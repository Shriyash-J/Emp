import base64
import os
import boto3
from io import BytesIO
from PIL import Image
from models import db, FaceEncoding
from dotenv import load_dotenv

load_dotenv()

# Initialize AWS Rekognition Client
rekognition = boto3.client(
    'rekognition',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION')
)

# Matching threshold - AWS uses a 0-100 scale for similarity
FACE_MATCH_THRESHOLD = 85 

def get_image_bytes(base64_string):
    """Convert base64 string/URI to raw bytes for AWS Rekognition."""
    if ',' in base64_string:
        base64_string = base64_string.split(',', 1)[1]
    return base64.b64decode(base64_string)

def register_face(user_id, base64_image):
    """
    Register a face for an employee by storing the image bytes.
    Note: We store the image so we can compare it later via AWS.
    """
    try:
        existing = FaceEncoding.query.filter_by(user_id=user_id).first()
        if existing:
            return False, 'Face already registered. Contact admin to re-register.'

        image_bytes = get_image_bytes(base64_image)

        # Optional: Validate with AWS that a face actually exists before saving
        detect_response = rekognition.detect_faces(
            Image={'Bytes': image_bytes},
            Attributes=['DEFAULT']
        )
        
        if not detect_response['FaceDetails']:
            return False, 'No face detected in the image. Please try again.'

        # Create record. 
        # Note: We will use the 'encoding' field to store the image bytes/string
        face_record = FaceEncoding(user_id=user_id)
        
        # We are hijacking the 'set_encoding' method to store the base64 string
        # because AWS Rekognition needs the image, not the 128-d vector.
        face_record.set_encoding(base64_image) 
        
        db.session.add(face_record)
        db.session.commit()
        return True, 'Face registered successfully with AWS Rekognition.'
    
    except Exception as e:
        return False, f"Registration Error: {str(e)}"

def verify_face(user_id, base64_image):
    """
    Verify a captured face against the stored registration image using AWS.
    """
    try:
        stored = FaceEncoding.query.filter_by(user_id=user_id).first()
        if not stored:
            return False, 'No face registered. Please register your face first.'

        # Get raw bytes for both images
        source_bytes = get_image_bytes(stored.get_encoding()) # The registered image
        target_bytes = get_image_bytes(base64_image)         # The live capture

        # Call Amazon Rekognition
        response = rekognition.compare_faces(
            SourceImage={'Bytes': source_bytes},
            TargetImage={'Bytes': target_bytes},
            SimilarityThreshold=FACE_MATCH_THRESHOLD
        )

        if response['FaceMatches']:
            similarity = response['FaceMatches'][0]['Similarity']
            return True, f'Face verified successfully (Confidence: {similarity:.1f}%).'
        
        return False, 'Face does not match. Please ensure you are in a well-lit area.'

    except Exception as e:
        return False, f"AWS Verification Error: {str(e)}"

def re_register_face(user_id, base64_image):
    """Replace an existing face image."""
    existing = FaceEncoding.query.filter_by(user_id=user_id).first()
    
    image_bytes = get_image_bytes(base64_image)
    # Basic check
    detect = rekognition.detect_faces(Image={'Bytes': image_bytes})
    if not detect['FaceDetails']:
        return False, 'No face detected.'

    if existing:
        existing.set_encoding(base64_image)
    else:
        existing = FaceEncoding(user_id=user_id)
        existing.set_encoding(base64_image)
        db.session.add(existing)

    db.session.commit()
    return True, 'Face re-registered successfully.'