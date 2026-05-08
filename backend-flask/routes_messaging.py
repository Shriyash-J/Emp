"""
Internal Employee Messaging API — one-to-one chat between employees.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Message, Notification
from middleware import log_activity, sanitize_string, notify

messaging_bp = Blueprint('messaging', __name__, url_prefix='/api/messages')


@messaging_bp.route('/send', methods=['POST'])
@jwt_required()
def send_message():
    """Send a message to another employee."""
    sender_id = int(get_jwt_identity())
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid JSON payload.'}), 400

    receiver_id = data.get('receiver_id')
    message_text = data.get('message', '').strip()

    if not receiver_id:
        return jsonify({'error': 'receiver_id is required.'}), 400
    if not message_text:
        return jsonify({'error': 'message cannot be empty.'}), 400

    receiver_id = int(receiver_id)
    if receiver_id == sender_id:
        return jsonify({'error': 'Cannot send a message to yourself.'}), 400

    # Verify receiver exists and is active
    receiver = User.query.filter_by(id=receiver_id, status='active').first()
    if not receiver:
        return jsonify({'error': 'Recipient not found or inactive.'}), 404

    sanitized = sanitize_string(message_text, max_length=2000)
    msg = Message(
        sender_id=sender_id,
        receiver_id=receiver_id,
        message=sanitized,
    )
    db.session.add(msg)

    log_activity(
        action='MESSAGE_SENT',
        description=f'Sent message to {receiver.name}',
        module='messaging',
        user_id=sender_id,
    )

    sender = User.query.get(sender_id)
    sender_name = sender.name if sender else 'Someone'
    # Build a deep link to the conversation in the receiver's role-prefixed messaging page.
    receiver_role = receiver.role if receiver.role in ('admin', 'hr', 'manager', 'employee') else 'employee'
    notify(
        user_id=receiver_id,
        title=f'New message from {sender_name}',
        body=sanitized[:200],
        category='message',
        link=f'/{receiver_role}/messaging?with={sender_id}',
    )

    db.session.commit()

    return jsonify(msg.to_dict()), 201


@messaging_bp.route('/conversation/<int:other_user_id>', methods=['GET'])
@jwt_required()
def get_conversation(other_user_id):
    """
    Get all messages between the logged-in user and another user.
    Supports pagination via ?page=1&per_page=50
    """
    user_id = int(get_jwt_identity())
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    per_page = min(per_page, 100)  # Cap at 100

    messages = Message.query.filter(
        db.or_(
            db.and_(Message.sender_id == user_id, Message.receiver_id == other_user_id),
            db.and_(Message.sender_id == other_user_id, Message.receiver_id == user_id),
        )
    ).order_by(Message.timestamp.asc()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    # Mark unread messages from the other user as read
    unread = Message.query.filter(
        Message.sender_id == other_user_id,
        Message.receiver_id == user_id,
        Message.is_read == False,
    ).all()
    for m in unread:
        m.is_read = True

    # Also clear any chat notifications about this conversation so opening
    # the chat acts as "read" everywhere — bell badge, navbar, dropdown.
    chat_notifs = Notification.query.filter(
        Notification.user_id == user_id,
        Notification.category == 'message',
        Notification.is_read == False,
        Notification.link.like(f'%with={other_user_id}%'),
    ).all()
    for n in chat_notifs:
        n.is_read = True

    if unread or chat_notifs:
        db.session.commit()

    return jsonify({
        'messages': [m.to_dict() for m in messages.items],
        'total': messages.total,
        'page': messages.page,
        'pages': messages.pages,
    })


@messaging_bp.route('/contacts', methods=['GET'])
@jwt_required()
def get_contacts():
    """
    Get list of all active employees the user can message,
    along with the last message and unread count for each.
    """
    user_id = int(get_jwt_identity())

    # All active employees except self
    employees = User.query.filter(
        User.status == 'active',
        User.id != user_id,
    ).order_by(User.name).all()

    contacts = []
    for emp in employees:
        # Last message between user and this employee
        last_msg = Message.query.filter(
            db.or_(
                db.and_(Message.sender_id == user_id, Message.receiver_id == emp.id),
                db.and_(Message.sender_id == emp.id, Message.receiver_id == user_id),
            )
        ).order_by(Message.timestamp.desc()).first()

        # Unread count from this employee
        unread_count = Message.query.filter(
            Message.sender_id == emp.id,
            Message.receiver_id == user_id,
            Message.is_read == False,
        ).count()

        contacts.append({
            'id': emp.id,
            'name': emp.name,
            'email': emp.email,
            'department': emp.department,
            'position': emp.position,
            'role': emp.role,
            'last_message': last_msg.message[:60] if last_msg else None,
            'last_message_time': last_msg.timestamp.isoformat() if last_msg else None,
            'unread_count': unread_count,
        })

    # Sort: contacts with recent messages first, then alphabetical
    contacts.sort(key=lambda c: (c['last_message_time'] or '', c['name']), reverse=True)
    # Re-sort so those with messages come first, then alphabetical for the rest
    with_messages = [c for c in contacts if c['last_message_time']]
    without_messages = sorted([c for c in contacts if not c['last_message_time']], key=lambda c: c['name'])
    contacts = with_messages + without_messages

    return jsonify(contacts)


@messaging_bp.route('/unread-count', methods=['GET'])
@jwt_required()
def unread_count():
    """Get total unread message count for the logged-in user."""
    user_id = int(get_jwt_identity())
    count = Message.query.filter(
        Message.receiver_id == user_id,
        Message.is_read == False,
    ).count()
    return jsonify({'unread_count': count})
