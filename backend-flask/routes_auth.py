from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token, jwt_required, get_jwt_identity, get_jwt
)
import bcrypt
from models import db, User, ActivityLog
from otp_service import create_otp, verify_otp, send_otp_email
from middleware import (
    validate_password, validate_email,
    log_activity, require_roles, ROLE_HIERARCHY, notify,
)

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# Will be set from app.py
mail = None


def init_mail(mail_instance):
    global mail
    mail = mail_instance


# ─── REGISTER (DISABLED — company-level auth) ─────────────────
@auth_bp.route('/register', methods=['POST'])
def register():
    """Public registration is disabled. Users are created by Admin/HR."""
    return jsonify({
        'error': 'Public registration is disabled. Please contact your administrator.'
    }), 403


# ─── ADMIN SETUP STATUS CHECK ─────────────────────────────────
@auth_bp.route('/admin-setup-status', methods=['GET'])
def admin_setup_status():
    """Check if initial admin setup is needed (no admin user exists)."""
    admin_exists = User.query.filter_by(role='admin').first() is not None
    return jsonify({'admin_exists': admin_exists}), 200


# ─── FIRST-TIME ADMIN SETUP ───────────────────────────────────
@auth_bp.route('/admin-setup', methods=['POST'])
def admin_setup():
    """One-time admin account creation. Only works when no admin exists."""
    if User.query.filter_by(role='admin').first():
        return jsonify({'error': 'Admin account already exists. Setup is locked.'}), 403

    data = request.get_json()
    name = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    phone = data.get('phone', '').strip()

    if not name or not email or not password:
        return jsonify({'error': 'Name, email, and password are required.'}), 400

    if not validate_email(email):
        return jsonify({'error': 'Invalid email format.'}), 400

    pw_valid, pw_error = validate_password(password)
    if not pw_valid:
        return jsonify({'error': pw_error}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered.'}), 409

    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    user = User(
        name=name, email=email, password=hashed_pw, role='admin',
        department='Management', position='Administrator', phone=phone,
        is_email_verified=True, status='active'
    )
    db.session.add(user)
    db.session.commit()

    # Create JWT token so admin is logged in immediately
    additional_claims = {'role': user.role, 'name': user.name, 'email': user.email}
    access_token = create_access_token(identity=str(user.id), additional_claims=additional_claims)

    log = ActivityLog(
        user_id=user.id, action='ADMIN_SETUP',
        description=f'Initial admin account created: {name}',
        module='system', ip_address=request.remote_addr or ''
    )
    db.session.add(log)
    db.session.commit()

    return jsonify({
        'message': 'Admin account created successfully.',
        'token': access_token,
        'user': user.to_dict(),
        'redirect': '/admin/dashboard'
    }), 201


# ─── CREATE USER (Admin/HR only) ──────────────────────────────
@auth_bp.route('/create-user', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr')
def create_user():
    """
    Strict role hierarchy:
      - Admin can ONLY create HR accounts.
      - HR can ONLY create Manager and Employee accounts.
      - Manager/Employee cannot create anyone.
    """
    claims = get_jwt()
    creator_role = claims.get('role')
    creator_name = claims.get('name', 'Unknown')

    data = request.get_json()
    name = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    role = data.get('role', '').strip().lower()
    department = data.get('department', '').strip()
    position = data.get('position', '').strip()
    phone = data.get('phone', '').strip()

    if not name or not email or not password or not role:
        return jsonify({'error': 'Name, email, password, and role are required.'}), 400

    # Validate role value
    if role not in ROLE_HIERARCHY:
        return jsonify({'error': f'Invalid role. Must be one of: {", ".join(ROLE_HIERARCHY.keys())}'}), 400

    # Strict role creation hierarchy
    if creator_role == 'admin' and role != 'hr':
        return jsonify({'error': 'Admin can only create HR accounts.'}), 403

    if creator_role == 'hr' and role not in ('manager', 'employee'):
        return jsonify({'error': 'HR can only create Manager and Employee accounts.'}), 403

    # Validate email format (any domain allowed)
    if not validate_email(email):
        return jsonify({'error': 'Invalid email format.'}), 400

    pw_valid, pw_error = validate_password(password)
    if not pw_valid:
        return jsonify({'error': pw_error}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered.'}), 409

    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    user = User(
        name=name, email=email, password=hashed_pw, role=role,
        department=department, position=position, phone=phone,
        is_email_verified=True, status='active'
    )
    db.session.add(user)
    db.session.commit()

    log = ActivityLog(
        user_id=int(get_jwt_identity()), action='CREATE_USER',
        description=f'{creator_name} ({creator_role}) created {role} account for {name}',
        module='system', ip_address=request.remote_addr or ''
    )
    db.session.add(log)

    notify(
        user_id=user.id,
        title=f'Welcome to WorkNet, {name.split()[0] if name else ""}!',
        body=f'Your {role} account has been created by {creator_name}. Explore your dashboard to get started.',
        category='general',
        link=f'/{role}/dashboard',
    )

    db.session.commit()

    return jsonify({
        'message': f'{role.capitalize()} account created successfully for {name}.',
        'user': user.to_dict()
    }), 201


# ─── LOGIN — STEP 1: Send OTP ──────────────────────────────
@auth_bp.route('/login', methods=['POST'])
def login_step1():
    # Rate limiting is applied globally in app.py (200/min default)
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required.'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        log_activity(
            action='LOGIN_FAILED', description=f'Failed login attempt for unknown email: {email}',
            module='security', user_id=None
        )
        db.session.commit()
        return jsonify({'error': 'Invalid email or password.'}), 401

    if not bcrypt.checkpw(password.encode('utf-8'), user.password.encode('utf-8')):
        log_activity(
            action='LOGIN_FAILED', description=f'Invalid password attempt for {user.name}',
            module='security', user_id=user.id
        )
        db.session.commit()
        return jsonify({'error': 'Invalid email or password.'}), 401

    if user.status == 'inactive':
        return jsonify({'error': 'Account is deactivated. Contact HR.'}), 403

    # Generate and send OTP
    otp_code = create_otp(email, purpose='login')
    email_sent, email_msg = send_otp_email(mail, email, otp_code, purpose='login')

    log = ActivityLog(
        user_id=user.id, action='LOGIN_OTP_SENT',
        description=f'Login OTP sent to {user.name}',
        module='system', ip_address=request.remote_addr or ''
    )
    db.session.add(log)
    db.session.commit()

    if not email_sent:
        return jsonify({'error': f'Failed to send OTP email. Please check mail server configuration. ({email_msg})'}), 500

    return jsonify({
        'message': 'OTP sent to your email address.',
        'requires_otp': True,
        'email': email
    }), 200


# ─── LOGIN — STEP 2: Verify OTP & Get Token ────────────────
@auth_bp.route('/verify-otp', methods=['POST'])
def login_verify_otp():
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    otp_code = data.get('otp', '').strip()
    purpose = data.get('purpose', 'login')

    if not email or not otp_code:
        return jsonify({'error': 'Email and OTP are required.'}), 400

    # Verify OTP
    success, message = verify_otp(email, otp_code, purpose=purpose)

    if not success:
        return jsonify({'error': message}), 401

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    # If registering, mark email as verified
    if purpose == 'register':
        user.is_email_verified = True
        db.session.commit()

    # Create JWT token
    additional_claims = {
        'role': user.role,
        'name': user.name,
        'email': user.email
    }
    access_token = create_access_token(
        identity=str(user.id),
        additional_claims=additional_claims
    )

    # Role-based redirect path
    role_redirects = {
        'admin': '/admin/dashboard',
        'hr': '/hr/dashboard',
        'manager': '/manager/dashboard',
        'employee': '/employee/dashboard',
    }

    log = ActivityLog(
        user_id=user.id, action='LOGIN_SUCCESS',
        description=f'{user.name} logged in successfully via OTP',
        module='system', ip_address=request.remote_addr or ''
    )
    db.session.add(log)
    db.session.commit()

    return jsonify({
        'message': 'Login successful.',
        'token': access_token,
        'user': user.to_dict(),
        'redirect': role_redirects.get(user.role, '/employee/dashboard')
    }), 200


# ─── RESEND OTP ─────────────────────────────────────────────
@auth_bp.route('/resend-otp', methods=['POST'])
def resend_otp():
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    purpose = data.get('purpose', 'login')

    if not email:
        return jsonify({'error': 'Email is required.'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'Email not found.'}), 404

    otp_code = create_otp(email, purpose=purpose)
    email_sent, email_msg = send_otp_email(mail, email, otp_code, purpose=purpose)

    if not email_sent:
        return jsonify({'error': 'Failed to send OTP email. Please check mail server configuration.'}), 500

    return jsonify({
        'message': 'New OTP sent.',
        'email_sent': email_sent
    }), 200


# ─── PASSWORD RESET — Request OTP ──────────────────────────
@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    email = data.get('email', '').strip().lower()

    if not email:
        return jsonify({'error': 'Email is required.'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        # Don't reveal whether email exists
        return jsonify({'message': 'If the email exists, an OTP has been sent.'}), 200

    otp_code = create_otp(email, purpose='reset')
    email_sent, email_msg = send_otp_email(mail, email, otp_code, purpose='reset')

    return jsonify({
        'message': 'If the email exists, an OTP has been sent.'
    }), 200


# ─── PASSWORD RESET — Verify & Reset ───────────────────────
@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    otp_code = data.get('otp', '').strip()
    new_password = data.get('new_password', '')

    if not email or not otp_code or not new_password:
        return jsonify({'error': 'Email, OTP, and new password are required.'}), 400

    pw_valid, pw_error = validate_password(new_password)
    if not pw_valid:
        return jsonify({'error': pw_error}), 400

    success, message = verify_otp(email, otp_code, purpose='reset')
    if not success:
        return jsonify({'error': message}), 401

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    user.password = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    db.session.commit()

    log = ActivityLog(
        user_id=user.id, action='PASSWORD_RESET',
        description=f'{user.name} reset their password',
        module='system', ip_address=request.remote_addr or ''
    )
    db.session.add(log)
    db.session.commit()

    return jsonify({'message': 'Password reset successful. You can now login.'}), 200


# ─── GET CURRENT USER ──────────────────────────────────────
@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_me():
    user_id = get_jwt_identity()
    user = User.query.get(int(user_id))
    if not user:
        return jsonify({'error': 'User not found.'}), 404
    return jsonify(user.to_dict()), 200


# ─── PROTECTED TEST ROUTE ──────────────────────────────────
@auth_bp.route('/protected', methods=['GET'])
@jwt_required()
def protected():
    claims = get_jwt()
    return jsonify({
        'message': 'Access granted to protected resource.',
        'user_id': get_jwt_identity(),
        'role': claims.get('role'),
        'name': claims.get('name')
    }), 200
