"""
Admin Control Center — centralized admin-only routes for:
  - Organization management (departments)
  - User management (activate/deactivate, reset password, role assignment)
  - System settings
  - System dashboard (high-level company metrics)
  - Enhanced audit logs

Admin does NOT handle: tasks, leaves, attendance, recruitment, letters
(those belong to HR/Manager modules).
"""
import bcrypt
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import (
    db, User, Department, SystemConfig, ActivityLog,
    Payroll, PayrollConfig, Attendance, Leave
)
from middleware import (
    require_roles, sanitize_string, validate_email,
    validate_password, log_activity, clamp_int, notify
)

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')


# ═══════════════════════════════════════════════════════════════
#  SYSTEM DASHBOARD — high-level company metrics
# ═══════════════════════════════════════════════════════════════

@admin_bp.route('/dashboard', methods=['GET'])
@jwt_required()
@require_roles('admin')
def system_dashboard():
    """Aggregated company-wide metrics for admin overview."""
    total_users = User.query.count()
    active_users = User.query.filter_by(status='active').count()
    inactive_users = User.query.filter_by(status='inactive').count()

    # Role distribution
    role_counts = {}
    for role in ('admin', 'hr', 'manager', 'employee'):
        role_counts[role] = User.query.filter_by(role=role, status='active').count()

    # Department headcounts
    dept_counts = db.session.query(
        User.department, db.func.count(User.id)
    ).filter(User.department != '', User.status == 'active').group_by(
        User.department
    ).order_by(db.func.count(User.id).desc()).all()

    # Payroll cost (latest month with data)
    latest_payroll = Payroll.query.order_by(Payroll.month.desc()).first()
    total_payroll_cost = 0
    payroll_month = ''
    if latest_payroll:
        payroll_month = latest_payroll.month
        cost = db.session.query(db.func.sum(Payroll.final_salary)).filter_by(
            month=payroll_month
        ).scalar()
        total_payroll_cost = round(cost or 0, 2)
        # Fallback to net_salary if final_salary not computed
        if total_payroll_cost == 0:
            cost = db.session.query(db.func.sum(Payroll.net_salary)).filter_by(
                month=payroll_month
            ).scalar()
            total_payroll_cost = round(cost or 0, 2)

    # Today's activity count
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    today_activities = ActivityLog.query.filter(
        db.func.date(ActivityLog.timestamp) == today
    ).count()

    # Recent audit entries
    recent_audit = ActivityLog.query.order_by(
        ActivityLog.timestamp.desc()
    ).limit(10).all()

    # Departments count
    dept_total = db.session.query(User.department).filter(
        User.department != ''
    ).distinct().count()

    # System configs count
    config_count = SystemConfig.query.count()

    return jsonify({
        'total_users': total_users,
        'active_users': active_users,
        'inactive_users': inactive_users,
        'role_distribution': role_counts,
        'department_counts': [{'department': d, 'count': c} for d, c in dept_counts],
        'departments_total': dept_total,
        'payroll_month': payroll_month,
        'total_payroll_cost': total_payroll_cost,
        'today_activities': today_activities,
        'config_count': config_count,
        'recent_audit': [a.to_dict() for a in recent_audit],
    }), 200


# ═══════════════════════════════════════════════════════════════
#  ORGANIZATION MANAGEMENT — Departments
# ═══════════════════════════════════════════════════════════════

@admin_bp.route('/departments', methods=['GET'])
@jwt_required()
@require_roles('admin')
def list_departments():
    """List all departments with manager and headcount."""
    depts = Department.query.order_by(Department.name).all()

    # Enrich with live headcount from users table
    for d in depts:
        d.head_count = User.query.filter_by(department=d.name, status='active').count()

    return jsonify([d.to_dict() for d in depts]), 200


@admin_bp.route('/departments', methods=['POST'])
@jwt_required()
@require_roles('admin')
def create_department():
    data = request.get_json()
    name = sanitize_string(data.get('name', ''), 100)
    if not name:
        return jsonify({'error': 'Department name is required.'}), 400

    if Department.query.filter_by(name=name).first():
        return jsonify({'error': 'Department already exists.'}), 409

    manager_id = data.get('manager_id')
    if manager_id:
        mgr = User.query.get(int(manager_id))
        if not mgr or mgr.role not in ('manager', 'admin'):
            return jsonify({'error': 'Invalid manager.'}), 404

    dept = Department(
        name=name,
        description=sanitize_string(data.get('description', ''), 500),
        manager_id=int(manager_id) if manager_id else None,
        budget=min(float(data.get('budget', 0) or 0), 1e12),
    )
    db.session.add(dept)
    log_activity(action='CREATE_DEPARTMENT', description=f'Created department "{name}"', module='admin')
    db.session.commit()
    return jsonify({'message': f'Department "{name}" created.', 'department': dept.to_dict()}), 201


@admin_bp.route('/departments/<int:dept_id>', methods=['PUT'])
@jwt_required()
@require_roles('admin')
def update_department(dept_id):
    dept = Department.query.get(dept_id)
    if not dept:
        return jsonify({'error': 'Department not found.'}), 404

    data = request.get_json()
    if 'name' in data:
        new_name = sanitize_string(data['name'], 100)
        if new_name != dept.name:
            if Department.query.filter_by(name=new_name).first():
                return jsonify({'error': 'Department name already taken.'}), 409
            old_name = dept.name
            dept.name = new_name
            # Update user records that reference the old department name
            User.query.filter_by(department=old_name).update({'department': new_name})
    if 'description' in data:
        dept.description = sanitize_string(data['description'], 500)
    if 'manager_id' in data:
        dept.manager_id = int(data['manager_id']) if data['manager_id'] else None
    if 'budget' in data:
        dept.budget = min(float(data['budget'] or 0), 1e12)
    if 'status' in data and data['status'] in ('active', 'inactive'):
        dept.status = data['status']

    log_activity(action='UPDATE_DEPARTMENT', description=f'Updated department "{dept.name}"', module='admin')
    db.session.commit()
    return jsonify({'message': 'Department updated.', 'department': dept.to_dict()}), 200


@admin_bp.route('/departments/<int:dept_id>', methods=['DELETE'])
@jwt_required()
@require_roles('admin')
def delete_department(dept_id):
    dept = Department.query.get(dept_id)
    if not dept:
        return jsonify({'error': 'Department not found.'}), 404

    # Check if any active users belong to this department
    active_in_dept = User.query.filter_by(department=dept.name, status='active').count()
    if active_in_dept > 0:
        return jsonify({'error': f'Cannot delete: {active_in_dept} active employees in this department.'}), 400

    name = dept.name
    db.session.delete(dept)
    log_activity(action='DELETE_DEPARTMENT', description=f'Deleted department "{name}"', module='admin')
    db.session.commit()
    return jsonify({'message': f'Department "{name}" deleted.'}), 200


# ═══════════════════════════════════════════════════════════════
#  USER MANAGEMENT — role assignment, activate/deactivate, reset password
# ═══════════════════════════════════════════════════════════════

@admin_bp.route('/users', methods=['GET'])
@jwt_required()
@require_roles('admin')
def list_all_users():
    """List all users with full details for admin user management."""
    status_filter = request.args.get('status', '')
    role_filter = request.args.get('role', '')
    search = request.args.get('search', '')

    query = User.query
    if status_filter:
        query = query.filter_by(status=status_filter)
    if role_filter:
        query = query.filter_by(role=role_filter)
    if search:
        query = query.filter(db.or_(
            User.name.ilike(f'%{search}%'),
            User.email.ilike(f'%{search}%'),
        ))

    users = query.order_by(User.created_at.desc()).all()
    return jsonify([u.to_dict() for u in users]), 200


@admin_bp.route('/users/<int:user_id>/role', methods=['PUT'])
@jwt_required()
@require_roles('admin')
def change_user_role(user_id):
    """Admin assigns/changes a user's role."""
    admin_id = int(get_jwt_identity())
    if user_id == admin_id:
        return jsonify({'error': 'You cannot change your own role.'}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    data = request.get_json()
    new_role = data.get('role', '')
    if new_role not in ('admin', 'hr', 'manager', 'employee'):
        return jsonify({'error': 'Invalid role. Must be admin, hr, manager, or employee.'}), 400

    old_role = user.role
    user.role = new_role
    log_activity(
        action='CHANGE_ROLE',
        description=f'Changed {user.name} role from {old_role} to {new_role}',
        module='admin'
    )

    notify(
        user_id=user.id,
        title='Your role was changed',
        body=f'An administrator changed your role from {old_role} to {new_role}. Please sign in again to refresh your permissions.',
        category='general',
        link=f'/{new_role}/dashboard',
    )

    db.session.commit()
    return jsonify({'message': f'{user.name} role changed to {new_role}.'}), 200


@admin_bp.route('/users/<int:user_id>/status', methods=['PUT'])
@jwt_required()
@require_roles('admin')
def toggle_user_status(user_id):
    """Activate or deactivate a user."""
    admin_id = int(get_jwt_identity())
    if user_id == admin_id:
        return jsonify({'error': 'You cannot deactivate yourself.'}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    data = request.get_json()
    new_status = data.get('status', '')
    if new_status not in ('active', 'inactive'):
        return jsonify({'error': 'Status must be "active" or "inactive".'}), 400

    user.status = new_status
    log_activity(
        action='TOGGLE_USER_STATUS',
        description=f'Set {user.name} status to {new_status}',
        module='admin'
    )

    if new_status == 'active':
        # Only meaningful to notify a re-activated user; deactivated users can't sign in.
        notify(
            user_id=user.id,
            title='Account reactivated',
            body='Your account has been reactivated. You can now sign in again.',
            category='general',
            link=f'/{user.role}/dashboard',
        )

    db.session.commit()
    return jsonify({'message': f'{user.name} status set to {new_status}.'}), 200


@admin_bp.route('/users/<int:user_id>/reset-password', methods=['POST'])
@jwt_required()
@require_roles('admin')
def reset_user_password(user_id):
    """Admin resets a user's password."""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    data = request.get_json()
    new_password = data.get('password', '')

    valid, error = validate_password(new_password)
    if not valid:
        return jsonify({'error': error}), 400

    user.password = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    log_activity(
        action='RESET_PASSWORD',
        description=f'Admin reset password for {user.name}',
        module='admin'
    )

    notify(
        user_id=user.id,
        title='Password reset by admin',
        body='Your password was reset. Sign in with the new password and consider changing it.',
        category='general',
        link=f'/{user.role}/dashboard',
    )

    db.session.commit()
    return jsonify({'message': f'Password reset for {user.name}.'}), 200


# ═══════════════════════════════════════════════════════════════
#  SYSTEM SETTINGS
# ═══════════════════════════════════════════════════════════════

@admin_bp.route('/settings', methods=['GET'])
@jwt_required()
@require_roles('admin')
def list_settings():
    """List all system configuration settings."""
    category = request.args.get('category', '')
    query = SystemConfig.query
    if category:
        query = query.filter_by(category=category)
    configs = query.order_by(SystemConfig.category, SystemConfig.key).all()
    return jsonify([c.to_dict() for c in configs]), 200


@admin_bp.route('/settings', methods=['POST'])
@jwt_required()
@require_roles('admin')
def create_setting():
    data = request.get_json()
    key = sanitize_string(data.get('key', ''), 100)
    value = sanitize_string(data.get('value', ''), 2000)
    if not key:
        return jsonify({'error': 'key is required.'}), 400

    if SystemConfig.query.filter_by(key=key).first():
        return jsonify({'error': f'Setting "{key}" already exists. Use PUT to update.'}), 409

    config = SystemConfig(
        key=key, value=value,
        description=sanitize_string(data.get('description', ''), 500),
        category=data.get('category', 'general'),
        updated_by=int(get_jwt_identity()),
    )
    db.session.add(config)
    log_activity(action='CREATE_SETTING', description=f'Created setting "{key}"', module='admin')
    db.session.commit()
    return jsonify({'message': f'Setting "{key}" created.', 'setting': config.to_dict()}), 201


@admin_bp.route('/settings/<key_name>', methods=['PUT'])
@jwt_required()
@require_roles('admin')
def update_setting(key_name):
    config = SystemConfig.query.filter_by(key=key_name).first()
    if not config:
        return jsonify({'error': f'Setting "{key_name}" not found.'}), 404

    data = request.get_json()
    if 'value' in data:
        config.value = sanitize_string(data['value'], 2000)
    if 'description' in data:
        config.description = sanitize_string(data['description'], 500)
    if 'category' in data:
        config.category = data['category']
    config.updated_by = int(get_jwt_identity())

    log_activity(action='UPDATE_SETTING', description=f'Updated setting "{key_name}"', module='admin')
    db.session.commit()
    return jsonify({'message': f'Setting "{key_name}" updated.', 'setting': config.to_dict()}), 200


@admin_bp.route('/settings/<key_name>', methods=['DELETE'])
@jwt_required()
@require_roles('admin')
def delete_setting(key_name):
    config = SystemConfig.query.filter_by(key=key_name).first()
    if not config:
        return jsonify({'error': f'Setting "{key_name}" not found.'}), 404

    db.session.delete(config)
    log_activity(action='DELETE_SETTING', description=f'Deleted setting "{key_name}"', module='admin')
    db.session.commit()
    return jsonify({'message': f'Setting "{key_name}" deleted.'}), 200


# ═══════════════════════════════════════════════════════════════
#  PAYROLL ADJUSTMENTS — bonus/deduction on generated payroll
# ═══════════════════════════════════════════════════════════════

@admin_bp.route('/payroll/<int:payroll_id>/adjust', methods=['PUT'])
@jwt_required()
@require_roles('admin')
def adjust_payroll(payroll_id):
    """Admin adds bonus, extra deduction, or overtime pay to a payroll record."""
    record = Payroll.query.get(payroll_id)
    if not record:
        return jsonify({'error': 'Payroll record not found.'}), 404

    if record.status == 'paid':
        return jsonify({'error': 'Cannot adjust a paid payroll record.'}), 400

    data = request.get_json()

    if 'bonus' in data:
        record.bonus = max(0, min(float(data['bonus'] or 0), 10000000))
    if 'bonus_reason' in data:
        record.bonus_reason = sanitize_string(data['bonus_reason'], 200)
    if 'extra_deduction' in data:
        record.extra_deduction = max(0, min(float(data['extra_deduction'] or 0), 10000000))
    if 'extra_deduction_reason' in data:
        record.extra_deduction_reason = sanitize_string(data['extra_deduction_reason'], 200)
    if 'overtime_pay' in data:
        record.overtime_pay = max(0, min(float(data['overtime_pay'] or 0), 10000000))
    if 'late_penalty' in data:
        record.late_penalty = max(0, min(float(data['late_penalty'] or 0), 10000000))

    record.compute_final()

    log_activity(
        action='ADJUST_PAYROLL',
        description=f'Adjusted payroll #{payroll_id} for {record.user.name if record.user else "?"}: final={record.final_salary:.2f}',
        module='admin'
    )

    if record.user:
        payroll_link = f'/{record.user.role}/payroll' if record.user.role in ('employee', 'manager', 'hr') else '/employee/payroll'
        notify(
            user_id=record.user_id,
            title=f'Payroll adjusted for {record.month}',
            body=f'Bonus ₹{record.bonus:,.2f}, deduction ₹{record.extra_deduction:,.2f}. Final: ₹{record.final_salary:,.2f}.',
            category='payroll',
            link=payroll_link,
        )

    db.session.commit()
    return jsonify({'message': 'Payroll adjusted.', 'record': record.to_dict()}), 200


@admin_bp.route('/payroll/summary', methods=['GET'])
@jwt_required()
@require_roles('admin')
def payroll_summary():
    """Get payroll summary across months for dashboard."""
    # Get last 6 months of payroll data
    months = db.session.query(Payroll.month).distinct().order_by(
        Payroll.month.desc()
    ).limit(6).all()

    summary = []
    for (month,) in months:
        total_gross = db.session.query(db.func.sum(Payroll.gross_salary)).filter_by(month=month).scalar() or 0
        total_deductions = db.session.query(db.func.sum(Payroll.total_deductions)).filter_by(month=month).scalar() or 0
        total_net = db.session.query(db.func.sum(Payroll.net_salary)).filter_by(month=month).scalar() or 0
        total_bonus = db.session.query(db.func.sum(Payroll.bonus)).filter_by(month=month).scalar() or 0
        total_final = db.session.query(db.func.sum(Payroll.final_salary)).filter_by(month=month).scalar() or 0
        emp_count = Payroll.query.filter_by(month=month).count()

        summary.append({
            'month': month,
            'employee_count': emp_count,
            'total_gross': round(total_gross, 2),
            'total_deductions': round(total_deductions, 2),
            'total_net': round(total_net, 2),
            'total_bonus': round(total_bonus, 2),
            'total_final': round(total_final or total_net, 2),
        })

    return jsonify(summary), 200
