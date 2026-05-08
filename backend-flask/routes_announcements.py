from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Announcement, User
from middleware import require_roles, sanitize_string, sanitize_html, notify

announcements_bp = Blueprint('announcements', __name__, url_prefix='/api/announcements')

# Valid target audiences for announcements
VALID_AUDIENCES = ('all', 'admin', 'hr', 'manager', 'employee')


@announcements_bp.route('/', methods=['GET'])
@jwt_required()
def get_announcements():
    """
    List announcements filtered by role-based visibility.
    Each announcement has a target_audience field:
      - 'all': visible to everyone
      - 'admin', 'hr', 'manager', 'employee': visible only to that role + admin
    """
    claims = get_jwt()
    role = claims.get('role')

    announcements = Announcement.query.order_by(Announcement.created_at.desc()).all()

    # Filter by visibility: admin sees everything; others see 'all' or their role
    if role == 'admin':
        visible = announcements
    else:
        visible = [
            a for a in announcements
            if getattr(a, 'target_audience', 'all') in ('all', role)
        ]

    return jsonify([a.to_dict() for a in visible]), 200


@announcements_bp.route('/', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr')
def create_announcement():
    data = request.get_json()
    title = sanitize_string(data.get('title', ''), 200)
    content = sanitize_html(data.get('content', ''), 5000)

    if not title or not content:
        return jsonify({'error': 'Title and content are required.'}), 400

    priority = data.get('priority', 'normal')
    if priority not in ('normal', 'urgent'):
        return jsonify({'error': 'Priority must be "normal" or "urgent".'}), 400

    target_audience = data.get('target_audience', 'all')
    if target_audience not in VALID_AUDIENCES:
        return jsonify({'error': f'target_audience must be one of: {", ".join(VALID_AUDIENCES)}'}), 400

    creator_id = int(get_jwt_identity())
    announcement = Announcement(
        title=title,
        content=content,
        priority=priority,
        target_audience=target_audience,
        created_by=creator_id,
    )
    db.session.add(announcement)

    # Fan out notifications to every user who can see this announcement.
    if target_audience == 'all':
        recipients = User.query.filter(User.status == 'active').all()
    else:
        # Audience role + admin always see role-targeted announcements.
        roles = {target_audience, 'admin'}
        recipients = User.query.filter(
            User.role.in_(roles), User.status == 'active'
        ).all()

    for u in recipients:
        if u.id == creator_id:
            continue
        notify(
            user_id=u.id,
            title=f'{"Urgent: " if priority == "urgent" else ""}New announcement',
            body=title[:200],
            category='announcement',
            link=f'/{u.role}/announcements',
        )

    db.session.commit()
    return jsonify({'message': 'Announcement posted.', 'id': announcement.id}), 201
