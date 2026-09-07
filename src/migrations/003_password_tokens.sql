-- ══════════════════════════════════════════════════════════════════
-- Migration 003 — Password Token Management
-- Source: schema-password-tokens.sql
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set BOOLEAN DEFAULT FALSE;
UPDATE users SET password_set = true WHERE id = 'ENT001';

CREATE TABLE IF NOT EXISTS password_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(64) NOT NULL UNIQUE,
  type       VARCHAR(20) NOT NULL CHECK (type IN ('set_password','reset_password')),
  expires_at TIMESTAMP NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_tokens_token ON password_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_tokens_user  ON password_tokens(user_id);
