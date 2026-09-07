-- ══════════════════════════════════════════════════════════════════
-- Migration 007 — Fees Table Fixes
-- Source: schema-v3-fees-fix.sql
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE fees ADD COLUMN IF NOT EXISTS fee_type     VARCHAR(50);
ALTER TABLE fees ADD COLUMN IF NOT EXISTS receipt_no   VARCHAR(50);
ALTER TABLE fees ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(30);

ALTER TABLE fees DROP CONSTRAINT IF EXISTS fees_status_check;
ALTER TABLE fees ADD CONSTRAINT fees_status_check
  CHECK (status IN ('paid','due','overdue','pending'));
