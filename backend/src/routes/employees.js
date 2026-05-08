const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get all employees (admin, hr, manager)
router.get('/', authenticateToken, authorizeRoles('admin', 'hr', 'manager'), (req, res) => {
  const { department, status, role, search } = req.query;
  let query = 'SELECT id, name, email, role, department, position, phone, status, hire_date, created_at FROM users WHERE 1=1';
  const params = [];

  if (department) { query += ' AND department = ?'; params.push(department); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (role) { query += ' AND role = ?'; params.push(role); }
  if (search) { query += ' AND (name LIKE ? OR email LIKE ? OR position LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  query += ' ORDER BY created_at DESC';
  const employees = db.prepare(query).all(...params);
  res.json(employees);
});

// Get single employee
router.get('/:id', authenticateToken, (req, res) => {
  const employee = db.prepare('SELECT id, name, email, role, department, position, phone, status, hire_date, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });
  res.json(employee);
});

// Add new employee (HR only)
router.post('/', authenticateToken, authorizeRoles('admin', 'hr'), (req, res) => {
  const { name, email, password, role, department, position, phone } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json({ error: 'Email already exists.' });

  const hashedPassword = bcrypt.hashSync(password, 10);

  const result = db.prepare(
    'INSERT INTO users (name, email, password, role, department, position, phone) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, email, hashedPassword, role, department || '', position || '', phone || '');

  // Log activity
  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'ADD_EMPLOYEE', `Added new employee: ${name} (${role})`, 'hr'
  );

  res.status(201).json({ id: result.lastInsertRowid, message: 'Employee added successfully.' });
});

// Update employee
router.put('/:id', authenticateToken, authorizeRoles('admin', 'hr'), (req, res) => {
  const { name, email, role, department, position, phone, status } = req.body;
  const id = req.params.id;

  const employee = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });

  db.prepare(`
    UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), role = COALESCE(?, role),
    department = COALESCE(?, department), position = COALESCE(?, position), phone = COALESCE(?, phone),
    status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?
  `).run(name, email, role, department, position, phone, status, id);

  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'UPDATE_EMPLOYEE', `Updated employee profile: ID ${id}`, 'hr'
  );

  res.json({ message: 'Employee updated successfully.' });
});

// Delete employee (admin only)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const employee = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'DELETE_EMPLOYEE', `Deleted employee: ${employee.name}`, 'admin'
  );

  res.json({ message: 'Employee deleted successfully.' });
});

// Get departments list
router.get('/meta/departments', authenticateToken, (req, res) => {
  const departments = db.prepare('SELECT DISTINCT department FROM users WHERE department != ""').all();
  res.json(departments.map(d => d.department));
});

module.exports = router;
