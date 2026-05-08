from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
import bcrypt
from models import (
    db, User, ActivityLog, Attendance, Leave, Task,
    PerformanceRecord, TeamMember
)
from middleware import require_roles, validate_email, sanitize_string, log_activity

emp_bp = Blueprint('employees', __name__, url_prefix='/api/employees')


@emp_bp.route('/', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr', 'manager')
def get_employees():
    search = request.args.get('search', '')
    department = request.args.get('department', '')
    status = request.args.get('status', '')
    role = request.args.get('role', '')

    query = User.query

    if search:
        query = query.filter(
            db.or_(
                User.name.ilike(f'%{search}%'),
                User.email.ilike(f'%{search}%'),
                User.position.ilike(f'%{search}%')
            )
        )
    if department:
        query = query.filter_by(department=department)
    if status:
        query = query.filter_by(status=status)
    if role:
        query = query.filter_by(role=role)

    employees = query.order_by(User.created_at.desc()).all()
    return jsonify([e.to_dict() for e in employees]), 200


@emp_bp.route('/<int:emp_id>', methods=['GET'])
@jwt_required()
def get_employee(emp_id):
    """Employees can view their own profile; admin/hr/manager can view anyone."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())

    if emp_id != user_id and claims.get('role') not in ('admin', 'hr', 'manager'):
        return jsonify({'error': 'Permission denied. You can only view your own profile.'}), 403

    employee = User.query.get(emp_id)
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404
    return jsonify(employee.to_dict()), 200


@emp_bp.route('/', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr')
def add_employee():
    data = request.get_json()
    name = sanitize_string(data.get('name', ''), 100)
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    role = data.get('role', 'employee')
    department = sanitize_string(data.get('department', ''), 100)
    position = sanitize_string(data.get('position', ''), 100)
    phone = sanitize_string(data.get('phone', ''), 20)

    if not name or not email or not password:
        return jsonify({'error': 'Name, email, and password are required.'}), 400

    if not validate_email(email):
        return jsonify({'error': 'Invalid email format.'}), 400

    # Only admin can assign admin role
    claims = get_jwt()
    if role == 'admin' and claims.get('role') != 'admin':
        return jsonify({'error': 'Only admin can assign the admin role.'}), 403

    if role not in ('admin', 'hr', 'manager', 'employee'):
        return jsonify({'error': 'Invalid role.'}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already exists.'}), 409

    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    user = User(
        name=name, email=email, password=hashed_pw, role=role,
        department=department, position=position, phone=phone,
        is_email_verified=True
    )
    db.session.add(user)
    db.session.commit()

    log_activity(
        action='ADD_EMPLOYEE',
        description=f'Added new employee: {name} ({role})',
        module='hr'
    )
    db.session.commit()

    return jsonify({'id': user.id, 'message': 'Employee added successfully.'}), 201


@emp_bp.route('/<int:emp_id>', methods=['PUT'])
@jwt_required()
@require_roles('admin', 'hr')
def update_employee(emp_id):
    employee = User.query.get(emp_id)
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    data = request.get_json()
    claims = get_jwt()
    current_role = claims.get('role')

    # Prevent privilege escalation: only admin can change roles
    if 'role' in data and data['role'] is not None:
        if current_role != 'admin':
            return jsonify({'error': 'Only admin can change employee roles.'}), 403
        if data['role'] not in ('admin', 'hr', 'manager', 'employee'):
            return jsonify({'error': 'Invalid role.'}), 400

    # Prevent HR from editing admin accounts
    if employee.role == 'admin' and current_role != 'admin':
        return jsonify({'error': 'Only admin can modify admin accounts.'}), 403

    # Validate email uniqueness if changed
    if 'email' in data and data['email'] and data['email'] != employee.email:
        if not validate_email(data['email']):
            return jsonify({'error': 'Invalid email format.'}), 400
        if User.query.filter_by(email=data['email']).first():
            return jsonify({'error': 'Email already in use.'}), 409

    # Safe fields that HR can update
    safe_fields = ['name', 'email', 'department', 'position', 'phone', 'status']
    if current_role == 'admin':
        safe_fields.append('role')

    for field in safe_fields:
        if field in data and data[field] is not None:
            setattr(employee, field, sanitize_string(data[field], 120) if field != 'email' else data[field].strip().lower())

    db.session.commit()

    log_activity(
        action='UPDATE_EMPLOYEE',
        description=f'Updated employee: {employee.name} (fields: {", ".join(k for k in data if k in safe_fields)})',
        module='hr'
    )
    db.session.commit()

    return jsonify({'message': 'Employee updated successfully.'}), 200


@emp_bp.route('/<int:emp_id>', methods=['DELETE'])
@jwt_required()
@require_roles('admin')
def delete_employee(emp_id):
    employee = User.query.get(emp_id)
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    # Prevent admin from deleting themselves
    user_id = int(get_jwt_identity())
    if emp_id == user_id:
        return jsonify({'error': 'You cannot delete your own account.'}), 400

    name = employee.name
    db.session.delete(employee)
    db.session.commit()

    log_activity(
        action='DELETE_EMPLOYEE',
        description=f'Deleted employee: {name}',
        module='admin'
    )
    db.session.commit()

    return jsonify({'message': 'Employee deleted successfully.'}), 200


# ─── DEACTIVATE EMPLOYEE (HR/Admin) ──────────────────────────

@emp_bp.route('/<int:emp_id>/deactivate', methods=['PUT'])
@jwt_required()
@require_roles('admin', 'hr')
def deactivate_employee(emp_id):
    """Deactivate an employee (exit/resignation). Sets status to 'inactive'."""
    employee = User.query.get(emp_id)
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    if employee.status == 'inactive':
        return jsonify({'error': 'Employee is already inactive.'}), 400

    # Prevent deactivating admin accounts unless you're admin
    claims = get_jwt()
    if employee.role == 'admin' and claims.get('role') != 'admin':
        return jsonify({'error': 'Only admin can deactivate admin accounts.'}), 403

    employee.status = 'inactive'

    log_activity(
        action='DEACTIVATE_EMPLOYEE',
        description=f'Deactivated employee: {employee.name} ({employee.role})',
        module='hr'
    )
    db.session.commit()

    return jsonify({'message': f'{employee.name} has been deactivated.'}), 200


# ─── REACTIVATE EMPLOYEE (Admin only) ─────────────────────────

@emp_bp.route('/<int:emp_id>/reactivate', methods=['PUT'])
@jwt_required()
@require_roles('admin')
def reactivate_employee(emp_id):
    """Reactivate an inactive employee. Admin only."""
    employee = User.query.get(emp_id)
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    if employee.status == 'active':
        return jsonify({'error': 'Employee is already active.'}), 400

    employee.status = 'active'

    log_activity(
        action='REACTIVATE_EMPLOYEE',
        description=f'Reactivated employee: {employee.name}',
        module='admin'
    )
    db.session.commit()

    return jsonify({'message': f'{employee.name} has been reactivated.'}), 200


# ═══════════════════════════════════════════════════════════════
#  EMPLOYEE ANALYTICS — integrated into employee profile
#  Access: Admin (all), HR (all), Manager (own team only)
#  Employees are BLOCKED from this endpoint entirely.
# ═══════════════════════════════════════════════════════════════

@emp_bp.route('/<int:emp_id>/analytics', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr', 'manager')
def get_employee_analytics(emp_id):
    """
    Aggregated analytics for a single employee — attendance, tasks,
    leaves, and performance ratings.

    Access control:
      - Admin/HR: can view analytics for any employee
      - Manager: can ONLY view analytics for employees in their teams
      - Employee: BLOCKED (403) — this decorator enforces it
    """
    claims = get_jwt()
    user_id = int(get_jwt_identity())
    role = claims.get('role')

    # ── Verify the target employee exists ──────────────────────
    employee = User.query.get(emp_id)
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    # ── Manager scope check: only their team members ──────────
    if role == 'manager':
        managed_teams = db.session.query(TeamMember.user_id).join(
            TeamMember.team
        ).filter(
            TeamMember.team.has(manager_id=user_id)
        ).all()
        team_member_ids = {row[0] for row in managed_teams}

        if emp_id not in team_member_ids and emp_id != user_id:
            return jsonify({
                'error': 'You can only view analytics for your own team members.'
            }), 403

    # ── Query period ───────────────────────────────────────────
    # Default: current month. Accept ?months=N for historical range.
    months_back = min(int(request.args.get('months', 6) or 6), 24)
    now = datetime.now(timezone.utc)
    # Build date threshold: N months ago in YYYY-MM-DD
    year_offset, month_offset = divmod(now.month - months_back, 12)
    if month_offset <= 0:
        month_offset += 12
        year_offset -= 1
    start_year = now.year + year_offset
    start_date = f'{start_year}-{month_offset:02d}-01'

    # ═════════════════════════════════════════════════════════
    #  1. ATTENDANCE METRICS
    # ═════════════════════════════════════════════════════════
    attendance_records = Attendance.query.filter(
        Attendance.user_id == emp_id,
        Attendance.date >= start_date,
    ).all()

    total_present = sum(1 for a in attendance_records if a.status == 'present')
    total_absent = sum(1 for a in attendance_records if a.status == 'absent')
    total_leave = sum(1 for a in attendance_records if a.status == 'leave')
    total_late = sum(1 for a in attendance_records if a.is_late)
    total_half_day = sum(1 for a in attendance_records if a.is_half_day)

    hours_list = [a.working_hours for a in attendance_records if a.working_hours]
    total_hours = round(sum(hours_list), 2)
    avg_hours = round(total_hours / len(hours_list), 2) if hours_list else 0
    total_overtime = round(
        sum(a.overtime_hours or 0 for a in attendance_records), 2
    )

    # Monthly attendance breakdown
    monthly_attendance = {}
    for a in attendance_records:
        month_key = a.date[:7]  # YYYY-MM
        if month_key not in monthly_attendance:
            monthly_attendance[month_key] = {'present': 0, 'absent': 0, 'leave': 0, 'late': 0}
        if a.status == 'present':
            monthly_attendance[month_key]['present'] += 1
        elif a.status == 'absent':
            monthly_attendance[month_key]['absent'] += 1
        elif a.status == 'leave':
            monthly_attendance[month_key]['leave'] += 1
        if a.is_late:
            monthly_attendance[month_key]['late'] += 1

    attendance_rate = round(
        total_present / (total_present + total_absent) * 100, 1
    ) if (total_present + total_absent) > 0 else 0

    attendance_metrics = {
        'total_records': len(attendance_records),
        'total_present': total_present,
        'total_absent': total_absent,
        'total_leave': total_leave,
        'total_late': total_late,
        'total_half_day': total_half_day,
        'total_hours': total_hours,
        'avg_hours_per_day': avg_hours,
        'total_overtime': total_overtime,
        'attendance_rate': attendance_rate,
        'monthly_breakdown': [
            {'month': k, **v}
            for k, v in sorted(monthly_attendance.items())
        ],
    }

    # ═════════════════════════════════════════════════════════
    #  2. TASK PERFORMANCE
    # ═════════════════════════════════════════════════════════
    all_tasks = Task.query.filter_by(assigned_to=emp_id).all()
    total_tasks = len(all_tasks)
    completed_tasks = sum(1 for t in all_tasks if t.status == 'completed')
    in_progress_tasks = sum(1 for t in all_tasks if t.status == 'in_progress')
    pending_tasks = sum(1 for t in all_tasks if t.status == 'pending')

    # On-time completion: completed before or on due_date
    on_time = 0
    overdue = 0
    for t in all_tasks:
        if t.status == 'completed' and t.due_date:
            # Use created_at as proxy for completion date (best we have)
            if t.due_date >= (t.created_at.strftime('%Y-%m-%d') if t.created_at else ''):
                on_time += 1
            else:
                overdue += 1

    completion_rate = round(
        completed_tasks / total_tasks * 100, 1
    ) if total_tasks > 0 else 0

    # Priority distribution
    priority_dist = {}
    for t in all_tasks:
        priority_dist[t.priority] = priority_dist.get(t.priority, 0) + 1

    task_metrics = {
        'total_tasks': total_tasks,
        'completed': completed_tasks,
        'in_progress': in_progress_tasks,
        'pending': pending_tasks,
        'completion_rate': completion_rate,
        'on_time_completions': on_time,
        'overdue_completions': overdue,
        'priority_distribution': priority_dist,
    }

    # ═════════════════════════════════════════════════════════
    #  3. LEAVE SUMMARY
    # ═════════════════════════════════════════════════════════
    all_leaves = Leave.query.filter_by(user_id=emp_id).all()
    total_leave_requests = len(all_leaves)
    approved_leaves = sum(1 for l in all_leaves if l.status == 'approved')
    rejected_leaves = sum(1 for l in all_leaves if l.status == 'rejected')
    pending_leaves = sum(1 for l in all_leaves if l.status == 'pending')

    # Days consumed by type
    leave_by_type = {}
    for l in all_leaves:
        if l.status == 'approved':
            try:
                from datetime import date as date_type
                s = date_type.fromisoformat(l.start_date)
                e = date_type.fromisoformat(l.end_date)
                days = (e - s).days + 1
            except (ValueError, TypeError):
                days = 1
            leave_by_type[l.leave_type] = leave_by_type.get(l.leave_type, 0) + days

    total_days_taken = sum(leave_by_type.values())

    leave_metrics = {
        'total_requests': total_leave_requests,
        'approved': approved_leaves,
        'rejected': rejected_leaves,
        'pending': pending_leaves,
        'total_days_taken': total_days_taken,
        'by_type': leave_by_type,
    }

    # ═════════════════════════════════════════════════════════
    #  4. PERFORMANCE RATINGS
    # ═════════════════════════════════════════════════════════
    perf_records = PerformanceRecord.query.filter_by(
        user_id=emp_id
    ).order_by(PerformanceRecord.created_at.desc()).all()

    ratings = [p.rating for p in perf_records]
    avg_rating = round(sum(ratings) / len(ratings), 2) if ratings else 0
    goals_list = [p.goals_met for p in perf_records]
    avg_goals = round(sum(goals_list) / len(goals_list), 1) if goals_list else 0
    latest_rating = ratings[0] if ratings else None

    performance_metrics = {
        'total_reviews': len(perf_records),
        'avg_rating': avg_rating,
        'latest_rating': latest_rating,
        'avg_goals_met': avg_goals,
        'rating_history': [
            {
                'period': p.review_period,
                'rating': p.rating,
                'goals_met': p.goals_met,
                'status': p.status,
                'reviewer': p.reviewed_by_name if hasattr(p, 'reviewed_by_name') else (p.reviewer.name if p.reviewer else ''),
            }
            for p in perf_records
        ],
    }

    # ═════════════════════════════════════════════════════════
    #  COMPOSE RESPONSE
    # ═════════════════════════════════════════════════════════
    return jsonify({
        'employee': employee.to_dict(),
        'period': {'from': start_date, 'months': months_back},
        'attendance': attendance_metrics,
        'tasks': task_metrics,
        'leaves': leave_metrics,
        'performance': performance_metrics,
    }), 200


@emp_bp.route('/meta/departments', methods=['GET'])
@jwt_required()
def get_departments():
    departments = db.session.query(User.department).filter(
        User.department != ''
    ).distinct().all()
    return jsonify([d[0] for d in departments]), 200
