-- ══════════════════════════════════════════════════════════════════
-- Migration 009 — Teacher Employee Identity
-- Adds employee_id and aadhaar for staff identity.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS employee_id VARCHAR(20);

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS aadhaar VARCHAR(12);

CREATE UNIQUE INDEX IF NOT EXISTS uq_teachers_employee_id
  ON teachers(employee_id)
  WHERE employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teachers_aadhaar
  ON teachers(aadhaar)
  WHERE aadhaar IS NOT NULL;

ALTER TABLE teachers
  DROP CONSTRAINT IF EXISTS chk_teachers_aadhaar_digits;

ALTER TABLE teachers
  ADD CONSTRAINT chk_teachers_aadhaar_digits
  CHECK (aadhaar IS NULL OR aadhaar ~ '^[0-9]{12}$');
