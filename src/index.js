require('dotenv').config();
const express = require('express');
const db = require('./db');
const authRouter     = require('./routes/auth');
const approveRouter  = require('./routes/approve');
const webhookRouter  = require('./routes/webhook');
const dashRouter     = require('./routes/dashboard');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── ROUTES ────────────────────────────────────────────────────────────
app.use('/', authRouter);
app.use('/', approveRouter);
app.use('/', webhookRouter);
app.use('/', dashRouter);

// Health check — Railway uses this to verify the app is alive
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Home — simple landing with connect button
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

app.get('/', (req, res) => {
  const error = req.query.error;
  res.send(`<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Intelli Review</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Google Sans',Roboto,Arial,sans-serif;background:#f1f3f4;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:20px;padding:48px 40px;max-width:460px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.1);text-align:center}
    .logo{font-size:48px;margin-bottom:16px}
    h1{font-size:26px;font-weight:800;margin-bottom:8px;color:#202124}
    .tagline{color:#5f6368;font-size:14px;line-height:1.6;margin-bottom:28px}
    .btn{display:inline-flex;align-items:center;gap:10px;padding:14px 28px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;transition:background 0.15s;width:100%;justify-content:center}
    .btn:hover{background:#1557b0}
    .btn-login{background:#fff;color:#1a73e8;border:1.5px solid #dadce0;margin-top:10px}
    .btn-login:hover{background:#f8f9fa}
    .divider{display:flex;align-items:center;gap:12px;margin:20px 0;color:#9aa0a6;font-size:12px}
    .divider::before,.divider::after{content:'';flex:1;height:1px;background:#dadce0}
    .error{background:#fce8e6;color:#c5221f;padding:10px 16px;border-radius:8px;font-size:13px;margin-bottom:20px;text-align:left}
    .steps{text-align:left;background:#f8f9fa;border-radius:10px;padding:20px 20px 20px 36px;margin-top:24px}
    .steps li{font-size:13px;color:#5f6368;margin-bottom:8px;line-height:1.5}
    .steps li:last-child{margin-bottom:0}
    .price{display:inline-block;background:#e8f0fe;color:#1a73e8;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:24px}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">✨</div>
    <h1>Intelli Review</h1>
    <div class="price">$12.99 / month · 5 replies free</div>
    <p class="tagline">Stop spending 30 minutes a day on Google reviews.<br>We generate replies — you approve in 90 seconds.</p>
    ${error ? `<div class="error">⚠️ ${esc(error) === 'auth_failed' ? 'Google sign-in failed. Please try again.' : esc(error)}</div>` : ''}
    <a class="btn" href="/auth/google">
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Get Started — Connect Google Business
    </a>
    <div class="divider">already a member?</div>
    <a class="btn btn-login" href="/auth/google">
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#1a73e8" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#1a73e8" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#1a73e8" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#1a73e8" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Log in with Google
    </a>
    <ol class="steps">
      <li>Connect your Google Business Profile</li>
      <li>We check for new reviews every 2 hours</li>
      <li>You get an email digest with AI replies to approve</li>
      <li>One click → reply posted to Google automatically</li>
    </ol>
  </div>
</body></html>`);
});

// ── START ─────────────────────────────────────────────────────────────
async function start() {
  // Verify DB connection
  try {
    await db.query('SELECT 1');
    console.log('[DB] PostgreSQL connected');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
    startScheduler();
  });
}

start();
