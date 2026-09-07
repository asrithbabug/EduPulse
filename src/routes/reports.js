const router = require('express').Router();
const PDFDocument = require('pdfkit');
const db = require('../db');
const auth = require('../middleware/auth');

// ── Helper: draw PDF header ─────────────────────────────────────
function drawHeader(doc, title) {
  doc.fontSize(20).font('Helvetica-Bold').text('EduPulse School', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica').text(title, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(1);
}

// ── Helper: draw a simple table ─────────────────────────────────
function drawTable(doc, headers, rows, colWidths) {
  const startX = 50;
  const rowHeight = 22;
  let y = doc.y;

  // Header row
  doc.font('Helvetica-Bold').fontSize(9);
  let x = startX;
  headers.forEach((h, i) => {
    doc.text(h, x, y, { width: colWidths[i], align: 'left' });
    x += colWidths[i];
  });
  y += rowHeight;
  doc.moveTo(startX, y - 4).lineTo(550, y - 4).stroke();

  // Data rows
  doc.font('Helvetica').fontSize(9);
  rows.forEach((row) => {
    if (y > 720) {
      doc.addPage();
      y = 50;
    }
    x = startX;
    row.forEach((cell, i) => {
      doc.text(String(cell ?? ''), x, y, { width: colWidths[i], align: 'left' });
      x += colWidths[i];
    });
    y += rowHeight;
  });

  doc.y = y + 10;
}

// ── Student Attendance PDF ──────────────────────────────────────
router.get('/student/:studentId/attendance-pdf', auth, async (req, res) => {
  try {
    const { studentId } = req.params;

    const studentRes = await db.query(
      `SELECT name, class, section, roll_no FROM students WHERE id = $1`,
      [studentId]
    );
    if (!studentRes.rows.length) return res.status(404).json({ error: 'Student not found' });
    const student = studentRes.rows[0];

    const { rows } = await db.query(
      `SELECT date, status FROM attendance WHERE student_id = $1 ORDER BY date DESC`,
      [studentId]
    );

    const total = rows.length;
    const present = rows.filter(r => r.status === 'present').length;
    const absent = total - present;
    const percentage = total ? Math.round((present / total) * 100 * 10) / 10 : 0;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="attendance_${studentId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, 'Student Attendance Report');

    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`Student: ${student.name}`);
    doc.font('Helvetica').text(`Class: ${student.class || ''} ${student.section || ''} | Roll No: ${student.roll_no || ''}`);
    doc.moveDown(0.5);
    doc.text(`Total Days: ${total} | Present: ${present} | Absent: ${absent} | Percentage: ${percentage}%`);
    doc.moveDown(1);

    const tableRows = rows.map(r => [
      new Date(r.date).toLocaleDateString('en-IN'),
      r.status.charAt(0).toUpperCase() + r.status.slice(1),
    ]);
    drawTable(doc, ['Date', 'Status'], tableRows, [250, 250]);

    doc.end();
  } catch (err) {
    console.error('Attendance PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ── Student Marks PDF ───────────────────────────────────────────
router.get('/student/:studentId/marks-pdf', auth, async (req, res) => {
  try {
    const { studentId } = req.params;

    const studentRes = await db.query(
      `SELECT name, class, section, roll_no FROM students WHERE id = $1`,
      [studentId]
    );
    if (!studentRes.rows.length) return res.status(404).json({ error: 'Student not found' });
    const student = studentRes.rows[0];

    const { rows } = await db.query(
      `SELECT subject, exam_type, marks, total_marks, grade FROM marks WHERE student_id = $1 ORDER BY subject, exam_type`,
      [studentId]
    );

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="marks_${studentId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, 'Student Report Card');

    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`Student: ${student.name}`);
    doc.font('Helvetica').text(`Class: ${student.class || ''} ${student.section || ''} | Roll No: ${student.roll_no || ''}`);
    doc.moveDown(1);

    const tableRows = rows.map(r => [
      r.subject,
      r.exam_type,
      `${r.marks}/${r.total_marks}`,
      r.marks && r.total_marks ? `${Math.round((r.marks / r.total_marks) * 100)}%` : '-',
      r.grade || '-',
    ]);
    drawTable(doc, ['Subject', 'Exam', 'Marks', 'Percentage', 'Grade'], tableRows, [120, 100, 80, 80, 80]);

    doc.end();
  } catch (err) {
    console.error('Marks PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ── Student Fees PDF ────────────────────────────────────────────
router.get('/student/:studentId/fees-pdf', auth, async (req, res) => {
  try {
    const { studentId } = req.params;

    const studentRes = await db.query(
      `SELECT name, class, section, roll_no FROM students WHERE id = $1`,
      [studentId]
    );
    if (!studentRes.rows.length) return res.status(404).json({ error: 'Student not found' });
    const student = studentRes.rows[0];

    const { rows } = await db.query(
      `SELECT fee_type, amount, due_date, status, paid_date FROM fees WHERE student_id = $1 ORDER BY due_date`,
      [studentId]
    );

    const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const paidAmount = rows.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount || 0), 0);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fees_${studentId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, 'Fee Statement');

    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`Student: ${student.name}`);
    doc.font('Helvetica').text(`Class: ${student.class || ''} ${student.section || ''} | Roll No: ${student.roll_no || ''}`);
    doc.moveDown(0.5);
    doc.text(`Total Fees: ₹${totalAmount} | Paid: ₹${paidAmount} | Due: ₹${totalAmount - paidAmount}`);
    doc.moveDown(1);

    const tableRows = rows.map(r => [
      r.fee_type || 'Tuition',
      `₹${r.amount}`,
      r.due_date ? new Date(r.due_date).toLocaleDateString('en-IN') : '-',
      r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : '-',
      r.paid_date ? new Date(r.paid_date).toLocaleDateString('en-IN') : '-',
    ]);
    drawTable(doc, ['Type', 'Amount', 'Due Date', 'Status', 'Paid Date'], tableRows, [100, 80, 100, 80, 100]);

    doc.end();
  } catch (err) {
    console.error('Fees PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ── Class Attendance PDF ────────────────────────────────────────
router.get('/class/:classId/attendance-pdf', auth, async (req, res) => {
  try {
    const { classId } = req.params;
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const { rows } = await db.query(
      `SELECT s.name, s.roll_no, a.status
       FROM students s
       LEFT JOIN attendance a ON s.id = a.student_id AND a.date = $2
       WHERE s.class = $1
       ORDER BY s.roll_no`,
      [classId, targetDate]
    );

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="class_attendance_${classId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, `Class Attendance Report - ${classId}`);

    doc.fontSize(11).font('Helvetica');
    doc.text(`Date: ${new Date(targetDate).toLocaleDateString('en-IN')}`);
    doc.text(`Total Students: ${rows.length} | Present: ${rows.filter(r => r.status === 'present').length} | Absent: ${rows.filter(r => r.status === 'absent').length}`);
    doc.moveDown(1);

    const tableRows = rows.map(r => [
      r.roll_no || '-',
      r.name,
      r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : 'N/A',
    ]);
    drawTable(doc, ['Roll No', 'Name', 'Status'], tableRows, [80, 250, 150]);

    doc.end();
  } catch (err) {
    console.error('Class attendance PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ── Class Marks PDF ─────────────────────────────────────────────
router.get('/class/:classId/marks-pdf', auth, async (req, res) => {
  try {
    const { classId } = req.params;
    const { exam_type } = req.query;

    let query = `
      SELECT s.name, s.roll_no, m.subject, m.marks, m.total_marks, m.grade
      FROM students s
      LEFT JOIN marks m ON s.id = m.student_id
      WHERE s.class = $1
    `;
    const params = [classId];

    if (exam_type) {
      query += ` AND m.exam_type = $2`;
      params.push(exam_type);
    }
    query += ` ORDER BY s.roll_no, m.subject`;

    const { rows } = await db.query(query, params);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="class_marks_${classId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, `Class Marks Report - ${classId}`);

    if (exam_type) {
      doc.fontSize(11).font('Helvetica').text(`Exam: ${exam_type}`);
      doc.moveDown(0.5);
    }

    const tableRows = rows.map(r => [
      r.roll_no || '-',
      r.name,
      r.subject || '-',
      r.marks != null ? `${r.marks}/${r.total_marks}` : '-',
      r.grade || '-',
    ]);
    drawTable(doc, ['Roll No', 'Name', 'Subject', 'Marks', 'Grade'], tableRows, [70, 140, 120, 80, 70]);

    doc.end();
  } catch (err) {
    console.error('Class marks PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

module.exports = router;
