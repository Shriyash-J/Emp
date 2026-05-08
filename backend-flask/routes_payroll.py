"""
Payroll routes — salary configuration, payroll generation, salary slips, payment, and holiday management.
STRICT RBAC: Only Admin can create, update, and process payroll.
HR can view payroll records but cannot modify them.
Employees can view their own records and salary slips.
"""
import os
from datetime import datetime, timezone
import calendar
import hmac
import hashlib
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, User, Attendance, Leave, PayrollConfig, Payroll, Holiday, ActivityLog
from middleware import require_roles, require_admin_only, validate_month, log_activity, notify

try:
    import razorpay
    razorpay_client = razorpay.Client(
        auth=(os.getenv('RAZORPAY_KEY_ID', ''), os.getenv('RAZORPAY_KEY_SECRET', ''))
    )
except ImportError:
    razorpay_client = None

payroll_bp = Blueprint('payroll', __name__, url_prefix='/api/payroll')


# ─── SALARY CONFIGURATION (Admin only) ─────────────────────────

@payroll_bp.route('/config', methods=['GET'])
@jwt_required()
@require_roles('admin')
def get_all_configs():
    """Get salary configs for all employees (Admin only)."""
    configs = PayrollConfig.query.all()
    return jsonify([c.to_dict() for c in configs]), 200


@payroll_bp.route('/config/my', methods=['GET'])
@jwt_required()
def get_my_config():
    """Employee views their own salary configuration."""
    user_id = int(get_jwt_identity())
    config = PayrollConfig.query.filter_by(user_id=user_id).first()
    if not config:
        return jsonify({'error': 'Salary not configured yet. Contact HR.'}), 404
    return jsonify(config.to_dict()), 200


@payroll_bp.route('/config/<int:user_id>', methods=['POST', 'PUT'])
@jwt_required()
@require_roles('admin')
def set_config(user_id):
    """Create or update salary config for an employee (Admin only)."""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Employee not found.'}), 404

    data = request.get_json()
    config = PayrollConfig.query.filter_by(user_id=user_id).first()

    if not config:
        config = PayrollConfig(user_id=user_id)
        db.session.add(config)

    # Validate salary values are non-negative numbers
    salary_fields = ['basic_salary', 'hra', 'da', 'ta', 'pf_deduction', 'tax_deduction', 'other_deductions']
    for field in salary_fields:
        if field in data:
            try:
                val = float(data[field])
            except (TypeError, ValueError):
                return jsonify({'error': f'Invalid value for {field}. Must be a number.'}), 400
            if val < 0:
                return jsonify({'error': f'{field} cannot be negative.'}), 400
            if val > 10000000:
                return jsonify({'error': f'{field} exceeds maximum allowed value.'}), 400

    config.basic_salary = float(data.get('basic_salary', config.basic_salary or 0))
    config.hra = float(data.get('hra', config.hra or 0))
    config.da = float(data.get('da', config.da or 0))
    config.ta = float(data.get('ta', config.ta or 0))
    config.pf_deduction = float(data.get('pf_deduction', config.pf_deduction or 0))
    config.tax_deduction = float(data.get('tax_deduction', config.tax_deduction or 0))
    config.other_deductions = float(data.get('other_deductions', config.other_deductions or 0))

    log_activity(
        action='UPDATE_SALARY_CONFIG',
        description=f'Updated salary config for {user.name} (net: {config.basic_salary + config.hra + config.da + config.ta - config.pf_deduction - config.tax_deduction - config.other_deductions:.2f})',
        module='payroll'
    )
    db.session.commit()

    return jsonify({'message': 'Salary configuration saved.', 'config': config.to_dict()}), 200


# ─── PAYROLL GENERATION (Admin only) ───────────────────────────

def _count_working_days(year, month, user_id=None):
    """Count working days in a month, excluding weekends and holidays."""
    total_days = calendar.monthrange(year, month)[1]
    month_str = f'{year}-{month:02d}'

    # Get company-wide holidays
    holidays = Holiday.query.filter(
        Holiday.date.like(f'{month_str}-%'),
        (Holiday.user_id.is_(None)) | (Holiday.user_id == user_id)
    ).all()
    holiday_dates = {h.date for h in holidays}

    working_days = 0
    for day in range(1, total_days + 1):
        date_str = f'{month_str}-{day:02d}'
        weekday = calendar.weekday(year, month, day)
        # Skip weekends (Saturday=5, Sunday=6) and holidays
        if weekday < 5 and date_str not in holiday_dates:
            working_days += 1

    return working_days, holiday_dates


@payroll_bp.route('/generate', methods=['POST'])
@jwt_required()
@require_roles('admin')
def generate_payroll():
    """Generate payroll for a specific month (Admin only)."""
    data = request.get_json()
    month = data.get('month', '')  # Expected YYYY-MM
    employee_id = data.get('employee_id')  # Optional — None means all employees

    if not month or not validate_month(month):
        return jsonify({'error': 'Month is required in YYYY-MM format (e.g. 2026-03).'}), 400

    year, mon = int(month[:4]), int(month[5:7])

    # Determine employees to process
    if employee_id:
        employees = [User.query.get(int(employee_id))]
        if not employees[0]:
            return jsonify({'error': 'Employee not found.'}), 404
    else:
        employees = User.query.filter_by(status='active').all()

    generated = []
    skipped = []

    for emp in employees:
        # Skip if already generated for this month
        existing = Payroll.query.filter_by(user_id=emp.id, month=month).first()
        if existing:
            skipped.append(f'{emp.name} (already generated)')
            continue

        config = PayrollConfig.query.filter_by(user_id=emp.id).first()
        if not config:
            skipped.append(f'{emp.name} (no salary config)')
            continue

        working_days, _ = _count_working_days(year, mon, emp.id)

        # Count present days from attendance
        days_present = Attendance.query.filter(
            Attendance.user_id == emp.id,
            Attendance.date.like(f'{month}-%'),
            Attendance.status == 'present'
        ).count()

        # Count approved leave days
        approved_leaves = Leave.query.filter(
            Leave.user_id == emp.id,
            Leave.status == 'approved',
            Leave.start_date <= f'{month}-{calendar.monthrange(year, mon)[1]:02d}',
            Leave.end_date >= f'{month}-01'
        ).all()

        days_leave = 0
        for leave in approved_leaves:
            start = max(leave.start_date, f'{month}-01')
            end = min(leave.end_date, f'{month}-{calendar.monthrange(year, mon)[1]:02d}')
            from datetime import date as date_type
            s = date_type.fromisoformat(start)
            e = date_type.fromisoformat(end)
            days_leave += (e - s).days + 1

        # Check if any attendance data exists for this employee this month
        has_attendance = Attendance.query.filter(
            Attendance.user_id == emp.id,
            Attendance.date.like(f'{month}-%')
        ).count() > 0

        if not has_attendance and days_leave == 0:
            # No attendance data at all — assume full working days (default fallback)
            # This prevents salary becoming ₹0 when attendance hasn't been recorded
            days_present = working_days
            days_absent = 0
        else:
            days_absent = max(0, working_days - days_present - days_leave)

        # Prorate salary based on attendance (LOP deduction for absent days)
        # paid_days = present_days + leave_days (approved leaves are paid)
        paid_days = min(days_present + days_leave, working_days)
        pay_ratio = paid_days / working_days if working_days > 0 else 1

        basic = round(config.basic_salary * pay_ratio, 2)
        hra = round(config.hra * pay_ratio, 2)
        da = round(config.da * pay_ratio, 2)
        ta = round(config.ta * pay_ratio, 2)
        gross = round(basic + hra + da + ta, 2)
        pf = round(config.pf_deduction * pay_ratio, 2)
        tax = round(config.tax_deduction * pay_ratio, 2)
        other = round(config.other_deductions * pay_ratio, 2)
        total_ded = round(pf + tax + other, 2)
        net = round(gross - total_ded, 2)

        # Calculate overtime pay and late penalty from attendance
        month_attendance = Attendance.query.filter(
            Attendance.user_id == emp.id,
            Attendance.date.like(f'{month}-%'),
        ).all()

        total_overtime_hrs = sum(a.overtime_hours or 0 for a in month_attendance)
        late_count = sum(1 for a in month_attendance if a.is_late)

        # Overtime: 1.5x hourly rate for overtime hours
        hourly_rate = gross / (working_days * 9) if working_days > 0 else 0
        overtime_pay = round(total_overtime_hrs * hourly_rate * 1.5, 2)

        # Late penalty: 0.5% of gross per late day (configurable via system settings)
        late_penalty = round(gross * 0.005 * late_count, 2)

        final = round(net + overtime_pay - late_penalty, 2)

        payroll = Payroll(
            user_id=emp.id, month=month,
            total_working_days=working_days, days_present=days_present,
            days_absent=days_absent, days_leave=days_leave,
            basic_salary=basic, hra=hra, da=da, ta=ta,
            gross_salary=gross, pf_deduction=pf, tax_deduction=tax,
            other_deductions=other, total_deductions=total_ded,
            net_salary=net, overtime_pay=overtime_pay,
            late_penalty=late_penalty, final_salary=final,
            status='generated'
        )
        db.session.add(payroll)
        generated.append(emp.name)

        payroll_link = f'/{emp.role}/payroll' if emp.role in ('employee', 'manager', 'hr') else '/employee/payroll'
        notify(
            user_id=emp.id,
            title=f'Salary slip for {month} is ready',
            body=f'Net: ₹{net:,.2f} · Final (after overtime/penalty): ₹{final:,.2f}.',
            category='payroll',
            link=payroll_link,
        )

    log_activity(
        action='GENERATE_PAYROLL',
        description=f'Generated payroll for {month}: {len(generated)} employees',
        module='payroll'
    )
    db.session.commit()

    return jsonify({
        'message': f'Payroll generated for {len(generated)} employees.',
        'generated': generated,
        'skipped': skipped,
    }), 200


# ─── PAYROLL RECORDS ──────────────────────────────────────────

@payroll_bp.route('/records', methods=['GET'])
@jwt_required()
def get_payroll_records():
    """Admin sees all payroll records; employees see only their own."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())
    month = request.args.get('month', '')

    role = claims.get('role')
    if role in ('admin', 'hr'):
        # Admin and HR can view all payroll records (HR has read-only access)
        query = Payroll.query
        if month:
            query = query.filter_by(month=month)
        records = query.order_by(Payroll.month.desc()).limit(500).all()
    else:
        # Manager and Employee: can only see their own payroll records
        query = Payroll.query.filter_by(user_id=user_id)
        if month:
            query = query.filter_by(month=month)
        records = query.order_by(Payroll.month.desc()).all()

    return jsonify([r.to_dict() for r in records]), 200


@payroll_bp.route('/slip/<int:payroll_id>', methods=['GET'])
@jwt_required()
def get_salary_slip(payroll_id):
    """Get salary slip. Admin sees all; others see only their own."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())

    record = Payroll.query.get(payroll_id)
    if not record:
        return jsonify({'error': 'Payroll record not found.'}), 404

    # Non-admin users can only view their own slips
    if claims.get('role') != 'admin' and record.user_id != user_id:
        return jsonify({'error': 'Permission denied.'}), 403

    user = User.query.get(record.user_id)

    slip = {
        'company': 'Aaryak Solution',
        'slip_title': 'Salary Slip',
        'month': record.month,
        'generated_at': record.generated_at.isoformat() if record.generated_at else None,
        'employee': {
            'id': user.id,
            'name': user.name,
            'email': user.email,
            'department': user.department,
            'position': user.position,
            'hire_date': user.hire_date,
        },
        'attendance': {
            'total_working_days': record.total_working_days,
            'days_present': record.days_present,
            'days_absent': record.days_absent,
            'days_leave': record.days_leave,
        },
        'earnings': {
            'basic_salary': record.basic_salary,
            'hra': record.hra,
            'da': record.da,
            'ta': record.ta,
            'gross_salary': record.gross_salary,
        },
        'deductions': {
            'pf_deduction': record.pf_deduction,
            'tax_deduction': record.tax_deduction,
            'other_deductions': record.other_deductions,
            'total_deductions': record.total_deductions,
        },
        'net_salary': record.net_salary,
        'final_salary': record.final_salary or record.net_salary,
        'overtime_pay': record.overtime_pay,
        'late_penalty': record.late_penalty,
        'bonus': record.bonus,
        'bonus_reason': record.bonus_reason,
        'extra_deduction': record.extra_deduction,
        'extra_deduction_reason': record.extra_deduction_reason,
        'status': record.status,
        'payment_status': record.payment_status or 'pending',
        'payment_id': record.payment_id or '',
        'paid_on': record.paid_on.isoformat() if record.paid_on else None,
    }

    return jsonify(slip), 200


@payroll_bp.route('/records/<int:payroll_id>/status', methods=['PUT'])
@jwt_required()
@require_roles('admin')
def update_payroll_status(payroll_id):
    """Update payroll status — approve or mark as paid (Admin only)."""
    record = Payroll.query.get(payroll_id)
    if not record:
        return jsonify({'error': 'Payroll record not found.'}), 404

    data = request.get_json()
    new_status = data.get('status', '')
    if new_status not in ('approved', 'paid'):
        return jsonify({'error': 'Status must be "approved" or "paid".'}), 400

    record.status = new_status
    if new_status == 'paid':
        record.payment_status = 'paid'
        record.paid_on = datetime.now(timezone.utc)

    log_activity(
        action='UPDATE_PAYROLL_STATUS',
        description=f'Updated payroll #{payroll_id} status to {new_status}',
        module='payroll'
    )

    emp_user = User.query.get(record.user_id)
    if emp_user:
        payroll_link = f'/{emp_user.role}/payroll' if emp_user.role in ('employee', 'manager', 'hr') else '/employee/payroll'
        if new_status == 'paid':
            notify(
                user_id=record.user_id,
                title=f'Salary paid for {record.month}',
                body=f'₹{(record.final_salary or record.net_salary):,.2f} has been marked as paid.',
                category='payroll',
                link=payroll_link,
            )
        else:
            notify(
                user_id=record.user_id,
                title=f'Payroll {new_status} for {record.month}',
                body='Your payroll record was approved by admin.',
                category='payroll',
                link=payroll_link,
            )

    db.session.commit()

    return jsonify({'message': f'Payroll status updated to {new_status}.', 'record': record.to_dict()}), 200


# ─── RAZORPAY PAYMENT (Admin only) ────────────────────────────

@payroll_bp.route('/pay/<int:payroll_id>', methods=['POST'])
@jwt_required()
@require_roles('admin')
def create_payment_order(payroll_id):
    """Create a Razorpay payment order for a payroll record (Admin only)."""
    record = Payroll.query.get(payroll_id)
    if not record:
        return jsonify({'error': 'Payroll record not found.'}), 404

    if record.status not in ('approved', 'generated'):
        if record.payment_status == 'paid':
            return jsonify({'error': 'Salary already paid for this record.'}), 400

    final = record.final_salary or record.net_salary
    if final <= 0:
        return jsonify({'error': 'Net salary must be greater than zero.'}), 400

    # Amount in paise (Razorpay expects smallest currency unit)
    amount_paise = int(round(final * 100))

    user = User.query.get(record.user_id)
    razorpay_key_id = os.getenv('RAZORPAY_KEY_ID', '')

    if not razorpay_key_id or not razorpay_client:
        return jsonify({'error': 'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env'}), 500

    try:
        order = razorpay_client.order.create({
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': f'payroll_{record.id}_{record.month}',
            'notes': {
                'employee_id': str(record.user_id),
                'employee_name': user.name if user else '',
                'month': record.month,
                'payroll_id': str(record.id),
            }
        })
    except Exception as e:
        return jsonify({'error': f'Failed to create Razorpay order: {str(e)}'}), 500

    # Update payroll record with order info
    record.payment_order_id = order['id']
    record.payment_status = 'processing'

    log_activity(
        action='CREATE_PAYMENT_ORDER',
        description=f'Created Razorpay order {order["id"]} for {user.name if user else "?"} — ₹{final:.2f}',
        module='payroll'
    )
    db.session.commit()

    return jsonify({
        'order_id': order['id'],
        'amount': amount_paise,
        'currency': 'INR',
        'key_id': razorpay_key_id,
        'employee_name': user.name if user else '',
        'employee_email': user.email if user else '',
        'description': f'Salary for {record.month} — {user.name if user else ""}',
    }), 200


@payroll_bp.route('/pay/<int:payroll_id>/verify', methods=['POST'])
@jwt_required()
@require_roles('admin')
def verify_payment(payroll_id):
    """Verify Razorpay payment signature and mark payroll as paid (Admin only)."""
    record = Payroll.query.get(payroll_id)
    if not record:
        return jsonify({'error': 'Payroll record not found.'}), 404

    data = request.get_json()
    razorpay_order_id = data.get('razorpay_order_id', '')
    razorpay_payment_id = data.get('razorpay_payment_id', '')
    razorpay_signature = data.get('razorpay_signature', '')

    if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
        return jsonify({'error': 'Missing payment verification fields.'}), 400

    # Verify signature
    key_secret = os.getenv('RAZORPAY_KEY_SECRET', '')
    message = f'{razorpay_order_id}|{razorpay_payment_id}'
    expected_signature = hmac.HMAC(
        key_secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    if expected_signature != razorpay_signature:
        record.payment_status = 'failed'
        db.session.commit()
        return jsonify({'error': 'Payment verification failed. Signature mismatch.'}), 400

    # Payment verified — mark as paid
    record.payment_id = razorpay_payment_id
    record.payment_order_id = razorpay_order_id
    record.payment_status = 'paid'
    record.status = 'paid'
    record.paid_on = datetime.now(timezone.utc)

    user = User.query.get(record.user_id)
    log_activity(
        action='SALARY_PAID',
        description=f'Salary paid to {user.name if user else "?"} for {record.month} via Razorpay ({razorpay_payment_id})',
        module='payroll'
    )

    if user:
        payroll_link = f'/{user.role}/payroll' if user.role in ('employee', 'manager', 'hr') else '/employee/payroll'
        notify(
            user_id=record.user_id,
            title=f'Salary credited for {record.month}',
            body=f'₹{(record.final_salary or record.net_salary):,.2f} has been transferred (txn {razorpay_payment_id}).',
            category='payroll',
            link=payroll_link,
        )

    db.session.commit()

    return jsonify({
        'message': f'Payment verified and salary marked as paid.',
        'record': record.to_dict(),
    }), 200


@payroll_bp.route('/pay/<int:payroll_id>/fail', methods=['POST'])
@jwt_required()
@require_roles('admin')
def mark_payment_failed(payroll_id):
    """Mark payment as failed (called if Razorpay checkout fails/dismissed)."""
    record = Payroll.query.get(payroll_id)
    if not record:
        return jsonify({'error': 'Payroll record not found.'}), 404

    record.payment_status = 'failed'
    db.session.commit()

    return jsonify({'message': 'Payment marked as failed.', 'record': record.to_dict()}), 200


@payroll_bp.route('/razorpay-key', methods=['GET'])
@jwt_required()
@require_roles('admin')
def get_razorpay_key():
    """Return the Razorpay public key for frontend checkout."""
    key_id = os.getenv('RAZORPAY_KEY_ID', '')
    return jsonify({'key_id': key_id, 'configured': bool(key_id)}), 200


# ─── HOLIDAYS MANAGEMENT (Admin) ─────────────────────────────

@payroll_bp.route('/holidays', methods=['GET'])
@jwt_required()
def get_holidays():
    """Get holidays. Employees see company + their custom holidays."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())
    year = request.args.get('year', datetime.now(timezone.utc).strftime('%Y'))

    if claims.get('role') in ('admin', 'hr'):
        holidays = Holiday.query.filter(Holiday.date.like(f'{year}-%')).all()
    else:
        holidays = Holiday.query.filter(
            Holiday.date.like(f'{year}-%'),
            (Holiday.user_id.is_(None)) | (Holiday.user_id == user_id)
        ).all()

    return jsonify([h.to_dict() for h in holidays]), 200


@payroll_bp.route('/holidays', methods=['POST'])
@jwt_required()
@require_roles('admin')
def create_holiday():
    """Create a holiday (Admin only). user_id=null means company-wide."""
    data = request.get_json()
    date = data.get('date', '').strip()
    name = data.get('name', '').strip()
    holiday_type = data.get('holiday_type', 'company')
    user_id = data.get('user_id')  # None = company-wide

    if not date or not name:
        return jsonify({'error': 'Date and name are required.'}), 400

    holiday = Holiday(
        date=date, name=name, holiday_type=holiday_type,
        user_id=int(user_id) if user_id else None,
        created_by=int(get_jwt_identity())
    )
    db.session.add(holiday)
    db.session.commit()

    return jsonify({'message': 'Holiday created.', 'holiday': holiday.to_dict()}), 201


@payroll_bp.route('/holidays/<int:holiday_id>', methods=['DELETE'])
@jwt_required()
@require_roles('admin')
def delete_holiday(holiday_id):
    """Delete a holiday (Admin only)."""
    holiday = Holiday.query.get(holiday_id)
    if not holiday:
        return jsonify({'error': 'Holiday not found.'}), 404

    db.session.delete(holiday)
    db.session.commit()

    return jsonify({'message': 'Holiday deleted.'}), 200
