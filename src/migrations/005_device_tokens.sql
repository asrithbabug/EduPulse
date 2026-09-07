-- ══════════════════════════════════════════════════════════════════
-- Migration 005 — FCM Device Tokens
-- Source: schema-device-tokens.sql
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS device_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
  fcm_token   TEXT NOT NULL,
  device_type VARCHAR(10) CHECK (device_type IN ('android','ios','web')),
  device_id   VARCHAR(100),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user   ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_active ON device_tokens(user_id, is_active) WHERE is_active = true;
