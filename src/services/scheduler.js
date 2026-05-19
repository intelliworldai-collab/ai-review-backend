const cron = require('node-cron');
const db = require('../db');
const { buildAuthClient, getUnansweredReviews, starToNumber } = require('./google');
const { generateReply } = require('./claude');
const { sendDigestEmail } = require('./email');
const { generateApprovalToken, tokenExpiryDate } = require('../utils/token');

// Process a single location: fetch new reviews, generate replies, send email
async function processLocation(location, user) {
  try {
    console.log(`[Scheduler] Processing location: ${location.name}`);

    const isTrial = user.plan_status !== 'active';
    const remainingTrialReplies = isTrial ? (5 - (user.trial_replies_used || 0)) : Infinity;
    if (isTrial && remainingTrialReplies <= 0) {
      console.log(`[Scheduler] Trial limit reached for user ${user.user_id}`);
      return;
    }

    const authClient = buildAuthClient(user, db);

    // Fetch unanswered reviews from Google
    const googleReviews = await getUnansweredReviews(
      authClient,
      location.google_account_id,
      location.google_location_id
    );

    if (googleReviews.length === 0) {
      console.log(`[Scheduler] No new reviews for ${location.name}`);
      return;
    }

    const newReviewsWithReplies = [];

    for (const gr of googleReviews) {
      const googleReviewId = gr.reviewId || gr.name;
      const starRating = starToNumber(gr.starRating);
      const reviewText = gr.comment || '';
      const reviewerName = gr.reviewer?.displayName || 'Anonymous';
      const reviewerPhoto = gr.reviewer?.profilePhotoUrl || null;
      const reviewDate = gr.createTime ? new Date(gr.createTime) : new Date();

      // Skip if we've already processed this review
      const existing = await db.query(
        'SELECT id FROM reviews WHERE google_review_id = $1',
        [googleReviewId]
      );
      if (existing.rows.length > 0) continue;

      // Save review to DB
      const reviewResult = await db.query(
        `INSERT INTO reviews (location_id, google_review_id, reviewer_name, reviewer_photo, star_rating, review_text, review_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [location.id, googleReviewId, reviewerName, reviewerPhoto, starRating, reviewText, reviewDate]
      );
      const reviewId = reviewResult.rows[0].id;

      // Stop generating if trial quota would be exceeded
      if (isTrial && newReviewsWithReplies.length >= remainingTrialReplies) {
        console.log(`[Scheduler] Trial quota reached mid-batch for user ${user.user_id}`);
        break;
      }

      // Generate AI reply
      let aiText;
      try {
        aiText = await generateReply(
          reviewText || `${starRating} star review with no text`,
          starRating,
          location.tone_preference,
          location.length_preference
        );
      } catch (err) {
        console.error(`[Scheduler] Claude error for review ${googleReviewId}:`, err.message);
        continue;
      }

      // Save reply with approval token
      const token = generateApprovalToken();
      const tokenExpiry = tokenExpiryDate();

      const replyResult = await db.query(
        `INSERT INTO replies (review_id, ai_text, approval_token, token_expires_at)
         VALUES ($1, $2, $3, $4) RETURNING id, ai_text, approval_token`,
        [reviewId, aiText, token, tokenExpiry]
      );

      newReviewsWithReplies.push({
        review: { reviewer_name: reviewerName, star_rating: starRating, review_text: reviewText },
        reply: replyResult.rows[0]
      });

      console.log(`[Scheduler] Generated reply for review from ${reviewerName}`);
    }

    // Send digest email if there are new replies to approve
    if (newReviewsWithReplies.length > 0) {
      await sendDigestEmail({
        toEmail: location.digest_email,
        locationName: location.name,
        reviewsWithReplies: newReviewsWithReplies
      });

      // Mark email sent timestamp on all replies
      const replyIds = newReviewsWithReplies.map(r => r.reply.id);
      await db.query(
        `UPDATE replies SET email_sent_at = NOW() WHERE id = ANY($1::uuid[])`,
        [replyIds]
      );

      // Increment trial counter if user is on trial
      if (isTrial) {
        await db.query(
          `UPDATE users SET trial_replies_used = trial_replies_used + $1 WHERE id = $2`,
          [newReviewsWithReplies.length, user.user_id]
        );
      }

      console.log(`[Scheduler] Digest email sent to ${location.digest_email} with ${newReviewsWithReplies.length} reviews`);
    }

  } catch (err) {
    console.error(`[Scheduler] Error processing location ${location.name}:`, err.message);
  }
}

// Main job: runs every 2 hours
async function runReviewJob() {
  console.log(`[Scheduler] Starting review job at ${new Date().toISOString()}`);

  try {
    // Get all active locations with their user's tokens
    const result = await db.query(`
      SELECT
        l.id, l.name, l.google_account_id, l.google_location_id,
        l.tone_preference, l.length_preference, l.digest_email,
        u.id as user_id, u.access_token, u.refresh_token, u.token_expiry,
        u.plan_status, u.trial_replies_used
      FROM locations l
      JOIN users u ON u.id = l.user_id
      WHERE l.is_active = TRUE
        AND (u.plan_status = 'active' OR u.trial_replies_used < 5)
    `);

    const locations = result.rows;
    console.log(`[Scheduler] Processing ${locations.length} active locations`);

    for (const loc of locations) {
      await processLocation(loc, loc);
    }

    console.log(`[Scheduler] Job complete`);
  } catch (err) {
    console.error('[Scheduler] Job failed:', err.message);
  }
}

function startScheduler() {
  // Run every 2 hours
  cron.schedule('0 */2 * * *', runReviewJob);
  console.log('[Scheduler] Started — runs every 2 hours');

  // Also run once on startup after 10 seconds (so server is ready)
  setTimeout(runReviewJob, 10_000);
}

module.exports = { startScheduler, runReviewJob };
