"""
Input Validation Utilities for DivineBridge
Provides validation schemas and functions for API endpoints
"""

import re
import logging
from functools import wraps
from flask import request, jsonify

logger = logging.getLogger(__name__)

# Validation schemas
SCHEMAS = {
    'prayer_request': {
        'content': {
            'type': str,
            'required': True,
            'min_length': 10,
            'max_length': 2000
        },
        'is_anonymous': {
            'type': bool,
            'required': False,
        },
    },
    'email': {
        'email': {
            'type': str,
            'required': True,
            'pattern': r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
            'max_length': 255
        }
    },
    'signup': {
        'email': {
            'type': str,
            'required': True,
            'pattern': r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
            'max_length': 255
        },
        'password': {
            'type': str,
            'required': True,
            'min_length': 8,
            'max_length': 128
        },
        'firstName': {
            'type': str,
            'required': True,
            'min_length': 1,
            'max_length': 50,
            'pattern': r'^[a-zA-Z\s\'-]+$'
        },
        'lastName': {
            'type': str,
            'required': True,
            'min_length': 1,
            'max_length': 50,
            'pattern': r'^[a-zA-Z\s\'-]+$'
        }
    },
    'chat_message': {
        'message': {
            'type': str,
            'required': True,
            'min_length': 1,
            'max_length': 1000,
            'pattern': r'^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*$'  # No control characters except \t, \n, \r
        }
    },
    'location': {
        'latitude': {
            'type': (int, float),
            'required': True,
            'min': -90,
            'max': 90
        },
        'longitude': {
            'type': (int, float),
            'required': True,
            'min': -180,
            'max': 180
        },
        'city': {
            'type': str,
            'required': False,
            'max_length': 100
        },
        'country': {
            'type': str,
            'required': False,
            'max_length': 100
        }
    }
}


def validate_field(value, rules):
    """Validate a single field against its rules"""
    # Check required
    if rules.get('required') and not value:
        return False, "This field is required"
    
    if not value and not rules.get('required'):
        return True, None
    
    # Check type
    expected_type = rules.get('type')
    if expected_type and not isinstance(value, expected_type):
        return False, f"Must be of type {expected_type.__name__}"
    
    # String validations
    if isinstance(value, str):
        # Check min length
        if 'min_length' in rules and len(value) < rules['min_length']:
            return False, f"Must be at least {rules['min_length']} characters"
        
        # Check max length
        if 'max_length' in rules and len(value) > rules['max_length']:
            return False, f"Must be at most {rules['max_length']} characters"
        
        # Check pattern
        if 'pattern' in rules and not re.match(rules['pattern'], value):
            return False, "Invalid format"
    
    # Numeric validations
    if isinstance(value, (int, float)):
        # Check min
        if 'min' in rules and value < rules['min']:
            return False, f"Must be at least {rules['min']}"
        
        # Check max
        if 'max' in rules and value > rules['max']:
            return False, f"Must be at most {rules['max']}"
    
    return True, None


def validate_data(data, schema_name):
    """
    Validate data against a schema
    
    Args:
        data: Dictionary of data to validate
        schema_name: Name of schema in SCHEMAS
    
    Returns:
        tuple: (is_valid, errors_dict)
    """
    if schema_name not in SCHEMAS:
        logger.error(f"Unknown schema: {schema_name}")
        return False, {"error": "Internal validation error"}
    
    schema = SCHEMAS[schema_name]
    errors = {}
    
    for field_name, rules in schema.items():
        value = data.get(field_name)
        is_valid, error_message = validate_field(value, rules)
        
        if not is_valid:
            errors[field_name] = error_message
    
    return len(errors) == 0, errors


def validate_request(schema_name):
    """
    Decorator to validate request data against a schema
    
    Usage:
        @prayer_bp.route('/request', methods=['POST'])
        @validate_request('prayer_request')
        def submit_prayer():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            data = request.get_json()
            
            if not data:
                return jsonify({'error': 'No data provided'}), 400
            
            is_valid, errors = validate_data(data, schema_name)
            
            if not is_valid:
                logger.warning(f"Validation failed for {schema_name}: {errors}")
                return jsonify({'error': 'Validation failed', 'details': errors}), 400
            
            return f(*args, **kwargs)
        
        return decorated_function
    return decorator


def sanitize_string(text, max_length=None):
    """
    Sanitize string input
    - Remove leading/trailing whitespace
    - Limit length
    - Remove null bytes
    """
    if not isinstance(text, str):
        return text
    
    # Remove null bytes
    text = text.replace('\x00', '')
    
    # Strip whitespace
    text = text.strip()
    
    # Limit length
    if max_length and len(text) > max_length:
        text = text[:max_length]
    
    return text


def validate_email(email):
    """Validate email format"""
    if not email or not isinstance(email, str):
        return False
    
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


def validate_password_strength(password):
    """
    Validate password strength
    
    Requirements:
    - At least 8 characters
    - Contains uppercase and lowercase
    - Contains at least one number
    - Contains at least one special character
    """
    if not password or len(password) < 8:
        return False, "Password must be at least 8 characters"
    
    if len(password) > 128:
        return False, "Password must be at most 128 characters"
    
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
    
    if not re.search(r'[0-9]', password):
        return False, "Password must contain at least one number"
    
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special character"
    
    return True, None

