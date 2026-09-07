-- Normalized Teacher schema design (non-breaking)
-- This migration creates a dedicated schema so existing production tables remain unaffected.

CREATE SCHEMA IF NOT EXISTS teacher_v2;

-- 1) teachers (Anchor)
CREATE TABLE IF NOT EXISTS teacher_v2.teachers (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(20) UNIQUE NOT NULL,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_teacher_v2_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_teacher_v2_status
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED'))
);

CREATE INDEX IF NOT EXISTS idx_teacher_v2_teachers_school_status
  ON teacher_v2.teachers(school_id, status);

-- 2) teacher_identity (1:1)
CREATE TABLE IF NOT EXISTS teacher_v2.teacher_identity (
  teacher_id BIGINT PRIMARY KEY,
  employee_id VARCHAR(20) UNIQUE NOT NULL,
  aadhaar VARCHAR(12) UNIQUE NOT NULL,
  aadhaar_last4 VARCHAR(4) NOT NULL,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_teacher_v2_identity_teacher
    FOREIGN KEY (teacher_id)
    REFERENCES teacher_v2.teachers(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_teacher_v2_aadhaar_digits
    CHECK (aadhaar ~ '^[0-9]{12}$'),
  CONSTRAINT chk_teacher_v2_aadhaar_last4
    CHECK (aadhaar_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT chk_teacher_v2_verification_status
    CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_teacher_v2_identity_employee
  ON teacher_v2.teacher_identity(employee_id);

-- 3) teacher_professional (1:1)
CREATE TABLE IF NOT EXISTS teacher_v2.teacher_professional (
  teacher_id BIGINT PRIMARY KEY,
  staff_type VARCHAR(20) NOT NULL,
  role VARCHAR(50) NOT NULL,
  subject VARCHAR(50),
  department VARCHAR(50),
  qualification VARCHAR(120),
  experience_years INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_teacher_v2_professional_teacher
    FOREIGN KEY (teacher_id)
    REFERENCES teacher_v2.teachers(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_teacher_v2_staff_type
    CHECK (staff_type IN ('teaching', 'non-teaching')),
  CONSTRAINT chk_teacher_v2_experience_non_negative
    CHECK (experience_years IS NULL OR experience_years >= 0)
);

CREATE INDEX IF NOT EXISTS idx_teacher_v2_professional_type_role
  ON teacher_v2.teacher_professional(staff_type, role);

-- 4) teacher_contact (1:1)
CREATE TABLE IF NOT EXISTS teacher_v2.teacher_contact (
  teacher_id BIGINT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(100),
  house_no VARCHAR(50),
  address_line VARCHAR(150),
  landmark VARCHAR(100),
  state VARCHAR(100),
  district VARCHAR(100),
  mandal VARCHAR(100),
  village VARCHAR(100),
  pincode VARCHAR(6),
  emergency_contact_name VARCHAR(100),
  emergency_contact_phone VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_teacher_v2_contact_teacher
    FOREIGN KEY (teacher_id)
    REFERENCES teacher_v2.teachers(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_teacher_v2_pincode
    CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$')
);

CREATE INDEX IF NOT EXISTS idx_teacher_v2_contact_phone
  ON teacher_v2.teacher_contact(phone);

-- 5) teacher_employment (1:1)
CREATE TABLE IF NOT EXISTS teacher_v2.teacher_employment (
  teacher_id BIGINT PRIMARY KEY,
  joining_date DATE,
  employment_type VARCHAR(20) NOT NULL DEFAULT 'FULL_TIME',
  salary_grade VARCHAR(20),
  reporting_manager_teacher_id BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_teacher_v2_employment_teacher
    FOREIGN KEY (teacher_id)
    REFERENCES teacher_v2.teachers(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_teacher_v2_reporting_manager
    FOREIGN KEY (reporting_manager_teacher_id)
    REFERENCES teacher_v2.teachers(id)
    ON DELETE SET NULL,
  CONSTRAINT chk_teacher_v2_employment_type
    CHECK (employment_type IN ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING'))
);

CREATE INDEX IF NOT EXISTS idx_teacher_v2_employment_joining_date
  ON teacher_v2.teacher_employment(joining_date);

-- 6) teacher_class_assignments (1:N)
CREATE TABLE IF NOT EXISTS teacher_v2.teacher_class_assignments (
  id BIGSERIAL PRIMARY KEY,
  teacher_id BIGINT NOT NULL,
  academic_year_id INTEGER,
  class VARCHAR(10) NOT NULL,
  section VARCHAR(5) NOT NULL,
  is_class_teacher BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_teacher_v2_assignments_teacher
    FOREIGN KEY (teacher_id)
    REFERENCES teacher_v2.teachers(id)
    ON DELETE CASCADE,
  CONSTRAINT uq_teacher_v2_assignment_unique
    UNIQUE (teacher_id, academic_year_id, class, section)
);

CREATE INDEX IF NOT EXISTS idx_teacher_v2_assignments_lookup
  ON teacher_v2.teacher_class_assignments(academic_year_id, class, section);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'academic_years'
  ) THEN
    ALTER TABLE teacher_v2.teacher_class_assignments
      DROP CONSTRAINT IF EXISTS fk_teacher_v2_assignments_academic_year;

    ALTER TABLE teacher_v2.teacher_class_assignments
      ADD CONSTRAINT fk_teacher_v2_assignments_academic_year
      FOREIGN KEY (academic_year_id)
      REFERENCES academic_years(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Updated-at helper trigger
CREATE OR REPLACE FUNCTION teacher_v2.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_teacher_v2_teachers_updated_at'
  ) THEN
    CREATE TRIGGER trg_teacher_v2_teachers_updated_at
    BEFORE UPDATE ON teacher_v2.teachers
    FOR EACH ROW EXECUTE FUNCTION teacher_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_teacher_v2_identity_updated_at'
  ) THEN
    CREATE TRIGGER trg_teacher_v2_identity_updated_at
    BEFORE UPDATE ON teacher_v2.teacher_identity
    FOR EACH ROW EXECUTE FUNCTION teacher_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_teacher_v2_professional_updated_at'
  ) THEN
    CREATE TRIGGER trg_teacher_v2_professional_updated_at
    BEFORE UPDATE ON teacher_v2.teacher_professional
    FOR EACH ROW EXECUTE FUNCTION teacher_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_teacher_v2_contact_updated_at'
  ) THEN
    CREATE TRIGGER trg_teacher_v2_contact_updated_at
    BEFORE UPDATE ON teacher_v2.teacher_contact
    FOR EACH ROW EXECUTE FUNCTION teacher_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_teacher_v2_employment_updated_at'
  ) THEN
    CREATE TRIGGER trg_teacher_v2_employment_updated_at
    BEFORE UPDATE ON teacher_v2.teacher_employment
    FOR EACH ROW EXECUTE FUNCTION teacher_v2.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_teacher_v2_assignments_updated_at'
  ) THEN
    CREATE TRIGGER trg_teacher_v2_assignments_updated_at
    BEFORE UPDATE ON teacher_v2.teacher_class_assignments
    FOR EACH ROW EXECUTE FUNCTION teacher_v2.set_updated_at();
  END IF;
END $$;

-- Canonical read model for staff listing/profile
CREATE OR REPLACE VIEW teacher_v2.v_teacher_profile AS
SELECT
  t.id,
  t.user_id,
  t.school_id,
  t.status,
  i.employee_id,
  i.aadhaar,
  i.aadhaar_last4,
  i.verification_status,
  p.staff_type,
  p.role,
  p.subject,
  p.department,
  p.qualification,
  p.experience_years,
  c.phone,
  c.email,
  c.house_no,
  c.address_line,
  c.landmark,
  c.state,
  c.district,
  c.mandal,
  c.village,
  c.pincode,
  c.emergency_contact_name,
  c.emergency_contact_phone,
  e.joining_date,
  e.employment_type,
  e.salary_grade,
  e.reporting_manager_teacher_id,
  t.created_at,
  t.updated_at
FROM teacher_v2.teachers t
LEFT JOIN teacher_v2.teacher_identity i ON i.teacher_id = t.id
LEFT JOIN teacher_v2.teacher_professional p ON p.teacher_id = t.id
LEFT JOIN teacher_v2.teacher_contact c ON c.teacher_id = t.id
LEFT JOIN teacher_v2.teacher_employment e ON e.teacher_id = t.id;

-- Teacher create transaction flow (application-side)
-- 1) BEGIN
-- 2) Insert users row (role=teacher).
-- 3) Insert teacher_v2.teachers (user_id, school_id).
-- 4) Insert teacher_v2.teacher_identity (employee_id, aadhaar, aadhaar_last4).
-- 5) Insert teacher_v2.teacher_professional.
-- 6) Insert teacher_v2.teacher_contact.
-- 7) Insert teacher_v2.teacher_employment.
-- 8) Insert teacher_v2.teacher_class_assignments rows (if teaching).
-- 9) COMMIT; on error ROLLBACK.
