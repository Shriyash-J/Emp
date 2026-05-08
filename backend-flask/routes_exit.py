"""
Exit Management routes — HR processes employee resignations and exits.
Handles the full offboarding workflow: resignation -> exit interview -> asset return -> settlement -> letters -> deactivation.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, User, ExitRecord, Letter
from middleware import require_roles, validate_date, sanitize_string, log_activity, notify, notify_roles

exit_bp = Blueprint('exit', __name__, url_prefix='/api/exit')


# ─── INITIATE EXIT (HR/Admin) ─────────────────────────────────

@exit_bp.route('/', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr')
def initiate_exit():
    """HR initiates the exit process for an employee."""
    data = request.get_json()
    user_id = data.get('user_id')
    resignation_date = data.get('resignation_date', '').strip()
    last_working_date = data.get('last_working_date', '').strip()
    exit_type = data.get('exit_type', 'resignation')
    reason = sanitize_string(data.get('reason', ''), 2000)
    notice_period = data.get('notice_period_days', 30)

    if not user_id or not resignation_date or not last_working_date:
        return jsonify({'error': 'user_id, resignation_date, and last_working_date are required.'}), 400

    if not validate_date(resignation_date) or not validate_date(last_working_date):
        return jsonify({'error': 'Dates must be in YYYY-MM-DD format.'}), 400

    if last_working_date < resignation_date:
        return jsonify({'error': 'last_working_date cannot be before resignation_date.'}), 400

    if exit_type not in ExitRecord.VALID_EXIT_TYPES:
        return jsonify({'error': f'exit_type must be one of: {", ".join(ExitRecord.VALID_EXIT_TYPES)}'}), 400

    employee = User.query.get(int(user_id))
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    if employee.status == 'inactive':
        return jsonify({'error': 'Employee is already inactive.'}), 400

    # Check if exit already initiated
    existing = ExitRecord.query.filter_by(user_id=int(user_id)).first()
    if existing:
        return jsonify({'error': 'Exit process already initiated for this employee.'}), 409

    record = ExitRecord(
        user_id=int(user_id),
        resignation_date=resignation_date,
        last_working_date=last_working_date,
        exit_type=exit_type,
        reason=reason,
        notice_period_days=max(0, min(int(notice_period or 30), 365)),
        status='initiated',
        processed_by=int(get_jwt_identity()),
    )
    db.session.add(record)

    # Update employee status to 'on_leave' during notice period
    employee.status = 'on_leave'

    log_activity(
        action='INITIATE_EXIT',
        description=f'Initiated {exit_type} for {employee.name} (last day: {last_working_date})',
        module='hr'
    )

    emp_link = f'/{employee.role}/dashboard' if employee.role in ('employee', 'manager', 'hr') else '/employee/dashboard'
    notify(
        user_id=employee.id,
        title='Exit process initiated',
        body=f'Your {exit_type} has been initiated. Last working day: {last_working_date}.',
        category='general',
        link=emp_link,
    )

    db.session.commit()

    return jsonify({'message': f'Exit process initiated for {employee.name}.', 'record': record.to_dict()}), 201


# ─── LIST EXIT RECORDS ─────────────────────────────────────────

@exit_bp.route('/', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr')
def list_exits():
    """List all exit records."""
    status = request.args.get('status', '')
    query = ExitRecord.query

    if status and status in ('initiated', 'in_progress', 'completed'):
        query = query.filter_by(status=status)

    records = query.order_by(ExitRecord.created_at.desc()).all()
    return jsonify([r.to_dict() for r in records]), 200


# ─── GET SINGLE EXIT RECORD ───────────────────────────────────

@exit_bp.route('/<int:record_id>', methods=['GET'])
@jwt_required()
def get_exit(record_id):
    """HR/Admin sees any; employee sees only their own."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())

    record = ExitRecord.query.get(record_id)
    if not record:
        return jsonify({'error': 'Exit record not found.'}), 404

    if claims.get('role') not in ('admin', 'hr') and record.user_id != user_id:
        return jsonify({'error': 'Permission denied.'}), 403

    return jsonify(record.to_dict()), 200


# ─── UPDATE EXIT RECORD (Checklist) ───────────────────────────

@exit_bp.route('/<int:record_id>', methods=['PUT'])
@jwt_required()
@require_roles('admin', 'hr')
def update_exit(record_id):
    """HR updates the exit checklist and progresses the offboarding."""
    record = ExitRecord.query.get(record_id)
    if not record:
        return jsonify({'error': 'Exit record not found.'}), 404

    data = request.get_json()

    # Update checklist items
    if 'exit_interview_done' in data:
        record.exit_interview_done = bool(data['exit_interview_done'])
    if 'exit_interview_notes' in data:
        record.exit_interview_notes = sanitize_string(data['exit_interview_notes'], 2000)
    if 'assets_returned' in data:
        record.assets_returned = bool(data['assets_returned'])
    if 'final_settlement_done' in data:
        record.final_settlement_done = bool(data['final_settlement_done'])
    if 'last_working_date' in data:
        if not validate_date(data['last_working_date']):
            return jsonify({'error': 'last_working_date must be YYYY-MM-DD.'}), 400
        record.last_working_date = data['last_working_date']
    if 'reason' in data:
        record.reason = sanitize_string(data['reason'], 2000)

    # Status progression
    if 'status' in data and data['status'] in ('initiated', 'in_progress', 'completed'):
        record.status = data['status']

    # Auto-progress to in_progress when any checklist item is done
    if record.status == 'initiated' and (record.exit_interview_done or record.assets_returned):
        record.status = 'in_progress'

    log_activity(
        action='UPDATE_EXIT',
        description=f'Updated exit record for user #{record.user_id} (status: {record.status})',
        module='hr'
    )
    db.session.commit()

    return jsonify({'message': 'Exit record updated.', 'record': record.to_dict()}), 200


# ─── COMPLETE EXIT & DEACTIVATE EMPLOYEE ──────────────────────

@exit_bp.route('/<int:record_id>/complete', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr')
def complete_exit(record_id):
    """
    Mark exit as completed and deactivate the employee.
    Requires all checklist items to be done.
    """
    record = ExitRecord.query.get(record_id)
    if not record:
        return jsonify({'error': 'Exit record not found.'}), 404

    if record.status == 'completed':
        return jsonify({'error': 'Exit already completed.'}), 400

    # Validate checklist
    pending = []
    if not record.exit_interview_done:
        pending.append('Exit interview')
    if not record.assets_returned:
        pending.append('Asset return')
    if not record.final_settlement_done:
        pending.append('Final settlement')

    if pending:
        return jsonify({
            'error': f'Cannot complete exit. Pending items: {", ".join(pending)}.',
            'pending_items': pending,
        }), 400

    # Deactivate employee
    employee = User.query.get(record.user_id)
    if employee:
        employee.status = 'inactive'

    record.status = 'completed'

    log_activity(
        action='COMPLETE_EXIT',
        description=f'Completed exit for {employee.name if employee else "user #" + str(record.user_id)} — employee deactivated',
        module='hr'
    )

    notify_roles(
        roles=['admin', 'hr'],
        title='Exit completed',
        body=f'{employee.name if employee else "Employee"} has been deactivated.',
        category='general',
        link='/hr/exit-management',
    )

    db.session.commit()

    return jsonify({
        'message': f'Exit completed. {employee.name if employee else "Employee"} has been deactivated.',
        'record': record.to_dict(),
    }), 200


# ─── EXIT STATS ────────────────────────────────────────────────

@exit_bp.route('/stats', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr')
def exit_stats():
    """Exit management statistics."""
    total = ExitRecord.query.count()
    by_status = {}
    for status in ('initiated', 'in_progress', 'completed'):
        by_status[status] = ExitRecord.query.filter_by(status=status).count()

    by_type = {}
    for etype in ExitRecord.VALID_EXIT_TYPES:
        by_type[etype] = ExitRecord.query.filter_by(exit_type=etype).count()

    return jsonify({
        'total': total,
        'by_status': by_status,
        'by_type': by_type,
    }), 200
