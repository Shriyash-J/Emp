"""
Team Management routes — Manager creates teams, assigns team tasks, tracks progress.
Includes ML-based deadline prediction (rule-based + optional Logistic Regression).
"""
import math
from datetime import datetime, timezone, date as date_type
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, User, Team, TeamMember, TeamTask, TeamTaskProgress
# Used below when back-filling progress entries for newly-added team members.
from middleware import require_roles, validate_date, sanitize_string, log_activity, clamp_int, notify

teams_bp = Blueprint('teams', __name__, url_prefix='/api/teams')


# ═══════════════════════════════════════════════════════════════
#  HELPER — ownership check
# ═══════════════════════════════════════════════════════════════

def _assert_team_owner(team, user_id, role):
    """Return error response if user is not the team's manager (admin bypasses)."""
    if role == 'admin':
        return None
    if team.manager_id != user_id:
        return jsonify({'error': 'You can only manage your own teams.'}), 403
    return None


# ═══════════════════════════════════════════════════════════════
#  TEAM CRUD
# ═══════════════════════════════════════════════════════════════

@teams_bp.route('/', methods=['POST'])
@jwt_required()
@require_roles('admin', 'manager')
def create_team():
    """Manager creates a new team."""
    data = request.get_json()
    name = sanitize_string(data.get('name', ''), 100)
    description = sanitize_string(data.get('description', ''), 500)
    department = sanitize_string(data.get('department', ''), 100)

    if not name:
        return jsonify({'error': 'Team name is required.'}), 400

    user_id = int(get_jwt_identity())
    claims = get_jwt()

    # Admin can create teams for any manager
    manager_id = user_id
    if claims.get('role') == 'admin' and data.get('manager_id'):
        mgr = User.query.get(int(data['manager_id']))
        if not mgr or mgr.role not in ('manager', 'admin'):
            return jsonify({'error': 'Specified manager not found or invalid role.'}), 404
        manager_id = mgr.id

    team = Team(
        name=name, description=description,
        manager_id=manager_id, department=department,
    )
    db.session.add(team)
    log_activity(action='CREATE_TEAM', description=f'Created team "{name}"', module='manager')
    db.session.commit()

    return jsonify({'message': f'Team "{name}" created.', 'team': team.to_dict()}), 201


@teams_bp.route('/', methods=['GET'])
@jwt_required()
def list_teams():
    """
    Manager: sees own teams.  Employee: sees teams they belong to.
    Admin/HR: sees all teams.
    """
    claims = get_jwt()
    user_id = int(get_jwt_identity())
    role = claims.get('role')

    if role in ('admin', 'hr'):
        teams = Team.query.order_by(Team.created_at.desc()).all()
    elif role == 'manager':
        teams = Team.query.filter_by(manager_id=user_id).order_by(Team.created_at.desc()).all()
    else:
        # Employee — teams they are a member of
        member_rows = TeamMember.query.filter_by(user_id=user_id).all()
        team_ids = [m.team_id for m in member_rows]
        teams = Team.query.filter(Team.id.in_(team_ids)).all() if team_ids else []

    return jsonify([t.to_dict() for t in teams]), 200


@teams_bp.route('/<int:team_id>', methods=['GET'])
@jwt_required()
def get_team(team_id):
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found.'}), 404
    return jsonify(team.to_dict()), 200


@teams_bp.route('/<int:team_id>', methods=['PUT'])
@jwt_required()
@require_roles('admin', 'manager')
def update_team(team_id):
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found.'}), 404

    err = _assert_team_owner(team, int(get_jwt_identity()), get_jwt().get('role'))
    if err:
        return err

    data = request.get_json()
    if 'name' in data:
        team.name = sanitize_string(data['name'], 100)
    if 'description' in data:
        team.description = sanitize_string(data['description'], 500)
    if 'department' in data:
        team.department = sanitize_string(data['department'], 100)
    if 'status' in data and data['status'] in ('active', 'archived'):
        team.status = data['status']

    db.session.commit()
    return jsonify({'message': 'Team updated.', 'team': team.to_dict()}), 200


@teams_bp.route('/<int:team_id>', methods=['DELETE'])
@jwt_required()
@require_roles('admin', 'manager')
def delete_team(team_id):
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found.'}), 404

    err = _assert_team_owner(team, int(get_jwt_identity()), get_jwt().get('role'))
    if err:
        return err

    name = team.name
    db.session.delete(team)
    log_activity(action='DELETE_TEAM', description=f'Deleted team "{name}"', module='manager')
    db.session.commit()
    return jsonify({'message': f'Team "{name}" deleted.'}), 200


# ═══════════════════════════════════════════════════════════════
#  TEAM MEMBERS
# ═══════════════════════════════════════════════════════════════

@teams_bp.route('/<int:team_id>/members', methods=['POST'])
@jwt_required()
@require_roles('admin', 'manager')
def add_member(team_id):
    """Add an employee to a team."""
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found.'}), 404

    err = _assert_team_owner(team, int(get_jwt_identity()), get_jwt().get('role'))
    if err:
        return err

    data = request.get_json()
    emp_id = data.get('user_id')
    if not emp_id:
        return jsonify({'error': 'user_id is required.'}), 400

    employee = User.query.get(int(emp_id))
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    existing = TeamMember.query.filter_by(team_id=team_id, user_id=int(emp_id)).first()
    if existing:
        return jsonify({'error': f'{employee.name} is already in this team.'}), 409

    member = TeamMember(
        team_id=team_id, user_id=int(emp_id),
        role_in_team=data.get('role_in_team', 'member'),
    )
    db.session.add(member)

    # Back-fill TeamTaskProgress rows for every existing (non-completed) task
    # on this team so the new member can see them on /api/teams/tasks/my.
    # Without this, tasks created before the member joined are invisible.
    existing_tasks = TeamTask.query.filter_by(team_id=team_id).all()
    for t in existing_tasks:
        already = TeamTaskProgress.query.filter_by(
            team_task_id=t.id, user_id=int(emp_id)
        ).first()
        if not already:
            db.session.add(TeamTaskProgress(
                team_task_id=t.id, user_id=int(emp_id), progress=0,
            ))

    log_activity(action='ADD_TEAM_MEMBER', description=f'Added {employee.name} to team "{team.name}"', module='manager')

    notify(
        user_id=int(emp_id),
        title=f'Added to team: {team.name}',
        body=f'You were added to the {team.name} team.',
        category='task',
        link=f'/{employee.role}/teams' if employee.role in ('employee', 'manager') else '/employee/teams',
    )

    db.session.commit()

    return jsonify({'message': f'{employee.name} added to {team.name}.', 'member': member.to_dict()}), 201


@teams_bp.route('/<int:team_id>/members/<int:user_id>', methods=['DELETE'])
@jwt_required()
@require_roles('admin', 'manager')
def remove_member(team_id, user_id):
    """Remove an employee from a team."""
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found.'}), 404

    err = _assert_team_owner(team, int(get_jwt_identity()), get_jwt().get('role'))
    if err:
        return err

    member = TeamMember.query.filter_by(team_id=team_id, user_id=user_id).first()
    if not member:
        return jsonify({'error': 'Member not found in this team.'}), 404

    db.session.delete(member)
    db.session.commit()
    return jsonify({'message': 'Member removed from team.'}), 200


# ═══════════════════════════════════════════════════════════════
#  TEAM TASKS
# ═══════════════════════════════════════════════════════════════

@teams_bp.route('/<int:team_id>/tasks', methods=['POST'])
@jwt_required()
@require_roles('admin', 'manager')
def create_team_task(team_id):
    """Assign a task to the entire team."""
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found.'}), 404

    user_id = int(get_jwt_identity())
    err = _assert_team_owner(team, user_id, get_jwt().get('role'))
    if err:
        return err

    data = request.get_json()
    title = sanitize_string(data.get('title', ''), 200)
    start_date = data.get('start_date', '').strip()
    deadline = data.get('deadline', '').strip()

    if not title or not start_date or not deadline:
        return jsonify({'error': 'title, start_date, and deadline are required.'}), 400
    if not validate_date(start_date) or not validate_date(deadline):
        return jsonify({'error': 'Dates must be YYYY-MM-DD.'}), 400
    if deadline < start_date:
        return jsonify({'error': 'Deadline cannot be before start_date.'}), 400

    priority = data.get('priority', 'medium')
    if priority not in TeamTask.VALID_PRIORITIES:
        return jsonify({'error': f'priority must be one of: {", ".join(TeamTask.VALID_PRIORITIES)}'}), 400

    task = TeamTask(
        team_id=team_id, title=title,
        description=sanitize_string(data.get('description', ''), 2000),
        assigned_by=user_id, priority=priority,
        start_date=start_date, deadline=deadline,
    )
    db.session.add(task)
    db.session.flush()

    # Auto-create progress entries for each team member
    for member in team.members:
        entry = TeamTaskProgress(team_task_id=task.id, user_id=member.user_id, progress=0)
        db.session.add(entry)

    log_activity(action='CREATE_TEAM_TASK', description=f'Assigned "{title}" to team "{team.name}"', module='manager')

    # Notify every team member (skip the assigner if they happen to be on the team).
    for member in team.members:
        if member.user_id == user_id:
            continue
        member_user = member.user
        member_role = member_user.role if member_user else 'employee'
        link = f'/{member_role}/tasks' if member_role in ('employee', 'manager') else '/employee/tasks'
        notify(
            user_id=member.user_id,
            title=f'New team task: {title}',
            body=f'Assigned to "{team.name}" — due {deadline} ({priority}).',
            category='task',
            link=link,
        )

    db.session.commit()
    return jsonify({'message': f'Task assigned to {team.name}.', 'task': task.to_dict()}), 201


@teams_bp.route('/<int:team_id>/tasks', methods=['GET'])
@jwt_required()
def list_team_tasks(team_id):
    """List all tasks for a team."""
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found.'}), 404

    tasks = TeamTask.query.filter_by(team_id=team_id).order_by(TeamTask.created_at.desc()).all()
    return jsonify([t.to_dict() for t in tasks]), 200


@teams_bp.route('/tasks/my', methods=['GET'])
@jwt_required()
def my_team_tasks():
    """Employee: see all team tasks where I have a progress entry."""
    user_id = int(get_jwt_identity())
    entries = TeamTaskProgress.query.filter_by(user_id=user_id).all()
    task_ids = [e.team_task_id for e in entries]
    if not task_ids:
        return jsonify([]), 200
    tasks = TeamTask.query.filter(TeamTask.id.in_(task_ids)).order_by(TeamTask.deadline).all()
    return jsonify([t.to_dict() for t in tasks]), 200


# ═══════════════════════════════════════════════════════════════
#  PROGRESS TRACKING
# ═══════════════════════════════════════════════════════════════

@teams_bp.route('/tasks/<int:task_id>/progress', methods=['PUT'])
@jwt_required()
def update_progress(task_id):
    """Employee updates their own progress on a team task."""
    user_id = int(get_jwt_identity())
    data = request.get_json()
    progress = data.get('progress')
    notes = sanitize_string(data.get('notes', ''), 500)

    if progress is None:
        return jsonify({'error': 'progress (0-100) is required.'}), 400
    progress = max(0, min(100, int(progress)))

    entry = TeamTaskProgress.query.filter_by(team_task_id=task_id, user_id=user_id).first()
    if not entry:
        return jsonify({'error': 'You are not assigned to this team task.'}), 403

    entry.progress = progress
    if notes:
        entry.notes = notes

    # Recompute overall progress
    task = TeamTask.query.get(task_id)
    if task:
        task.overall_progress = task.compute_overall_progress()
        # Auto-complete when all members at 100%
        if task.overall_progress == 100 and task.status != 'completed':
            task.status = 'completed'
            task.completed_at = datetime.now(timezone.utc)
            # Notify the assigner (and team manager if different) that the work is done.
            if task.assigned_by and task.assigned_by != user_id:
                notify(
                    user_id=task.assigned_by,
                    title=f'Team task completed: {task.title}',
                    body=f'All members on "{task.team.name if task.team else ""}" finished their progress.',
                    category='task',
                    link='/manager/teams',
                )
            if task.team and task.team.manager_id and task.team.manager_id not in (user_id, task.assigned_by):
                notify(
                    user_id=task.team.manager_id,
                    title=f'Team task completed: {task.title}',
                    body=f'Your team "{task.team.name}" finished the task.',
                    category='task',
                    link='/manager/teams',
                )
        elif task.overall_progress > 0 and task.status == 'pending':
            task.status = 'in_progress'

    db.session.commit()
    return jsonify({'message': 'Progress updated.', 'overall_progress': task.overall_progress if task else progress}), 200


# ═══════════════════════════════════════════════════════════════
#  ML PREDICTION — Will the team finish on time?
# ═══════════════════════════════════════════════════════════════

def _rule_based_prediction(progress, time_elapsed_pct, priority):
    """
    Simple heuristic prediction.
    Compares expected progress (linear) vs actual progress.

    Returns: ("On Time" | "At Risk" | "Delayed", confidence 0–1, details)
    """
    if time_elapsed_pct <= 0:
        return 'On Time', 0.5, 'Task has not started yet.'

    expected_progress = time_elapsed_pct * 100
    pace_ratio = progress / expected_progress if expected_progress > 0 else 1.0

    # Priority multiplier — urgent tasks get flagged sooner
    priority_thresholds = {
        'low': (0.60, 0.80),      # generous
        'medium': (0.70, 0.85),
        'high': (0.78, 0.90),
        'urgent': (0.85, 0.95),   # strict
    }
    delay_thresh, risk_thresh = priority_thresholds.get(priority, (0.70, 0.85))

    if pace_ratio >= risk_thresh:
        label = 'On Time'
        confidence = min(1.0, 0.6 + pace_ratio * 0.3)
    elif pace_ratio >= delay_thresh:
        label = 'At Risk'
        confidence = 0.5 + (pace_ratio - delay_thresh) / (risk_thresh - delay_thresh) * 0.3
    else:
        label = 'Delayed'
        confidence = min(1.0, 0.6 + (1 - pace_ratio) * 0.3)

    projected_completion = progress / pace_ratio if pace_ratio > 0 else 0
    detail = (
        f'Progress {progress}% vs expected {expected_progress:.0f}% '
        f'(pace ratio {pace_ratio:.2f}). '
        f'Projected at deadline: {min(projected_completion, 100):.0f}%.'
    )
    return label, round(confidence, 2), detail


def _ml_prediction(task):
    """
    Advanced prediction using Logistic Regression trained on completed team tasks.
    Falls back to rule-based if not enough historical data or sklearn unavailable.
    """
    try:
        from sklearn.linear_model import LogisticRegression
        import numpy as np
    except ImportError:
        return None  # Fall back to rule-based

    # Gather completed historical tasks for training
    completed = TeamTask.query.filter(
        TeamTask.status == 'completed',
        TeamTask.completed_at.isnot(None),
    ).all()

    if len(completed) < 5:
        return None  # Not enough data, fall back

    X, y = [], []
    for ct in completed:
        try:
            start = date_type.fromisoformat(ct.start_date)
            deadline = date_type.fromisoformat(ct.deadline)
            total_days = (deadline - start).days or 1
            completed_date = ct.completed_at.date() if ct.completed_at else deadline
            actual_days = (completed_date - start).days
            was_on_time = 1 if actual_days <= total_days else 0

            priority_num = {'low': 0, 'medium': 1, 'high': 2, 'urgent': 3}.get(ct.priority, 1)
            member_count = len(ct.member_progress) or 1

            X.append([total_days, priority_num, member_count])
            y.append(was_on_time)
        except (ValueError, TypeError):
            continue

    if len(X) < 5 or len(set(y)) < 2:
        return None

    X = np.array(X)
    y = np.array(y)

    model = LogisticRegression(max_iter=200)
    model.fit(X, y)

    # Predict for current task
    try:
        start = date_type.fromisoformat(task.start_date)
        deadline = date_type.fromisoformat(task.deadline)
        total_days = (deadline - start).days or 1
        priority_num = {'low': 0, 'medium': 1, 'high': 2, 'urgent': 3}.get(task.priority, 1)
        member_count = len(task.member_progress) or 1

        X_new = np.array([[total_days, priority_num, member_count]])
        proba = model.predict_proba(X_new)[0]
        on_time_prob = proba[1] if len(proba) > 1 else proba[0]

        if on_time_prob >= 0.7:
            label = 'On Time'
        elif on_time_prob >= 0.4:
            label = 'At Risk'
        else:
            label = 'Delayed'

        return {
            'label': label,
            'confidence': round(float(on_time_prob), 2),
            'method': 'logistic_regression',
            'training_samples': len(X),
            'detail': f'ML model trained on {len(X)} completed tasks. On-time probability: {on_time_prob:.0%}.',
        }
    except (ValueError, TypeError):
        return None


@teams_bp.route('/tasks/<int:task_id>/predict', methods=['GET'])
@jwt_required()
def predict_completion(task_id):
    """
    Predict whether the team will complete the task before the deadline.
    Uses ML (Logistic Regression) if enough historical data exists,
    otherwise falls back to rule-based heuristics.
    """
    task = TeamTask.query.get(task_id)
    if not task:
        return jsonify({'error': 'Team task not found.'}), 404

    if task.status == 'completed':
        return jsonify({
            'prediction': 'Completed',
            'label': 'On Time' if task.completed_at and task.completed_at.strftime('%Y-%m-%d') <= task.deadline else 'Delayed',
            'confidence': 1.0,
            'method': 'actual',
            'detail': f'Task completed on {task.completed_at.strftime("%Y-%m-%d") if task.completed_at else "unknown"}.',
            'overall_progress': task.overall_progress,
        }), 200

    # Calculate time metrics
    today = date_type.today()
    try:
        start = date_type.fromisoformat(task.start_date)
        deadline = date_type.fromisoformat(task.deadline)
    except ValueError:
        return jsonify({'error': 'Invalid dates on task.'}), 400

    total_days = (deadline - start).days or 1
    elapsed_days = (today - start).days
    time_elapsed_pct = max(0.0, min(1.0, elapsed_days / total_days))
    days_remaining = (deadline - today).days

    # Try ML first
    ml_result = _ml_prediction(task)

    if ml_result:
        # Blend ML with current progress for a hybrid score
        rule_label, rule_conf, rule_detail = _rule_based_prediction(
            task.overall_progress, time_elapsed_pct, task.priority
        )
        # If ML and rule-based agree, boost confidence
        if ml_result['label'] == rule_label:
            ml_result['confidence'] = min(1.0, ml_result['confidence'] + 0.1)
            ml_result['detail'] += f' Rule-based agrees: {rule_detail}'
        else:
            ml_result['detail'] += f' (Rule-based says: {rule_label})'
            ml_result['method'] = 'hybrid'

        return jsonify({
            'prediction': ml_result['label'],
            **ml_result,
            'overall_progress': task.overall_progress,
            'time_elapsed_pct': round(time_elapsed_pct * 100, 1),
            'days_remaining': days_remaining,
            'total_days': total_days,
        }), 200

    # Fallback: rule-based
    label, confidence, detail = _rule_based_prediction(
        task.overall_progress, time_elapsed_pct, task.priority
    )

    return jsonify({
        'prediction': label,
        'label': label,
        'confidence': confidence,
        'method': 'rule_based',
        'detail': detail,
        'overall_progress': task.overall_progress,
        'time_elapsed_pct': round(time_elapsed_pct * 100, 1),
        'days_remaining': days_remaining,
        'total_days': total_days,
    }), 200


# ═══════════════════════════════════════════════════════════════
#  TEAM STATS
# ═══════════════════════════════════════════════════════════════

@teams_bp.route('/stats', methods=['GET'])
@jwt_required()
@require_roles('admin', 'manager')
def team_stats():
    """Aggregate stats for the manager's teams."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())

    if claims.get('role') == 'admin':
        teams = Team.query.all()
    else:
        teams = Team.query.filter_by(manager_id=user_id).all()

    total_teams = len(teams)
    total_members = sum(len(t.members) for t in teams)
    team_ids = [t.id for t in teams]

    if team_ids:
        all_tasks = TeamTask.query.filter(TeamTask.team_id.in_(team_ids)).all()
    else:
        all_tasks = []

    completed = sum(1 for t in all_tasks if t.status == 'completed')
    in_progress = sum(1 for t in all_tasks if t.status == 'in_progress')
    pending = sum(1 for t in all_tasks if t.status == 'pending')

    return jsonify({
        'total_teams': total_teams,
        'total_members': total_members,
        'total_tasks': len(all_tasks),
        'tasks_completed': completed,
        'tasks_in_progress': in_progress,
        'tasks_pending': pending,
        'completion_rate': round(completed / len(all_tasks) * 100, 1) if all_tasks else 0,
    }), 200
