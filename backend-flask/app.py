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

    # CORS — Standardized to split environment variables
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

    # Security headers
    from middleware import add_security_headers
    app.after_request(add_security_headers)

    # Register blueprints with centralized prefixes
    # NOTE: Ensure you remove url_prefix from individual Blueprint definitions in your route files
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

    # Registering all blueprints under the /api prefix
    app.register_blueprint(auth_bp)
    app.register_blueprint(emp_bp)
    app.register_blueprint(activity_bp)
    app.register_blueprint(attendance_bp)
    app.register_blueprint(leaves_bp)
    app.register_blueprint(tasks_bp)
    app.register_blueprint(announcements_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(payroll_bp)
    app.register_blueprint(letters_bp)
    app.register_blueprint(recruitment_bp)
    app.register_blueprint(performance_bp)
    app.register_blueprint(exit_bp)
    app.register_blueprint(teams_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(face_attendance_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(messaging_bp)
    app.register_blueprint(notifications_bp)

    # Health check
    @app.route('/api/health', methods=['GET'])
    def health():
        return jsonify({
            'status': 'ok',
            'server': 'Flask',
            'company': 'Aaryak Solution'
        })

    return app

# Migration Helpers
def _migrate_db():
    if db.engine.dialect.name == 'sqlite':
        _migrate_attendance_columns()
        _migrate_announcement_columns()
        _migrate_payroll_columns()
        _migrate_payment_columns()
        _migrate_user_upi_column()

def _migrate_attendance_columns():
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(attendance)")
    existing = {row[1] for row in cursor.fetchall()}
    new_columns = [('working_hours', 'FLOAT'), ('is_late', 'BOOLEAN DEFAULT 0'), 
                   ('is_half_day', 'BOOLEAN DEFAULT 0'), ('overtime_hours', 'FLOAT')]
    for col_name, col_type in new_columns:
        if col_name not in existing:
            cursor.execute(f'ALTER TABLE attendance ADD COLUMN {col_name} {col_type}')
    conn.commit()
    conn.close()

def _migrate_announcement_columns():
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(announcements)")
    existing = {row[1] for row in cursor.fetchall()}
    if 'target_audience' not in existing:
        cursor.execute("ALTER TABLE announcements ADD COLUMN target_audience VARCHAR(20) DEFAULT 'all'")
    conn.commit()
    conn.close()

def _migrate_payroll_columns():
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(payroll)")
    existing = {row[1] for row in cursor.fetchall()}
    new_columns = [('bonus', 'FLOAT DEFAULT 0'), ('bonus_reason', "VARCHAR(200) DEFAULT ''"),
                   ('extra_deduction', 'FLOAT DEFAULT 0'), ('extra_deduction_reason', "VARCHAR(200) DEFAULT ''"),
                   ('overtime_pay', 'FLOAT DEFAULT 0'), ('late_penalty', 'FLOAT DEFAULT 0'), ('final_salary', 'FLOAT DEFAULT 0')]
    for col_name, col_type in new_columns:
        if col_name not in existing:
            cursor.execute(f'ALTER TABLE payroll ADD COLUMN {col_name} {col_type}')
    conn.commit()
    conn.close()

def _migrate_payment_columns():
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(payroll)")
    existing = {row[1] for row in cursor.fetchall()}
    new_columns = [('payment_status', "VARCHAR(20) DEFAULT 'pending'"), ('payment_order_id', "VARCHAR(100) DEFAULT ''"),
                   ('payment_id', "VARCHAR(100) DEFAULT ''"), ('paid_on', 'DATETIME')]
    for col_name, col_type in new_columns:
        if col_name not in existing:
            cursor.execute(f'ALTER TABLE payroll ADD COLUMN {col_name} {col_type}')
    conn.commit()
    conn.close()

def _migrate_user_upi_column():
    conn = db.engine.raw_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(users)")
    existing = {row[1] for row in cursor.fetchall()}
    if 'upi_id' not in existing:
        cursor.execute("ALTER TABLE users ADD COLUMN upi_id VARCHAR(100) DEFAULT ''")
    conn.commit()
    conn.close()

# --- INITIALIZATION AT MODULE LEVEL ---
# This ensures it runs once when the master process starts
# 1. Create the app instance at the top level
app = create_app()

# 2. Database & Seeding logic
# On Vercel, this runs during the "Cold Start"
with app.app_context():
    try:
        db.create_all()
        _migrate_db()
        from seed import seed_database
        seed_database()
        print("[SUCCESS] Database initialized and seeded.")
    except Exception as e:
        print(f"[ERROR] Database init failed: {e}")

# 3. Vercel doesn't use the 'if __name__ == "__main__"' block for serving,
# but we keep it here so you can still run it locally!
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
