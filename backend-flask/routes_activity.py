from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from models import db, User, ActivityLog
from middleware import require_roles, clamp_int

activity_bp = Blueprint('activity', __name__, url_prefix='/api/activity')


@activity_bp.route('/', methods=['GET'])
@jwt_required()
@require_roles('admin')
def get_activity_logs():
    module = request.args.get('module', '')
    limit = clamp_int(request.args.get('limit'), default=50, min_val=1, max_val=200)
    offset = clamp_int(request.args.get('offset'), default=0, min_val=0, max_val=100000)

    query = ActivityLog.query
    if module:
        query = query.filter_by(module=module)

    total = query.count()
    logs = query.order_by(ActivityLog.timestamp.desc()).offset(offset).limit(limit).all()

    return jsonify({
        'logs': [l.to_dict() for l in logs],
        'total': total
    }), 200


@activity_bp.route('/stats', methods=['GET'])
@jwt_required()
@require_roles('admin')
def get_stats():
    total_employees = User.query.count()
    active_employees = User.query.filter_by(status='active').count()
    departments = db.session.query(User.department).filter(
        User.department != ''
    ).distinct().count()

    from datetime import datetime, timezone
    from models import Leave
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    today_activities = ActivityLog.query.filter(
        db.func.date(ActivityLog.timestamp) == today
    ).count()

    pending_leaves = Leave.query.filter_by(status='pending').count()

    recent = ActivityLog.query.order_by(
        ActivityLog.timestamp.desc()
    ).limit(10).all()

    dept_counts = db.session.query(
        User.department, db.func.count(User.id)
    ).filter(User.department != '').group_by(User.department).order_by(
        db.func.count(User.id).desc()
    ).all()

    return jsonify({
        'totalEmployees': total_employees,
        'activeEmployees': active_employees,
        'departments': departments,
        'todayActivities': today_activities,
        'pendingLeaves': pending_leaves,
        'recentActivities': [a.to_dict() for a in recent],
        'departmentCounts': [{'department': d, 'count': c} for d, c in dept_counts]
    }), 200
