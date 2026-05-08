"""
Shared security middleware — decorators, validators, audit helpers, and
security-hardening utilities for the WorkNet application.
"""
import re
import html
from functools import wraps
from flask import request, jsonify, g
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request
from models import db, ActivityLog, User, Notification


# ── Role-Based Access Control Decorator ─────────────────────────

ROLE_HIERARCHY = {
    'admin': 4,
    'hr': 3,
    'manager': 2,
    'employee': 1,
}

VALID_ROLES = set(ROLE_HIERARCHY.keys())


def require_roles(*allowed_roles):
    """
    Decorator that restricts a route to specific roles.
    Must be placed AFTER @jwt_required().

    Usage:
        @route(...)
        @jwt_required()
        @require_roles('admin', 'hr')
        def my_endpoint():
            ...
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            claims = get_jwt()
            role = claims.get('role')

            # Verify the role claim matches the user's actual DB role
            # to prevent stale token exploitation
            if role not in allowed_roles:
                log_activity(
                    action='ACCESS_DENIED',
                    description=f'Unauthorized access attempt to {request.method} {request.path} (role: {role})',
                    module='security'
                )
                return jsonify({'error': 'You do not have permission to perform this action.'}), 403

            # Store current user info in Flask g for easy access
            g.current_role = role
            try:
                g.current_user_id = int(get_jwt_identity())
            except Exception:
                g.current_user_id = None

            return fn(*args, **kwargs)
        return wrapper
    return decorator


def require_admin_only(fn):
    """Convenience decorator: admin-only access."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        if claims.get('role') != 'admin':
            log_activity(
                action='ACCESS_DENIED',
                description=f'Admin-only endpoint accessed by role={claims.get("role")}: {request.method} {request.path}',
                module='security'
            )
            return jsonify({'error': 'This action requires admin privileges.'}), 403
        return fn(*args, **kwargs)
    return wrapper


# ── Password Validation ─────────────────────────────────────────

def validate_password(password):
    """
    Enforce strong password policy.
    Returns (is_valid: bool, error_message: str | None).
    """
    if len(password) < 8:
        return False, 'Password must be at least 8 characters long.'
    if not re.search(r'[A-Z]', password):
        return False, 'Password must contain at least one uppercase letter.'
    if not re.search(r'[a-z]', password):
        return False, 'Password must contain at least one lowercase letter.'
    if not re.search(r'\d', password):
        return False, 'Password must contain at least one digit.'
    if not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':\"\\|,.<>\/?]', password):
        return False, 'Password must contain at least one special character.'
    return True, None


# ── Input Validation Helpers ────────────────────────────────────

def validate_date(date_str):
    """Validate YYYY-MM-DD format."""
    return bool(re.match(r'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$', date_str))


def validate_month(month_str):
    """Validate YYYY-MM format."""
    return bool(re.match(r'^\d{4}-(0[1-9]|1[0-2])$', month_str))


def validate_email(email):
    """Basic email format validation."""
    return bool(re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email))


def sanitize_string(value, max_length=500):
    """Strip, truncate, and HTML-escape a string input to prevent XSS."""
    if not isinstance(value, str):
        return ''
    cleaned = value.strip()[:max_length]
    # Escape HTML entities to prevent stored XSS
    cleaned = html.escape(cleaned, quote=True)
    return cleaned


def sanitize_html(value, max_length=5000):
    """
    Allow limited safe HTML tags (for rich-text fields like announcements).
    Falls back to plain escape if bleach is not installed.
    """
    if not isinstance(value, str):
        return ''
    value = value.strip()[:max_length]
    try:
        import bleach
        allowed_tags = ['b', 'i', 'u', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li']
        return bleach.clean(value, tags=allowed_tags, strip=True)
    except ImportError:
        return html.escape(value, quote=True)


def clamp_int(value, default, min_val=0, max_val=500):
    """Safely parse and clamp an integer query parameter."""
    try:
        val = int(value)
        return max(min_val, min(val, max_val))
    except (TypeError, ValueError):
        return default


def validate_json_payload():
    """Ensure the request has a valid JSON body. Returns (data, error_response)."""
    if not request.is_json:
        return None, (jsonify({'error': 'Content-Type must be application/json.'}), 400)
    data = request.get_json(silent=True)
    if data is None:
        return None, (jsonify({'error': 'Invalid JSON payload.'}), 400)
    return data, None


# ── Security Headers Middleware ─────────────────────────────────

def add_security_headers(response):
    """Add security headers to every response to mitigate common web attacks."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Content-Security-Policy'] = "default-src 'self'; frame-ancestors 'none'"
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


# ── Audit Logging Helper ────────────────────────────────────────

def log_activity(action, description, module='system', user_id=None):
    """
    Create an activity log entry.
    If user_id is None, tries to get it from the current JWT.
    """
    if user_id is None:
        try:
            user_id = int(get_jwt_identity())
        except Exception:
            user_id = None

    # Sanitize description to prevent log injection
    safe_desc = description.replace('\n', ' ').replace('\r', ' ')[:500]

    log = ActivityLog(
        user_id=user_id,
        action=action,
        description=safe_desc,
        module=module,
        ip_address=request.remote_addr or ''
    )
    db.session.add(log)
    # Caller is responsible for committing (often batched with other writes)


# ── Notification Helper ────────────────────────────────────────

def notify(user_id, title, body='', category='general', link=''):
    """
    Queue an in-app notification for a single user. The caller is responsible
    for committing the session (usually alongside the action that triggered it).
    """
    if not user_id:
        return None
    n = Notification(
        user_id=int(user_id),
        title=title[:200],
        body=(body or '')[:500],
        category=category,
        link=link or '',
    )
    db.session.add(n)
    return n


def notify_roles(roles, title, body='', category='general', link='', exclude_user_id=None):
    """
    Queue an in-app notification for every active user matching the given roles.
    Useful for "all HR" or "all admins" broadcasts (e.g. new leave request).
    """
    if isinstance(roles, str):
        roles = [roles]
    users = User.query.filter(User.role.in_(roles), User.status == 'active').all()
    for u in users:
        if exclude_user_id and u.id == int(exclude_user_id):
            continue
        notify(u.id, title, body, category, link)
