from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Attendance, FaceEncoding
from face_service import register_face, verify_face, re_register_face
from middleware import require_roles, log_activity
from time_utils import today_str, now_time_str

face_attendance_bp = Blueprint('face_attendance', __name__, url_prefix='/api/face-attendance')

# ─── REGISTER FACE (one-time setup) ───────────────────────────
@face_attendance_bp.route('/register-face', methods=['POST'])
@jwt_required()
def register_face_route():
    """Employee registers their face for attendance via AWS Rekognition."""
    user_id = int(get_jwt_identity())
    data = request.get_json()
    image_b64 = data.get('image', '')

    if not image_b64:
        return jsonify({'error': 'Image is required. Please capture a clear photo.'}), 400

    user = User.query.get(user_id)
    if not user or user.status == 'inactive':
        return jsonify({'error': 'User not found or account deactivated.'}), 403

    try:
        # Calls the new AWS-powered service
        success, message = register_face(user_id, image_b64)
        
        if success:
            log_activity(
                action='FACE_REGISTERED',
                description=f'{user.name} registered their face via AWS Rekognition',
                module='attendance',
                user_id=user_id
            )
            db.session.commit()
            return jsonify({'success': True, 'message': message}), 200
        else:
            return jsonify({'error': message}), 400

    except Exception as e:
        print(f'[AWS ERROR] Face registration crashed: {str(e)}')
        return jsonify({'error': 'Internal server error during registration.'}), 500


# ─── FACE CHECK-IN ─────────────────────────────────────────────
@face_attendance_bp.route('/check-in', methods=['POST'])
@jwt_required()
def face_check_in():
    """Employee checks in via AWS Face Verification."""
    user_id = int(get_jwt_identity())
    data = request.get_json()
    image_b64 = data.get('image', '')

    if not image_b64:
        return jsonify({'error': 'Image is required for face verification.'}), 400

    user = User.query.get(user_id)
    if not user or user.status == 'inactive':
        return jsonify({'error': 'User not found or deactivated.'}), 403

    # Verify face identity using Amazon Rekognition
    try:
        matched, msg = verify_face(user_id, image_b64)
        
        if not matched:
            log_activity(
                action='FACE_CHECK_IN_FAILED',
                description=f'Failed verification for {user.name}: {msg}',
                module='security',
                user_id=user_id
            )
            db.session.commit()
            return jsonify({'error': msg}), 401

        # SUCCESS: Proceed with attendance logic
        today = today_str()
        now_time = now_time_str()

        existing = Attendance.query.filter_by(user_id=user_id, date=today).first()
        if existing and existing.check_in:
            return jsonify({'error': 'You have already checked in today.'}), 400

        if existing:
            existing.check_in = now_time
            existing.status = 'present'
            existing.compute_late()
        else:
            existing = Attendance(user_id=user_id, date=today, check_in=now_time, status='present')
            existing.compute_late()
            db.session.add(existing)

        log_activity(
            action='FACE_CHECK_IN',
            description=f'{user.name} checked in (AWS Verification Success)',
            module='attendance',
            user_id=user_id
        )
        db.session.commit()

        return jsonify({
            'message': 'Face verified. Checked in successfully.',
            'check_in': now_time,
            'is_late': existing.is_late,
        }), 200

    except Exception as e:
        print(f'[AWS ERROR] Check-in verification crashed: {str(e)}')
        return jsonify({'error': 'Verification service currently unavailable.'}), 500


# ─── FACE CHECK-OUT ────────────────────────────────────────────
@face_attendance_bp.route('/check-out', methods=['POST'])
@jwt_required()
def face_check_out():
    """Employee checks out via AWS Face Verification."""
    user_id = int(get_jwt_identity())
    data = request.get_json()
    image_b64 = data.get('image', '')

    if not image_b64:
        return jsonify({'error': 'Image is required for face verification.'}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found.'}), 404

    try:
        matched, msg = verify_face(user_id, image_b64)
        
        if not matched:
            log_activity(
                action='FACE_CHECK_OUT_FAILED',
                description=f'Failed verification for {user.name}: {msg}',
                module='security',
                user_id=user_id
            )
            db.session.commit()
            return jsonify({'error': msg}), 401

        # SUCCESS: Proceed with attendance logic
        today = today_str()
        now_time = now_time_str()

        record = Attendance.query.filter_by(user_id=user_id, date=today).first()
        if not record or not record.check_in:
            return jsonify({'error': 'You must check in before checking out.'}), 400
        if record.check_out:
            return jsonify({'error': 'You have already checked out today.'}), 400

        record.check_out = now_time
        record.compute_hours()

        log_activity(
            action='FACE_CHECK_OUT',
            description=f'{user.name} checked out (AWS Verification Success)',
            module='attendance',
            user_id=user_id
        )
        db.session.commit()

        return jsonify({
            'message': 'Face verified. Checked out successfully.',
            'check_out': now_time,
            'working_hours': record.working_hours,
            'is_half_day': record.is_half_day,
            'overtime_hours': record.overtime_hours,
        }), 200

    except Exception as e:
        print(f'[AWS ERROR] Check-out verification crashed: {str(e)}')
        return jsonify({'error': 'Verification service currently unavailable.'}), 500


# ─── STATUS & ADMIN ROUTES ────────────────────────────────────
@face_attendance_bp.route('/status', methods=['GET'])
@jwt_required()
def face_status():
    user_id = int(get_jwt_identity())
    face_record = FaceEncoding.query.filter_by(user_id=user_id).first()
    return jsonify({
        'face_registered': face_record is not None,
        'registered_at': face_record.registered_at.isoformat() if face_record else None,
    }), 200

@face_attendance_bp.route('/admin/re-register/<int:employee_id>', methods=['POST'])
@jwt_required()
@require_roles('admin')
def admin_re_register_face(employee_id):
    data = request.get_json()
    image_b64 = data.get('image', '')
    if not image_b64:
        return jsonify({'error': 'Image is required.'}), 400

    user = User.query.get(employee_id)
    if not user:
        return jsonify({'error': 'Employee not found.'}), 404

    success, message = re_register_face(employee_id, image_b64)
    if success:
        log_activity(action='FACE_RE_REGISTERED', description=f'Admin re-registered face for {user.name}', module='admin')
        db.session.commit()
    return jsonify({'success': success, 'message': message}), 200 if success else 400