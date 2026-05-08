"""
Letter routes — HR generates offer, experience, and appointment letters as PDFs.
HR can issue letters; employees can view/download their own; admin has full access.
"""
import os
import json
import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, send_file, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from flask_mail import Message
from models import db, User, Letter, PayrollConfig
from middleware import require_roles, validate_date, sanitize_string, log_activity, notify

letters_bp = Blueprint('letters', __name__, url_prefix='/api/letters')

# Directory to store generated PDFs
LETTERS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'generated_letters')


def _ensure_letters_dir():
    os.makedirs(LETTERS_DIR, exist_ok=True)


# ─── LETTER TEMPLATES ─────────────────────────────────────────

LETTER_TEMPLATES = {
    'offer': {
        'title': 'Offer Letter',
        'fields': ['employee_name', 'position', 'department', 'salary', 'joining_date'],
    },
    'experience': {
        'title': 'Experience Letter',
        'fields': ['employee_name', 'position', 'department', 'joining_date', 'last_working_date', 'duration'],
    },
    'appointment': {
        'title': 'Appointment Letter',
        'fields': ['employee_name', 'position', 'department', 'salary', 'joining_date', 'reporting_manager'],
    },
    'relieving': {
        'title': 'Relieving Letter',
        'fields': ['employee_name', 'position', 'department', 'joining_date', 'last_working_date', 'resignation_date'],
    },
}


def _generate_pdf(letter, employee):
    """Generate a professional PDF letter using reportlab's platypus (structured layout)."""
    _ensure_letters_dir()

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import inch, cm
        from reportlab.lib.colors import HexColor
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
            HRFlowable, KeepTogether,
        )
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY, TA_RIGHT
    except ImportError:
        return None, 'reportlab is not installed. Run: pip install reportlab'

    data = json.loads(letter.content_json)
    filename = f"{letter.letter_type}_{employee.id}_{uuid.uuid4().hex[:8]}.pdf"
    filepath = os.path.join(LETTERS_DIR, filename)

    doc = SimpleDocTemplate(
        filepath, pagesize=A4,
        topMargin=2.5 * cm, bottomMargin=2 * cm,
        leftMargin=2.2 * cm, rightMargin=2.2 * cm,
        title=letter.title,
    )

    styles = getSampleStyleSheet()

    # Every custom style declares explicit leading (line-height) and
    # spaceBefore/spaceAfter so paragraph spacing is deterministic and
    # lines cannot overlap regardless of content length.
    company_style = ParagraphStyle(
        'Company', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=22, leading=28,
        textColor=HexColor('#1a237e'),
        alignment=TA_CENTER, spaceBefore=0, spaceAfter=6,
    )
    tagline_style = ParagraphStyle(
        'Tagline', parent=styles['Normal'],
        fontName='Helvetica', fontSize=10, leading=14,
        textColor=HexColor('#666666'),
        alignment=TA_CENTER, spaceAfter=16,
    )
    title_style = ParagraphStyle(
        'LetterTitle', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=16, leading=22,
        textColor=HexColor('#1a237e'),
        alignment=TA_CENTER, spaceBefore=6, spaceAfter=18,
    )
    date_style = ParagraphStyle(
        'LetterDate', parent=styles['Normal'],
        fontName='Helvetica', fontSize=11, leading=15,
        alignment=TA_RIGHT, spaceBefore=4, spaceAfter=18,
    )
    body_style = ParagraphStyle(
        'LetterBody', parent=styles['Normal'],
        fontName='Helvetica', fontSize=11, leading=17,
        alignment=TA_JUSTIFY,
        spaceBefore=0, spaceAfter=12,
    )
    salutation_style = ParagraphStyle(
        'Salutation', parent=body_style,
        alignment=TA_LEFT, spaceAfter=10,
    )
    bold_style = ParagraphStyle(
        'BoldBody', parent=body_style,
        fontName='Helvetica-Bold', alignment=TA_LEFT, spaceAfter=8,
    )
    signature_style = ParagraphStyle(
        'Signature', parent=body_style,
        alignment=TA_LEFT, spaceAfter=4,
    )
    footer_style = ParagraphStyle(
        'Footer', parent=styles['Normal'],
        fontName='Helvetica', fontSize=8, leading=11,
        textColor=HexColor('#999999'), alignment=TA_CENTER,
    )

    elements = []

    # Company Header — every piece is a platypus flowable so nothing is
    # absolutely positioned; spacing is driven by leading + spaceBefore/After.
    elements.append(Paragraph('Aaryak Solution', company_style))
    elements.append(Paragraph('Corporate Employee Management System', tagline_style))
    elements.append(HRFlowable(
        width="100%", thickness=2, color=HexColor('#1a237e'),
        spaceBefore=4, spaceAfter=24,
    ))
    # Guaranteed gap between the header band and anything that follows,
    # so the body can never visually collide with the header rule.
    elements.append(Spacer(1, 12))

    # Date
    elements.append(Paragraph(f"Date: {letter.issued_date}", date_style))

    emp_name = data.get('employee_name', employee.name)
    position = data.get('position', employee.position)
    department = data.get('department', employee.department)
    salary = data.get('salary', '')
    joining_date = data.get('joining_date', employee.hire_date)

    if letter.letter_type == 'offer':
        elements.append(Paragraph('OFFER LETTER', title_style))
        elements.append(Paragraph(f"Dear <b>{emp_name}</b>,", salutation_style))
        elements.append(Paragraph(
            f"We are pleased to offer you the position of <b>{position}</b> in the "
            f"<b>{department}</b> department at <b>Aaryak Solution</b>.", body_style))
        elements.append(Paragraph(
            f"Your proposed date of joining is <b>{joining_date}</b>. "
            f"Your annual compensation package will be <b>INR {salary}</b> "
            f"(inclusive of all allowances and before applicable deductions).", body_style))
        elements.append(Paragraph(
            "This offer is contingent upon successful completion of background verification "
            "and submission of all required documents. Please confirm your acceptance within "
            "7 business days of receiving this letter.", body_style))
        elements.append(Paragraph(
            "We look forward to welcoming you to the team and are excited about the "
            "contributions you will bring to our organization.", body_style))

    elif letter.letter_type == 'experience':
        last_working = data.get('last_working_date', '')
        duration = data.get('duration', '')
        elements.append(Paragraph('EXPERIENCE LETTER', title_style))
        elements.append(Paragraph("To Whom It May Concern,", salutation_style))
        elements.append(Paragraph(
            f"This is to certify that <b>{emp_name}</b> was employed with "
            f"<b>Aaryak Solution</b> as a <b>{position}</b> in the "
            f"<b>{department}</b> department from <b>{joining_date}</b> to "
            f"<b>{last_working}</b>, a period of <b>{duration}</b>.", body_style))
        elements.append(Paragraph(
            f"During their tenure, {emp_name} demonstrated excellent professional skills, "
            "a strong work ethic, and a collaborative attitude. They consistently met "
            "performance expectations and contributed positively to team objectives.", body_style))
        elements.append(Paragraph(
            f"We wish {emp_name} all the best in their future endeavors.", body_style))

    elif letter.letter_type == 'appointment':
        reporting_manager = data.get('reporting_manager', '')
        elements.append(Paragraph('APPOINTMENT LETTER', title_style))
        elements.append(Paragraph(f"Dear <b>{emp_name}</b>,", salutation_style))
        elements.append(Paragraph(
            f"With reference to your application and subsequent discussions, we are pleased "
            f"to appoint you as <b>{position}</b> in the <b>{department}</b> department "
            f"at <b>Aaryak Solution</b>, effective <b>{joining_date}</b>.", body_style))

        # Salary table
        if salary:
            elements.append(Paragraph("Compensation Details:", bold_style))
            salary_table = Table([
                ['Component', 'Amount (Monthly)'],
                ['Gross Salary', f'INR {salary}'],
            ], colWidths=[3 * inch, 3 * inch])
            salary_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#1a237e')),
                ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#cccccc')),
                ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (-1, -1), 8),
                ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ]))
            elements.append(salary_table)
            elements.append(Spacer(1, 14))

        if reporting_manager:
            elements.append(Paragraph(
                f"You will be reporting to <b>{reporting_manager}</b>.", body_style))
        elements.append(Paragraph(
            "Your appointment is subject to the terms and conditions outlined in the "
            "company's employee handbook. You are expected to maintain confidentiality "
            "regarding all proprietary information during and after your employment.", body_style))

    elif letter.letter_type == 'relieving':
        resignation_date = data.get('resignation_date', '')
        last_working = data.get('last_working_date', '')
        elements.append(Paragraph('RELIEVING LETTER', title_style))
        elements.append(Paragraph(f"Dear <b>{emp_name}</b>,", salutation_style))
        elements.append(Paragraph(
            f"This is to inform you that your resignation dated <b>{resignation_date}</b> "
            f"has been accepted, and you are hereby relieved from your duties as "
            f"<b>{position}</b> in the <b>{department}</b> department at "
            f"<b>Aaryak Solution</b>, effective <b>{last_working}</b>.", body_style))
        elements.append(Paragraph(
            f"During your tenure from <b>{joining_date}</b> to <b>{last_working}</b>, "
            "your contributions to the organization have been valued. We confirm that "
            "you have completed all handover formalities and returned all company assets "
            "in your possession.", body_style))
        elements.append(Paragraph(
            "We confirm that there are no dues pending from your end as on the date of "
            "your relieving. You are free to pursue your career elsewhere.", body_style))
        elements.append(Paragraph(
            f"We wish {emp_name} all the best in their future endeavors and thank them "
            "for their service to the organization.", body_style))

    # Signature block — wrap in KeepTogether so the signatory lines never
    # get orphaned from "Yours sincerely," across a page break.
    elements.append(Spacer(1, 36))
    elements.append(KeepTogether([
        Paragraph("Yours sincerely,", signature_style),
        Spacer(1, 40),
        Paragraph("<b>Authorized Signatory</b>", signature_style),
        Paragraph("Aaryak Solution", signature_style),
        Paragraph("Human Resources Department", signature_style),
    ]))

    # Footer
    elements.append(Spacer(1, 28))
    elements.append(HRFlowable(
        width="100%", thickness=0.5, color=HexColor('#cccccc'), spaceAfter=6,
    ))
    elements.append(Paragraph(
        f"Document ID: LTR-{letter.id:06d} | Generated on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} | "
        "This is a computer-generated document.", footer_style))

    doc.build(elements)
    return filepath, None


# ─── GET LETTER TEMPLATES INFO ─────────────────────────────────

@letters_bp.route('/templates', methods=['GET'])
@jwt_required()
@require_roles('admin', 'hr')
def get_templates():
    """Get available letter templates and their required fields."""
    return jsonify(LETTER_TEMPLATES), 200


# ─── CREATE / ISSUE A LETTER (HR & Admin) ─────────────────────

@letters_bp.route('/', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr')
def create_letter():
    """HR/Admin creates and issues a letter for an employee."""
    data = request.get_json()
    user_id = data.get('user_id')
    letter_type = data.get('letter_type', '').strip().lower()
    custom_data = data.get('letter_data', {})
    issued_date = data.get('issued_date', datetime.now(timezone.utc).strftime('%Y-%m-%d'))

    if not user_id:
        return jsonify({'error': 'Employee user_id is required.'}), 400

    if letter_type not in Letter.VALID_TYPES:
        return jsonify({'error': f'Invalid letter type. Must be one of: {", ".join(Letter.VALID_TYPES)}'}), 400

    if issued_date and not validate_date(issued_date):
        return jsonify({'error': 'issued_date must be in YYYY-MM-DD format.'}), 400

    employee = User.query.get(int(user_id))
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404

    # Auto-fill data from employee profile if not provided
    template_info = LETTER_TEMPLATES[letter_type]
    letter_data = {}
    letter_data['employee_name'] = sanitize_string(custom_data.get('employee_name', employee.name), 200)
    letter_data['position'] = sanitize_string(custom_data.get('position', employee.position), 200)
    letter_data['department'] = sanitize_string(custom_data.get('department', employee.department), 200)
    letter_data['joining_date'] = custom_data.get('joining_date', employee.hire_date)

    # Type-specific fields
    if letter_type in ('offer', 'appointment'):
        # Try to get salary from payroll config
        if 'salary' not in custom_data or not custom_data['salary']:
            config = PayrollConfig.query.filter_by(user_id=employee.id).first()
            if config:
                gross = config.basic_salary + config.hra + config.da + config.ta
                letter_data['salary'] = f"{gross:,.2f}"
            else:
                letter_data['salary'] = custom_data.get('salary', 'As discussed')
        else:
            letter_data['salary'] = sanitize_string(str(custom_data['salary']), 50)

    if letter_type == 'appointment':
        letter_data['reporting_manager'] = sanitize_string(custom_data.get('reporting_manager', ''), 200)

    if letter_type in ('experience', 'relieving'):
        letter_data['last_working_date'] = custom_data.get('last_working_date', '')
        letter_data['duration'] = sanitize_string(custom_data.get('duration', ''), 100)

    if letter_type == 'relieving':
        letter_data['resignation_date'] = custom_data.get('resignation_date', '')

    title = f"{template_info['title']} - {employee.name}"

    letter = Letter(
        user_id=employee.id,
        letter_type=letter_type,
        title=title,
        content_json=json.dumps(letter_data),
        issued_by=int(get_jwt_identity()),
        status='issued',
        issued_date=issued_date,
    )
    db.session.add(letter)
    db.session.flush()  # Get ID before PDF generation

    # Generate PDF
    filepath, error = _generate_pdf(letter, employee)
    if error:
        db.session.rollback()
        return jsonify({'error': f'PDF generation failed: {error}'}), 500

    letter.file_path = filepath

    log_activity(
        action='ISSUE_LETTER',
        description=f'Issued {letter_type} letter for {employee.name}',
        module='hr'
    )

    letter_link = f'/{employee.role}/letters' if employee.role in ('employee', 'manager', 'hr') else '/employee/letters'
    notify(
        user_id=employee.id,
        title=f'New {template_info["title"]} issued',
        body=f'HR issued your {template_info["title"].lower()} ({issued_date}). Open the Letters page to view or download.',
        category='general',
        link=letter_link,
    )

    db.session.commit()

    return jsonify({'message': f'{template_info["title"]} issued for {employee.name}.', 'letter': letter.to_dict()}), 201


# ─── LIST LETTERS ─────────────────────────────────────────────

@letters_bp.route('/', methods=['GET'])
@jwt_required()
def list_letters():
    """Admin/HR see all letters; employees see only their own."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())
    role = claims.get('role')

    letter_type = request.args.get('type', '')
    employee_id = request.args.get('employee_id', '')

    if role in ('admin', 'hr'):
        query = Letter.query
        if employee_id:
            query = query.filter_by(user_id=int(employee_id))
    else:
        # Employees and managers can only see their own letters
        query = Letter.query.filter_by(user_id=user_id)

    if letter_type and letter_type in Letter.VALID_TYPES:
        query = query.filter_by(letter_type=letter_type)

    letters = query.order_by(Letter.created_at.desc()).all()
    return jsonify([l.to_dict() for l in letters]), 200


# ─── GET SINGLE LETTER ────────────────────────────────────────

@letters_bp.route('/<int:letter_id>', methods=['GET'])
@jwt_required()
def get_letter(letter_id):
    """Get letter details. Employees can only view their own."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())

    letter = Letter.query.get(letter_id)
    if not letter:
        return jsonify({'error': 'Letter not found.'}), 404

    if claims.get('role') not in ('admin', 'hr') and letter.user_id != user_id:
        return jsonify({'error': 'Permission denied.'}), 403

    return jsonify(letter.to_dict()), 200


# ─── DOWNLOAD LETTER PDF ──────────────────────────────────────

@letters_bp.route('/<int:letter_id>/download', methods=['GET'])
@jwt_required()
def download_letter(letter_id):
    """Download letter PDF. Employees can only download their own."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())

    letter = Letter.query.get(letter_id)
    if not letter:
        return jsonify({'error': 'Letter not found.'}), 404

    # Authorization: employees can only download their own letters
    if claims.get('role') not in ('admin', 'hr') and letter.user_id != user_id:
        return jsonify({'error': 'Permission denied.'}), 403

    if not letter.file_path or not os.path.exists(letter.file_path):
        # Try to regenerate
        employee = User.query.get(letter.user_id)
        filepath, error = _generate_pdf(letter, employee)
        if error:
            return jsonify({'error': f'PDF not available: {error}'}), 500
        letter.file_path = filepath
        db.session.commit()

    log_activity(
        action='DOWNLOAD_LETTER',
        description=f'Downloaded {letter.letter_type} letter #{letter.id}',
        module='hr'
    )
    db.session.commit()

    download_name = f"{letter.letter_type}_letter_{letter.employee.name.replace(' ', '_')}_{letter.issued_date}.pdf"
    return send_file(letter.file_path, as_attachment=True, download_name=download_name, mimetype='application/pdf')


# ─── EMAIL LETTER PDF TO EMPLOYEE (HR/Admin) ──────────────────

LETTER_EMAIL_SUBJECTS = {
    'offer': 'Your Offer Letter from Aaryak Solution',
    'experience': 'Your Experience Letter from Aaryak Solution',
    'appointment': 'Your Appointment Letter from Aaryak Solution',
    'relieving': 'Your Relieving Letter from Aaryak Solution',
}


def _letter_email_body(letter, employee):
    type_label = LETTER_TEMPLATES.get(letter.letter_type, {}).get('title', 'Letter')
    plain = (
        f"Dear {employee.name},\n\n"
        f"Please find attached your {type_label.lower()} issued on {letter.issued_date}.\n\n"
        "If you have any questions, reach out to the Human Resources department.\n\n"
        "Regards,\n"
        "Human Resources\n"
        "Aaryak Solution"
    )
    html = f"""
    <!DOCTYPE html>
    <html>
      <body style="font-family: 'Segoe UI', Arial, sans-serif; background:#f1f5f9; margin:0; padding:20px;">
        <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;
                    box-shadow:0 4px 6px rgba(0,0,0,0.07);overflow:hidden;">
          <div style="background:linear-gradient(135deg,#1a237e,#3949ab);color:#fff;
                      padding:28px 24px;text-align:center;">
            <h1 style="margin:0;font-size:22px;letter-spacing:1px;">AARYAK SOLUTION</h1>
            <p style="margin:4px 0 0;font-size:12px;opacity:0.85;letter-spacing:2px;">HUMAN RESOURCES</p>
          </div>
          <div style="padding:28px 24px;color:#334155;font-size:14px;line-height:1.6;">
            <p>Dear <strong>{employee.name}</strong>,</p>
            <p>Please find attached your <strong>{type_label}</strong> issued on
               <strong>{letter.issued_date}</strong>.</p>
            <p>If you have any questions regarding this document, please contact the
               Human Resources department.</p>
            <p style="margin-top:24px;">Regards,<br/>Human Resources<br/>Aaryak Solution</p>
          </div>
          <div style="background:#f8fafc;padding:14px 24px;text-align:center;
                      border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;">
            &copy; 2026 Aaryak Solution. This is an automated message.
          </div>
        </div>
      </body>
    </html>
    """
    return plain, html


@letters_bp.route('/<int:letter_id>/email', methods=['POST'])
@jwt_required()
@require_roles('admin', 'hr')
def email_letter(letter_id):
    """Email the generated letter PDF to the employee's registered address."""
    letter = Letter.query.get(letter_id)
    if not letter:
        return jsonify({'error': 'Letter not found.'}), 404

    if letter.status == 'revoked':
        return jsonify({'error': 'Cannot email a revoked letter.'}), 400

    employee = User.query.get(letter.user_id)
    if not employee:
        return jsonify({'error': 'Employee not found.'}), 404
    if not employee.email:
        return jsonify({'error': 'Employee does not have an email address on file.'}), 400

    # Ensure a PDF exists on disk; regenerate if missing.
    if not letter.file_path or not os.path.exists(letter.file_path):
        filepath, error = _generate_pdf(letter, employee)
        if error:
            return jsonify({'error': f'PDF not available: {error}'}), 500
        letter.file_path = filepath
        db.session.commit()

    # SMTP must be configured (Gmail App Password).
    if not current_app.config.get('MAIL_USERNAME') or not current_app.config.get('MAIL_PASSWORD'):
        return jsonify({'error': 'Email service is not configured. Please set MAIL_USERNAME / MAIL_PASSWORD.'}), 503

    # Read the PDF bytes for attachment.
    try:
        with open(letter.file_path, 'rb') as f:
            pdf_bytes = f.read()
    except OSError as e:
        return jsonify({'error': f'Failed to read letter PDF: {e}'}), 500

    subject = LETTER_EMAIL_SUBJECTS.get(letter.letter_type, f'Your letter from Aaryak Solution')
    plain_body, html_body = _letter_email_body(letter, employee)
    attachment_name = f"{letter.letter_type}_letter_{employee.name.replace(' ', '_')}_{letter.issued_date}.pdf"

    try:
        from app import mail  # Flask-Mail instance initialized in app.py
        msg = Message(
            subject=subject,
            recipients=[employee.email],
            body=plain_body,
            html=html_body,
        )
        msg.attach(attachment_name, 'application/pdf', pdf_bytes)
        mail.send(msg)
    except Exception as e:
        current_app.logger.exception('Failed to email letter %s', letter.id)
        return jsonify({'error': f'Failed to send email: {e}'}), 500

    log_activity(
        action='EMAIL_LETTER',
        description=f'Emailed {letter.letter_type} letter #{letter.id} to {employee.email}',
        module='hr',
    )

    letter_link = f'/{employee.role}/letters' if employee.role in ('employee', 'manager', 'hr') else '/employee/letters'
    notify(
        user_id=employee.id,
        title='Letter emailed',
        body=f'A copy of your {letter.letter_type} letter was sent to {employee.email}.',
        category='general',
        link=letter_link,
    )

    db.session.commit()

    return jsonify({
        'message': f'Letter emailed to {employee.email}.',
        'email': employee.email,
    }), 200


# ─── REVOKE LETTER (HR/Admin) ─────────────────────────────────

@letters_bp.route('/<int:letter_id>/revoke', methods=['PUT'])
@jwt_required()
@require_roles('admin', 'hr')
def revoke_letter(letter_id):
    """Revoke an issued letter."""
    letter = Letter.query.get(letter_id)
    if not letter:
        return jsonify({'error': 'Letter not found.'}), 404

    if letter.status == 'revoked':
        return jsonify({'error': 'Letter is already revoked.'}), 400

    letter.status = 'revoked'

    log_activity(
        action='REVOKE_LETTER',
        description=f'Revoked {letter.letter_type} letter #{letter.id} for user #{letter.user_id}',
        module='hr'
    )

    employee = letter.employee
    if employee:
        letter_link = f'/{employee.role}/letters' if employee.role in ('employee', 'manager', 'hr') else '/employee/letters'
        notify(
            user_id=letter.user_id,
            title=f'{letter.letter_type.title()} letter revoked',
            body='HR has revoked one of your previously issued letters.',
            category='general',
            link=letter_link,
        )

    db.session.commit()

    return jsonify({'message': 'Letter revoked.', 'letter': letter.to_dict()}), 200


# ─── LETTER HISTORY FOR AN EMPLOYEE ───────────────────────────

@letters_bp.route('/history/<int:employee_id>', methods=['GET'])
@jwt_required()
def letter_history(employee_id):
    """Get all letters issued to an employee. HR/Admin see all; employee sees own."""
    claims = get_jwt()
    user_id = int(get_jwt_identity())

    if claims.get('role') not in ('admin', 'hr') and employee_id != user_id:
        return jsonify({'error': 'Permission denied.'}), 403

    letters = Letter.query.filter_by(user_id=employee_id).order_by(Letter.created_at.desc()).all()
    return jsonify([l.to_dict() for l in letters]), 200
