const db = require('./database');
const bcrypt = require('bcryptjs');

function seedDatabase() {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@pacematic.com');
  if (existingAdmin) return;

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password, role, department, position, phone, status, hire_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const users = [
    ['Rajesh Kumar', 'admin@pacematic.com', hash('admin123'), 'admin', 'Management', 'CEO', '9876543210', 'active', '2020-01-15'],
    ['Priya Sharma', 'hr@pacematic.com', hash('hr123'), 'hr', 'Human Resources', 'HR Manager', '9876543211', 'active', '2021-03-10'],
    ['Amit Patel', 'manager@pacematic.com', hash('manager123'), 'manager', 'Engineering', 'Engineering Manager', '9876543212', 'active', '2021-06-20'],
    ['Sneha Reddy', 'sneha@pacematic.com', hash('emp123'), 'employee', 'Engineering', 'Software Developer', '9876543213', 'active', '2022-01-10'],
    ['Vikram Singh', 'vikram@pacematic.com', hash('emp123'), 'employee', 'Engineering', 'Frontend Developer', '9876543214', 'active', '2022-04-15'],
    ['Neha Gupta', 'neha@pacematic.com', hash('emp123'), 'employee', 'Design', 'UI/UX Designer', '9876543215', 'active', '2022-07-01'],
    ['Arjun Mehta', 'arjun@pacematic.com', hash('emp123'), 'employee', 'Marketing', 'Marketing Executive', '9876543216', 'active', '2023-01-20'],
    ['Kavita Joshi', 'kavita@pacematic.com', hash('emp123'), 'employee', 'Finance', 'Accountant', '9876543217', 'active', '2023-03-15'],
  ];

  const insertMany = db.transaction(() => {
    for (const u of users) {
      insertUser.run(...u);
    }
  });
  insertMany();

  // Seed some activity logs
  const insertLog = db.prepare(`
    INSERT INTO activity_log (user_id, action, description, module, timestamp) VALUES (?, ?, ?, ?, ?)
  `);
  const logs = [
    [1, 'LOGIN', 'Admin logged into the system', 'admin', '2026-03-25 09:00:00'],
    [2, 'ADD_EMPLOYEE', 'HR added new employee Sneha Reddy', 'hr', '2026-03-25 09:30:00'],
    [3, 'VIEW_REPORT', 'Manager viewed team performance report', 'employee', '2026-03-25 10:00:00'],
    [4, 'CHECK_IN', 'Sneha Reddy checked in for the day', 'employee', '2026-03-25 09:15:00'],
    [5, 'TASK_COMPLETED', 'Vikram Singh completed frontend redesign task', 'employee', '2026-03-25 11:00:00'],
    [2, 'LEAVE_APPROVED', 'HR approved leave request for Arjun Mehta', 'hr', '2026-03-25 14:00:00'],
    [1, 'ANNOUNCEMENT', 'Admin posted company-wide announcement', 'admin', '2026-03-25 15:00:00'],
    [3, 'ASSIGN_TASK', 'Manager assigned new task to Neha Gupta', 'employee', '2026-03-25 16:00:00'],
  ];
  const insertLogs = db.transaction(() => {
    for (const l of logs) insertLog.run(...l);
  });
  insertLogs();

  // Seed announcements
  db.prepare(`INSERT INTO announcements (title, content, created_by, priority) VALUES (?, ?, ?, ?)`).run(
    'Welcome to Pacematic Corporate Pvt. Ltd.',
    'We are excited to launch our new Employee Management System. All employees are requested to update their profiles.',
    1, 'high'
  );
  db.prepare(`INSERT INTO announcements (title, content, created_by, priority) VALUES (?, ?, ?, ?)`).run(
    'Quarterly Review Meeting',
    'The quarterly review meeting is scheduled for next Friday. All department heads must prepare their reports.',
    1, 'normal'
  );

  // Seed tasks
  const insertTask = db.prepare(`INSERT INTO tasks (title, description, assigned_to, assigned_by, priority, status, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertTask.run('Complete Dashboard UI', 'Design and implement the main dashboard interface', 5, 3, 'high', 'in_progress', '2026-04-01');
  insertTask.run('API Documentation', 'Write comprehensive API documentation', 4, 3, 'medium', 'pending', '2026-04-05');
  insertTask.run('Logo Redesign', 'Create new company logo variants', 6, 3, 'low', 'completed', '2026-03-20');

  console.log('Database seeded successfully!');
}

seedDatabase();
module.exports = seedDatabase;
