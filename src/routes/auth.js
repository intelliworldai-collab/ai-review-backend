const express = require('express');
const router = express.Router();
const db = require('../db');
const { getAuthUrl, exchangeCodeForTokens, getUserInfo, getAccounts, getLocations, buildAuthClient } = require('../services/google');

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Step 1 — Redirect user to Google OAuth
router.get('/auth/google', (req, res) => {
  res.redirect(getAuthUrl());
});

// Step 2 — Google redirects back here with a code
router.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokens = await exchangeCodeForTokens(code);
    const userInfo = await getUserInfo(tokens.access_token);

    // Check if user already exists and has locations set up
    const existing = await db.query(
      `SELECT u.id, u.plan_status,
              (SELECT COUNT(*) FROM locations WHERE user_id = u.id AND is_active = TRUE) as loc_count
       FROM users u WHERE u.email = $1`,
      [userInfo.email]
    );

    // Save or update user tokens
    const result = await db.query(
      `INSERT INTO users (email, google_id, access_token, refresh_token, token_expiry)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         access_token  = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token),
         token_expiry  = EXCLUDED.token_expiry,
         google_id     = EXCLUDED.google_id
       RETURNING id, email, plan_status`,
      [
        userInfo.email,
        userInfo.id,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null
      ]
    );

    const user = result.rows[0];
    const isReturningUser = existing.rows.length > 0 && parseInt(existing.rows[0].loc_count) > 0;

    // Returning users go straight to dashboard — no setup needed
    if (isReturningUser) {
      return res.redirect(`/dashboard?userId=${user.id}`);
    }

    // New users go through location setup
    res.redirect(`/setup?userId=${user.id}`);
  } catch (err) {
    console.error('[Auth] OAuth callback error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

// Step 3 — Connect Google Business locations (new users only)
router.get('/setup', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('Missing userId');

  try {
    const userResult = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!userResult.rows.length) return res.status(404).send('User not found');

    const user = userResult.rows[0];
    const authClient = buildAuthClient(user);
    const accounts = await getAccounts(authClient);

    if (!accounts.length) {
      return res.send(setupPage('No Business Account Found', `
        <div style="text-align:center;padding:20px 0;">
          <div style="font-size:48px;margin-bottom:16px;">🔍</div>
          <h2>No Google Business account found</h2>
          <p style="color:#5f6368;margin-top:12px;">Make sure you have a Google Business Profile set up at
            <a href="https://business.google.com" target="_blank">business.google.com</a> and try again.</p>
          <a href="/auth/google" style="display:inline-block;margin-top:20px;padding:10px 24px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Try Again</a>
        </div>
      `));
    }

    const account = accounts[0];
    const locations = await getLocations(authClient, account.name);

    if (!locations.length) {
      return res.send(setupPage('No Locations Found', `
        <div style="text-align:center;padding:20px 0;">
          <div style="font-size:48px;margin-bottom:16px;">📍</div>
          <h2>No locations found</h2>
          <p style="color:#5f6368;margin-top:12px;">Your Google Business account has no locations yet. Add one at
            <a href="https://business.google.com" target="_blank">business.google.com</a>.</p>
        </div>
      `));
    }

    // Auto-connect all locations
    for (const loc of locations) {
      const locId = loc.name;
      const locName = loc.title || 'My Business';
      await db.query(
        `INSERT INTO locations (user_id, google_account_id, google_location_id, name, digest_email)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (google_account_id, google_location_id) DO NOTHING`,
        [user.id, account.name, locId, locName, user.email]
      );
    }

    const locList = locations.map(l => `<li style="margin-bottom:6px;">📍 ${esc(l.title || 'My Business')}</li>`).join('');

    res.send(setupPage('You\'re connected!', `
      <div style="text-align:center;">
        <div style="font-size:64px;margin-bottom:16px;">🎉</div>
        <h2 style="color:#137333;margin-bottom:12px;">You're all set!</h2>
        <p style="color:#5f6368;margin-bottom:20px;">Connected <strong>${locations.length}</strong> location(s):</p>
        <ul style="text-align:left;list-style:none;background:#f8f9fa;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          ${locList}
        </ul>
        <p style="color:#5f6368;font-size:13px;margin-bottom:24px;">
          We'll check for new reviews every 2 hours and email you a digest to approve.
          Your first check runs in the next few minutes.
        </p>
        <a href="/dashboard?userId=${userId}"
           style="display:inline-block;padding:12px 32px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">
          Go to Dashboard →
        </a>
      </div>
    `));
  } catch (err) {
    console.error('[Setup] Error:', err.message);
    res.status(500).send(setupPage('Setup Failed', `<p style="color:#c5221f;">${esc(err.message)}</p>`));
  }
});

function setupPage(title, body) {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} — Intelli Review</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Google Sans',Roboto,Arial,sans-serif;background:#f1f3f4;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:16px;padding:40px;max-width:480px;width:100%;box-shadow:0 2px 16px rgba(0,0,0,0.1)}
    .brand{font-size:13px;color:#1a73e8;font-weight:700;margin-bottom:24px;}
    h2{font-size:22px;font-weight:800;margin-bottom:8px}
    p{color:#5f6368;font-size:14px;line-height:1.6}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">✨ Intelli Review</div>
    ${body}
  </div>
</body></html>`;
}

module.exports = router;
