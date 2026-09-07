-- Normalized Student Admission schema design (non-breaking)
-- This migration creates a dedicated schema so existing production tables remain unaffected.

CREATE SCHEMA IF NOT EXISTS admission_v2;

-- 1) students (Core Identity)
CREATE TABLE IF NOT EXISTS admission_v2.students (
  id BIGSERIAL PRIMARY KEY,
  student_id VARCHAR(20) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
);

CREATE INDEX IF NOT EXISTS idx_adm_v2_students_status
  ON admission_v2.students(status);

-- 2) student_academic (Current Academic Information)
CREATE TABLE IF NOT EXISTS admission_v2.student_academic (
  student_id BIGINT PRIMARY KEY,
  class VARCHAR(20) NOT NULL,
  section VARCHAR(10) NOT NULL,
  medium VARCHAR(30),
  first_language VARCHAR(30),
  previous_class VARCHAR(30),
  previous_school VARCHAR(150),
  qualified_for_promotion BOOLEAN,
  tc_no VARCHAR(50),
  tc_date DATE,
  CONSTRAINT fk_adm_v2_student_academic_student
    FOREIGN KEY (student_id)
    REFERENCES admission_v2.students(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_adm_v2_student_academic_class_section
  ON admission_v2.student_academic(class, section);

-- 3) student_family (Parent/Guardian Information)
CREATE TABLE IF NOT EXISTS admission_v2.student_family (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL,
  relation_type VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL,
  email VARCHAR(100),
  aadhaar VARCHAR(12) NOT NULL,
  occupation VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_adm_v2_student_family_student
    FOREIGN KEY (student_id)
    REFERENCES admission_v2.students(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_adm_v2_relation_type
    CHECK (relation_type IN ('Father', 'Mother', 'Guardian'))
);

CREATE INDEX IF NOT EXISTS idx_adm_v2_student_family_student
  ON admission_v2.student_family(student_id);

CREATE INDEX IF NOT EXISTS idx_adm_v2_student_family_mobile
  ON admission_v2.student_family(mobile);

-- Optional dedupe control: one relation row per student type (Father/Mother/Guardian)
CREATE UNIQUE INDEX IF NOT EXISTS uq_adm_v2_student_family_relation
  ON admission_v2.student_family(student_id, relation_type);

-- 4) student_address (Address Information)
CREATE TABLE IF NOT EXISTS admission_v2.student_address (
  student_id BIGINT PRIMARY KEY,
  house_no VARCHAR(50),
  state VARCHAR(100) NOT NULL,
  district VARCHAR(100) NOT NULL,
  mandal VARCHAR(100) NOT NULL,
  village VARCHAR(100) NOT NULL,
  pin_code VARCHAR(6),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_adm_v2_student_address_student
    FOREIGN KEY (student_id)
    REFERENCES admission_v2.students(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_adm_v2_pin_code
    CHECK (pin_code IS NULL OR pin_code ~ '^[0-9]{6}$')
);

CREATE INDEX IF NOT EXISTS idx_adm_v2_student_address_geo
  ON admission_v2.student_address(state, district, mandal, village);

-- 5) student_admission (Admission Information)
CREATE TABLE IF NOT EXISTS admission_v2.student_admission (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL,
  admission_no VARCHAR(20) UNIQUE NOT NULL,
  admission_date DATE NOT NULL,
  admission_type VARCHAR(30) NOT NULL DEFAULT 'NEW',
  serial_no INT NOT NULL,
  admission_year INT NOT NULL,
  admission_month INT NOT NULL,
  legacy_flag BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_adm_v2_student_admission_student
    FOREIGN KEY (student_id)
    REFERENCES admission_v2.students(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_adm_v2_admission_no_digits
    CHECK (admission_no ~ '^[0-9]{11,20}$')
);

CREATE INDEX IF NOT EXISTS idx_adm_v2_student_admission_student
  ON admission_v2.student_admission(student_id);

CREATE INDEX IF NOT EXISTS idx_adm_v2_student_admission_date
  ON admission_v2.student_admission(admission_date);

-- Daily uniqueness for serial number design (YYYYMMDD + NNN)
CREATE UNIQUE INDEX IF NOT EXISTS uq_adm_v2_admission_daily_serial
  ON admission_v2.student_admission(admission_date, serial_no);

-- 6) student_additional (Personal/Additional Details)
CREATE TABLE IF NOT EXISTS admission_v2.student_additional (
  student_id BIGINT PRIMARY KEY,
  aadhaar VARCHAR(12) UNIQUE NOT NULL,
  mother_tongue VARCHAR(50),
  nationality VARCHAR(50),
  religion VARCHAR(50),
  caste VARCHAR(50),
  vaccinated BOOLEAN,
  conduct VARCHAR(50),
  identification_mark_1 TEXT,
  identification_mark_2 TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_adm_v2_student_additional_student
    FOREIGN KEY (student_id)
    REFERENCES admission_v2.students(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_adm_v2_aadhaar_digits
    CHECK (aadhaar ~ '^[0-9]{12}$')
);

-- Updated-at helper trigger
CREATE OR REPLACE FUNCTION admission_v2.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_adm_v2_students_updated_at'
  ) THEN
    CREATE TRIGGER trg_adm_v2_students_updated_at
    BEFORE UPDATE ON admission_v2.students
    FOR EACH ROW EXECUTE FUNCTION admission_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_adm_v2_student_family_updated_at'
  ) THEN
    CREATE TRIGGER trg_adm_v2_student_family_updated_at
    BEFORE UPDATE ON admission_v2.student_family
    FOR EACH ROW EXECUTE FUNCTION admission_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_adm_v2_student_address_updated_at'
  ) THEN
    CREATE TRIGGER trg_adm_v2_student_address_updated_at
    BEFORE UPDATE ON admission_v2.student_address
    FOR EACH ROW EXECUTE FUNCTION admission_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_adm_v2_student_admission_updated_at'
  ) THEN
    CREATE TRIGGER trg_adm_v2_student_admission_updated_at
    BEFORE UPDATE ON admission_v2.student_admission
    FOR EACH ROW EXECUTE FUNCTION admission_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_adm_v2_student_additional_updated_at'
  ) THEN
    CREATE TRIGGER trg_adm_v2_student_additional_updated_at
    BEFORE UPDATE ON admission_v2.student_additional
    FOR EACH ROW EXECUTE FUNCTION admission_v2.set_updated_at();
  END IF;
END $$;

-- Student creation transaction flow (application-side)
-- 1) Generate student_id using school-prefix + last4(student aadhaar)
-- 2) Generate admission_no as YYYYMMDD + NNN with daily serial lock
-- 3) BEGIN
-- 4) INSERT admission_v2.students
-- 5) INSERT admission_v2.student_academic
-- 6) INSERT admission_v2.student_family
-- 7) INSERT admission_v2.student_address
-- 8) INSERT admission_v2.student_admission
-- 9) INSERT admission_v2.student_additional
-- 10) COMMIT; on error ROLLBACK
