import os
from datetime import timedelta
from dotenv import load_dotenv

# Load local .env file if it exists
load_dotenv()

class Config:
    # --- SECURITY ---
    SECRET_KEY = os.getenv('SECRET_KEY', 'worknet_flask_super_secret_key_2024')
    
    # --- DATABASE ---
    # Render uses 'DATABASE_URL' by default. We check both common keys.
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL') or os.getenv('DATABASE_URI', 
        'postgresql://neondb_owner:npg_zIbBZQqtYi69@ep-orange-paper-an1e8wet-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Critical fix for Neon/Render connection drops
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 280,
    }

    # --- JWT ---
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'worknet_jwt_secret_key_2024')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(seconds=int(os.getenv('JWT_ACCESS_TOKEN_EXPIRES', 86400)))
    JWT_TOKEN_LOCATION = ['headers']
    JWT_HEADER_NAME = 'Authorization'
    JWT_HEADER_TYPE = 'Bearer'

    # --- MAIL (Gmail SMTP) ---
    MAIL_SERVER = os.getenv('MAIL_SERVER', 'smtp.gmail.com')
    # Force integer type for Port
    MAIL_PORT = int(os.getenv('MAIL_PORT', 587))
    # Robust boolean conversion for TLS/SSL
    MAIL_USE_TLS = str(os.getenv('MAIL_USE_TLS', 'True')).lower() == 'true'
    MAIL_USE_SSL = str(os.getenv('MAIL_USE_SSL', 'False')).lower() == 'true'
    
    MAIL_USERNAME = os.getenv('MAIL_USERNAME', '')
    
    # CRITICAL FIX: Strip spaces from the App Password automatically
    # This handles the "woyr imyo irsf blix" format from your screenshot
    _raw_password = os.getenv('MAIL_PASSWORD', '')
    MAIL_PASSWORD = _raw_password.replace(' ', '') if _raw_password else ''
    
    MAIL_DEFAULT_SENDER = os.getenv('MAIL_DEFAULT_SENDER', MAIL_USERNAME)

    # --- OTP ---
    OTP_EXPIRY_MINUTES = int(os.getenv('OTP_EXPIRY_MINUTES', 5))
