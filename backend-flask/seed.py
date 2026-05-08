"""
Database seeder — creates initial users and payroll config for development/testing.

╔══════════════════════════════════════════════════════════════════════╗
║  DEVELOPER TEST ACCOUNTS (NOT shown in UI)                         ║
║                                                                     ║
║  If SEED_EMAIL is set in .env, aliases are used:                   ║
║    Admin:    <SEED_EMAIL_USER>+admin@gmail.com    / admin123       ║
║    HR:       <SEED_EMAIL_USER>+hr@gmail.com       / hr123         ║
║    Manager:  <SEED_EMAIL_USER>+manager@gmail.com  / manager123    ║
║    Employee: <SEED_EMAIL_USER>+sneha@gmail.com    / emp123        ║
║                                                                     ║
║  If SEED_EMAIL is NOT set, fallback emails are used:               ║
║    admin@worknet.com      / admin123                             ║
║    hr@worknet.com         / hr123                                ║
║    manager@worknet.com    / manager123                           ║
║    sneha@worknet.com      / emp123                                ║
║                                                                     ║
║  All employee test accounts use password: emp123                   ║
║  To re-seed: delete instance/worknet.db and restart the server.  ║
╚══════════════════════════════════════════════════════════════════════╝
"""
import os
import json
import bcrypt
from datetime import datetime, timezone
from models import db, User, ActivityLog, PayrollConfig, Holiday, Letter, Candidate, PerformanceRecord, Team, TeamMember, TeamTask, TeamTaskProgress, Department, SystemConfig


def seed_database():
    """Seed the database with initial data if empty."""
    base_email = os.getenv('SEED_EMAIL', '')

    if not base_email:
        print('[SEED] WARNING: SEED_EMAIL not set in .env — seed users will not receive OTP emails.')
        print('[SEED] Set SEED_EMAIL=youremail@gmail.com in .env and delete worknet.db to re-seed.')

    def make_alias(label):
        """Create Gmail alias: user+label@gmail.com"""
        if not base_email:
            return f'{label}@worknet.com'
        name, domain = base_email.split('@')
        return f'{name}+{label}@{domain}'

    admin_email = make_alias('admin')

    if User.query.filter_by(email=admin_email).first():
        print('[SEED] Database already seeded.')
        return

    def hash_pw(pw):
        return bcrypt.hashpw(pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    users_data = [
        {'name': 'Rajesh Kumar', 'email': make_alias('admin'), 'password': hash_pw('admin123'),
         'role': 'admin', 'department': 'Management', 'position': 'CEO', 'phone': '9876543210'},
        {'name': 'Priya Sharma', 'email': make_alias('hr'), 'password': hash_pw('hr123'),
         'role': 'hr', 'department': 'Human Resources', 'position': 'HR Manager', 'phone': '9876543211'},
        {'name': 'Amit Patel', 'email': make_alias('manager'), 'password': hash_pw('manager123'),
         'role': 'manager', 'department': 'Engineering', 'position': 'Engineering Manager', 'phone': '9876543212'},
        {'name': 'Sneha Reddy', 'email': make_alias('sneha'), 'password': hash_pw('emp123'),
         'role': 'employee', 'department': 'Engineering', 'position': 'Software Developer', 'phone': '9876543213'},
        {'name': 'Vikram Singh', 'email': make_alias('vikram'), 'password': hash_pw('emp123'),
         'role': 'employee', 'department': 'Engineering', 'position': 'Frontend Developer', 'phone': '9876543214'},
        {'name': 'Neha Gupta', 'email': make_alias('neha'), 'password': hash_pw('emp123'),
         'role': 'employee', 'department': 'Design', 'position': 'UI/UX Designer', 'phone': '9876543215'},
        {'name': 'Arjun Mehta', 'email': make_alias('arjun'), 'password': hash_pw('emp123'),
         'role': 'employee', 'department': 'Marketing', 'position': 'Marketing Executive', 'phone': '9876543216'},
        {'name': 'Kavita Joshi', 'email': make_alias('kavita'), 'password': hash_pw('emp123'),
         'role': 'employee', 'department': 'Finance', 'position': 'Accountant', 'phone': '9876543217'},
    ]

    for u in users_data:
        user = User(is_email_verified=True, status='active', **u)
        db.session.add(user)

    db.session.commit()

    # ─── Seed Payroll Configurations ──────────────────────────
    # Salary structures for each seeded employee
    payroll_data = [
        {'user_id': 1, 'basic_salary': 150000, 'hra': 60000, 'da': 15000, 'ta': 5000, 'pf_deduction': 18000, 'tax_deduction': 25000, 'other_deductions': 2000},
        {'user_id': 2, 'basic_salary': 90000, 'hra': 36000, 'da': 9000, 'ta': 3000, 'pf_deduction': 10800, 'tax_deduction': 12000, 'other_deductions': 1000},
        {'user_id': 3, 'basic_salary': 110000, 'hra': 44000, 'da': 11000, 'ta': 4000, 'pf_deduction': 13200, 'tax_deduction': 15000, 'other_deductions': 1500},
        {'user_id': 4, 'basic_salary': 70000, 'hra': 28000, 'da': 7000, 'ta': 2500, 'pf_deduction': 8400, 'tax_deduction': 8000, 'other_deductions': 500},
        {'user_id': 5, 'basic_salary': 65000, 'hra': 26000, 'da': 6500, 'ta': 2500, 'pf_deduction': 7800, 'tax_deduction': 7000, 'other_deductions': 500},
        {'user_id': 6, 'basic_salary': 60000, 'hra': 24000, 'da': 6000, 'ta': 2000, 'pf_deduction': 7200, 'tax_deduction': 6000, 'other_deductions': 500},
        {'user_id': 7, 'basic_salary': 55000, 'hra': 22000, 'da': 5500, 'ta': 2000, 'pf_deduction': 6600, 'tax_deduction': 5000, 'other_deductions': 500},
        {'user_id': 8, 'basic_salary': 60000, 'hra': 24000, 'da': 6000, 'ta': 2000, 'pf_deduction': 7200, 'tax_deduction': 6000, 'other_deductions': 500},
    ]

    for p in payroll_data:
        db.session.add(PayrollConfig(**p))

    # ─── Seed Company Holidays (2026) ─────────────────────────
    holidays_data = [
        {'date': '2026-01-26', 'name': 'Republic Day', 'holiday_type': 'company', 'created_by': 1},
        {'date': '2026-03-10', 'name': 'Holi', 'holiday_type': 'company', 'created_by': 1},
        {'date': '2026-04-14', 'name': 'Ambedkar Jayanti', 'holiday_type': 'company', 'created_by': 1},
        {'date': '2026-05-01', 'name': 'May Day', 'holiday_type': 'company', 'created_by': 1},
        {'date': '2026-08-15', 'name': 'Independence Day', 'holiday_type': 'company', 'created_by': 1},
        {'date': '2026-10-02', 'name': 'Gandhi Jayanti', 'holiday_type': 'company', 'created_by': 1},
        {'date': '2026-10-20', 'name': 'Diwali', 'holiday_type': 'company', 'created_by': 1},
        {'date': '2026-10-21', 'name': 'Diwali (Day 2)', 'holiday_type': 'company', 'created_by': 1},
        {'date': '2026-12-25', 'name': 'Christmas', 'holiday_type': 'company', 'created_by': 1},
    ]

    for h in holidays_data:
        db.session.add(Holiday(**h))

    # ─── Seed Activity Logs ───────────────────────────────────
    logs_data = [
        {'user_id': 1, 'action': 'LOGIN', 'description': 'Admin logged into the system', 'module': 'admin'},
        {'user_id': 2, 'action': 'ADD_EMPLOYEE', 'description': 'HR added new employee Sneha Reddy', 'module': 'hr'},
        {'user_id': 3, 'action': 'VIEW_REPORT', 'description': 'Manager viewed team performance report', 'module': 'employee'},
        {'user_id': 4, 'action': 'CHECK_IN', 'description': 'Sneha Reddy checked in for the day', 'module': 'employee'},
        {'user_id': 5, 'action': 'TASK_COMPLETED', 'description': 'Vikram Singh completed frontend redesign', 'module': 'employee'},
    ]

    for l in logs_data:
        db.session.add(ActivityLog(**l))

    # ─── Seed Sample Letters ─────────────────────────────────
    letters_data = [
        {
            'user_id': 4, 'letter_type': 'offer', 'title': 'Offer Letter - Sneha Reddy',
            'content_json': json.dumps({
                'employee_name': 'Sneha Reddy', 'position': 'Software Developer',
                'department': 'Engineering', 'salary': '10,70,000',
                'joining_date': '2025-06-15'
            }),
            'issued_by': 2, 'status': 'issued', 'issued_date': '2025-06-01',
        },
        {
            'user_id': 4, 'letter_type': 'appointment', 'title': 'Appointment Letter - Sneha Reddy',
            'content_json': json.dumps({
                'employee_name': 'Sneha Reddy', 'position': 'Software Developer',
                'department': 'Engineering', 'salary': '89,166.67',
                'joining_date': '2025-06-15', 'reporting_manager': 'Amit Patel'
            }),
            'issued_by': 2, 'status': 'issued', 'issued_date': '2025-06-15',
        },
        {
            'user_id': 5, 'letter_type': 'offer', 'title': 'Offer Letter - Vikram Singh',
            'content_json': json.dumps({
                'employee_name': 'Vikram Singh', 'position': 'Frontend Developer',
                'department': 'Engineering', 'salary': '10,00,000',
                'joining_date': '2025-07-01'
            }),
            'issued_by': 2, 'status': 'issued', 'issued_date': '2025-06-20',
        },
    ]

    for lt in letters_data:
        db.session.add(Letter(**lt))

    # ─── Seed Candidates (Recruitment) ───────────────────────
    candidates_data = [
        {'name': 'Rohit Verma', 'email': 'rohit.verma@gmail.com', 'phone': '9876543220',
         'position_applied': 'Backend Developer', 'department': 'Engineering',
         'experience_years': 3.5, 'current_company': 'TechCorp India',
         'expected_salary': 900000, 'status': 'interviewed',
         'interview_date': '2026-04-10', 'interview_notes': 'Strong Python and Flask skills. Good cultural fit.',
         'added_by': 2},
        {'name': 'Meera Nair', 'email': 'meera.nair@gmail.com', 'phone': '9876543221',
         'position_applied': 'UI/UX Designer', 'department': 'Design',
         'experience_years': 2.0, 'current_company': 'DesignHub',
         'expected_salary': 700000, 'status': 'applied',
         'added_by': 2},
        {'name': 'Sanjay Gupta', 'email': 'sanjay.g@outlook.com', 'phone': '9876543222',
         'position_applied': 'DevOps Engineer', 'department': 'Engineering',
         'experience_years': 5.0, 'current_company': 'CloudFirst',
         'expected_salary': 1400000, 'status': 'selected',
         'interview_date': '2026-03-28', 'interview_notes': 'Excellent AWS and Docker experience.',
         'added_by': 2},
        {'name': 'Divya Sharma', 'email': 'divya.s@gmail.com', 'phone': '9876543223',
         'position_applied': 'Marketing Manager', 'department': 'Marketing',
         'experience_years': 4.0, 'current_company': 'BrandWorks',
         'expected_salary': 1000000, 'status': 'rejected',
         'rejection_reason': 'Salary expectations too high for the role.',
         'added_by': 2},
    ]

    for c in candidates_data:
        db.session.add(Candidate(**c))

    # ─── Seed Performance Records ─────────────────────────────
    performance_data = [
        {'user_id': 4, 'review_period': '2026-Q1', 'rating': 4, 'goals_met': 85,
         'strengths': 'Excellent coding skills, fast learner, good team player',
         'improvements': 'Could improve documentation habits',
         'manager_comments': 'Sneha has been a consistent performer this quarter.',
         'status': 'submitted', 'reviewed_by': 3},
        {'user_id': 5, 'review_period': '2026-Q1', 'rating': 3, 'goals_met': 70,
         'strengths': 'Creative UI designs, good eye for detail',
         'improvements': 'Needs to improve deadline management',
         'manager_comments': 'Vikram delivered good work but missed two sprint deadlines.',
         'status': 'submitted', 'reviewed_by': 3},
        {'user_id': 6, 'review_period': '2026-Q1', 'rating': 5, 'goals_met': 95,
         'strengths': 'Exceptional design sense, proactive communication',
         'improvements': 'None significant',
         'manager_comments': 'Neha has exceeded expectations consistently.',
         'hr_comments': 'Recommended for promotion review.',
         'status': 'reviewed', 'reviewed_by': 3},
    ]

    for p in performance_data:
        db.session.add(PerformanceRecord(**p))

    # ─── Seed Teams ────────────────────────────────────────────
    # Manager (user_id=3) creates engineering team
    team1 = Team(name='Backend Squad', description='Core backend API development team',
                 manager_id=3, department='Engineering')
    team2 = Team(name='Frontend Crew', description='UI/UX implementation team',
                 manager_id=3, department='Engineering')
    db.session.add_all([team1, team2])
    db.session.flush()

    # Add members to teams
    members_data = [
        {'team_id': team1.id, 'user_id': 4, 'role_in_team': 'lead'},   # Sneha — lead
        {'team_id': team1.id, 'user_id': 8, 'role_in_team': 'member'}, # Kavita
        {'team_id': team2.id, 'user_id': 5, 'role_in_team': 'lead'},   # Vikram — lead
        {'team_id': team2.id, 'user_id': 6, 'role_in_team': 'member'}, # Neha
    ]
    for m in members_data:
        db.session.add(TeamMember(**m))
    db.session.flush()

    # Seed team tasks with progress
    tt1 = TeamTask(team_id=team1.id, title='API v2 Migration',
                   description='Migrate all REST endpoints to v2 schema with pagination',
                   assigned_by=3, priority='high', status='in_progress',
                   start_date='2026-03-15', deadline='2026-04-30', overall_progress=45)
    tt2 = TeamTask(team_id=team2.id, title='Dashboard Redesign',
                   description='Redesign the employee dashboard with new chart components',
                   assigned_by=3, priority='medium', status='in_progress',
                   start_date='2026-03-20', deadline='2026-04-20', overall_progress=70)
    tt3 = TeamTask(team_id=team1.id, title='Unit Test Coverage',
                   description='Increase backend test coverage to 80%',
                   assigned_by=3, priority='medium', status='completed',
                   start_date='2026-02-01', deadline='2026-03-15', overall_progress=100,
                   completed_at=datetime.now(timezone.utc))
    db.session.add_all([tt1, tt2, tt3])
    db.session.flush()

    # Progress entries
    progress_data = [
        {'team_task_id': tt1.id, 'user_id': 4, 'progress': 55, 'notes': 'Auth endpoints done'},
        {'team_task_id': tt1.id, 'user_id': 8, 'progress': 35, 'notes': 'Working on payroll endpoints'},
        {'team_task_id': tt2.id, 'user_id': 5, 'progress': 80, 'notes': 'Charts implemented'},
        {'team_task_id': tt2.id, 'user_id': 6, 'progress': 60, 'notes': 'Responsive layout WIP'},
        {'team_task_id': tt3.id, 'user_id': 4, 'progress': 100, 'notes': 'All tests passing'},
        {'team_task_id': tt3.id, 'user_id': 8, 'progress': 100, 'notes': 'Coverage at 82%'},
    ]
    for pg in progress_data:
        db.session.add(TeamTaskProgress(**pg))

    # ─── Seed Departments ────────────────────────────────────
    departments_data = [
        {'name': 'Management', 'description': 'Executive leadership and company strategy', 'manager_id': 1, 'budget': 5000000},
        {'name': 'Human Resources', 'description': 'Employee relations, recruitment, and compliance', 'manager_id': 2, 'budget': 2000000},
        {'name': 'Engineering', 'description': 'Software development and technical infrastructure', 'manager_id': 3, 'budget': 8000000},
        {'name': 'Design', 'description': 'UI/UX design and brand identity', 'budget': 1500000},
        {'name': 'Marketing', 'description': 'Brand promotion and market outreach', 'budget': 3000000},
        {'name': 'Finance', 'description': 'Accounting, budgeting, and financial planning', 'budget': 2000000},
    ]
    for d in departments_data:
        db.session.add(Department(**d))

    # ─── Seed System Config ──────────────────────────────────
    config_data = [
        {'key': 'company_name', 'value': 'Aaryak Solution', 'description': 'Company legal name', 'category': 'general'},
        {'key': 'company_address', 'value': 'Mumbai, Maharashtra, India', 'description': 'Registered office address', 'category': 'general'},
        {'key': 'work_hours_per_day', 'value': '9', 'description': 'Standard working hours per day', 'category': 'attendance'},
        {'key': 'late_threshold', 'value': '09:30', 'description': 'Check-in time after which employee is marked late', 'category': 'attendance'},
        {'key': 'late_penalty_pct', 'value': '0.5', 'description': 'Penalty as % of gross per late day', 'category': 'payroll'},
        {'key': 'overtime_multiplier', 'value': '1.5', 'description': 'Overtime pay multiplier (x hourly rate)', 'category': 'payroll'},
        {'key': 'max_casual_leaves', 'value': '12', 'description': 'Max casual leaves per year', 'category': 'attendance'},
        {'key': 'max_sick_leaves', 'value': '10', 'description': 'Max sick leaves per year', 'category': 'attendance'},
        {'key': 'password_min_length', 'value': '8', 'description': 'Minimum password length', 'category': 'security'},
        {'key': 'otp_expiry_minutes', 'value': '5', 'description': 'OTP validity in minutes', 'category': 'security'},
        {'key': 'session_timeout_hours', 'value': '24', 'description': 'JWT token expiry in hours', 'category': 'security'},
    ]
    for c in config_data:
        c['updated_by'] = 1
        db.session.add(SystemConfig(**c))

    db.session.commit()
    print('[SEED] Database seeded with users, payroll, holidays, letters, candidates, performance, teams, departments, and settings!')
