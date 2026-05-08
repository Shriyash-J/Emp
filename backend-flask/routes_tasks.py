from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Task, User, TeamMember, TeamTask
from middleware import require_roles, sanitize_string, notify

tasks_bp = Blueprint('tasks', __name__, url_prefix='/api/tasks')

VALID_PRIORITIES = ('low', 'medium', 'high')
VALID_STATUSES = ('pending', 'in_progress', 'completed')


@tasks_bp.route('/', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr', 'manager')
def create_task():
    data = request.get_json()
    title = sanitize_string(data.get('title', ''), 200)
    assigned_to = data.get('assigned_to')

    if not title or assigned_to in (None, '', 0):
        return jsonify({'error': 'Title and assigned_to are required.'}), 400

    try:
        assigned_to = int(assigned_to)
    except (TypeError, ValueError):
        return jsonify({'error': 'assigned_to must be a valid employee id.'}), 400

    # Verify the assignee exists
    assignee = User.query.get(assigned_to)
    if not assignee:
        return jsonify({'error': 'Assigned employee not found.'}), 404

    priority = data.get('priority', 'medium')
    if priority not in VALID_PRIORITIES:
        return jsonify({'error': f'Invalid priority. Must be one of: {", ".join(VALID_PRIORITIES)}'}), 400

    task = Task(
        title=title,
        description=sanitize_string(data.get('description', ''), 1000),
        assigned_to=assigned_to,
        assigned_by=int(get_jwt_identity()),
        priority=priority,
        due_date=data.get('due_date') or None,
    )
    db.session.add(task)

    assigner_id = int(get_jwt_identity())
    assigner = User.query.get(assigner_id)
    assigner_name = assigner.name if assigner else 'Someone'
    if assigned_to != assigner_id:
        # Tasks page exists for employee/manager; admin/hr fall back to dashboard.
        task_link = (f'/{assignee.role}/tasks'
                     if assignee.role in ('employee', 'manager')
                     else f'/{assignee.role}/dashboard')
        notify(
            user_id=assigned_to,
            title=f'New task: {task.title}',
            body=f'{assigner_name} assigned you a {priority}-priority task'
                 + (f' (due {task.due_date})' if task.due_date else ''),
            category='task',
            link=task_link,
        )

    db.session.commit()
    return jsonify({'message': 'Task created.', 'id': task.id, 'assigned_to': task.assigned_to}), 201


@tasks_bp.route('/my', methods=['GET'])
@jwt_required()
def my_tasks():
    user_id = int(get_jwt_identity())

    tasks = Task.query.filter_by(assigned_to=user_id).order_by(Task.created_at.desc()).all()
    result = [t.to_dict() for t in tasks]

    # Also surface tasks assigned to any team this employee is a member of,
    # so team-assigned work appears on the employee dashboard.
    team_ids = [m.team_id for m in TeamMember.query.filter_by(user_id=user_id).all()]
    if team_ids:
        team_tasks = (TeamTask.query
                      .filter(TeamTask.team_id.in_(team_ids))
                      .order_by(TeamTask.created_at.desc())
                      .all())
        for tt in team_tasks:
            result.append({
                'id': f'team-{tt.id}',
                'title': tt.title,
                'description': tt.description,
                'assigned_to': user_id,
                'assigned_to_name': '',
                'assigned_by': tt.assigned_by,
                'assigned_by_name': tt.assigner.name if tt.assigner else '',
                'priority': tt.priority,
                'status': tt.status,
                'due_date': tt.deadline,
                'created_at': tt.created_at.isoformat() if tt.created_at else None,
                'team_id': tt.team_id,
                'team_name': tt.team.name if tt.team else '',
                'is_team_task': True,
            })

    return jsonify(result), 200


@tasks_bp.route('/', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr', 'manager')
def all_tasks():
    tasks = Task.query.order_by(Task.created_at.desc()).all()
    return jsonify([t.to_dict() for t in tasks]), 200


@tasks_bp.route('/<int:task_id>', methods=['PUT'])
@jwt_required()
def update_task(task_id):
    user_id = int(get_jwt_identity())
    claims = get_jwt()
    task = Task.query.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    is_manager = claims.get('role') in ('admin', 'hr', 'manager')
    if task.assigned_to != user_id and not is_manager:
        return jsonify({'error': 'Permission denied.'}), 403

    data = request.get_json()

    # Validate status if provided
    if 'status' in data:
        if data['status'] not in VALID_STATUSES:
            return jsonify({'error': f'Invalid status. Must be one of: {", ".join(VALID_STATUSES)}'}), 400
        task.status = data['status']

    # Only managers/admin/hr can update other fields
    if is_manager:
        if 'title' in data:
            task.title = sanitize_string(data['title'], 200)
        if 'description' in data:
            task.description = sanitize_string(data['description'], 1000)
        if 'priority' in data:
            if data['priority'] not in VALID_PRIORITIES:
                return jsonify({'error': f'Invalid priority. Must be one of: {", ".join(VALID_PRIORITIES)}'}), 400
            task.priority = data['priority']
        if 'due_date' in data:
            task.due_date = data['due_date']

    db.session.commit()
    return jsonify({'message': 'Task updated.'}), 200
