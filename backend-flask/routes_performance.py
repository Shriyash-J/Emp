"""
Performance routes — Manager submits reviews, HR views/adds comments, employees view their own.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, User, PerformanceRecord
from middleware import require_roles, sanitize_string, log_activity, clamp_int, notify, notify_roles

performance_bp = Blueprint('performance', __name__, url_prefix='/api/performance')


# ─── CREATE PERFORMANCE REVIEW (Manager only) ─────────────────

@performance_bp.route('/', methods=['POST'])
@jwt_required()
@require_roles('admin', 'manager')
def create_review():
    """Manager submits a performance review for an employee."""
    data = request.get_json()
    user_id = data.get('user_id')
    review_period = sanitize_string(data.get('review_period', ''), 20)
    rating = data.get('rating')

    if not user_id or not review_period or rating is None:
        return jsonify({'error': 'user_id, review_period, and rating are required.'}), 400

    try:
        rating = int(rating)
    except (TypeError, ValueError):
        return jsonify({'error': 'Rating must be an integer.'}), 400

    if rating < 1 or rating > 5:
        return jsonify({'error': 'Rating must be between 1 and 5.'}), 400

    employee = User.query.get(int(user_id))
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    # Check for duplicate review (same employee + same period)
    existing = PerformanceRecord.query.filter_by(
        user_id=int(user_id), review_period=review_period
    ).first()
    if existing:
        return jsonify({'error': f'A review for {review_period} already exists for this employee.'}), 409

    goals_met = max(0, min(100, int(data.get('goals_met', 0) or 0)))

    record = PerformanceRecord(
        user_id=int(user_id),
        review_period=review_period,
        rating=rating,
        goals_met=goals_met,
        strengths=sanitize_string(data.get('strengths', ''), 2000),
        improvements=sanitize_string(data.get('improvements', ''), 2000),
        manager_comments=sanitize_string(data.get('manager_comments', ''), 2000),
        status='submitted',
        reviewed_by=int(get_jwt_identity()),
    )
    db.session.add(record)

    log_activity(
        action='CREATE_PERFORMANCE_REVIEW',
        description=f'Submitted performance review for {employee.name} ({review_period}, rating: {rating}/5)',
        module='hr'
    )

    review_link = f'/{employee.role}/performance' if employee.role in ('employee', 'manager', 'hr') else '/employee/performance'
    notify(
        user_id=int(user_id),
        title=f'New performance review ({review_period})',
        body=f'You received a {rating}/5 review. Open it to read the feedback.',
        category='general',
        link=review_link,
    )

    db.session.commit()

    return jsonify({'message': 'Performance review submitted.', 'record': record.to_dict()}), 201


# ─── LIST PERFORMANCE RECORDS ─────────────────────────────────

@performance_bp.route('/', methods=['GET'])
@jwt_required()
def list_reviews():
    """
    Admin/HR: see all records.
    Manager: see records they submitted + their own.
    Employee: see only their own.
    """
    claims = get_jwt()
    user_id = int(get_jwt_identity())
    role = claims.get('role')

    employee_id = request.args.get('employee_id', '')
    period = request.args.get('review_period', '')

    if role in ('admin', 'hr'):
        query = PerformanceRecord.query
        if employee_id:
            query = query.filter_by(user_id=int(employee_id))
    elif role == 'manager':
        # Managers see reviews they submitted + their own records
        query = PerformanceRecord.query.filter(
            db.or_(
                PerformanceRecord.reviewed_by == user_id,
                PerformanceRecord.user_id == user_id,
            )
        )
        if employee_id:
            query = query.filter_by(user_id=int(employee_id))
    else:
        # Employees see only their own
        query = PerformanceRecord.query.filter_by(user_id=user_id)

    if period:
        query = query.filter_by(review_period=period)

    records = query.order_by(PerformanceRecord.created_at.desc()).all()
    return jsonify([r.to_dict() for r in records]), 200


# ─── GET SINGLE RECORD ────────────────────────────────────────

@performance_bp.route('/<int:record_id>', methods=['GET'])
@jwt_required()
def get_review(record_id):
    claims = get_jwt()
    user_id = int(get_jwt_identity())

    record = PerformanceRecord.query.get(record_id)
    if not record:
        return jsonify({'error': 'Performance record not found.'}), 404

    # Authorization
    if claims.get('role') in ('admin', 'hr'):
        pass  # Full access
    elif claims.get('role') == 'manager' and (record.reviewed_by == user_id or record.user_id == user_id):
        pass  # Manager who submitted or their own record
    elif record.user_id == user_id:
        pass  # Employee's own record
    else:
        return jsonify({'error': 'Permission denied.'}), 403

    return jsonify(record.to_dict()), 200


# ─── HR ADDS COMMENTS TO A REVIEW ─────────────────────────────

@performance_bp.route('/<int:record_id>/hr-comment', methods=['PUT'])
@jwt_required()
@require_roles('admin', 'hr')
def add_hr_comment(record_id):
    """HR adds their comments to a performance review."""
    record = PerformanceRecord.query.get(record_id)
    if not record:
        return jsonify({'error': 'Performance record not found.'}), 404

    data = request.get_json()
    if 'hr_comments' in data:
        record.hr_comments = sanitize_string(data['hr_comments'], 2000)
    if 'status' in data and data['status'] in ('reviewed', 'acknowledged'):
        record.status = data['status']

    log_activity(
        action='HR_REVIEW_COMMENT',
        description=f'HR added comments to performance review #{record_id}',
        module='hr'
    )

    employee = record.employee
    if employee:
        emp_link = f'/{employee.role}/performance' if employee.role in ('employee', 'manager', 'hr') else '/employee/performance'
        notify(
            user_id=record.user_id,
            title='HR added comments to your review',
            body=f'HR commented on your {record.review_period} performance review.',
            category='general',
            link=emp_link,
        )

    db.session.commit()

    return jsonify({'message': 'HR comments added.', 'record': record.to_dict()}), 200


# ─── EMPLOYEE ACKNOWLEDGES REVIEW ─────────────────────────────

@performance_bp.route('/<int:record_id>/acknowledge', methods=['PUT'])
@jwt_required()
def acknowledge_review(record_id):
    """Employee acknowledges their performance review."""
    user_id = int(get_jwt_identity())

    record = PerformanceRecord.query.get(record_id)
    if not record:
        return jsonify({'error': 'Performance record not found.'}), 404

    if record.user_id != user_id:
        return jsonify({'error': 'You can only acknowledge your own review.'}), 403

    record.status = 'acknowledged'

    employee = record.employee
    if record.reviewed_by and record.reviewed_by != user_id:
        notify(
            user_id=record.reviewed_by,
            title='Performance review acknowledged',
            body=f'{employee.name if employee else "Employee"} acknowledged the {record.review_period} review.',
            category='general',
            link='/manager/performance',
        )

    db.session.commit()

    return jsonify({'message': 'Review acknowledged.', 'record': record.to_dict()}), 200


# ─── PERFORMANCE STATS ────────────────────────────────────────

@performance_bp.route('/stats', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr')
def performance_stats():
    """Aggregate performance statistics for HR dashboard."""
    total = PerformanceRecord.query.count()
    avg_rating = db.session.query(db.func.avg(PerformanceRecord.rating)).scalar() or 0
    avg_goals = db.session.query(db.func.avg(PerformanceRecord.goals_met)).scalar() or 0

    by_rating = {}
    for r in range(1, 6):
        by_rating[str(r)] = PerformanceRecord.query.filter_by(rating=r).count()

    return jsonify({
        'total_reviews': total,
        'avg_rating': round(float(avg_rating), 2),
        'avg_goals_met': round(float(avg_goals), 1),
        'by_rating': by_rating,
    }), 200
