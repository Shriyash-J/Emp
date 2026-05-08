import os
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_mail import Mail
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import Config
from models import db

# Initialize extensions
jwt = JWTManager()
mail = Mail()
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per minute"],
    storage_uri="memory://"
)


def create_app():
    app = Flask(__name__)
    app.url_map.strict_slashes = False
    app.config.from_object(Config)

    # Initialize extensions
    db.init_app(app)
    jwt.init_app(app)
    mail.init_app(app)
    limiter.init_app(app)

    # CORS — restrict to known frontend origins
    allowed_origins = os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://localhost:3000').split(',')
    CORS(app, resources={r"/api/*": {
        "origins": [o.strip() for o in allowed_origins],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": True
    }})

    # JWT error handlers
    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        return jsonify({'error': 'Token has expired.', 'code': 'token_expired'}), 401

    @jwt.invalid_token_loader
    def invalid_token_callback(error):
        return jsonify({'error': 'Invalid token.', 'code': 'invalid_token'}), 401

    @jwt.unauthorized_loader
    def missing_token_callback(error):
        return jsonify({'error': 'Authorization token required.', 'code': 'missing_token'}), 401

    # Security headers on every response
    from middleware import add_security_headers
    app.after_request(add_security_headers)

    # Register blueprints
    from routes_auth import auth_bp, init_mail
    from routes_employees import emp_bp
    from routes_activity import activity_bp
    from routes_attendance import attendance_bp
    from routes_leaves import leaves_bp
    from routes_tasks import tasks_bp
    from routes_announcements import announcements_bp
    from routes_chat import chat_bp
    from routes_payroll import payroll_bp
    from routes_letters import letters_bp
    from routes_recruitment import recruitment_bp
    from routes_performance import performance_bp
    from routes_exit import exit_bp
    from routes_teams import teams_bp
    from routes_admin import admin_bp
    from routes_face_attendance import face_attendance_bp
    from routes_analytics import analytics_bp
    from routes_messaging import messaging_bp
    from routes_notifications import notifications_bp

    init_mail(mail)

# Register blueprints with the /api prefix to match your frontend baseURL
    app.register_blueprint(auth_bp, url_prefix='/api')
    app.register_blueprint(emp_bp, url_prefix='/api')
    app.register_blueprint(activity_bp, url_prefix='/api')
    app.register_blueprint(attendance_bp, url_prefix='/api')
    app.register_blueprint(leaves_bp, url_prefix='/api')
    app.register_blueprint(tasks_bp, url_prefix='/api')
    app.register_blueprint(announcements_bp, url_prefix='/api')
    app.register_blueprint(chat_bp, url_prefix='/api')
    app.register_blueprint(payroll_bp, url_prefix='/api')
    app.register_blueprint(letters_bp, url_prefix='/api')
    app.register_blueprint(recruitment_bp, url_prefix='/api')
    app.register_blueprint(performance_bp, url_prefix='/api')
    app.register_blueprint(exit_bp, url_prefix='/api')
    app.register_blueprint(teams_bp, url_prefix='/api')
    app.register_blueprint(admin_bp, url_prefix='/api')
    app.register_blueprint(face_attendance_bp, url_prefix='/api')
    app.register_blueprint(analytics_bp, url_prefix='/api')
    app.register_blueprint(messaging_bp, url_prefix='/api')
    app.register_blueprint(notifications_bp, url_prefix='/api')

    # Rate limits for sensitive auth endpoints (applied per-route in routes_auth.py)
    # Blueprint-level limit removed — too aggressive with CORS preflight requests

    # Health check
    @app.route('/api/health', methods=['GET'])
    def health():
        return jsonify({
            'status': 'ok',
            'server': 'Flask',
            'company': 'Aaryak Solution',
            'features': ['JWT Auth', 'OTP Email Verification', 'RBAC', 'Rate Limiting', 'Face Recognition Attendance']
        })

    # Create tables, migrate, and seed
    with app.app_context():
        db.create_all()
        # The PRAGMA-based migrations below are only meaningful for legacy
        # SQLite databases that predate newer columns. A fresh Postgres
        # (Supabase) database gets every column straight from db.create_all(),
        # so skip them to avoid dialect errors.
        if db.engine.dialect.name == 'sqlite':
            _migrate_attendance_columns()
            _migrate_announcement_columns()
            _migrate_payroll_columns()
            _migrate_payment_columns()
            _migrate_user_upi_column()
        from seed import seed_database
        seed_database()

    return app


def _migrate_attendance_columns():
    """Add new columns to attendance table if they don't exist (SQLite migration)."""
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(attendance)")
    existing = {row[1] for row in cursor.fetchall()}

    new_columns = [
        ('working_hours', 'FLOAT'),
        ('is_late', 'BOOLEAN DEFAULT 0'),
        ('is_half_day', 'BOOLEAN DEFAULT 0'),
        ('overtime_hours', 'FLOAT'),
    ]

    for col_name, col_type in new_columns:
        if col_name not in existing:
            cursor.execute(f'ALTER TABLE attendance ADD COLUMN {col_name} {col_type}')
            print(f'[MIGRATE] Added column attendance.{col_name}')

    conn.commit()
    conn.close()


def _migrate_announcement_columns():
    """Add target_audience column to announcements table if it doesn't exist."""
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(announcements)")
    existing = {row[1] for row in cursor.fetchall()}

    if 'target_audience' not in existing:
        cursor.execute("ALTER TABLE announcements ADD COLUMN target_audience VARCHAR(20) DEFAULT 'all'")
        print('[MIGRATE] Added column announcements.target_audience')

    conn.commit()
    conn.close()


def _migrate_payroll_columns():
    """Add bonus/deduction columns to payroll table if they don't exist."""
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(payroll)")
    existing = {row[1] for row in cursor.fetchall()}

    new_columns = [
        ('bonus', 'FLOAT DEFAULT 0'),
        ('bonus_reason', "VARCHAR(200) DEFAULT ''"),
        ('extra_deduction', 'FLOAT DEFAULT 0'),
        ('extra_deduction_reason', "VARCHAR(200) DEFAULT ''"),
        ('overtime_pay', 'FLOAT DEFAULT 0'),
        ('late_penalty', 'FLOAT DEFAULT 0'),
        ('final_salary', 'FLOAT DEFAULT 0'),
    ]

    for col_name, col_type in new_columns:
        if col_name not in existing:
            cursor.execute(f'ALTER TABLE payroll ADD COLUMN {col_name} {col_type}')
            print(f'[MIGRATE] Added column payroll.{col_name}')

    conn.commit()
    conn.close()


def _migrate_payment_columns():
    """Add payment-related columns to payroll table if they don't exist."""
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(payroll)")
    existing = {row[1] for row in cursor.fetchall()}

    new_columns = [
        ('payment_status', "VARCHAR(20) DEFAULT 'pending'"),
        ('payment_order_id', "VARCHAR(100) DEFAULT ''"),
        ('payment_id', "VARCHAR(100) DEFAULT ''"),
        ('paid_on', 'DATETIME'),
    ]

    for col_name, col_type in new_columns:
        if col_name not in existing:
            cursor.execute(f'ALTER TABLE payroll ADD COLUMN {col_name} {col_type}')
            print(f'[MIGRATE] Added column payroll.{col_name}')

    conn.commit()
    conn.close()


def _migrate_user_upi_column():
    """Add upi_id column to users table if it doesn't exist."""
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(users)")
    existing = {row[1] for row in cursor.fetchall()}

    if 'upi_id' not in existing:
        cursor.execute("ALTER TABLE users ADD COLUMN upi_id VARCHAR(100) DEFAULT ''")
        print('[MIGRATE] Added column users.upi_id')

    conn.commit()
    conn.close()


# 1. Create the app at the module level so Gunicorn can find it
# Create the app instance here so Gunicorn can find it
app = create_app()

if __name__ == '__main__':
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    # Use the PORT environment variable provided by Render
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
    
    print('\n========================================')
    print('  Aaryak Solution')
    print('  Flask Auth Server with JWT + OTP')
    print(f'  Debug: {debug_mode}')
    
    # Use the PORT environment variable for Render compatibility
    port = int(os.environ.get("PORT", 5000))
    print(f'  Running on http://0.0.0.0:{port}')
    print('========================================\n')
    
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
    print('========================================\n')
    app.run(host='0.0.0.0', port=5000, debug=debug_mode)
