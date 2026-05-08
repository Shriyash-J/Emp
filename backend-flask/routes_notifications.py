"""
In-app Notification API — backs the bell-icon dropdown in the top navbar.
Each notification belongs to exactly one user and has a read/unread flag.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, Notification

notifications_bp = Blueprint('notifications', __name__, url_prefix='/api/notifications')


@notifications_bp.route('/', methods=['GET'])
@jwt_required()
def list_notifications():
    """Return the latest notifications for the logged-in user (newest first)."""
    user_id = int(get_jwt_identity())
    limit = request.args.get('limit', 30, type=int)
    limit = max(1, min(limit, 100))

    items = (Notification.query
             .filter_by(user_id=user_id)
             .order_by(Notification.created_at.desc())
             .limit(limit)
             .all())

    unread = (Notification.query
              .filter_by(user_id=user_id, is_read=False)
              .count())

    return jsonify({
        'notifications': [n.to_dict() for n in items],
        'unread_count': unread,
    })


@notifications_bp.route('/unread-count', methods=['GET'])
@jwt_required()
def unread_count():
    """Lightweight endpoint used by the navbar to poll for the red dot."""
    user_id = int(get_jwt_identity())
    count = Notification.query.filter_by(user_id=user_id, is_read=False).count()
    return jsonify({'unread_count': count})


@notifications_bp.route('/<int:notif_id>/read', methods=['POST'])
@jwt_required()
def mark_read(notif_id):
    user_id = int(get_jwt_identity())
    n = Notification.query.filter_by(id=notif_id, user_id=user_id).first()
    if not n:
        return jsonify({'error': 'Notification not found.'}), 404
    if not n.is_read:
        n.is_read = True
        db.session.commit()
    return jsonify({'message': 'Marked as read.'})


@notifications_bp.route('/read-all', methods=['POST'])
@jwt_required()
def mark_all_read():
    user_id = int(get_jwt_identity())
    Notification.query.filter_by(user_id=user_id, is_read=False).update({'is_read': True})
    db.session.commit()
    return jsonify({'message': 'All notifications marked as read.'})


@notifications_bp.route('/<int:notif_id>', methods=['DELETE'])
@jwt_required()
def delete_notification(notif_id):
    user_id = int(get_jwt_identity())
    n = Notification.query.filter_by(id=notif_id, user_id=user_id).first()
    if not n:
        return jsonify({'error': 'Notification not found.'}), 404
    db.session.delete(n)
    db.session.commit()
    return jsonify({'message': 'Notification deleted.'})
