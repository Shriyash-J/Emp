const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Return current date ("YYYY-MM-DD") and time ("HH:MM:SS") in the configured
// company timezone. Offset in hours is controlled by APP_TIMEZONE_OFFSET_HOURS
// (default 5.5 = IST) so the server's own timezone is irrelevant.
function nowInCompanyTz() {
  const offsetHours = parseFloat(process.env.APP_TIMEZONE_OFFSET_HOURS || '5.5');
  const shifted = new Date(Date.now() + offsetHours * 3600 * 1000);
  const iso = shifted.toISOString(); // e.g. "2026-04-19T14:32:10.000Z"
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

// Check in
router.post('/check-in', authenticateToken, (req, res) => {
  const { date: today, time: now } = nowInCompanyTz();
  const existing = db.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, today);

  if (existing) return res.status(400).json({ error: 'Already checked in today.' });

  db.prepare('INSERT INTO attendance (user_id, date, check_in, status) VALUES (?, ?, ?, ?)').run(
    req.user.id, today, now, now > '09:30:00' ? 'late' : 'present'
  );

  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'CHECK_IN', `${req.user.name} checked in at ${now}`, 'employee'
  );

  res.json({ message: 'Checked in successfully.', time: now });
});

// Check out
router.post('/check-out', authenticateToken, (req, res) => {
  const { date: today, time: now } = nowInCompanyTz();
  const record = db.prepare('SELECT id, check_out FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, today);

  if (!record) return res.status(400).json({ error: 'You haven\'t checked in today.' });
  if (record.check_out) return res.status(400).json({ error: 'Already checked out today.' });

  db.prepare('UPDATE attendance SET check_out = ? WHERE id = ?').run(now, record.id);

  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'CHECK_OUT', `${req.user.name} checked out at ${now}`, 'employee'
  );

  res.json({ message: 'Checked out successfully.', time: now });
});

// Get my attendance
router.get('/my', authenticateToken, (req, res) => {
  const records = db.prepare('SELECT * FROM attendance WHERE user_id = ? ORDER BY date DESC LIMIT 30').all(req.user.id);
  res.json(records);
});

// Get all attendance (HR/Admin/Manager)
router.get('/', authenticateToken, authorizeRoles('admin', 'hr', 'manager'), (req, res) => {
  const { date, user_id } = req.query;
  let query = `
    SELECT a.*, u.name as employee_name, u.department
    FROM attendance a JOIN users u ON a.user_id = u.id WHERE 1=1
  `;
  const params = [];
  if (date) { query += ' AND a.date = ?'; params.push(date); }
  if (user_id) { query += ' AND a.user_id = ?'; params.push(user_id); }
  query += ' ORDER BY a.date DESC, u.name ASC LIMIT 100';

  res.json(db.prepare(query).all(...params));
});

module.exports = router;
