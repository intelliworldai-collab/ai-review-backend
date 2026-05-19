const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');

// Verify Lemon Squeezy webhook signature
function verifySignature(payload, signature) {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return hmac === signature;
}

router.post('/webhook/lemonsqueezy',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-signature'];
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(req.body.toString());
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventName = event.meta?.event_name;
    const attrs = event.data?.attributes;
    const customerId = String(event.data?.attributes?.customer_id || '');
    const subscriptionId = String(event.data?.id || '');
    const userEmail = attrs?.user_email || attrs?.billing_address?.email;

    console.log('[Webhook] Lemon Squeezy event:', eventName);

    try {
      if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
        const status = attrs?.status === 'active' ? 'active' : 'cancelled';

        if (userEmail) {
          await db.query(
            `UPDATE users SET
               plan_status = $1,
               ls_customer_id = $2,
               ls_subscription_id = $3
             WHERE email = $4`,
            [status, customerId, subscriptionId, userEmail]
          );
        }
      }

      if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
        if (userEmail) {
          await db.query(
            `UPDATE users SET plan_status = 'cancelled' WHERE email = $1`,
            [userEmail]
          );
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error('[Webhook] DB error:', err.message);
      res.status(500).json({ error: 'DB error' });
    }
  }
);

module.exports = router;
