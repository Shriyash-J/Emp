import json
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='employee')
    department = db.Column(db.String(100), default='')
    position = db.Column(db.String(100), default='')
    phone = db.Column(db.String(20), default='')
    status = db.Column(db.String(20), default='active')
    hire_date = db.Column(db.String(20), default=lambda: datetime.now(timezone.utc).strftime('%Y-%m-%d'))
    upi_id = db.Column(db.String(100), default='')  # Optional UPI ID for salary payment
    is_email_verified = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'role': self.role,
            'department': self.department,
            'position': self.position,
            'phone': self.phone,
            'status': self.status,
            'hire_date': self.hire_date,
            'upi_id': self.upi_id or '',
            'is_email_verified': self.is_email_verified,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class OTP(db.Model):
    __tablename__ = 'otps'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    email = db.Column(db.String(120), nullable=False, index=True)
    otp_code = db.Column(db.String(6), nullable=False)
    purpose = db.Column(db.String(20), nullable=False, default='login')  # login, register, reset
    is_used = db.Column(db.Boolean, default=False)
    attempts = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = db.Column(db.DateTime, nullable=False)

    def is_expired(self):
        now = datetime.now(timezone.utc)
        expires = self.expires_at
        # Handle naive datetime from SQLite
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return now > expires

    def is_valid(self):
        return not self.is_used and not self.is_expired() and self.attempts < 5


class Attendance(db.Model):
    __tablename__ = 'attendance'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    date = db.Column(db.String(10), nullable=False)
    check_in = db.Column(db.String(8), default=None)
    check_out = db.Column(db.String(8), default=None)
    status = db.Column(db.String(20), default='present')
    working_hours = db.Column(db.Float, default=None)     # Auto-computed on check-out
    is_late = db.Column(db.Boolean, default=False)         # True if check-in after 09:30
    is_half_day = db.Column(db.Boolean, default=False)     # True if worked < 4 hours
    overtime_hours = db.Column(db.Float, default=None)     # Hours beyond 9h standard

    user = db.relationship('User', backref='attendance_records', lazy=True)

    # Office policy constants
    OFFICE_START = '09:00:00'
    LATE_THRESHOLD = '09:30:00'
    STANDARD_HOURS = 9.0

    def compute_hours(self):
        """Calculate working_hours, overtime, and is_half_day from check-in/out."""
        if self.check_in and self.check_out:
            try:
                h1, m1, s1 = map(int, self.check_in.split(':'))
                h2, m2, s2 = map(int, self.check_out.split(':'))
                total_sec = (h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1)
                if total_sec < 0:
                    total_sec = 0
                self.working_hours = round(total_sec / 3600.0, 2)
                self.is_half_day = self.working_hours < 4.0
                overtime = self.working_hours - self.STANDARD_HOURS
                self.overtime_hours = round(overtime, 2) if overtime > 0 else None
            except (ValueError, TypeError):
                self.working_hours = None

    def compute_late(self):
        """Determine if check-in is after the late threshold."""
        if self.check_in:
            self.is_late = self.check_in > self.LATE_THRESHOLD

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'employee_name': self.user.name if self.user else '',
            'department': self.user.department if self.user else '',
            'date': self.date,
            'check_in': self.check_in,
            'check_out': self.check_out,
            'status': self.status,
            'working_hours': self.working_hours,
            'is_late': self.is_late,
            'is_half_day': self.is_half_day,
            'overtime_hours': self.overtime_hours,
        }


class Leave(db.Model):
    __tablename__ = 'leaves'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    leave_type = db.Column(db.String(30), nullable=False, default='casual')
    start_date = db.Column(db.String(10), nullable=False)
    end_date = db.Column(db.String(10), nullable=False)
    reason = db.Column(db.String(500), default='')
    status = db.Column(db.String(20), default='pending')
    approved_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', foreign_keys=[user_id], backref='leave_requests', lazy=True)
    approver = db.relationship('User', foreign_keys=[approved_by], lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'employee_name': self.user.name if self.user else '',
            'department': self.user.department if self.user else '',
            # Role of the requester — used by the frontend to decide whether
            # the viewer is authorised to approve/reject this specific leave.
            'user_role': self.user.role if self.user else '',
            'leave_type': self.leave_type,
            'start_date': self.start_date,
            'end_date': self.end_date,
            'reason': self.reason,
            'status': self.status,
            'approved_by': self.approved_by,
            'approved_by_name': self.approver.name if self.approver else '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Task(db.Model):
    __tablename__ = 'tasks'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.String(1000), default='')
    assigned_to = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    assigned_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    priority = db.Column(db.String(20), default='medium')
    status = db.Column(db.String(20), default='pending')
    due_date = db.Column(db.String(10), default=None)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    assignee = db.relationship('User', foreign_keys=[assigned_to], backref='assigned_tasks', lazy=True)
    assigner = db.relationship('User', foreign_keys=[assigned_by], backref='created_tasks', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'assigned_to': self.assigned_to,
            'assigned_to_name': self.assignee.name if self.assignee else '',
            'assigned_by': self.assigned_by,
            'assigned_by_name': self.assigner.name if self.assigner else '',
            'priority': self.priority,
            'status': self.status,
            'due_date': self.due_date,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Announcement(db.Model):
    __tablename__ = 'announcements'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    priority = db.Column(db.String(20), default='normal')
    target_audience = db.Column(db.String(20), default='all')  # all, admin, hr, manager, employee
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    creator = db.relationship('User', backref='announcements', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'content': self.content,
            'priority': self.priority,
            'target_audience': self.target_audience or 'all',
            'created_by': self.created_by,
            'created_by_name': self.creator.name if self.creator else '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class PayrollConfig(db.Model):
    """Per-employee salary configuration set by Admin/HR."""
    __tablename__ = 'payroll_config'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, unique=True)
    basic_salary = db.Column(db.Float, nullable=False, default=0)  # Monthly gross salary
    hra = db.Column(db.Float, default=0)           # House Rent Allowance
    da = db.Column(db.Float, default=0)            # Dearness Allowance
    ta = db.Column(db.Float, default=0)            # Travel Allowance
    pf_deduction = db.Column(db.Float, default=0)  # Provident Fund deduction
    tax_deduction = db.Column(db.Float, default=0) # Tax deduction
    other_deductions = db.Column(db.Float, default=0)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', backref=db.backref('payroll_config', uselist=False), lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'employee_name': self.user.name if self.user else '',
            'department': self.user.department if self.user else '',
            'position': self.user.position if self.user else '',
            'basic_salary': self.basic_salary,
            'hra': self.hra,
            'da': self.da,
            'ta': self.ta,
            'pf_deduction': self.pf_deduction,
            'tax_deduction': self.tax_deduction,
            'other_deductions': self.other_deductions,
            'gross_salary': self.basic_salary + self.hra + self.da + self.ta,
            'total_deductions': self.pf_deduction + self.tax_deduction + self.other_deductions,
            'net_salary': (self.basic_salary + self.hra + self.da + self.ta)
                          - (self.pf_deduction + self.tax_deduction + self.other_deductions),
        }


class Payroll(db.Model):
    """Monthly payroll record generated for each employee."""
    __tablename__ = 'payroll'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    month = db.Column(db.String(7), nullable=False)  # YYYY-MM
    total_working_days = db.Column(db.Integer, default=0)
    days_present = db.Column(db.Integer, default=0)
    days_absent = db.Column(db.Integer, default=0)
    days_leave = db.Column(db.Integer, default=0)
    basic_salary = db.Column(db.Float, default=0)
    hra = db.Column(db.Float, default=0)
    da = db.Column(db.Float, default=0)
    ta = db.Column(db.Float, default=0)
    gross_salary = db.Column(db.Float, default=0)
    pf_deduction = db.Column(db.Float, default=0)
    tax_deduction = db.Column(db.Float, default=0)
    other_deductions = db.Column(db.Float, default=0)
    total_deductions = db.Column(db.Float, default=0)
    net_salary = db.Column(db.Float, default=0)
    bonus = db.Column(db.Float, default=0)               # Admin-added bonus
    bonus_reason = db.Column(db.String(200), default='')
    extra_deduction = db.Column(db.Float, default=0)      # Admin-added extra deduction
    extra_deduction_reason = db.Column(db.String(200), default='')
    overtime_pay = db.Column(db.Float, default=0)         # Computed from overtime hours
    late_penalty = db.Column(db.Float, default=0)         # Penalty for late arrivals
    final_salary = db.Column(db.Float, default=0)         # net + bonus + overtime - extra_deduction - penalty
    status = db.Column(db.String(20), default='generated')  # generated, approved, paid
    payment_status = db.Column(db.String(20), default='pending')  # pending, processing, paid, failed
    payment_order_id = db.Column(db.String(100), default='')  # Razorpay order ID
    payment_id = db.Column(db.String(100), default='')  # Razorpay payment ID
    paid_on = db.Column(db.DateTime, nullable=True)  # Date when payment was completed
    generated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', backref='payroll_records', lazy=True)

    def compute_final(self):
        """Compute final_salary from net + adjustments."""
        self.final_salary = round(
            self.net_salary + self.bonus + self.overtime_pay
            - self.extra_deduction - self.late_penalty, 2
        )

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'employee_name': self.user.name if self.user else '',
            'department': self.user.department if self.user else '',
            'position': self.user.position if self.user else '',
            'month': self.month,
            'total_working_days': self.total_working_days,
            'days_present': self.days_present,
            'days_absent': self.days_absent,
            'days_leave': self.days_leave,
            'basic_salary': self.basic_salary,
            'hra': self.hra,
            'da': self.da,
            'ta': self.ta,
            'gross_salary': self.gross_salary,
            'pf_deduction': self.pf_deduction,
            'tax_deduction': self.tax_deduction,
            'other_deductions': self.other_deductions,
            'total_deductions': self.total_deductions,
            'net_salary': self.net_salary,
            'bonus': self.bonus,
            'bonus_reason': self.bonus_reason,
            'extra_deduction': self.extra_deduction,
            'extra_deduction_reason': self.extra_deduction_reason,
            'overtime_pay': self.overtime_pay,
            'late_penalty': self.late_penalty,
            'final_salary': self.final_salary or self.net_salary,
            'status': self.status,
            'payment_status': self.payment_status or 'pending',
            'payment_order_id': self.payment_order_id or '',
            'payment_id': self.payment_id or '',
            'paid_on': self.paid_on.isoformat() if self.paid_on else None,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
        }


class Holiday(db.Model):
    """Company holidays and custom holidays for specific employees."""
    __tablename__ = 'holidays'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    date = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    name = db.Column(db.String(200), nullable=False)
    holiday_type = db.Column(db.String(20), default='company')  # company, custom
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # NULL = company-wide
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    employee = db.relationship('User', foreign_keys=[user_id], lazy=True)
    creator = db.relationship('User', foreign_keys=[created_by], lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'date': self.date,
            'name': self.name,
            'holiday_type': self.holiday_type,
            'user_id': self.user_id,
            'employee_name': self.employee.name if self.employee else 'All Employees',
            'created_by': self.created_by,
            'created_by_name': self.creator.name if self.creator else '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Letter(db.Model):
    """HR-issued letters: offer, experience, appointment, relieving."""
    __tablename__ = 'letters'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    letter_type = db.Column(db.String(30), nullable=False)  # offer, experience, appointment, relieving
    title = db.Column(db.String(200), nullable=False)
    content_json = db.Column(db.Text, nullable=False, default='{}')  # Template data as JSON
    file_path = db.Column(db.String(500), default=None)  # Path to generated PDF
    issued_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(20), default='issued')  # draft, issued, revoked
    issued_date = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    employee = db.relationship('User', foreign_keys=[user_id], backref='letters_received', lazy=True)
    issuer = db.relationship('User', foreign_keys=[issued_by], backref='letters_issued', lazy=True)

    VALID_TYPES = ('offer', 'experience', 'appointment', 'relieving')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'employee_name': self.employee.name if self.employee else '',
            'employee_email': self.employee.email if self.employee else '',
            'department': self.employee.department if self.employee else '',
            'position': self.employee.position if self.employee else '',
            'letter_type': self.letter_type,
            'title': self.title,
            'content_json': self.content_json,
            'file_path': self.file_path,
            'issued_by': self.issued_by,
            'issued_by_name': self.issuer.name if self.issuer else '',
            'status': self.status,
            'issued_date': self.issued_date,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Team(db.Model):
    """Teams managed by managers."""
    __tablename__ = 'teams'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(500), default='')
    manager_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    department = db.Column(db.String(100), default='')
    status = db.Column(db.String(20), default='active')  # active, archived
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    manager = db.relationship('User', backref='managed_teams', lazy=True)
    members = db.relationship('TeamMember', backref='team', lazy=True, cascade='all, delete-orphan')
    team_tasks = db.relationship('TeamTask', backref='team', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'manager_id': self.manager_id,
            'manager_name': self.manager.name if self.manager else '',
            'department': self.department,
            'status': self.status,
            'member_count': len(self.members),
            'members': [m.to_dict() for m in self.members],
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class TeamMember(db.Model):
    """Association between teams and employees."""
    __tablename__ = 'team_members'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    team_id = db.Column(db.Integer, db.ForeignKey('teams.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    role_in_team = db.Column(db.String(50), default='member')  # member, lead
    joined_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', backref='team_memberships', lazy=True)

    __table_args__ = (db.UniqueConstraint('team_id', 'user_id', name='uq_team_user'),)

    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'user_id': self.user_id,
            'employee_name': self.user.name if self.user else '',
            'position': self.user.position if self.user else '',
            'department': self.user.department if self.user else '',
            'role_in_team': self.role_in_team,
            'joined_at': self.joined_at.isoformat() if self.joined_at else None,
        }


class TeamTask(db.Model):
    """Tasks assigned to an entire team with progress tracking."""
    __tablename__ = 'team_tasks'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    team_id = db.Column(db.Integer, db.ForeignKey('teams.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default='')
    assigned_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    priority = db.Column(db.String(20), default='medium')  # low, medium, high, urgent
    status = db.Column(db.String(20), default='pending')    # pending, in_progress, completed, cancelled
    start_date = db.Column(db.String(10), nullable=False)
    deadline = db.Column(db.String(10), nullable=False)
    overall_progress = db.Column(db.Integer, default=0)     # 0–100 auto-computed
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = db.Column(db.DateTime, default=None)

    assigner = db.relationship('User', backref='team_tasks_created', lazy=True)
    member_progress = db.relationship('TeamTaskProgress', backref='team_task', lazy=True, cascade='all, delete-orphan')

    VALID_PRIORITIES = ('low', 'medium', 'high', 'urgent')

    def compute_overall_progress(self):
        """Average of all member progress entries."""
        entries = self.member_progress
        if not entries:
            return 0
        return round(sum(e.progress for e in entries) / len(entries))

    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'team_name': self.team.name if self.team else '',
            'title': self.title,
            'description': self.description,
            'assigned_by': self.assigned_by,
            'assigned_by_name': self.assigner.name if self.assigner else '',
            'priority': self.priority,
            'status': self.status,
            'start_date': self.start_date,
            'deadline': self.deadline,
            'overall_progress': self.overall_progress,
            'member_progress': [p.to_dict() for p in self.member_progress],
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
        }


class TeamTaskProgress(db.Model):
    """Individual member progress on a team task."""
    __tablename__ = 'team_task_progress'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    team_task_id = db.Column(db.Integer, db.ForeignKey('team_tasks.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    progress = db.Column(db.Integer, default=0)  # 0–100
    notes = db.Column(db.String(500), default='')
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', lazy=True)

    __table_args__ = (db.UniqueConstraint('team_task_id', 'user_id', name='uq_teamtask_user'),)

    def to_dict(self):
        return {
            'id': self.id,
            'team_task_id': self.team_task_id,
            'user_id': self.user_id,
            'employee_name': self.user.name if self.user else '',
            'progress': self.progress,
            'notes': self.notes,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Candidate(db.Model):
    """Recruitment tracking — job candidates managed by HR."""
    __tablename__ = 'candidates'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(20), default='')
    position_applied = db.Column(db.String(100), nullable=False)
    department = db.Column(db.String(100), default='')
    resume_path = db.Column(db.String(500), default=None)
    experience_years = db.Column(db.Float, default=0)
    current_company = db.Column(db.String(200), default='')
    expected_salary = db.Column(db.Float, default=0)
    status = db.Column(db.String(30), default='applied')  # applied, screening, interviewed, selected, rejected, on_hold
    interview_date = db.Column(db.String(10), default=None)
    interview_notes = db.Column(db.Text, default='')
    rejection_reason = db.Column(db.String(500), default='')
    added_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    recruiter = db.relationship('User', backref='candidates_added', lazy=True)

    VALID_STATUSES = ('applied', 'screening', 'interviewed', 'selected', 'rejected', 'on_hold')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'phone': self.phone,
            'position_applied': self.position_applied,
            'department': self.department,
            'experience_years': self.experience_years,
            'current_company': self.current_company,
            'expected_salary': self.expected_salary,
            'status': self.status,
            'interview_date': self.interview_date,
            'interview_notes': self.interview_notes,
            'rejection_reason': self.rejection_reason,
            'added_by': self.added_by,
            'added_by_name': self.recruiter.name if self.recruiter else '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class PerformanceRecord(db.Model):
    """Performance records — submitted by Manager, viewable by HR and employee."""
    __tablename__ = 'performance_records'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    review_period = db.Column(db.String(20), nullable=False)  # e.g. "2026-Q1", "2025-H2"
    rating = db.Column(db.Integer, nullable=False)  # 1-5 scale
    goals_met = db.Column(db.Integer, default=0)  # percentage 0-100
    strengths = db.Column(db.Text, default='')
    improvements = db.Column(db.Text, default='')
    manager_comments = db.Column(db.Text, default='')
    hr_comments = db.Column(db.Text, default='')
    status = db.Column(db.String(20), default='submitted')  # submitted, reviewed, acknowledged
    reviewed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    employee = db.relationship('User', foreign_keys=[user_id], backref='performance_records', lazy=True)
    reviewer = db.relationship('User', foreign_keys=[reviewed_by], backref='reviews_given', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'employee_name': self.employee.name if self.employee else '',
            'department': self.employee.department if self.employee else '',
            'position': self.employee.position if self.employee else '',
            'review_period': self.review_period,
            'rating': self.rating,
            'goals_met': self.goals_met,
            'strengths': self.strengths,
            'improvements': self.improvements,
            'manager_comments': self.manager_comments,
            'hr_comments': self.hr_comments,
            'status': self.status,
            'reviewed_by': self.reviewed_by,
            'reviewed_by_name': self.reviewer.name if self.reviewer else '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class ExitRecord(db.Model):
    """Employee exit/resignation tracking managed by HR."""
    __tablename__ = 'exit_records'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, unique=True)
    resignation_date = db.Column(db.String(10), nullable=False)
    last_working_date = db.Column(db.String(10), nullable=False)
    exit_type = db.Column(db.String(30), default='resignation')  # resignation, termination, retirement, contract_end
    reason = db.Column(db.Text, default='')
    notice_period_days = db.Column(db.Integer, default=30)
    exit_interview_done = db.Column(db.Boolean, default=False)
    exit_interview_notes = db.Column(db.Text, default='')
    assets_returned = db.Column(db.Boolean, default=False)
    final_settlement_done = db.Column(db.Boolean, default=False)
    relieving_letter_issued = db.Column(db.Boolean, default=False)
    experience_letter_issued = db.Column(db.Boolean, default=False)
    status = db.Column(db.String(20), default='initiated')  # initiated, in_progress, completed
    processed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    employee = db.relationship('User', foreign_keys=[user_id], backref=db.backref('exit_record', uselist=False), lazy=True)
    processor = db.relationship('User', foreign_keys=[processed_by], lazy=True)

    VALID_EXIT_TYPES = ('resignation', 'termination', 'retirement', 'contract_end')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'employee_name': self.employee.name if self.employee else '',
            'department': self.employee.department if self.employee else '',
            'position': self.employee.position if self.employee else '',
            'email': self.employee.email if self.employee else '',
            'resignation_date': self.resignation_date,
            'last_working_date': self.last_working_date,
            'exit_type': self.exit_type,
            'reason': self.reason,
            'notice_period_days': self.notice_period_days,
            'exit_interview_done': self.exit_interview_done,
            'exit_interview_notes': self.exit_interview_notes,
            'assets_returned': self.assets_returned,
            'final_settlement_done': self.final_settlement_done,
            'relieving_letter_issued': self.relieving_letter_issued,
            'experience_letter_issued': self.experience_letter_issued,
            'status': self.status,
            'processed_by': self.processed_by,
            'processed_by_name': self.processor.name if self.processor else '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Department(db.Model):
    """Organization departments managed by Admin."""
    __tablename__ = 'departments'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    description = db.Column(db.String(500), default='')
    manager_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    head_count = db.Column(db.Integer, default=0)
    budget = db.Column(db.Float, default=0)
    status = db.Column(db.String(20), default='active')  # active, inactive
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    manager = db.relationship('User', backref='department_managed', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'manager_id': self.manager_id,
            'manager_name': self.manager.name if self.manager else '',
            'head_count': self.head_count,
            'budget': self.budget,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class SystemConfig(db.Model):
    """System-wide settings managed by Admin."""
    __tablename__ = 'system_config'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    key = db.Column(db.String(100), nullable=False, unique=True)
    value = db.Column(db.Text, nullable=False, default='')
    description = db.Column(db.String(500), default='')
    category = db.Column(db.String(50), default='general')  # general, payroll, attendance, security
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    updater = db.relationship('User', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'key': self.key,
            'value': self.value,
            'description': self.description,
            'category': self.category,
            'updated_by_name': self.updater.name if self.updater else '',
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class ActivityLog(db.Model):
    __tablename__ = 'activity_log'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    action = db.Column(db.String(50), nullable=False)
    description = db.Column(db.String(500), nullable=False)
    module = db.Column(db.String(20), nullable=False, default='system')
    ip_address = db.Column(db.String(50), default='')
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', backref='activities', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.name if self.user else 'System',
            'user_role': self.user.role if self.user else '',
            'action': self.action,
            'description': self.description,
            'module': self.module,
            'ip_address': self.ip_address,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }


class Message(db.Model):
    """Internal employee-to-employee messaging."""
    __tablename__ = 'messages'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    message = db.Column(db.Text, nullable=False)
    is_read = db.Column(db.Boolean, default=False)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    sender = db.relationship('User', foreign_keys=[sender_id], backref='messages_sent', lazy=True)
    receiver = db.relationship('User', foreign_keys=[receiver_id], backref='messages_received', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'sender_id': self.sender_id,
            'sender_name': self.sender.name if self.sender else '',
            'receiver_id': self.receiver_id,
            'receiver_name': self.receiver.name if self.receiver else '',
            'message': self.message,
            'is_read': self.is_read,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }


class Notification(db.Model):
    """In-app notifications shown in the bell dropdown of the top navbar."""
    __tablename__ = 'notifications'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.String(500), default='')
    category = db.Column(db.String(30), default='general')  # leave, task, announcement, attendance, payroll, general
    link = db.Column(db.String(200), default='')  # Optional in-app route to navigate to on click
    is_read = db.Column(db.Boolean, default=False, index=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    user = db.relationship('User', backref='notifications', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'body': self.body,
            'category': self.category,
            'link': self.link,
            'is_read': self.is_read,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class FaceEncoding(db.Model):
    __tablename__ = 'face_encodings'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
    # This remains db.Text, which is perfect for storing long Base64 image strings
    encoding_data = db.Column(db.Text, nullable=False) 
    registered_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', backref=db.backref('face_encoding', uselist=False), lazy=True)

    def get_encoding(self):
        """Returns the stored Base64 image string."""
        return self.encoding_data

    def set_encoding(self, image_base64_string):
        """Stores the raw Base64 image string directly."""
        self.encoding_data = image_base64_string

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'employee_name': self.user.name if self.user else '',
            'registered_at': self.registered_at.isoformat() if self.registered_at else None,
        }