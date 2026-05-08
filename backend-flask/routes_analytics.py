"""
Analytics API — aggregated data for charts and dashboards.
Provides task status, employee performance, and attendance breakdowns.

Supports optional `?employee_id=<id>` filtering so Admin / HR / Manager
can view a single employee's analytics without changing the response shape.
Access rules:
  - admin / hr  → any employee
  - manager     → self + members of teams they manage
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, User, Task, Attendance, Leave, PerformanceRecord, Team, TeamMember
from middleware import require_roles

analytics_bp = Blueprint('analytics', __name__, url_prefix='/api/analytics')


# ── Access helpers ─────────────────────────────────────────────
def _manager_accessible_user_ids(manager_id):
    """Return ids the manager is allowed to view (self + their team members)."""
    team_ids = [t.id for t in Team.query.filter_by(manager_id=manager_id).all()]
    if not team_ids:
        return {manager_id}
    member_ids = {m.user_id for m in TeamMember.query.filter(TeamMember.team_id.in_(team_ids)).all()}
    member_ids.add(manager_id)
    return member_ids


def _can_view_employee(role, current_user_id, target_user_id):
    if role in ('admin', 'hr'):
        return True
    if role == 'manager':
        return target_user_id in _manager_accessible_user_ids(current_user_id)
    return False


# ── Dropdown list for the analytics selector ──────────────────
@analytics_bp.route('/employees', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr', 'manager')
def analytics_employees():
    """Return employees the current user is allowed to filter analytics by."""
    claims = get_jwt()
    role = claims.get('role')
    user_id = int(get_jwt_identity())

    if role in ('admin', 'hr'):
        users = User.query.filter(User.status == 'active').order_by(User.name.asc()).all()
    else:  # manager
        allowed = _manager_accessible_user_ids(user_id)
        users = User.query.filter(User.id.in_(allowed), User.status == 'active') \
            .order_by(User.name.asc()).all()

    return jsonify([{
        'id': u.id,
        'name': u.name,
        'department': u.department,
        'position': u.position,
    } for u in users])


# ── Overview (company-wide OR single-employee when ?employee_id=) ──
@analytics_bp.route('/overview', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr', 'manager')
def analytics_overview():
    """
    Combined analytics data for the dashboard charts.

    Query params:
        employee_id (optional): restrict all aggregations to this employee.
    """
    from datetime import datetime, timezone

    claims = get_jwt()
    role = claims.get('role')
    current_uid = int(get_jwt_identity())

    # ── Optional employee filter ─────────────────────────────
    emp_id_raw = request.args.get('employee_id')
    target_id = None
    if emp_id_raw:
        try:
            target_id = int(emp_id_raw)
        except ValueError:
            return jsonify({'error': 'Invalid employee_id.'}), 400
        if not _can_view_employee(role, current_uid, target_id):
            return jsonify({'error': 'You are not allowed to view analytics for this employee.'}), 403
        if not User.query.get(target_id):
            return jsonify({'error': 'Employee not found.'}), 404

    # ── Task Status Breakdown ────────────────────────────────
    task_query = db.session.query(Task.status, db.func.count(Task.id))
    if target_id is not None:
        task_query = task_query.filter(Task.assigned_to == target_id)
    task_data = {status: count for status, count in task_query.group_by(Task.status).all()}

    # ── Task Priority Breakdown ──────────────────────────────
    prio_query = db.session.query(Task.priority, db.func.count(Task.id))
    if target_id is not None:
        prio_query = prio_query.filter(Task.assigned_to == target_id)
    priority_data = {p: c for p, c in prio_query.group_by(Task.priority).all()}

    # ── Performance ──────────────────────────────────────────
    if target_id is not None:
        # Single employee → return multiple reviews so the chart shows trend.
        # Frontend uses `employee_name` as the x-axis label, so we label it
        # with the review period for per-employee view.
        recs = PerformanceRecord.query.filter_by(user_id=target_id) \
            .order_by(PerformanceRecord.created_at.asc()).all()
        performance_data = [{
            'employee_name': r.review_period,  # label used by the chart
            'rating': r.rating,
            'goals_met': r.goals_met,
            'review_period': r.review_period,
        } for r in recs]
    else:
        perf_records = PerformanceRecord.query.order_by(
            PerformanceRecord.user_id,
            PerformanceRecord.created_at.desc()
        ).all()
        seen_users = set()
        performance_data = []
        for rec in perf_records:
            if rec.user_id not in seen_users:
                seen_users.add(rec.user_id)
                performance_data.append({
                    'employee_name': rec.employee.name if rec.employee else f'User {rec.user_id}',
                    'rating': rec.rating,
                    'goals_met': rec.goals_met,
                    'review_period': rec.review_period,
                })

    # ── Attendance Summary (current month) ───────────────────
    now = datetime.now(timezone.utc)
    current_month = now.strftime('%Y-%m')
    att_q = Attendance.query.filter(Attendance.date.like(f'{current_month}%'))
    if target_id is not None:
        att_q = att_q.filter(Attendance.user_id == target_id)
    attendance_records = att_q.all()

    present_count = sum(1 for a in attendance_records if a.status == 'present' and a.check_in)
    absent_count = sum(1 for a in attendance_records if a.status == 'absent')
    late_count = sum(1 for a in attendance_records if a.is_late)
    half_day_count = sum(1 for a in attendance_records if a.is_half_day)

    leave_q = Leave.query.filter(
        Leave.status == 'approved',
        Leave.start_date.like(f'{current_month}%'),
    )
    if target_id is not None:
        leave_q = leave_q.filter(Leave.user_id == target_id)
    leave_count = leave_q.count()

    # ── Department headcount (company view only) ─────────────
    if target_id is None:
        dept_counts = db.session.query(
            User.department, db.func.count(User.id)
        ).filter(
            User.status == 'active',
            User.department != ''
        ).group_by(User.department).all()
        department_data = [{'department': dept, 'count': count} for dept, count in dept_counts]
    else:
        department_data = []

    # ── Selected employee meta (useful for UI titles) ────────
    selected_employee = None
    if target_id is not None:
        u = User.query.get(target_id)
        selected_employee = {
            'id': u.id, 'name': u.name,
            'department': u.department, 'position': u.position,
        }

    return jsonify({
        'task_status': {
            'pending': task_data.get('pending', 0),
            'in_progress': task_data.get('in_progress', 0),
            'completed': task_data.get('completed', 0),
        },
        'task_priority': {
            'low': priority_data.get('low', 0),
            'medium': priority_data.get('medium', 0),
            'high': priority_data.get('high', 0),
        },
        'employee_performance': performance_data,
        'attendance': {
            'present': present_count,
            'absent': absent_count,
            'late': late_count,
            'half_day': half_day_count,
            'on_leave': leave_count,
            'month': current_month,
        },
        'departments': department_data,
        'selected_employee': selected_employee,
    })


@analytics_bp.route('/my', methods=['GET'])
@jwt_required()
def my_analytics():
    """
    Personal analytics for the logged-in employee.
    Returns their own task breakdown, attendance stats, and performance.
    """
    user_id = int(get_jwt_identity())

    my_tasks = Task.query.filter_by(assigned_to=user_id).all()
    task_status = {
        'pending': sum(1 for t in my_tasks if t.status == 'pending'),
        'in_progress': sum(1 for t in my_tasks if t.status == 'in_progress'),
        'completed': sum(1 for t in my_tasks if t.status == 'completed'),
    }

    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    thirty_days_ago = (now - timedelta(days=30)).strftime('%Y-%m-%d')

    my_attendance = Attendance.query.filter(
        Attendance.user_id == user_id,
        Attendance.date >= thirty_days_ago
    ).all()

    att_summary = {
        'present': sum(1 for a in my_attendance if a.status == 'present' and a.check_in),
        'absent': sum(1 for a in my_attendance if a.status == 'absent'),
        'late': sum(1 for a in my_attendance if a.is_late),
        'on_time': sum(1 for a in my_attendance if a.check_in and not a.is_late),
    }

    my_perf = PerformanceRecord.query.filter_by(user_id=user_id).order_by(
        PerformanceRecord.created_at.desc()
    ).limit(5).all()

    perf_data = [{
        'review_period': p.review_period,
        'rating': p.rating,
        'goals_met': p.goals_met,
    } for p in my_perf]

    return jsonify({
        'task_status': task_status,
        'attendance': att_summary,
        'performance': perf_data,
    })
