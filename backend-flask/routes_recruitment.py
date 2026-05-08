"""
Recruitment routes — HR manages job candidates through the hiring pipeline.
HR-only for all operations (admin also has access).
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Candidate, User
from middleware import require_roles, validate_date, validate_email, sanitize_string, log_activity, clamp_int

recruitment_bp = Blueprint('recruitment', __name__, url_prefix='/api/recruitment')


# ─── ADD CANDIDATE ─────────────────────────────────────────────

@recruitment_bp.route('/candidates', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr')
def add_candidate():
    """HR adds a new candidate to the recruitment pipeline."""
    data = request.get_json()

    name = sanitize_string(data.get('name', ''), 100)
    email = data.get('email', '').strip().lower()
    position = sanitize_string(data.get('position_applied', ''), 100)

    if not name or not email or not position:
        return jsonify({'error': 'Name, email, and position_applied are required.'}), 400

    if not validate_email(email):
        return jsonify({'error': 'Invalid email format.'}), 400

    # Check for duplicate candidate (same email + same position)
    existing = Candidate.query.filter_by(email=email, position_applied=position).first()
    if existing:
        return jsonify({'error': f'Candidate with this email already applied for {position}.'}), 409

    candidate = Candidate(
        name=name,
        email=email,
        phone=sanitize_string(data.get('phone', ''), 20),
        position_applied=position,
        department=sanitize_string(data.get('department', ''), 100),
        experience_years=min(float(data.get('experience_years', 0) or 0), 50),
        current_company=sanitize_string(data.get('current_company', ''), 200),
        expected_salary=min(float(data.get('expected_salary', 0) or 0), 100000000),
        status='applied',
        added_by=int(get_jwt_identity()),
    )
    db.session.add(candidate)

    log_activity(
        action='ADD_CANDIDATE',
        description=f'Added candidate {name} for {position}',
        module='hr'
    )
    db.session.commit()

    return jsonify({'message': 'Candidate added.', 'candidate': candidate.to_dict()}), 201


# ─── LIST CANDIDATES ──────────────────────────────────────────

@recruitment_bp.route('/candidates', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr')
def list_candidates():
    """List all candidates with optional filters."""
    status = request.args.get('status', '')
    department = request.args.get('department', '')
    search = request.args.get('search', '')
    limit = clamp_int(request.args.get('limit'), default=200, min_val=1, max_val=500)

    query = Candidate.query

    if status and status in Candidate.VALID_STATUSES:
        query = query.filter_by(status=status)
    if department:
        query = query.filter_by(department=department)
    if search:
        query = query.filter(
            db.or_(
                Candidate.name.ilike(f'%{search}%'),
                Candidate.email.ilike(f'%{search}%'),
                Candidate.position_applied.ilike(f'%{search}%'),
            )
        )

    candidates = query.order_by(Candidate.created_at.desc()).limit(limit).all()
    return jsonify([c.to_dict() for c in candidates]), 200


# ─── GET SINGLE CANDIDATE ─────────────────────────────────────

@recruitment_bp.route('/candidates/<int:candidate_id>', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr')
def get_candidate(candidate_id):
    candidate = Candidate.query.get(candidate_id)
    if not candidate:
        return jsonify({'error': 'Candidate not found.'}), 404
    return jsonify(candidate.to_dict()), 200


# ─── UPDATE CANDIDATE STATUS ──────────────────────────────────

@recruitment_bp.route('/candidates/<int:candidate_id>', methods=['PUT'])
@jwt_required()
@require_roles('admin', 'hr')
def update_candidate(candidate_id):
    """Update candidate details or move through the pipeline."""
    candidate = Candidate.query.get(candidate_id)
    if not candidate:
        return jsonify({'error': 'Candidate not found.'}), 404

    data = request.get_json()

    # Update status if provided
    if 'status' in data:
        new_status = data['status']
        if new_status not in Candidate.VALID_STATUSES:
            return jsonify({'error': f'Invalid status. Must be one of: {", ".join(Candidate.VALID_STATUSES)}'}), 400
        candidate.status = new_status

    # Update other fields
    if 'name' in data:
        candidate.name = sanitize_string(data['name'], 100)
    if 'phone' in data:
        candidate.phone = sanitize_string(data['phone'], 20)
    if 'department' in data:
        candidate.department = sanitize_string(data['department'], 100)
    if 'position_applied' in data:
        candidate.position_applied = sanitize_string(data['position_applied'], 100)
    if 'experience_years' in data:
        candidate.experience_years = min(float(data['experience_years'] or 0), 50)
    if 'current_company' in data:
        candidate.current_company = sanitize_string(data['current_company'], 200)
    if 'expected_salary' in data:
        candidate.expected_salary = min(float(data['expected_salary'] or 0), 100000000)
    if 'interview_date' in data:
        if data['interview_date'] and not validate_date(data['interview_date']):
            return jsonify({'error': 'interview_date must be YYYY-MM-DD format.'}), 400
        candidate.interview_date = data['interview_date'] or None
    if 'interview_notes' in data:
        candidate.interview_notes = sanitize_string(data['interview_notes'], 2000)
    if 'rejection_reason' in data:
        candidate.rejection_reason = sanitize_string(data['rejection_reason'], 500)

    log_activity(
        action='UPDATE_CANDIDATE',
        description=f'Updated candidate {candidate.name} (status: {candidate.status})',
        module='hr'
    )
    db.session.commit()

    return jsonify({'message': 'Candidate updated.', 'candidate': candidate.to_dict()}), 200


# ─── DELETE CANDIDATE ──────────────────────────────────────────

@recruitment_bp.route('/candidates/<int:candidate_id>', methods=['DELETE'])
@jwt_required()
@require_roles('admin', 'hr')
def delete_candidate(candidate_id):
    candidate = Candidate.query.get(candidate_id)
    if not candidate:
        return jsonify({'error': 'Candidate not found.'}), 404

    name = candidate.name
    db.session.delete(candidate)

    log_activity(
        action='DELETE_CANDIDATE',
        description=f'Deleted candidate {name}',
        module='hr'
    )
    db.session.commit()

    return jsonify({'message': 'Candidate deleted.'}), 200


# ─── RECRUITMENT STATS ─────────────────────────────────────────

@recruitment_bp.route('/stats', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr')
def recruitment_stats():
    """Get recruitment pipeline statistics."""
    total = Candidate.query.count()
    by_status = {}
    for status in Candidate.VALID_STATUSES:
        by_status[status] = Candidate.query.filter_by(status=status).count()

    # Top positions being recruited for
    positions = db.session.query(
        Candidate.position_applied, db.func.count(Candidate.id)
    ).group_by(Candidate.position_applied).order_by(db.func.count(Candidate.id).desc()).limit(10).all()

    return jsonify({
        'total': total,
        'by_status': by_status,
        'top_positions': [{'position': p, 'count': c} for p, c in positions],
    }), 200
