const express = require('express');
const router = express.Router();
const db = require('../db');
const { buildAuthClient, postReply } = require('../services/google');

async function getReplyWithContext(token) {
  const result = await db.query(`
    SELECT
      rp.id as reply_id, rp.ai_text, rp.final_text, rp.status,
      rp.approval_token, rp.token_expires_at,
      rv.google_review_id, rv.reviewer_name, rv.star_rating, rv.review_text,
      l.google_account_id, l.google_location_id, l.name as location_name,
      u.access_token, u.refresh_token, u.token_expiry
    FROM replies rp
    JOIN reviews rv ON rv.id = rp.review_id
    JOIN locations l ON l.id = rv.location_id
    JOIN users u ON u.id = l.user_id
    WHERE rp.approval_token = $1
  `, [token]);
  return result.rows[0] || null;
}

// ── APPROVE ──────────────────────────────────────────────────────────
router.get('/approve/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const row = await getReplyWithContext(token);

    if (!row) return res.status(404).send(page('Not found', '❌ This approval link is invalid or has expired.'));
    if (row.status === 'posted') return res.send(page('Already posted', '✅ This reply was already posted to Google.'));
    if (row.status === 'skipped') return res.send(page('Skipped', 'This review was marked as skipped.'));
    if (new Date(row.token_expires_at) < new Date()) {
      return res.send(page('Expired', '⏰ This approval link has expired (7 days). Please check your next digest email.'));
    }

    const replyText = row.final_text || row.ai_text;
    const authClient = buildAuthClient(row);

    await postReply(authClient, row.google_account_id, row.google_location_id, row.google_review_id, replyText);

    await db.query(
      `UPDATE replies SET status = 'posted', approved_at = NOW(), posted_at = NOW() WHERE approval_token = $1`,
      [token]
    );

    res.send(page('Reply Posted!', `
      <div style="text-align:center;">
        <div style="font-size:64px;margin-bottom:16px;">✅</div>
        <h2 style="color:#137333;">Reply posted to Google!</h2>
        <p style="color:#5f6368;">Your reply to <strong>${row.reviewer_name || 'the reviewer'}</strong> has been published.</p>
        <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin:20px 0;text-align:left;font-style:italic;color:#3c4043;">
          "${replyText}"
        </div>
        <p style="color:#9aa0a6;font-size:13px;">You can close this tab.</p>
      </div>
    `));
  } catch (err) {
    console.error('[Approve] Error:', err.message);

    await db.query(
      `UPDATE replies SET status = 'failed', post_error = $1 WHERE approval_token = $2`,
      [err.message, token]
    );

    res.status(500).send(page('Error', `
      <div style="text-align:center;">
        <div style="font-size:48px;">❌</div>
        <h2>Failed to post reply</h2>
        <p style="color:#c5221f;">${err.message}</p>
        <p>Please try again or reply manually on Google Business Profile.</p>
      </div>
    `));
  }
});

// ── EDIT ─────────────────────────────────────────────────────────────
router.get('/edit/:token', async (req, res) => {
  const { token } = req.params;
  const row = await getReplyWithContext(token);

  if (!row) return res.status(404).send(page('Not found', '❌ Link invalid or expired.'));
  if (row.status === 'posted') return res.send(page('Already posted', '✅ Already posted.'));

  const currentText = row.final_text || row.ai_text;

  res.send(page('Edit Reply', `
    <h2 style="margin-bottom:8px;">✏️ Edit Reply</h2>
    <p style="color:#5f6368;margin-bottom:20px;">
      Reviewing: <strong>${row.reviewer_name || 'Anonymous'}</strong>
      ${'⭐'.repeat(row.star_rating)}
    </p>
    <div style="background:#f8f9fa;border-radius:8px;padding:14px;margin-bottom:16px;font-style:italic;color:#3c4043;font-size:13px;">
      "${row.review_text || 'No text'}"
    </div>
    <form method="POST" action="/edit/${token}">
      <label style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#5f6368;">Your Reply</label>
      <textarea name="replyText" rows="6" style="width:100%;margin-top:8px;padding:12px;font-size:14px;border:1.5px solid #dadce0;border-radius:8px;resize:vertical;font-family:inherit;line-height:1.6;">${currentText}</textarea>
      <button type="submit" style="margin-top:12px;width:100%;padding:14px;background:#1a73e8;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">
        Post Reply to Google ✅
      </button>
    </form>
  `));
});

router.post('/edit/:token', express.urlencoded({ extended: true }), async (req, res) => {
  const { token } = req.params;
  const { replyText } = req.body;

  if (!replyText?.trim()) return res.redirect(`/edit/${token}`);

  try {
    const row = await getReplyWithContext(token);
    if (!row) return res.status(404).send(page('Not found', '❌ Link invalid.'));

    const authClient = buildAuthClient(row);
    await postReply(authClient, row.google_account_id, row.google_location_id, row.google_review_id, replyText.trim());

    await db.query(
      `UPDATE replies SET status = 'posted', final_text = $1, approved_at = NOW(), posted_at = NOW() WHERE approval_token = $2`,
      [replyText.trim(), token]
    );

    res.send(page('Posted!', `
      <div style="text-align:center;">
        <div style="font-size:64px;">✅</div>
        <h2 style="color:#137333;">Reply posted!</h2>
        <p style="color:#5f6368;">Your edited reply has been published to Google.</p>
      </div>
    `));
  } catch (err) {
    res.status(500).send(page('Error', `<p style="color:red;">${err.message}</p>`));
  }
});

// ── SKIP ─────────────────────────────────────────────────────────────
router.get('/skip/:token', async (req, res) => {
  await db.query(
    `UPDATE replies SET status = 'skipped' WHERE approval_token = $1 AND status = 'pending'`,
    [req.params.token]
  );
  res.send(page('Skipped', `
    <div style="text-align:center;">
      <div style="font-size:48px;">👍</div>
      <h2>Review skipped</h2>
      <p style="color:#5f6368;">This review won't be replied to. You can close this tab.</p>
    </div>
  `));
});

// ── APPROVE ALL ───────────────────────────────────────────────────────
router.get('/approve-all', async (req, res) => {
  const { tokens } = req.query;
  if (!tokens) return res.status(400).send(page('Error', 'No tokens provided.'));

  const tokenList = tokens.split(',').filter(Boolean);
  const results = { posted: 0, failed: 0 };

  for (const token of tokenList) {
    try {
      const row = await getReplyWithContext(token);
      if (!row || row.status === 'posted' || row.status === 'skipped') continue;
      if (new Date(row.token_expires_at) < new Date()) continue;

      const replyText = row.final_text || row.ai_text;
      const authClient = buildAuthClient(row);
      await postReply(authClient, row.google_account_id, row.google_location_id, row.google_review_id, replyText);
      await db.query(
        `UPDATE replies SET status = 'posted', approved_at = NOW(), posted_at = NOW() WHERE approval_token = $1`,
        [token]
      );
      results.posted++;
    } catch (err) {
      console.error('[ApproveAll] Failed for token:', token, err.message);
      results.failed++;
    }
  }

  res.send(page('All Done!', `
    <div style="text-align:center;">
      <div style="font-size:64px;">🎉</div>
      <h2 style="color:#137333;">${results.posted} replies posted!</h2>
      ${results.failed > 0 ? `<p style="color:#ea4335;">${results.failed} failed — please reply manually.</p>` : ''}
      <p style="color:#5f6368;">You can close this tab.</p>
    </div>
  `));
});

// ── PAGE TEMPLATE ─────────────────────────────────────────────────────
function page(title, body) {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Intelli Review</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Google Sans',Roboto,Arial,sans-serif; background:#f1f3f4; padding:24px 16px; color:#202124; }
    .card { max-width:520px; margin:40px auto; background:#fff; border-radius:16px; padding:32px; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
    h2 { margin-bottom:12px; font-size:22px; }
    p { color:#5f6368; line-height:1.6; margin-bottom:8px; font-size:14px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:13px;color:#1a73e8;font-weight:700;margin-bottom:20px;">✨ Intelli Review</div>
    ${body}
  </div>
</body></html>`;
}

module.exports = router;
