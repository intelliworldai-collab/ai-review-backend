const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function starEmoji(n) {
  return '⭐'.repeat(n) + '☆'.repeat(5 - n);
}

function sentimentColor(stars) {
  if (stars >= 4) return '#34a853';
  if (stars === 3) return '#fbbc04';
  return '#ea4335';
}

function buildReviewCard(review, reply) {
  const color = sentimentColor(review.star_rating);
  return `
    <div style="border:1px solid #dadce0;border-radius:12px;padding:20px;margin-bottom:20px;background:#ffffff;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="width:40px;height:40px;border-radius:50%;background:#e8eaed;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#5f6368;">
          ${review.reviewer_name ? review.reviewer_name[0].toUpperCase() : '?'}
        </div>
        <div>
          <div style="font-weight:700;font-size:14px;color:#202124;">${review.reviewer_name || 'Anonymous'}</div>
          <div style="color:${color};font-size:13px;">${starEmoji(review.star_rating)} ${review.star_rating}/5</div>
        </div>
      </div>

      <div style="background:#f8f9fa;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;color:#3c4043;line-height:1.6;font-style:italic;">
        "${review.review_text || 'No text provided'}"
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#5f6368;margin-bottom:8px;">AI Generated Reply</div>
        <div style="background:#e8f0fe;border-left:3px solid #1a73e8;border-radius:0 8px 8px 0;padding:14px;font-size:13px;color:#202124;line-height:1.6;">
          ${reply.ai_text}
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="${BASE_URL}/approve/${reply.approval_token}"
           style="display:inline-block;padding:10px 20px;background:#34a853;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;">
          ✅ Approve &amp; Post
        </a>
        <a href="${BASE_URL}/edit/${reply.approval_token}"
           style="display:inline-block;padding:10px 20px;background:#ffffff;color:#1a73e8;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;border:1.5px solid #1a73e8;">
          ✏️ Edit Reply
        </a>
        <a href="${BASE_URL}/skip/${reply.approval_token}"
           style="display:inline-block;padding:10px 20px;background:#ffffff;color:#5f6368;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;border:1.5px solid #dadce0;">
          ❌ Skip
        </a>
      </div>
    </div>`;
}

async function sendDigestEmail({ toEmail, locationName, reviewsWithReplies }) {
  const count = reviewsWithReplies.length;
  const allApproveTokens = reviewsWithReplies.map(r => r.reply.approval_token).join(',');

  const reviewCards = reviewsWithReplies.map(({ review, reply }) =>
    buildReviewCard(review, reply)
  ).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f3f4;font-family:'Google Sans',Roboto,Arial,sans-serif;">
  <div style="max-width:600px;margin:24px auto;padding:0 16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a73e8,#0d47a1);border-radius:16px 16px 0 0;padding:28px 28px 24px;">
      <div style="font-size:24px;margin-bottom:4px;">✨</div>
      <div style="font-size:22px;font-weight:800;color:#ffffff;margin-bottom:4px;">AI Review Digest</div>
      <div style="font-size:14px;color:#a8c7fa;">${locationName} · ${count} new review${count !== 1 ? 's' : ''} need${count === 1 ? 's' : ''} a reply</div>
    </div>

    <!-- Body -->
    <div style="background:#f8f9fa;padding:24px 28px;border:1px solid #dadce0;border-top:none;">

      <!-- Approve all -->
      <div style="background:#ffffff;border:1px solid #dadce0;border-radius:10px;padding:16px;margin-bottom:24px;text-align:center;">
        <div style="font-size:13px;color:#5f6368;margin-bottom:12px;">Approve all ${count} AI replies at once</div>
        <a href="${BASE_URL}/approve-all?tokens=${allApproveTokens}"
           style="display:inline-block;padding:12px 32px;background:#1a73e8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
          ✅ Approve All (${count}) &amp; Post
        </a>
      </div>

      <!-- Individual review cards -->
      ${reviewCards}

      <!-- Footer note -->
      <div style="text-align:center;font-size:11px;color:#9aa0a6;margin-top:8px;line-height:1.6;">
        Approve links expire in 7 days.<br>
        Powered by AI Review Reply · <a href="${BASE_URL}/unsubscribe?email=${encodeURIComponent(toEmail)}" style="color:#9aa0a6;">Unsubscribe</a>
      </div>
    </div>

  </div>
</body>
</html>`;

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'AI Review Reply <digest@aireviewreply.com>',
    to: toEmail,
    subject: `${count} new Google review${count !== 1 ? 's' : ''} ready to approve — ${locationName}`,
    html
  });
}

module.exports = { sendDigestEmail };
