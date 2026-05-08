const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Static knowledge base
const KNOWLEDGE = {
  company: {
    keywords: ['company', 'pacematic', 'about', 'organization'],
    response: `**Pacematic Corporate Pvt. Ltd.** is a leading technology corporation focused on innovative solutions.\n\nOur departments include Engineering, Design, Marketing, Finance, and Human Resources.\n\nWe're committed to excellence, collaboration, and employee growth.`
  },
  leave: {
    keywords: ['leave policy', 'vacation', 'time off', 'pto', 'leave type'],
    response: `**Leave Policy:**\n- **Casual Leave:** 12 days/year\n- **Sick Leave:** 10 days/year\n- **Earned Leave:** 15 days/year\n- **Maternity Leave:** 26 weeks\n- **Paternity Leave:** 2 weeks\n\nApply via the **Leaves** section in your sidebar.`
  },
  attendance: {
    keywords: ['attendance policy', 'working hours', 'office hours', 'clock', 'punch'],
    response: `**Attendance Policy:**\n- Office hours: **9:00 AM - 6:00 PM**\n- Check-in after 9:30 AM is marked **Late**\n- Use the Check In/Out buttons on your dashboard\n- Minimum 8 hours/day required`
  },
  salary: {
    keywords: ['salary', 'pay', 'compensation', 'payroll', 'ctc'],
    response: `Salary slips are generated on the **1st of every month**. For salary queries, contact HR at **hr@pacematic.com**.`
  },
  benefits: {
    keywords: ['benefit', 'insurance', 'health', 'medical', 'perks'],
    response: `**Employee Benefits:**\n- Health Insurance (employee + family)\n- Annual performance bonus\n- Professional development allowance\n- Flexible WFH (2 days/week)\n- Wellness programs & team events`
  },
  performance: {
    keywords: ['performance', 'review', 'appraisal', 'kpi', 'evaluation'],
    response: `**Performance Reviews** are conducted quarterly.\n- Self-assessment + manager review\n- KPIs set at quarter start\n- Annual appraisal determines promotions`
  },
  help: {
    keywords: ['help', 'what can you do', 'commands', 'guide'],
    response: `I can help with:\n- **my tasks** — Your current task summary\n- **my attendance** — Your attendance this month\n- **my leaves** — Your leave balance\n- **team stats** — Team overview (managers+)\n- **leave policy** — Company leave rules\n- **attendance policy** — Working hours\n- **company** — About Pacematic\n- **benefits** — Employee perks\n\nJust type naturally!`
  }
};

// Context-aware queries that hit the database
function getContextResponse(message, userId, userRole, userName) {
  const msg = message.toLowerCase().trim();

  // ─── MY TASKS ─────────────────────────────────────────
  if (msg.includes('my task') || msg.includes('my assignment') || (msg.includes('task') && msg.includes('status'))) {
    const tasks = db.prepare(`
      SELECT title, status, priority, due_date FROM tasks WHERE assigned_to = ? ORDER BY created_at DESC LIMIT 10
    `).all(userId);

    if (tasks.length === 0) return `You have **no tasks** assigned right now, ${userName}. Enjoy the free time!`;

    const pending = tasks.filter(t => t.status === 'pending').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const urgent = tasks.filter(t => t.priority === 'urgent' && t.status !== 'completed');

    let resp = `**Your Task Summary:**\n- Pending: **${pending}**\n- In Progress: **${inProgress}**\n- Completed: **${completed}**`;
    if (urgent.length > 0) resp += `\n\n⚠️ **Urgent tasks:** ${urgent.map(t => t.title).join(', ')}`;

    const overdue = tasks.filter(t => t.due_date && t.due_date < new Date().toISOString().split('T')[0] && t.status !== 'completed');
    if (overdue.length > 0) resp += `\n\n🔴 **Overdue:** ${overdue.map(t => `${t.title} (due ${t.due_date})`).join(', ')}`;

    return resp;
  }

  // ─── MY ATTENDANCE ────────────────────────────────────
  if (msg.includes('my attendance') || msg.includes('attendance this') || msg.includes('how many days')) {
    const month = new Date().toISOString().slice(0, 7);
    const records = db.prepare(`SELECT date, status, check_in, check_out FROM attendance WHERE user_id = ? AND date LIKE ? ORDER BY date DESC`).all(userId, `${month}%`);

    if (records.length === 0) return `No attendance records found for this month, ${userName}.`;

    const present = records.filter(r => r.status === 'present').length;
    const late = records.filter(r => r.status === 'late').length;
    const total = records.length;

    let resp = `**Your Attendance (${month}):**\n- Total days recorded: **${total}**\n- Present: **${present}**\n- Late: **${late}**`;

    const today = new Date().toISOString().split('T')[0];
    const todayRec = records.find(r => r.date === today);
    if (todayRec) {
      resp += `\n\nToday: Checked in at **${todayRec.check_in}**${todayRec.check_out ? `, out at **${todayRec.check_out}**` : ' (still working)'}`;
    } else {
      resp += `\n\nYou haven't checked in today yet.`;
    }
    return resp;
  }

  // ─── MY LEAVES ────────────────────────────────────────
  if (msg.includes('my leave') || msg.includes('leave balance') || msg.includes('leave status')) {
    const leaves = db.prepare(`SELECT leave_type, start_date, end_date, status FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`).all(userId);

    if (leaves.length === 0) return `You have **no leave requests** on record, ${userName}.`;

    const pending = leaves.filter(l => l.status === 'pending').length;
    const approved = leaves.filter(l => l.status === 'approved').length;
    const rejected = leaves.filter(l => l.status === 'rejected').length;

    let resp = `**Your Leave Summary:**\n- Pending: **${pending}**\n- Approved: **${approved}**\n- Rejected: **${rejected}**`;

    const active = leaves.filter(l => l.status === 'pending');
    if (active.length > 0) {
      resp += `\n\n**Pending requests:**\n` + active.map(l => `- ${l.leave_type}: ${l.start_date} to ${l.end_date}`).join('\n');
    }
    return resp;
  }

  // ─── TEAM STATS (managers/admin/hr only) ──────────────
  if ((msg.includes('team') || msg.includes('employee count') || msg.includes('how many employee') || msg.includes('department')) && ['admin', 'hr', 'manager'].includes(userRole)) {
    const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const active = db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'active'").get().c;
    const depts = db.prepare("SELECT department, COUNT(*) as c FROM users WHERE department != '' GROUP BY department ORDER BY c DESC").all();
    const pendingLeaves = db.prepare("SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending'").get().c;

    let resp = `**Team Overview:**\n- Total employees: **${total}**\n- Active: **${active}**\n- Pending leave requests: **${pendingLeaves}**`;
    if (depts.length > 0) {
      resp += `\n\n**By Department:**\n` + depts.map(d => `- ${d.department}: **${d.c}**`).join('\n');
    }
    return resp;
  }

  // ─── WHO IS ON LEAVE ──────────────────────────────────
  if (msg.includes('who is on leave') || msg.includes('on leave today') || msg.includes('whos on leave')) {
    const today = new Date().toISOString().split('T')[0];
    const onLeave = db.prepare(`
      SELECT u.name, lr.leave_type, lr.start_date, lr.end_date
      FROM leave_requests lr JOIN users u ON lr.user_id = u.id
      WHERE lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ?
    `).all(today, today);

    if (onLeave.length === 0) return `No one is on approved leave today!`;
    return `**On Leave Today:**\n` + onLeave.map(l => `- **${l.name}** (${l.leave_type}: ${l.start_date} to ${l.end_date})`).join('\n');
  }

  // ─── DEADLINES ────────────────────────────────────────
  if (msg.includes('deadline') || msg.includes('due') || msg.includes('upcoming')) {
    const tasks = db.prepare(`
      SELECT title, due_date, priority, status FROM tasks
      WHERE assigned_to = ? AND status != 'completed' AND due_date IS NOT NULL
      ORDER BY due_date ASC LIMIT 5
    `).all(userId);

    if (tasks.length === 0) return `You have no upcoming deadlines. All clear!`;
    return `**Upcoming Deadlines:**\n` + tasks.map(t => `- **${t.title}** — Due: ${t.due_date} [${t.priority}]`).join('\n');
  }

  return null; // No context match
}

function getResponse(message, userId, userRole, userName) {
  const msg = message.toLowerCase().trim();

  // Greetings
  if (/^(hi|hello|hey|good\s?(morning|afternoon|evening)|namaste)\b/.test(msg)) {
    return `Hello, **${userName}**! 👋 How can I help you today? Type **help** to see what I can do.`;
  }

  // Thanks
  if (/^(thank|thanks|thx)/.test(msg)) {
    return `You're welcome, ${userName}! Let me know if you need anything else.`;
  }

  // Try context-aware (database) queries first
  const contextResp = getContextResponse(message, userId, userRole, userName);
  if (contextResp) return contextResp;

  // Try knowledge base
  let bestMatch = null;
  let maxScore = 0;
  for (const [topic, data] of Object.entries(KNOWLEDGE)) {
    const score = data.keywords.filter(kw => msg.includes(kw)).length;
    if (score > maxScore) { maxScore = score; bestMatch = topic; }
  }
  if (bestMatch) return KNOWLEDGE[bestMatch].response;

  // Fallback
  return `I'm not sure about that, ${userName}. Try:\n- **my tasks** — Your task summary\n- **my attendance** — This month's records\n- **my leaves** — Leave status\n- **help** — Full list of topics`;
}

// Chat endpoint
router.post('/', authenticateToken, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required.' });

  const response = getResponse(message, req.user.id, req.user.role, req.user.name);

  db.prepare('INSERT INTO chat_messages (user_id, message, response) VALUES (?, ?, ?)').run(
    req.user.id, message, response
  );

  res.json({ response, timestamp: new Date().toISOString() });
});

// Get chat history
router.get('/history', authenticateToken, (req, res) => {
  const messages = db.prepare('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json(messages);
});

module.exports = router;
