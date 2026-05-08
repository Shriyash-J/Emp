import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.getenv('SECRET_KEY')
    if not SECRET_KEY:
        import warnings
        warnings.warn('SECRET_KEY not set in .env — using insecure default. Set it before deploying.')
        SECRET_KEY = 'worknet_flask_super_secret_key_2024'

    # Database
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URI', 'postgresql://neondb_owner:npg_zIbBZQqtYi69@ep-orange-paper-an1e8wet-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require')
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # JWT
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
    if not JWT_SECRET_KEY:
        import warnings
        warnings.warn('JWT_SECRET_KEY not set in .env — using insecure default. Set it before deploying.')
        JWT_SECRET_KEY = 'worknet_jwt_secret_key_2024'
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(seconds=int(os.getenv('JWT_ACCESS_TOKEN_EXPIRES', 86400)))
    JWT_TOKEN_LOCATION = ['headers']
    JWT_HEADER_NAME = 'Authorization'
    JWT_HEADER_TYPE = 'Bearer'

    # Mail (Gmail SMTP)
    MAIL_SERVER = os.getenv('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT = int(os.getenv('MAIL_PORT', 587))
    MAIL_USE_TLS = os.getenv('MAIL_USE_TLS', 'True').lower() == 'true'
    MAIL_USERNAME = os.getenv('MAIL_USERNAME', '')
    MAIL_PASSWORD = os.getenv('MAIL_PASSWORD', '')
    MAIL_DEFAULT_SENDER = os.getenv('MAIL_DEFAULT_SENDER', '')

    # OTP
    OTP_EXPIRY_MINUTES = int(os.getenv('OTP_EXPIRY_MINUTES', 5))
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 280, # Resets connections before Render's 300s timeout
    }
