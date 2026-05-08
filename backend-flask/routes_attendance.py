from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Attendance, User, ActivityLog
from middleware import require_roles, validate_date, clamp_int, log_activity, notify
from time_utils import today_str, now_time_str

attendance_bp = Blueprint('attendance', __name__, url_prefix='/api/attendance')


# ─── EMPLOYEE: Check In ─────────────────────────────────────────
@attendance_bp.route('/check-in', methods=['POST'])
@jwt_required()
def check_in():
    user_id = int(get_jwt_identity())
    today = today_str()
    now_time = now_time_str()

    existing = Attendance.query.filter_by(user_id=user_id, date=today).first()
    if existing:
        if existing.check_in:
            return jsonify({'error': 'You have already checked in today.'}), 400
        existing.check_in = now_time
        existing.status = 'present'
        existing.compute_late()
    else:
        existing = Attendance(user_id=user_id, date=today, check_in=now_time, status='present')
        existing.compute_late()
        db.session.add(existing)

    if existing.is_late:
        notify(
            user_id=user_id,
            title='Late check-in recorded',
            body=f'You checked in at {now_time}. The late threshold is {Attendance.LATE_THRESHOLD}.',
            category='attendance',
            link='/employee/attendance',
        )
    else:
        notify(
            user_id=user_id,
            title='Checked in',
            body=f'Check-in recorded at {now_time}.',
            category='attendance',
            link='/employee/attendance',
        )

    db.session.commit()

    return jsonify({
        'message': 'Checked in successfully.',
        'check_in': now_time,
        'is_late': existing.is_late,
    }), 200


# ─── EMPLOYEE: Check Out ────────────────────────────────────────
@attendance_bp.route('/check-out', methods=['POST'])
@jwt_required()
def check_out():
    user_id = int(get_jwt_identity())
    today = today_str()
    now_time = now_time_str()

    record = Attendance.query.filter_by(user_id=user_id, date=today).first()
    if not record or not record.check_in:
        return jsonify({'error': 'You must check in before checking out.'}), 400
    if record.check_out:
        return jsonify({'error': 'You have already checked out today.'}), 400

    record.check_out = now_time
    record.compute_hours()

    body_parts = [f'Worked {record.working_hours}h.'] if record.working_hours else ['Check-out recorded.']
    if record.is_half_day:
        body_parts.append('Marked as half-day.')
    if record.overtime_hours:
        body_parts.append(f'Overtime: {record.overtime_hours}h.')
    notify(
        user_id=user_id,
        title='Checked out',
        body=' '.join(body_parts),
        category='attendance',
        link='/employee/attendance',
    )

    db.session.commit()

    return jsonify({
        'message': 'Checked out successfully.',
        'check_out': now_time,
        'working_hours': record.working_hours,
        'is_half_day': record.is_half_day,
        'overtime_hours': record.overtime_hours,
    }), 200


# ─── EMPLOYEE: Today's Status ───────────────────────────────────
@attendance_bp.route('/today', methods=['GET'])
@jwt_required()
def today_status():
    """Get current user's attendance status for today."""
    user_id = int(get_jwt_identity())
    today = today_str()

    record = Attendance.query.filter_by(user_id=user_id, date=today).first()
    if not record:
        return jsonify({
            'status': 'not_checked_in',
            'checked_in': False,
            'checked_out': False,
        }), 200

    return jsonify({
        'status': record.status,
        'checked_in': bool(record.check_in),
        'checked_out': bool(record.check_out),
        'check_in': record.check_in,
        'check_out': record.check_out,
        'is_late': record.is_late,
        'working_hours': record.working_hours,
        'is_half_day': record.is_half_day,
        'overtime_hours': record.overtime_hours,
    }), 200


# ─── EMPLOYEE: My Attendance with date range filter ─────────────
@attendance_bp.route('/my', methods=['GET'])
@jwt_required()
def my_attendance():
    user_id = int(get_jwt_identity())
    from_date = request.args.get('from', '')
    to_date = request.args.get('to', '')

    query = Attendance.query.filter_by(user_id=user_id)

    if from_date and validate_date(from_date):
        query = query.filter(Attendance.date >= from_date)
    if to_date and validate_date(to_date):
        query = query.filter(Attendance.date <= to_date)

    records = query.order_by(Attendance.date.desc()).all()
    return jsonify([r.to_dict() for r in records]), 200


# ─── MANAGER/ADMIN/HR: All Attendance with filters ──────────────
@attendance_bp.route('/', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr', 'manager')
def all_attendance():
    from_date = request.args.get('from', '')
    to_date = request.args.get('to', '')
    status_filter = request.args.get('status', '')
    department = request.args.get('department', '')
    search = request.args.get('search', '')
    limit = clamp_int(request.args.get('limit'), default=200, min_val=1, max_val=500)

    query = Attendance.query

    if from_date and validate_date(from_date):
        query = query.filter(Attendance.date >= from_date)
    if to_date and validate_date(to_date):
        query = query.filter(Attendance.date <= to_date)
    if status_filter:
        query = query.filter_by(status=status_filter)

    # Join with User table for department/name filters
    if department or search:
        query = query.join(User)
        if department:
            query = query.filter(User.department == department)
        if search:
            query = query.filter(
                db.or_(
                    User.name.ilike(f'%{search}%'),
                    User.email.ilike(f'%{search}%')
                )
            )

    records = query.order_by(Attendance.date.desc()).limit(limit).all()
    return jsonify([r.to_dict() for r in records]), 200


# ─── ATTENDANCE SUMMARY (Monthly Stats) ─────────────────────────
@attendance_bp.route('/summary', methods=['GET'])
@jwt_required()
def attendance_summary():
    """
    Monthly attendance summary.
    Employees see own summary; admin/hr/manager can see any employee or all.
    Query params: month (YYYY-MM), employee_id (optional, admin only)
    """
    claims = get_jwt()
    user_id = int(get_jwt_identity())
    role = claims.get('role')
    month = request.args.get('month', today_str()[:7])
    target_id = request.args.get('employee_id', '')

    is_privileged = role in ('admin', 'hr', 'manager')

    # Determine whose summary to show
    if target_id and is_privileged:
        target_id = int(target_id)
    elif target_id and not is_privileged:
        return jsonify({'error': 'Permission denied.'}), 403
    else:
        target_id = None  # Will return all for privileged, or self for employees

    if target_id:
        # Summary for a specific employee
        records = Attendance.query.filter(
            Attendance.user_id == target_id,
            Attendance.date.like(f'{month}-%')
        ).all()
        user = User.query.get(target_id)
        summaries = [_build_summary(records, month, user)]
    elif is_privileged:
        # Summary for all employees
        employees = User.query.filter_by(status='active').all()
        summaries = []
        for emp in employees:
            records = Attendance.query.filter(
                Attendance.user_id == emp.id,
                Attendance.date.like(f'{month}-%')
            ).all()
            summaries.append(_build_summary(records, month, emp))
    else:
        # Employee sees own summary
        records = Attendance.query.filter(
            Attendance.user_id == user_id,
            Attendance.date.like(f'{month}-%')
        ).all()
        user = User.query.get(user_id)
        summaries = [_build_summary(records, month, user)]

    return jsonify(summaries), 200


def _build_summary(records, month, user):
    """Build a summary dict from attendance records."""
    total_present = sum(1 for r in records if r.status == 'present')
    total_absent = sum(1 for r in records if r.status == 'absent')
    total_leave = sum(1 for r in records if r.status == 'leave')
    total_late = sum(1 for r in records if r.is_late)
    total_half_day = sum(1 for r in records if r.is_half_day)

    hours_list = [r.working_hours for r in records if r.working_hours is not None]
    total_hours = round(sum(hours_list), 2) if hours_list else 0
    avg_hours = round(total_hours / len(hours_list), 2) if hours_list else 0
    total_overtime = round(sum(r.overtime_hours or 0 for r in records), 2)

    return {
        'employee_id': user.id if user else None,
        'employee_name': user.name if user else '',
        'department': user.department if user else '',
        'month': month,
        'total_present': total_present,
        'total_absent': total_absent,
        'total_leave': total_leave,
        'total_late': total_late,
        'total_half_day': total_half_day,
        'total_hours': total_hours,
        'avg_hours': avg_hours,
        'total_overtime': total_overtime,
        'total_records': len(records),
    }


# ─── ADMIN ONLY: Manage attendance for a specific employee ─────
@attendance_bp.route('/manage', methods=['POST'])
@jwt_required()
@require_roles('admin')
def manage_attendance():
    """Admin can create or update attendance records for any employee. HR is view-only."""
    data = request.get_json()
    employee_id = data.get('employee_id')
    date = data.get('date', '').strip()
    check_in_val = data.get('check_in', '').strip()
    check_out_val = data.get('check_out', '').strip()
    status = data.get('status', 'present')

    if not employee_id or not date:
        return jsonify({'error': 'Employee ID and date are required.'}), 400

    if not validate_date(date):
        return jsonify({'error': 'Date must be in YYYY-MM-DD format.'}), 400

    if status not in ('present', 'absent', 'leave', 'half_day'):
        return jsonify({'error': 'Status must be "present", "absent", "leave", or "half_day".'}), 400

    user = User.query.get(int(employee_id))
    if not user:
        return jsonify({'error': 'Employee not found.'}), 404

    record = Attendance.query.filter_by(user_id=int(employee_id), date=date).first()
    if record:
        if check_in_val:
            record.check_in = check_in_val
        if check_out_val:
            record.check_out = check_out_val
        record.status = status
    else:
        record = Attendance(
            user_id=int(employee_id), date=date,
            check_in=check_in_val or None, check_out=check_out_val or None,
            status=status
        )
        db.session.add(record)

    # Auto-compute hours and late status
    record.compute_late()
    record.compute_hours()
    if status == 'half_day':
        record.is_half_day = True

    log_activity(
        action='MANAGE_ATTENDANCE',
        description=f'Updated attendance for {user.name} on {date} ({status})',
        module='admin'
    )

    notify(
        user_id=int(employee_id),
        title='Attendance record updated',
        body=f'Your attendance for {date} was set to {status} by an administrator.',
        category='attendance',
        link=f'/{user.role}/attendance' if user.role else '/employee/attendance',
    )

    db.session.commit()

    return jsonify({'message': f'Attendance updated for {user.name} on {date}.', 'record': record.to_dict()}), 200


# ─── ADMIN: Delete attendance record ────────────────────────────
@attendance_bp.route('/<int:record_id>', methods=['DELETE'])
@jwt_required()
@require_roles('admin')
def delete_attendance(record_id):
    """Admin can delete an attendance record."""
    record = Attendance.query.get(record_id)
    if not record:
        return jsonify({'error': 'Record not found.'}), 404

    db.session.delete(record)
    db.session.commit()
    return jsonify({'message': 'Attendance record deleted.'}), 200
