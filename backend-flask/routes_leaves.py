from datetime import date as date_type, timedelta
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Leave, Attendance, User
from middleware import require_roles, validate_date, sanitize_string, log_activity, notify, notify_roles

leaves_bp = Blueprint('leaves', __name__, url_prefix='/api/leaves')

VALID_LEAVE_TYPES = ('casual', 'sick', 'earned', 'maternity', 'paternity')


@leaves_bp.route('/', methods=['POST'])
@jwt_required()
def request_leave():
    user_id = int(get_jwt_identity())
    data = request.get_json()

    leave_type = data.get('leave_type', 'casual')
    start_date = data.get('start_date', '').strip()
    end_date = data.get('end_date', '').strip()
    reason = sanitize_string(data.get('reason', ''), 500)

    if not start_date or not end_date:
        return jsonify({'error': 'Start date and end date are required.'}), 400

    if not validate_date(start_date) or not validate_date(end_date):
        return jsonify({'error': 'Dates must be in YYYY-MM-DD format.'}), 400

    if end_date < start_date:
        return jsonify({'error': 'End date cannot be before start date.'}), 400

    if leave_type not in VALID_LEAVE_TYPES:
        return jsonify({'error': f'Invalid leave type. Must be one of: {", ".join(VALID_LEAVE_TYPES)}'}), 400

    leave = Leave(
        user_id=user_id, leave_type=leave_type,
        start_date=start_date, end_date=end_date, reason=reason
    )
    db.session.add(leave)

    log_activity(
        action='LEAVE_REQUESTED',
        description=f'Requested {leave_type} leave from {start_date} to {end_date}',
        module='hr'
    )

    requester = User.query.get(user_id)
    requester_name = requester.name if requester else f'User #{user_id}'
    notify_roles(
        roles=['admin', 'hr'],
        title='New leave request',
        body=f'{requester_name} requested {leave_type} leave ({start_date} → {end_date})',
        category='leave',
        link='/hr/leaves',
        exclude_user_id=user_id,
    )

    db.session.commit()

    return jsonify({'message': 'Leave request submitted.', 'id': leave.id}), 201


@leaves_bp.route('/my', methods=['GET'])
@jwt_required()
def my_leaves():
    user_id = int(get_jwt_identity())
    leaves = Leave.query.filter_by(user_id=user_id).order_by(Leave.created_at.desc()).all()
    return jsonify([l.to_dict() for l in leaves]), 200


@leaves_bp.route('/', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr', 'manager')
def all_leaves():
    """Admin/HR/Manager can view all leave requests (HR is view-only)."""
    leaves = Leave.query.order_by(Leave.created_at.desc()).all()
    return jsonify([l.to_dict() for l in leaves]), 200


@leaves_bp.route('/<int:leave_id>', methods=['PUT'])
@jwt_required()
@require_roles('admin', 'hr')
def update_leave(leave_id):
    """
    Approve/reject leave requests. Authorisation matrix:
      * Admin → can act on any request (HR / Manager / Employee), except their own.
      * HR    → can act ONLY on Employee requests.
      * Manager / Employee → cannot act (blocked by @require_roles).
    Nobody can approve or reject their own leave.
    """
    user_id = int(get_jwt_identity())
    claims = get_jwt()
    role = claims.get('role')

    leave = Leave.query.get(leave_id)
    if not leave:
        return jsonify({'error': 'Leave request not found.'}), 404

    # Nobody — not even Admin — may approve their own leave request.
    if leave.user_id == user_id:
        return jsonify({'error': 'You cannot approve or reject your own leave request.'}), 403

    target_role = leave.user.role if leave.user else None
    if role == 'hr' and target_role != 'employee':
        return jsonify({
            'error': 'HR can only approve employee leave requests. '
                     'HR and Manager leaves must be handled by an Admin.'
        }), 403

    data = request.get_json()
    status = data.get('status')
    if status not in ('approved', 'rejected'):
        return jsonify({'error': 'Invalid status. Must be "approved" or "rejected".'}), 400

    leave.status = status
    leave.approved_by = user_id

    # When leave is approved, create attendance records marked as 'leave'
    # so that payroll calculation automatically accounts for leave days.
    if status == 'approved':
        start = date_type.fromisoformat(leave.start_date)
        end = date_type.fromisoformat(leave.end_date)
        current = start
        while current <= end:
            # Skip weekends (Saturday=5, Sunday=6)
            if current.weekday() < 5:
                date_str = current.isoformat()
                existing = Attendance.query.filter_by(
                    user_id=leave.user_id, date=date_str
                ).first()
                if not existing:
                    record = Attendance(
                        user_id=leave.user_id,
                        date=date_str,
                        status='leave',
                    )
                    db.session.add(record)
                elif existing.status != 'present':
                    # Don't overwrite a present record, but mark absent as leave
                    existing.status = 'leave'
            current += timedelta(days=1)

    log_activity(
        action=f'LEAVE_{status.upper()}',
        description=f'{status.title()} leave request #{leave.id} for user #{leave.user_id}',
        module='hr'
    )

    notify(
        user_id=leave.user_id,
        title=f'Leave {status}',
        body=f'Your {leave.leave_type} leave ({leave.start_date} → {leave.end_date}) was {status}.',
        category='leave',
        link='/employee/leaves' if (leave.user and leave.user.role == 'employee') else '/hr/leaves',
    )

    db.session.commit()

    return jsonify({'message': f'Leave {status}.'}), 200
