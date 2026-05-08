import re
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from models import db, User, Attendance, Leave, Payroll, PayrollConfig, Holiday, Task

chat_bp = Blueprint('chat', __name__, url_prefix='/api/chat')

# ── WorkNet scope keywords — used to detect on-topic queries ────
WORKNET_KEYWORDS = [
    'leave', 'attendance', 'check.?in', 'check.?out', 'payroll', 'salary',
    'employee', 'staff', 'task', 'holiday', 'hr', 'department', 'policy',
    'benefit', 'profile', 'detail', 'absent', 'present', 'late', 'overtime',
    'shift', 'working hours', 'face', 'register', 'apply', 'approve',
    'reject', 'pending', 'slip', 'deduction', 'bonus', 'announcement',
    'how to', 'how do', 'where', 'worknet', 'dashboard', 'help',
    'hi', 'hello', 'hey', 'hii', 'hiii', 'thank', 'bye', 'good morning',
    'good afternoon', 'good evening',
]

# ── "How to" step-by-step guides ────────────────────────────────
HOW_TO_GUIDES = {
    'apply.*leave': (
        "**How to Apply Leave:**\n"
        "1. Go to **My Leaves** from the sidebar\n"
        "2. Click **Apply Leave**\n"
        "3. Select leave type, dates, and add reason\n"
        "4. Click **Submit** — your manager will be notified"
    ),
    'check.?in|mark.*attendance': (
        "**How to Check In:**\n"
        "1. Go to **Attendance** page or use the Dashboard\n"
        "2. Click **Check In** — your webcam will open\n"
        "3. Capture your face photo and click **Confirm**\n"
        "4. Face must match your registered photo to proceed"
    ),
    'check.?out': (
        "**How to Check Out:**\n"
        "1. Go to **Attendance** page or Dashboard\n"
        "2. Click **Check Out** — webcam opens for face verification\n"
        "3. Capture and confirm your photo\n"
        "4. Working hours are calculated automatically"
    ),
    'register.*face|face.*register': (
        "**How to Register Face:**\n"
        "1. Go to **Attendance** page\n"
        "2. You'll see a banner: \"Face Not Registered\"\n"
        "3. Click **Register Face** — allow camera access\n"
        "4. Capture a clear photo and confirm"
    ),
    'view.*(payroll|salary|slip)': (
        "**How to View Payroll:**\n"
        "1. Go to **Payroll** from the sidebar\n"
        "2. Your salary structure and latest slip are shown\n"
        "3. Click on a record to download the pay slip"
    ),
    'assign.*task|create.*task': (
        "**How to Create/Assign a Task:**\n"
        "1. Go to **Tasks** from the sidebar\n"
        "2. Click **Create Task** (managers/admin only)\n"
        "3. Fill in title, description, assignee, and due date\n"
        "4. Click **Save** — the employee will be notified"
    ),
    'update.*task|task.*status': (
        "**How to Update Task Status:**\n"
        "1. Go to **Tasks** → find the task\n"
        "2. Change status to In Progress / Completed\n"
        "3. Changes are saved automatically"
    ),
    'change.*password|reset.*password': (
        "**Password Reset:**\n"
        "Contact your admin or HR to reset your password.\n"
        "Admins can reset via **Admin Panel → Users → Reset Password**."
    ),
}

# ── Static policy responses ─────────────────────────────────────
POLICIES = {
    'leave policy': (
        "**Leave Policy:**\n"
        "- Casual Leave: 12 days/year\n"
        "- Sick Leave: 10 days/year\n"
        "- Earned Leave: 15 days/year\n"
        "- Maternity/Paternity Leave available\n"
        "Apply through **My Leaves** in the sidebar."
    ),
    'attendance policy': (
        "**Attendance Policy:**\n"
        "- Work hours: 9:00 AM – 6:00 PM\n"
        "- Face verification required for check-in/out\n"
        "- Late after 9:30 AM — flagged automatically\n"
        "- Half-day if working < 4 hours"
    ),
    'benefits': (
        "**Employee Benefits:**\n"
        "- Health insurance for employee + family\n"
        "- Annual performance bonus\n"
        "- Learning & development allowance\n"
        "- WFH: up to 2 days/week"
    ),
    'contact hr': (
        "**HR Contact:**\n"
        "- Email: hr@worknet.com\n"
        "- Phone: +91-9876543211\n"
        "- Available Mon–Fri, 9 AM – 6 PM"
    ),
}


def _is_privileged(role):
    """Can view other employees' attendance, leave, and details."""
    return role in ('admin', 'hr', 'manager')


def _can_view_payroll(role):
    """Only admin can view/manage payroll for others."""
    return role == 'admin'


def _today():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def _extract_name(msg, prefix_patterns):
    """Try to extract a name from a message after known prefix patterns."""
    for pat in prefix_patterns:
        m = re.search(pat, msg, re.IGNORECASE)
        if m:
            name = m.group(1).strip().strip('?').strip()
            if name:
                return name
    return None


def _find_user_by_name(name):
    """Search for a user by partial name match."""
    return User.query.filter(
        User.name.ilike(f'%{name}%'),
        User.status == 'active'
    ).first()


def _format_currency(amount):
    return f"\u20b9{amount:,.2f}"


# ── Data query handlers ─────────────────────────────────────────

def handle_on_leave_today(user_id, role):
    """Who is on leave today?"""
    today = _today()
    leaves = Leave.query.filter(
        Leave.start_date <= today,
        Leave.end_date >= today,
        Leave.status == 'approved'
    ).all()

    if not _is_privileged(role):
        # Employees can only see if they themselves are on leave
        leaves = [l for l in leaves if l.user_id == user_id]

    if not leaves:
        return "No employees are on approved leave today."

    names = [l.user.name for l in leaves if l.user]
    return f"**Employees on leave today ({today}):**\n" + "\n".join(f"- {n}" for n in names)


def handle_present_today(user_id, role):
    """Who is present today?"""
    today = _today()

    if not _is_privileged(role):
        rec = Attendance.query.filter_by(user_id=user_id, date=today, status='present').first()
        if rec:
            return f"You are marked **present** today. Check-in: {rec.check_in or 'N/A'}"
        return "You have not checked in today."

    records = Attendance.query.filter_by(date=today, status='present').all()
    if not records:
        return "No attendance records found for today yet."

    lines = []
    for r in records:
        name = r.user.name if r.user else f'User #{r.user_id}'
        lines.append(f"- {name} (In: {r.check_in or 'N/A'}, Out: {r.check_out or '—'})")
    return f"**Employees present today ({today}): {len(lines)}**\n" + "\n".join(lines)


def handle_employee_details(msg, user_id, role):
    """Get details of a specific employee."""
    name = _extract_name(msg, [
        r'details?\s+(?:of\s+)?(.+)',
        r'info\s+(?:of\s+|about\s+|for\s+)?(.+)',
        r'who\s+is\s+(.+)',
        r'employee\s+(.+)',
    ])
    if not name:
        return None

    # Filter out common false-positive phrases
    skip = ['on leave', 'present', 'absent', 'today', 'payroll', 'salary', 'attendance']
    if any(s in name.lower() for s in skip):
        return None

    user = _find_user_by_name(name)
    if not user:
        return f"No employee found matching **\"{name}\"**."

    if not _is_privileged(role) and user.id != user_id:
        return "You can only view your own details. Contact HR for other employees' info."

    return (
        f"**{user.name}**\n"
        f"- Role: {user.role.title()}\n"
        f"- Department: {user.department or 'N/A'}\n"
        f"- Position: {user.position or 'N/A'}\n"
        f"- Email: {user.email}\n"
        f"- Phone: {user.phone or 'N/A'}\n"
        f"- Status: {user.status.title()}\n"
        f"- Hire Date: {user.hire_date or 'N/A'}"
    )


def handle_pending_leaves(user_id, role):
    """Show pending leave requests."""
    if _is_privileged(role):
        leaves = Leave.query.filter_by(status='pending').all()
    else:
        leaves = Leave.query.filter_by(user_id=user_id, status='pending').all()

    if not leaves:
        return "No pending leave requests found."

    lines = []
    for l in leaves:
        name = l.user.name if l.user else f'User #{l.user_id}'
        lines.append(f"- **{name}** — {l.leave_type.title()} ({l.start_date} to {l.end_date})")
    return f"**Pending Leave Requests: {len(lines)}**\n" + "\n".join(lines)


def handle_leave_status(msg, user_id, role):
    """Show leave requests filtered by status or for a specific person."""
    # Check for specific status filter
    status_filter = None
    for s in ('approved', 'rejected', 'pending'):
        if s in msg:
            status_filter = s
            break

    name = _extract_name(msg, [
        r'leave\s+(?:status|requests?|history)\s+(?:of|for)\s+(.+)',
        r'leaves?\s+(?:of|for)\s+(.+)',
    ])

    if name and _is_privileged(role):
        user = _find_user_by_name(name)
        if not user:
            return f"No employee found matching **\"{name}\"**."
        query = Leave.query.filter_by(user_id=user.id)
        label = f"for **{user.name}**"
    elif _is_privileged(role):
        query = Leave.query
        label = "(all employees)"
    else:
        query = Leave.query.filter_by(user_id=user_id)
        label = "(your requests)"

    if status_filter:
        query = query.filter_by(status=status_filter)
        label += f" — Status: {status_filter.title()}"

    leaves = query.order_by(Leave.created_at.desc()).limit(10).all()
    if not leaves:
        return f"No leave records found {label}."

    lines = []
    for l in leaves:
        name_str = l.user.name if l.user else f'User #{l.user_id}'
        status_icon = {'approved': '+', 'rejected': '-', 'pending': '~'}.get(l.status, ' ')
        lines.append(f"- [{status_icon}] **{name_str}** — {l.leave_type.title()} ({l.start_date} to {l.end_date}) — {l.status.title()}")
    return f"**Leave Records {label} (latest 10):**\n" + "\n".join(lines)


def handle_attendance_query(msg, user_id, role):
    """Show attendance records for self or a specific employee."""
    name = _extract_name(msg, [
        r'attendance\s+(?:of|for)\s+(.+)',
    ])

    if name and _is_privileged(role):
        user = _find_user_by_name(name)
        if not user:
            return f"No employee found matching **\"{name}\"**."
        target_id = user.id
        label = f"for **{user.name}**"
    else:
        target_id = user_id
        me = User.query.get(user_id)
        label = f"for **{me.name}**" if me else ""

    records = Attendance.query.filter_by(user_id=target_id)\
        .order_by(Attendance.date.desc()).limit(10).all()

    if not records:
        return f"No attendance records found {label}."

    lines = []
    for r in records:
        lines.append(f"- {r.date} — {r.status.title()} (In: {r.check_in or 'N/A'}, Out: {r.check_out or '—'})")
    return f"**Attendance {label} (latest 10):**\n" + "\n".join(lines)


def handle_payroll_query(msg, user_id, role):
    """Show payroll / salary details."""
    name = _extract_name(msg, [
        r'(?:payroll|salary)\s+(?:of|for|details?\s+(?:of|for)?)\s+(.+)',
        r'(?:payroll|salary)\s+(.+)',
    ])

    if name and _can_view_payroll(role):
        # Filter out noise words
        if name.lower() in ('details', 'info', 'status', 'slip', 'slips'):
            name = None

    if name and _can_view_payroll(role):
        user = _find_user_by_name(name)
        if not user:
            return f"No employee found matching **\"{name}\"**."
        target_id = user.id
        label = f"for **{user.name}**"
    elif name and not _can_view_payroll(role):
        return "Only admin can view other employees' payroll details."
    else:
        target_id = user_id
        me = User.query.get(user_id)
        label = f"for **{me.name}**" if me else ""

    # Show config + latest payroll record
    config = PayrollConfig.query.filter_by(user_id=target_id).first()
    latest = Payroll.query.filter_by(user_id=target_id)\
        .order_by(Payroll.month.desc()).first()

    if not config and not latest:
        return f"No payroll data found {label}."

    parts = [f"**Payroll Details {label}:**"]

    if config:
        d = config.to_dict()
        parts.append(
            f"\n**Salary Structure:**\n"
            f"- Basic: {_format_currency(d['basic_salary'])}\n"
            f"- HRA: {_format_currency(d['hra'])}\n"
            f"- DA: {_format_currency(d['da'])}\n"
            f"- TA: {_format_currency(d['ta'])}\n"
            f"- **Gross: {_format_currency(d['gross_salary'])}**\n"
            f"- PF Deduction: {_format_currency(d['pf_deduction'])}\n"
            f"- Tax: {_format_currency(d['tax_deduction'])}\n"
            f"- Other Deductions: {_format_currency(d['other_deductions'])}\n"
            f"- **Net Salary: {_format_currency(d['net_salary'])}**"
        )

    if latest:
        parts.append(
            f"\n**Latest Payroll ({latest.month}):**\n"
            f"- Working Days: {latest.total_working_days}\n"
            f"- Present: {latest.days_present} | Leave: {latest.days_leave} | Absent: {latest.days_absent}\n"
            f"- Net Paid: {_format_currency(latest.net_salary)}\n"
            f"- Status: {latest.status.title()}"
        )

    return "\n".join(parts)


def handle_total_employees(user_id, role):
    """Total employee count and breakdown."""
    if not _is_privileged(role):
        return "You don't have permission to view this information. Contact HR."

    total = User.query.filter_by(status='active').count()
    departments = db.session.query(
        User.department, db.func.count(User.id)
    ).filter(User.status == 'active', User.department != '')\
        .group_by(User.department).all()

    parts = [f"**Total Active Employees: {total}**"]
    if departments:
        parts.append("\n**By Department:**")
        for dept, count in departments:
            parts.append(f"- {dept}: {count}")
    return "\n".join(parts)


def handle_holidays(user_id, role):
    """Show upcoming holidays."""
    today = _today()
    holidays = Holiday.query.filter(
        Holiday.date >= today,
        Holiday.user_id.is_(None)  # company-wide only
    ).order_by(Holiday.date).limit(10).all()

    if not holidays:
        return "No upcoming company holidays found."

    lines = [f"- {h.date} — {h.name}" for h in holidays]
    return f"**Upcoming Holidays:**\n" + "\n".join(lines)


def handle_my_details(user_id):
    """Show the logged-in user's own details."""
    user = User.query.get(user_id)
    if not user:
        return "No data found."
    return (
        f"**Your Profile:**\n"
        f"- Name: {user.name}\n"
        f"- Role: {user.role.title()}\n"
        f"- Department: {user.department or 'N/A'}\n"
        f"- Position: {user.position or 'N/A'}\n"
        f"- Email: {user.email}\n"
        f"- Phone: {user.phone or 'N/A'}\n"
        f"- Status: {user.status.title()}\n"
        f"- Hire Date: {user.hire_date or 'N/A'}"
    )


def handle_leave_balance(user_id):
    """Show leave balance for the logged-in user."""
    today = _today()
    year = today[:4]

    # Count used leaves by type this year
    used = db.session.query(
        Leave.leave_type, db.func.count(Leave.id)
    ).filter(
        Leave.user_id == user_id,
        Leave.status == 'approved',
        Leave.start_date >= f'{year}-01-01'
    ).group_by(Leave.leave_type).all()

    used_map = {t: c for t, c in used}
    entitlements = {'casual': 12, 'sick': 10, 'earned': 15}

    lines = []
    for ltype, total in entitlements.items():
        taken = used_map.get(ltype, 0)
        remaining = max(total - taken, 0)
        lines.append(f"- {ltype.title()}: **{remaining}** remaining ({taken} used of {total})")

    return f"**Your Leave Balance ({year}):**\n" + "\n".join(lines)


def handle_my_tasks(user_id, role):
    """Show tasks assigned to or created by the user."""
    tasks = Task.query.filter_by(assigned_to=user_id).order_by(Task.created_at.desc()).limit(8).all()

    if not tasks:
        return "You have no tasks assigned. Check the **Tasks** page for updates."

    lines = []
    for t in tasks:
        status_icon = {'pending': '🟡', 'in_progress': '🔵', 'completed': '✅'}.get(t.status, '⚪')
        due = f" (Due: {t.due_date})" if t.due_date else ''
        lines.append(f"- {status_icon} **{t.title}** — {t.status.replace('_', ' ').title()}{due}")

    pending = sum(1 for t in tasks if t.status in ('pending', 'in_progress'))
    return f"**Your Tasks ({pending} active):**\n" + "\n".join(lines)


def _is_on_topic(msg):
    """Check if the message relates to WorkNet features."""
    for kw in WORKNET_KEYWORDS:
        if re.search(kw, msg, re.IGNORECASE):
            return True
    # Very short messages (1-2 words) that aren't greetings — let fallback handle
    if len(msg.split()) <= 2:
        return True
    return False


# ── Main router ─────────────────────────────────────────────────

HELP_TEXT = (
    "Here's what I can help you with:\n\n"
    "**Your Data:**\n"
    "- **my attendance** — Your attendance history\n"
    "- **my leave balance** — Remaining leaves this year\n"
    "- **my tasks** — Your assigned tasks\n"
    "- **my payroll** / **my salary** — Your salary details\n"
    "- **my details** — Your profile info\n\n"
    "**Company Data** (managers/admin):\n"
    "- **who is on leave today** — Employees on leave\n"
    "- **who is present today** — Today's attendance\n"
    "- **pending leaves** — Pending leave requests\n"
    "- **total employees** — Employee headcount\n"
    "- **details of [name]** — Employee info\n\n"
    "**How-To Guides:**\n"
    "- **how to apply leave** — Step-by-step\n"
    "- **how to check in** — Face attendance guide\n"
    "- **how to register face** — Setup guide\n\n"
    "**Policies:** leave policy, attendance policy, benefits, contact hr\n\n"
    "- **holidays** — Upcoming holidays\n\n"
    "Just type your question naturally!"
)

OFF_TOPIC_RESPONSE = "I am designed to assist only with WorkNet system-related queries. Try asking about attendance, leaves, payroll, tasks, or type **help** to see what I can do."


def get_response(message, user_id, role):
    msg = message.lower().strip()

    # ── Greetings ────────────────────────────────────────────
    if msg in ('hi', 'hello', 'hey', 'hii', 'hiii', 'good morning', 'good afternoon', 'good evening'):
        user = User.query.get(user_id)
        name = user.name.split()[0] if user else 'there'
        return f"Hello **{name}**! How can I help you with WorkNet today? Type **help** to see options."

    if msg in ('help', 'menu', 'options', 'what can you do'):
        return HELP_TEXT

    if any(w in msg for w in ['thank', 'thanks', 'thx']):
        return "You're welcome! Let me know if you need anything else."

    if msg in ('bye', 'goodbye', 'see you'):
        return "Goodbye! Have a productive day."

    # ── Scope guard: reject off-topic questions ──────────────
    if not _is_on_topic(msg):
        return OFF_TOPIC_RESPONSE

    # ── "How to" guides ──────────────────────────────────────
    if re.search(r'(how\s+(to|do|can)|where\s+(do|can)|steps?\s+(to|for))', msg):
        for pattern, guide in HOW_TO_GUIDES.items():
            if re.search(pattern, msg, re.IGNORECASE):
                return guide
        # Generic how-to fallback within scope
        return (
            "I have guides for: **apply leave**, **check in/out**, **register face**, "
            "**view payroll**, **create task**, **update task**, **reset password**.\n"
            "Try: \"How to apply leave?\""
        )

    # ── Static policy lookups ────────────────────────────────
    for key, response in POLICIES.items():
        if key in msg:
            return response

    # ── Live data queries ────────────────────────────────────

    # Who is on leave today
    if re.search(r'(who|employees?|staff)\s.*(on\s+leave|leave\s+today|on\s+leave\s+today)', msg) or msg in ('on leave today', 'leave today'):
        return handle_on_leave_today(user_id, role)

    # Who is present today
    if re.search(r'(who|employees?|staff)\s.*(present|checked\s*in)', msg) or 'present today' in msg:
        return handle_present_today(user_id, role)

    # Pending leaves
    if 'pending' in msg and 'leave' in msg:
        return handle_pending_leaves(user_id, role)

    # Leave balance
    if re.search(r'leave\s*balance|remaining\s*leave|leaves?\s*(left|available)', msg):
        return handle_leave_balance(user_id)

    # Leave status / history (with optional name or status filter)
    if re.search(r'leave\s*(status|request|history|record)', msg) or re.search(r'(approved|rejected)\s*leave', msg) or re.search(r'leaves?\s+(of|for)\s+', msg):
        return handle_leave_status(msg, user_id, role)

    # My tasks
    if re.search(r'my\s+task|task.*assigned|my.*todo', msg):
        return handle_my_tasks(user_id, role)

    # My details / my profile
    if re.search(r'my\s+(detail|profile|info)', msg):
        return handle_my_details(user_id)

    # My attendance
    if 'my attendance' in msg or 'my check' in msg:
        return handle_attendance_query(msg, user_id, role)

    # Attendance of someone
    if 'attendance' in msg and re.search(r'(of|for)\s+', msg):
        return handle_attendance_query(msg, user_id, role)

    # Am I late / late today
    if re.search(r'(am\s+i|was\s+i)\s+late|late\s+today', msg):
        today = _today()
        rec = Attendance.query.filter_by(user_id=user_id, date=today).first()
        if not rec or not rec.check_in:
            return "You haven't checked in today yet."
        if rec.is_late:
            return f"Yes, you checked in at **{rec.check_in}** — marked as **Late** (after 9:30 AM)."
        return f"No, you checked in on time at **{rec.check_in}**."

    # My payroll / my salary
    if re.search(r'my\s+(payroll|salary|pay\s*slip|slip)', msg):
        return handle_payroll_query(msg, user_id, role)

    # Payroll / salary of someone
    if ('payroll' in msg or 'salary' in msg) and re.search(r'(of|for)\s+', msg):
        return handle_payroll_query(msg, user_id, role)

    # Payroll / salary general
    if re.search(r'(payroll|salary)\s*(detail|info|status|slip)?$', msg):
        return handle_payroll_query(msg, user_id, role)

    # Total employees / headcount
    if re.search(r'(total|count|how\s+many)\s*(employee|staff|people|worker|member)', msg) or 'headcount' in msg:
        return handle_total_employees(user_id, role)

    # Employee details
    if re.search(r'(detail|info|who\s+is)\s', msg) or re.search(r'employee\s+\w', msg):
        result = handle_employee_details(msg, user_id, role)
        if result:
            return result

    # Holidays
    if 'holiday' in msg:
        return handle_holidays(user_id, role)

    # ── On-topic fallback ────────────────────────────────────
    return (
        "I couldn't find specific data for that. Try being more specific, or type **help** to see all available commands."
    )


@chat_bp.route('/', methods=['POST'])
@jwt_required()
def chat():
    data = request.get_json()
    message = data.get('message', '')
    if not message.strip():
        return jsonify({'error': 'Message is required.'}), 400

    claims = get_jwt()
    user_id = get_jwt_identity()
    role = claims.get('role', 'employee')

    return jsonify({'response': get_response(message, int(user_id), role)}), 200


@chat_bp.route('/history', methods=['GET'])
@jwt_required()
def chat_history():
    return jsonify([]), 200
