const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Request leave
router.post('/', authenticateToken, (req, res) => {
  const { leave_type, start_date, end_date, reason } = req.body;
  if (!leave_type || !start_date || !end_date) {
    return res.status(400).json({ error: 'Leave type, start date, and end date are required.' });
  }

  db.prepare('INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, leave_type, start_date, end_date, reason || ''
  );

  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'LEAVE_REQUEST', `${req.user.name} requested ${leave_type} leave`, 'employee'
  );

  res.status(201).json({ message: 'Leave request submitted.' });
});

// Get my leaves
router.get('/my', authenticateToken, (req, res) => {
  const leaves = db.prepare(`
    SELECT lr.*, u.name as approved_by_name FROM leave_requests lr
    LEFT JOIN users u ON lr.approved_by = u.id
    WHERE lr.user_id = ? ORDER BY lr.created_at DESC
  `).all(req.user.id);
  res.json(leaves);
});

// Get all leave requests (HR/Admin/Manager)
router.get('/', authenticateToken, authorizeRoles('admin', 'hr', 'manager'), (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT lr.*, u.name as employee_name, u.department, ap.name as approved_by_name
    FROM leave_requests lr
    JOIN users u ON lr.user_id = u.id
    LEFT JOIN users ap ON lr.approved_by = ap.id
    WHERE 1=1
  `;
  const params = [];
  if (status) { query += ' AND lr.status = ?'; params.push(status); }
  query += ' ORDER BY lr.created_at DESC';

  res.json(db.prepare(query).all(...params));
});

// Approve/Reject leave (HR/Admin/Manager)
router.put('/:id', authenticateToken, authorizeRoles('admin', 'hr', 'manager'), (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected.' });
  }

  const leave = db.prepare('SELECT lr.*, u.name as employee_name FROM leave_requests lr JOIN users u ON lr.user_id = u.id WHERE lr.id = ?').get(req.params.id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found.' });

  db.prepare('UPDATE leave_requests SET status = ?, approved_by = ? WHERE id = ?').run(status, req.user.id, req.params.id);

  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    req.user.id, status === 'approved' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
    `${req.user.name} ${status} leave for ${leave.employee_name}`, 'hr'
  );

  res.json({ message: `Leave request ${status}.` });
});

module.exports = router;
