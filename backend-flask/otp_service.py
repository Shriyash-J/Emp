import os  # Added for environment variable check
import random
import string
from datetime import datetime, timedelta, timezone
from flask import current_app
from flask_mail import Message
from models import OTP, db

def generate_otp(length=6):
    """Generate a random numeric OTP."""
    return ''.join(random.choices(string.digits, k=length))

def create_otp(email, purpose='login'):
    """Create and store a new OTP for the given email."""
    OTP.query.filter_by(email=email, purpose=purpose, is_used=False).update({'is_used': True})
    db.session.commit()

    otp_code = generate_otp()
    expiry_minutes = current_app.config.get('OTP_EXPIRY_MINUTES', 5)

    otp_record = OTP(
        email=email,
        otp_code=otp_code,
        purpose=purpose,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes)
    )
    db.session.add(otp_record)
    db.session.commit()

    return otp_code

def verify_otp(email, otp_code, purpose='login'):
    """Verify the OTP for the given email."""
    otp_record = OTP.query.filter_by(
        email=email,
        purpose=purpose,
        is_used=False
    ).order_by(OTP.created_at.desc()).first()

    if not otp_record:
        return False, 'No OTP found. Please request a new one.'

    otp_record.attempts += 1
    db.session.commit()

    if otp_record.attempts >= 5:
        otp_record.is_used = True
        db.session.commit()
        return False, 'Too many failed attempts. Please request a new OTP.'

    if otp_record.is_expired():
        otp_record.is_used = True
        db.session.commit()
        return False, 'OTP has expired. Please request a new one.'

    if otp_record.otp_code != otp_code:
        remaining = 5 - otp_record.attempts
        return False, f'Invalid OTP. {remaining} attempts remaining.'

    otp_record.is_used = True
    db.session.commit()

    return True, 'OTP verified successfully.'

def send_otp_email(mail, email, otp_code, purpose='login'):
    """Send OTP via Gmail SMTP or Fallback to Console on Network Error."""
    
    # 1. Check if we should explicitly bypass the email sending
    bypass_otp = os.getenv('BYPASS_OTP', 'False').lower() == 'true'
    
    if bypass_otp:
        print("\n" + "="*50)
        print(f" [BYPASS MODE] OTP for {email}: {otp_code}")
        print("="*50 + "\n")
        return True, 'OTP generated (Bypass Mode).'

    purpose_text = {
        'login': 'Login Verification',
        'register': 'Account Registration',
        'reset': 'Password Reset',
    }.get(purpose, 'Verification')

    subject = f'WorkNet - {purpose_text} OTP'

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #f1f5f9; margin: 0; padding: 20px; }}
            .container {{ max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px;
                          box-shadow: 0 4px 6px rgba(0,0,0,0.07); overflow: hidden; }}
            .header {{ background: linear-gradient(135deg, #1e3a8a, #1e40af); color: white;
                       padding: 32px 24px; text-align: center; }}
            .header h1 {{ margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 1px; }}
            .header p {{ margin: 4px 0 0; font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 2px; }}
            .body {{ padding: 32px 24px; text-align: center; }}
            .body p {{ color: #64748b; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }}
            .otp-box {{ background: #f1f5f9; border: 2px dashed #3b82f6; border-radius: 12px;
                        padding: 20px; margin: 24px 0; }}
            .otp-code {{ font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1e40af;
                         font-family: 'Courier New', monospace; }}
            .purpose {{ display: inline-block; background: #dbeafe; color: #1e40af; padding: 4px 12px;
                        border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }}
            .warning {{ background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px;
                        margin: 20px 0; text-align: left; border-radius: 0 8px 8px 0; }}
            .warning p {{ color: #92400e; font-size: 12px; margin: 0; }}
            .footer {{ background: #f8fafc; padding: 16px 24px; text-align: center;
                       border-top: 1px solid #e2e8f0; }}
            .footer p {{ color: #94a3b8; font-size: 11px; margin: 0; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>WORKNET</h1>
                <p>by Aaryak Solution</p>
            </div>
            <div class="body">
                <span class="purpose">{purpose_text}</span>
                <p>Hello! You requested a one-time password for your WorkNet account.
                   Use the code below to complete your {purpose_text.lower()}.</p>
                <div class="otp-box">
                    <div class="otp-code">{otp_code}</div>
                </div>
                <p>This code is valid for <strong>5 minutes</strong>.</p>
                <div class="warning">
                    <p><strong>Security Notice:</strong> Never share this OTP with anyone.
                       WorkNet staff will never ask for your OTP.</p>
                </div>
            </div>
            <div class="footer">
                <p>&copy; 2026 Aaryak Solution. All rights reserved.</p>
                <p>This is an automated email. Please do not reply.</p>
            </div>
        </div>
    </body>
    </html>
    """

    plain_body = f"""
    Aaryak Solution — {purpose_text}
    Your OTP Code: {otp_code}
    This code is valid for 5 minutes.
    Do not share this code with anyone.
    © 2026 Aaryak Solution
    """

    try:
        msg = Message(
            subject=subject,
            recipients=[email],
            body=plain_body,
            html=html_body
        )
        mail.send(msg)
        return True, 'OTP sent successfully.'
    except Exception as e:
        # 2. EMERGENCY FALLBACK: Print to logs so you can still log in!
        print("\n" + "!"*50)
        print(f" [EMAIL FAILED] OTP for {email}: {otp_code}")
        print(f" ERROR: {str(e)}")
        print("!"*50 + "\n")
        
        # Return True so the frontend allows the user to try entering the code
        return True, 'Mail delivery failed, but OTP is available in logs.'
