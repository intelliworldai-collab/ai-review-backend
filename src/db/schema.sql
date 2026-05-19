-- AI Review Backend — Database Schema
-- Run this once on your Railway PostgreSQL database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             TEXT NOT NULL UNIQUE,
  google_id         TEXT UNIQUE,
  access_token      TEXT,
  refresh_token     TEXT,
  token_expiry      TIMESTAMPTZ,
  plan_status       TEXT NOT NULL DEFAULT 'trial',  -- trial | active | cancelled
  ls_customer_id    TEXT,                            -- Lemon Squeezy customer ID
  ls_subscription_id TEXT,                           -- Lemon Squeezy subscription ID
  trial_replies_used INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── LOCATIONS ──────────────────────────────────────────────────────
-- One user can have multiple Google Business locations (restaurant chain etc.)
CREATE TABLE IF NOT EXISTS locations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_account_id TEXT NOT NULL,
  google_location_id TEXT NOT NULL,
  name              TEXT NOT NULL,
  address           TEXT,
  tone_preference   TEXT NOT NULL DEFAULT 'friendly',   -- friendly | professional
  length_preference TEXT NOT NULL DEFAULT 'medium',     -- short | medium | long
  digest_email      TEXT NOT NULL,
  digest_time       TEXT NOT NULL DEFAULT '09:00',      -- HH:MM in user timezone
  timezone          TEXT NOT NULL DEFAULT 'UTC',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(google_account_id, google_location_id)
);

-- ── REVIEWS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id       UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  google_review_id  TEXT NOT NULL UNIQUE,
  reviewer_name     TEXT,
  reviewer_photo    TEXT,
  star_rating       INTEGER NOT NULL CHECK (star_rating BETWEEN 1 AND 5),
  review_text       TEXT,
  review_date       TIMESTAMPTZ NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── REPLIES ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replies (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id         UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  ai_text           TEXT NOT NULL,          -- original AI generated reply
  final_text        TEXT,                   -- edited version (if owner edits)
  status            TEXT NOT NULL DEFAULT 'pending',
  -- pending | approved | edited | skipped | posted | failed
  approval_token    TEXT NOT NULL UNIQUE,   -- unique token for email link
  token_expires_at  TIMESTAMPTZ NOT NULL,   -- tokens expire after 7 days
  email_sent_at     TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  posted_at         TIMESTAMPTZ,
  post_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INDEXES ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reviews_location    ON reviews(location_id);
CREATE INDEX IF NOT EXISTS idx_reviews_date        ON reviews(review_date DESC);
CREATE INDEX IF NOT EXISTS idx_replies_status      ON replies(status);
CREATE INDEX IF NOT EXISTS idx_replies_token       ON replies(approval_token);
CREATE INDEX IF NOT EXISTS idx_locations_user      ON locations(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
