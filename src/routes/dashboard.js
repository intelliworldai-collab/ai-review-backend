const express = require('express');
const router = express.Router();
const db = require('../db');

function starBar(n) {
  return '⭐'.repeat(n) + '☆'.repeat(5 - n);
}

function statusBadge(status) {
  const map = {
    pending:  { color: '#fbbc04', label: 'Pending' },
    posted:   { color: '#34a853', label: 'Posted ✅' },
    skipped:  { color: '#9aa0a6', label: 'Skipped' },
    failed:   { color: '#ea4335', label: 'Failed ❌' },
    edited:   { color: '#1a73e8', label: 'Edited' },
  };
  const s = map[status] || { color: '#9aa0a6', label: status };
  return `<span style="background:${s.color};color:#fff;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;">${s.label}</span>`;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.redirect('/');

  try {
    const userResult = await db.query(
      'SELECT id, email, plan_status, trial_replies_used FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows.length) return res.redirect('/');
    const user = userResult.rows[0];

    const locResult = await db.query(
      'SELECT id, name FROM locations WHERE user_id = $1 AND is_active = TRUE',
      [userId]
    );
    const locations = locResult.rows;

    // Last 20 reviews across all their locations
    const reviewResult = await db.query(`
      SELECT
        rv.reviewer_name, rv.star_rating, rv.review_text, rv.review_date,
        rp.status, rp.ai_text, rp.posted_at,
        l.name as location_name
      FROM reviews rv
      JOIN locations l ON l.id = rv.location_id
      LEFT JOIN replies rp ON rp.review_id = rv.id
      WHERE l.user_id = $1
      ORDER BY rv.review_date DESC
      LIMIT 20
    `, [userId]);
    const reviews = reviewResult.rows;

    // Stats
    const statsResult = await db.query(`
      SELECT
        COUNT(rv.id) FILTER (WHERE rp.status = 'posted') as posted,
        COUNT(rv.id) FILTER (WHERE rp.status = 'pending') as pending,
        COUNT(rv.id) FILTER (WHERE rp.status = 'skipped') as skipped,
        ROUND(AVG(rv.star_rating), 1) as avg_stars
      FROM reviews rv
      JOIN locations l ON l.id = rv.location_id
      LEFT JOIN replies rp ON rp.review_id = rv.id
      WHERE l.user_id = $1
    `, [userId]);
    const stats = statsResult.rows[0];

    const planBadge = user.plan_status === 'active'
      ? `<span style="background:#34a853;color:#fff;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;">Pro ✅</span>`
      : `<span style="background:#fbbc04;color:#000;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;">Trial (${user.trial_replies_used}/5 replies used)</span>`;

    const reviewRows = reviews.map(r => `
      <tr style="border-bottom:1px solid #f1f3f4;">
        <td style="padding:12px 8px;">
          <div style="font-weight:600;font-size:13px;">${r.reviewer_name || 'Anonymous'}</div>
          <div style="font-size:11px;color:#9aa0a6;">${r.location_name}</div>
        </td>
        <td style="padding:12px 8px;font-size:13px;">${starBar(r.star_rating)}</td>
        <td style="padding:12px 8px;font-size:12px;color:#5f6368;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.review_text || '—'}</td>
        <td style="padding:12px 8px;">${statusBadge(r.status || 'no reply')}</td>
        <td style="padding:12px 8px;font-size:11px;color:#9aa0a6;">${r.review_date ? new Date(r.review_date).toLocaleDateString() : '—'}</td>
      </tr>
    `).join('');

    res.send(`<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dashboard — AI Review Reply</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Google Sans',Roboto,Arial,sans-serif;background:#f1f3f4;color:#202124}
    .nav{background:#fff;border-bottom:1px solid #dadce0;padding:0 32px;display:flex;align-items:center;justify-content:space-between;height:56px}
    .nav-brand{font-weight:800;font-size:16px;color:#1a73e8}
    .nav-links{display:flex;gap:16px;align-items:center}
    .nav-links a{font-size:13px;color:#5f6368;text-decoration:none;padding:6px 12px;border-radius:6px}
    .nav-links a:hover{background:#f1f3f4}
    .container{max-width:1000px;margin:32px auto;padding:0 24px}
    .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
    .stat{background:#fff;border-radius:12px;padding:20px;border:1px solid #dadce0}
    .stat-value{font-size:28px;font-weight:800;color:#202124}
    .stat-label{font-size:12px;color:#9aa0a6;margin-top:4px}
    .card{background:#fff;border-radius:12px;border:1px solid #dadce0;overflow:hidden;margin-bottom:24px}
    .card-header{padding:16px 20px;border-bottom:1px solid #f1f3f4;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:space-between}
    table{width:100%;border-collapse:collapse}
    th{padding:10px 8px;font-size:11px;color:#9aa0a6;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-align:left;background:#fafafa}
    .btn{display:inline-block;padding:8px 18px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600}
    .btn-outline{background:#fff;color:#1a73e8;border:1.5px solid #1a73e8}
  </style>
</head>
<body>
  <nav class="nav">
    <div class="nav-brand">✨ AI Review Reply</div>
    <div class="nav-links">
      <a href="/dashboard?userId=${userId}">Dashboard</a>
      <a href="/settings?userId=${userId}">Settings</a>
      ${planBadge}
    </div>
  </nav>
  <div class="container">
    <div style="margin-bottom:24px;">
      <div style="font-size:20px;font-weight:800;">Good morning 👋</div>
      <div style="font-size:13px;color:#9aa0a6;margin-top:4px;">${user.email} · ${locations.length} location(s) connected</div>
    </div>

    <div class="stat-grid">
      <div class="stat">
        <div class="stat-value">${stats.posted || 0}</div>
        <div class="stat-label">Replies posted</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.pending || 0}</div>
        <div class="stat-label">Pending approval</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.avg_stars || '—'}</div>
        <div class="stat-label">Avg star rating</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.skipped || 0}</div>
        <div class="stat-label">Skipped</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        Recent Reviews
        <a class="btn btn-outline" href="/settings?userId=${userId}">⚙️ Settings</a>
      </div>
      ${reviews.length === 0
        ? '<div style="padding:40px;text-align:center;color:#9aa0a6;">No reviews yet. We check every 2 hours.</div>'
        : `<table>
            <thead><tr>
              <th>Reviewer</th><th>Rating</th><th>Review</th><th>Status</th><th>Date</th>
            </tr></thead>
            <tbody>${reviewRows}</tbody>
          </table>`
      }
    </div>
  </div>
</body></html>`);
  } catch (err) {
    console.error('[Dashboard] Error:', err.message);
    res.status(500).send('Dashboard error: ' + err.message);
  }
});

// ── SETTINGS ──────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.redirect('/');

  try {
    const locResult = await db.query(
      'SELECT * FROM locations WHERE user_id = $1 AND is_active = TRUE',
      [userId]
    );
    const locations = locResult.rows;

    const locationForms = locations.map(loc => `
      <form method="POST" action="/settings/location/${loc.id}?userId=${userId}"
            style="background:#fff;border:1px solid #dadce0;border-radius:12px;padding:24px;margin-bottom:20px;">
        <div style="font-weight:700;font-size:15px;margin-bottom:20px;">📍 ${loc.name}</div>

        <div style="margin-bottom:16px;">
          <label style="font-size:12px;font-weight:700;text-transform:uppercase;color:#5f6368;display:block;margin-bottom:6px;">
            Digest email address
          </label>
          <input name="digest_email" type="email" value="${loc.digest_email}"
            style="width:100%;padding:10px 12px;border:1.5px solid #dadce0;border-radius:8px;font-size:14px;">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px;">
          <div>
            <label style="font-size:12px;font-weight:700;text-transform:uppercase;color:#5f6368;display:block;margin-bottom:6px;">
              Reply tone
            </label>
            <select name="tone_preference"
              style="width:100%;padding:10px 12px;border:1.5px solid #dadce0;border-radius:8px;font-size:14px;background:#fff;">
              <option value="friendly" ${loc.tone_preference === 'friendly' ? 'selected' : ''}>Friendly</option>
              <option value="professional" ${loc.tone_preference === 'professional' ? 'selected' : ''}>Professional</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;text-transform:uppercase;color:#5f6368;display:block;margin-bottom:6px;">
              Reply length
            </label>
            <select name="length_preference"
              style="width:100%;padding:10px 12px;border:1.5px solid #dadce0;border-radius:8px;font-size:14px;background:#fff;">
              <option value="short"  ${loc.length_preference === 'short'  ? 'selected' : ''}>Short (2–3 sentences)</option>
              <option value="medium" ${loc.length_preference === 'medium' ? 'selected' : ''}>Medium (3–5 sentences)</option>
              <option value="long"   ${loc.length_preference === 'long'   ? 'selected' : ''}>Long (5–7 sentences)</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;text-transform:uppercase;color:#5f6368;display:block;margin-bottom:6px;">
              Daily digest time
            </label>
            <input name="digest_time" type="time" value="${loc.digest_time}"
              style="width:100%;padding:10px 12px;border:1.5px solid #dadce0;border-radius:8px;font-size:14px;">
          </div>
        </div>

        <button type="submit"
          style="padding:10px 24px;background:#1a73e8;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
          Save Changes
        </button>
      </form>
    `).join('');

    res.send(`<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Settings — AI Review Reply</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Google Sans',Roboto,Arial,sans-serif;background:#f1f3f4;color:#202124}
    .nav{background:#fff;border-bottom:1px solid #dadce0;padding:0 32px;display:flex;align-items:center;justify-content:space-between;height:56px}
    .nav-brand{font-weight:800;font-size:16px;color:#1a73e8}
    .nav-links a{font-size:13px;color:#5f6368;text-decoration:none;padding:6px 12px;border-radius:6px}
    .nav-links a:hover{background:#f1f3f4}
    .container{max-width:680px;margin:32px auto;padding:0 24px}
  </style>
</head>
<body>
  <nav class="nav">
    <div class="nav-brand">✨ AI Review Reply</div>
    <div class="nav-links">
      <a href="/dashboard?userId=${userId}">← Dashboard</a>
    </div>
  </nav>
  <div class="container">
    <div style="font-size:20px;font-weight:800;margin-bottom:24px;">⚙️ Settings</div>
    ${locations.length === 0
      ? '<p style="color:#9aa0a6;">No locations connected yet.</p>'
      : locationForms
    }
  </div>
</body></html>`);
  } catch (err) {
    res.status(500).send('Settings error: ' + err.message);
  }
});

router.post('/settings/location/:locId', express.urlencoded({ extended: true }), async (req, res) => {
  const { locId } = req.params;
  const { userId } = req.query;
  const { digest_email, tone_preference, length_preference, digest_time } = req.body;

  await db.query(
    `UPDATE locations SET
       digest_email      = $1,
       tone_preference   = $2,
       length_preference = $3,
       digest_time       = $4
     WHERE id = $5 AND user_id = $6`,
    [digest_email, tone_preference, length_preference, digest_time, locId, userId]
  );

  res.redirect(`/settings?userId=${userId}&saved=1`);
});

// ── UNSUBSCRIBE ───────────────────────────────────────────────────────
router.get('/unsubscribe', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).send('Missing email parameter.');

  await db.query(
    `UPDATE locations SET is_active = FALSE
     WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [email]
  );

  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Unsubscribed</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f1f3f4}
.card{background:#fff;border-radius:16px;padding:40px;max-width:440px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.1)}</style>
</head><body>
  <div class="card">
    <div style="font-size:48px;margin-bottom:16px;">👋</div>
    <h2 style="margin-bottom:12px;">You've been unsubscribed</h2>
    <p style="color:#5f6368;line-height:1.6;">We've stopped sending digest emails for <strong>${email}</strong>.
    Your Google Business Profile is still connected — we've just paused the automation.</p>
    <p style="color:#9aa0a6;font-size:13px;margin-top:16px;">Changed your mind? Log back in to reactivate.</p>
  </div>
</body></html>`);
});

module.exports = router;
