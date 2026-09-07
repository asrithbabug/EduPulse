-- EduPulse Test Data — Realistic data for customer demo
-- Run AFTER schema.sql

-- ══════════════════════════════════════════════════════════════════
-- ATTENDANCE DATA (last 30 days for all students)
-- ══════════════════════════════════════════════════════════════════

INSERT INTO attendance (school_id, student_id, teacher_id, class, date, status) VALUES
-- STU001 (Arjun Sharma - 10-A)
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '1 day', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '2 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '3 days', 'absent'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '4 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '5 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '6 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '8 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '9 days', 'late'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '10 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '11 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '12 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '13 days', 'absent'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '15 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '16 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '17 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '18 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '19 days', 'present'),
(1, 'STU001', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '20 days', 'late'),
-- STU002 (Priya Patel - 10-A)
(1, 'STU002', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '1 day', 'present'),
(1, 'STU002', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '2 days', 'present'),
(1, 'STU002', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '3 days', 'present'),
(1, 'STU002', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '4 days', 'present'),
(1, 'STU002', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '5 days', 'absent'),
(1, 'STU002', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '8 days', 'present'),
(1, 'STU002', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '9 days', 'present'),
(1, 'STU002', 'TCH001', '10-A', CURRENT_DATE - INTERVAL '10 days', 'present')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- MARKS DATA
-- ══════════════════════════════════════════════════════════════════

INSERT INTO marks (school_id, student_id, teacher_id, subject, exam_type, marks, total_marks, grade, academic_year) VALUES
-- STU001 - Mid Term
(1, 'STU001', 'TCH001', 'Mathematics', 'Mid Term', 87, 100, 'A', '2025-26'),
(1, 'STU001', 'TCH002', 'Science', 'Mid Term', 92, 100, 'A+', '2025-26'),
(1, 'STU001', 'TCH003', 'English', 'Mid Term', 78, 100, 'B+', '2025-26'),
(1, 'STU001', 'TCH001', 'Hindi', 'Mid Term', 85, 100, 'A', '2025-26'),
(1, 'STU001', 'TCH002', 'Social Studies', 'Mid Term', 73, 100, 'B', '2025-26'),
-- STU001 - Unit Test
(1, 'STU001', 'TCH001', 'Mathematics', 'Unit Test 1', 42, 50, 'A', '2025-26'),
(1, 'STU001', 'TCH002', 'Science', 'Unit Test 1', 46, 50, 'A+', '2025-26'),
(1, 'STU001', 'TCH003', 'English', 'Unit Test 1', 38, 50, 'B+', '2025-26'),
-- STU002 - Mid Term
(1, 'STU002', 'TCH001', 'Mathematics', 'Mid Term', 95, 100, 'A+', '2025-26'),
(1, 'STU002', 'TCH002', 'Science', 'Mid Term', 88, 100, 'A', '2025-26'),
(1, 'STU002', 'TCH003', 'English', 'Mid Term', 91, 100, 'A+', '2025-26'),
(1, 'STU002', 'TCH001', 'Hindi', 'Mid Term', 79, 100, 'B+', '2025-26'),
(1, 'STU002', 'TCH002', 'Social Studies', 'Mid Term', 84, 100, 'A', '2025-26'),
-- STU003 - Mid Term (9-B)
(1, 'STU003', 'TCH001', 'Mathematics', 'Mid Term', 65, 100, 'B', '2025-26'),
(1, 'STU003', 'TCH002', 'Science', 'Mid Term', 72, 100, 'B+', '2025-26'),
(1, 'STU003', 'TCH003', 'English', 'Mid Term', 58, 100, 'C+', '2025-26')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- FEES DATA
-- ══════════════════════════════════════════════════════════════════

INSERT INTO fees (school_id, student_id, description, amount, status, due_date, paid_date, academic_year) VALUES
-- STU001
(1, 'STU001', 'Term 1 Tuition Fee', 25000, 'paid', '2025-06-15', '2025-06-10', '2025-26'),
(1, 'STU001', 'Term 2 Tuition Fee', 25000, 'paid', '2025-10-15', '2025-10-12', '2025-26'),
(1, 'STU001', 'Term 3 Tuition Fee', 25000, 'due', '2026-06-15', NULL, '2025-26'),
(1, 'STU001', 'Annual Sports Fee', 5000, 'paid', '2025-07-01', '2025-06-28', '2025-26'),
(1, 'STU001', 'Lab Fee', 3000, 'paid', '2025-07-01', '2025-07-01', '2025-26'),
-- STU002
(1, 'STU002', 'Term 1 Tuition Fee', 25000, 'paid', '2025-06-15', '2025-06-14', '2025-26'),
(1, 'STU002', 'Term 2 Tuition Fee', 25000, 'paid', '2025-10-15', '2025-10-15', '2025-26'),
(1, 'STU002', 'Term 3 Tuition Fee', 25000, 'overdue', '2026-05-15', NULL, '2025-26'),
(1, 'STU002', 'Annual Sports Fee', 5000, 'paid', '2025-07-01', '2025-06-30', '2025-26'),
-- STU003
(1, 'STU003', 'Term 1 Tuition Fee', 22000, 'paid', '2025-06-15', '2025-06-15', '2025-26'),
(1, 'STU003', 'Term 2 Tuition Fee', 22000, 'paid', '2025-10-15', '2025-11-01', '2025-26'),
(1, 'STU003', 'Term 3 Tuition Fee', 22000, 'due', '2026-06-15', NULL, '2025-26')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- TIMETABLE (Class 10-A, Monday to Friday)
-- ══════════════════════════════════════════════════════════════════

INSERT INTO timetable (school_id, class, section, day_of_week, period, start_time, end_time, subject, teacher_id) VALUES
-- Monday
(1, '10-A', 'A', 1, 1, '08:30', '09:15', 'Mathematics', 'TCH001'),
(1, '10-A', 'A', 1, 2, '09:15', '10:00', 'Science', 'TCH002'),
(1, '10-A', 'A', 1, 3, '10:15', '11:00', 'English', 'TCH003'),
(1, '10-A', 'A', 1, 4, '11:00', '11:45', 'Hindi', 'TCH001'),
(1, '10-A', 'A', 1, 5, '12:30', '13:15', 'Social Studies', 'TCH002'),
(1, '10-A', 'A', 1, 6, '13:15', '14:00', 'Physical Education', 'TCH003'),
-- Tuesday
(1, '10-A', 'A', 2, 1, '08:30', '09:15', 'English', 'TCH003'),
(1, '10-A', 'A', 2, 2, '09:15', '10:00', 'Mathematics', 'TCH001'),
(1, '10-A', 'A', 2, 3, '10:15', '11:00', 'Science', 'TCH002'),
(1, '10-A', 'A', 2, 4, '11:00', '11:45', 'Social Studies', 'TCH002'),
(1, '10-A', 'A', 2, 5, '12:30', '13:15', 'Hindi', 'TCH001'),
(1, '10-A', 'A', 2, 6, '13:15', '14:00', 'Art', 'TCH003'),
-- Wednesday
(1, '10-A', 'A', 3, 1, '08:30', '09:15', 'Science', 'TCH002'),
(1, '10-A', 'A', 3, 2, '09:15', '10:00', 'English', 'TCH003'),
(1, '10-A', 'A', 3, 3, '10:15', '11:00', 'Mathematics', 'TCH001'),
(1, '10-A', 'A', 3, 4, '11:00', '11:45', 'Computer Science', 'TCH001'),
(1, '10-A', 'A', 3, 5, '12:30', '13:15', 'Hindi', 'TCH001'),
(1, '10-A', 'A', 3, 6, '13:15', '14:00', 'Library', 'TCH003')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- HOMEWORK
-- ══════════════════════════════════════════════════════════════════

INSERT INTO homework (school_id, class, section, subject, title, description, due_date, assigned_by) VALUES
(1, '10-A', 'A', 'Mathematics', 'Chapter 5 Exercise', 'Complete exercises 5.1 to 5.4 from textbook. Show all steps.', CURRENT_DATE + INTERVAL '2 days', 'TCH001'),
(1, '10-A', 'A', 'Science', 'Lab Report — Photosynthesis', 'Write a detailed lab report on the photosynthesis experiment conducted today.', CURRENT_DATE + INTERVAL '3 days', 'TCH002'),
(1, '10-A', 'A', 'English', 'Essay: My Future Goals', 'Write a 500-word essay on your future goals and how education helps achieve them.', CURRENT_DATE + INTERVAL '5 days', 'TCH003'),
(1, '10-A', 'A', 'Mathematics', 'Trigonometry Practice', 'Solve problems 1-20 from the worksheet distributed in class.', CURRENT_DATE - INTERVAL '1 day', 'TCH001'),
(1, '9-B', 'B', 'Science', 'Chapter Review Questions', 'Answer all questions at the end of Chapter 8.', CURRENT_DATE + INTERVAL '2 days', 'TCH002')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- LEAVE APPLICATIONS
-- ══════════════════════════════════════════════════════════════════

INSERT INTO leave_applications (school_id, student_id, applied_by, reason, start_date, end_date, status, approved_by) VALUES
(1, 'STU001', 'STU001', 'Family function — cousin wedding in Chennai', CURRENT_DATE + INTERVAL '5 days', CURRENT_DATE + INTERVAL '7 days', 'pending', NULL),
(1, 'STU002', 'STU002', 'Fever and cold — doctor advised rest', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '3 days', 'approved', 'TCH001'),
(1, 'STU003', 'STU003', 'Participating in inter-school science competition', CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE + INTERVAL '10 days', 'pending', NULL)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- TEACHER SELF-ATTENDANCE (last 10 days)
-- ══════════════════════════════════════════════════════════════════

INSERT INTO teacher_attendance (teacher_id, date, status, remarks) VALUES
('TCH001', CURRENT_DATE, 'present', NULL),
('TCH001', CURRENT_DATE - INTERVAL '1 day', 'present', NULL),
('TCH001', CURRENT_DATE - INTERVAL '2 days', 'present', NULL),
('TCH001', CURRENT_DATE - INTERVAL '3 days', 'leave', 'Personal work'),
('TCH001', CURRENT_DATE - INTERVAL '4 days', 'present', NULL),
('TCH001', CURRENT_DATE - INTERVAL '5 days', 'present', NULL),
('TCH002', CURRENT_DATE, 'present', NULL),
('TCH002', CURRENT_DATE - INTERVAL '1 day', 'present', NULL),
('TCH002', CURRENT_DATE - INTERVAL '2 days', 'half_day', 'Doctor appointment'),
('TCH002', CURRENT_DATE - INTERVAL '3 days', 'present', NULL),
('TCH002', CURRENT_DATE - INTERVAL '4 days', 'present', NULL),
('TCH003', CURRENT_DATE, 'present', NULL),
('TCH003', CURRENT_DATE - INTERVAL '1 day', 'leave', 'Sick leave'),
('TCH003', CURRENT_DATE - INTERVAL '2 days', 'present', NULL),
('TCH003', CURRENT_DATE - INTERVAL '3 days', 'present', NULL)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- CHAT MESSAGES (sample conversation)
-- ══════════════════════════════════════════════════════════════════

INSERT INTO chat_messages (school_id, sender_id, receiver_id, message, is_read, created_at) VALUES
(1, 'STU001', 'TCH001', 'Good morning ma''am, Arjun has been having difficulty with trigonometry. Can you suggest extra practice?', true, NOW() - INTERVAL '2 days'),
(1, 'TCH001', 'STU001', 'Hello! Yes, I noticed that too. I''ll send some extra worksheets tomorrow. He can also attend the remedial class on Saturdays.', true, NOW() - INTERVAL '2 days' + INTERVAL '30 minutes'),
(1, 'STU001', 'TCH001', 'Thank you so much! That would be very helpful. What time is the Saturday class?', true, NOW() - INTERVAL '1 day'),
(1, 'TCH001', 'STU001', 'Saturday class is 10 AM to 11:30 AM. I''ll make sure he gets extra attention.', false, NOW() - INTERVAL '1 day' + INTERVAL '2 hours'),
(1, 'STU002', 'TCH002', 'Sir, Priya missed the science lab yesterday due to fever. Can she make it up?', true, NOW() - INTERVAL '3 days'),
(1, 'TCH002', 'STU002', 'Yes, she can attend the make-up lab session on Friday after school hours. Hope she feels better!', true, NOW() - INTERVAL '3 days' + INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- ACHIEVEMENTS
-- ══════════════════════════════════════════════════════════════════

INSERT INTO achievements (school_id, student_id, title, description, category, date, awarded_by) VALUES
(1, 'STU001', '100% Attendance — May 2026', 'Perfect attendance for the entire month', 'Attendance', '2026-05-31', 'TCH001'),
(1, 'STU001', 'Math Olympiad Winner', 'First place in school-level Mathematics Olympiad', 'Academic', '2026-03-15', 'ADM001'),
(1, 'STU002', 'Science Fair — Gold Medal', 'Won gold medal for innovative project on renewable energy', 'Academic', '2026-04-20', 'TCH002'),
(1, 'STU002', 'Best Student — Term 2', 'Highest overall score in Term 2 examinations', 'Academic', '2026-02-28', 'ADM001'),
(1, 'STU003', 'Sports Day Champion', 'Won 100m and 200m races in Annual Sports Day', 'Sports', '2026-01-25', 'ADM001')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- FEE STRUCTURE
-- ══════════════════════════════════════════════════════════════════

INSERT INTO fee_structure (school_id, class, description, amount, frequency, academic_year) VALUES
(1, '10', 'Tuition Fee', 25000, 'quarterly', '2025-26'),
(1, '10', 'Sports Fee', 5000, 'annually', '2025-26'),
(1, '10', 'Lab Fee', 3000, 'annually', '2025-26'),
(1, '10', 'Library Fee', 2000, 'annually', '2025-26'),
(1, '9', 'Tuition Fee', 22000, 'quarterly', '2025-26'),
(1, '9', 'Sports Fee', 4500, 'annually', '2025-26'),
(1, '9', 'Lab Fee', 2500, 'annually', '2025-26')
ON CONFLICT DO NOTHING;

-- Done!
