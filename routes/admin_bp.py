"""
Admin Blueprint - Passcode Protected AI Assistant
Interactive chat interface for admin to post tasks and receive email summaries
"""
from flask import Blueprint, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
import hashlib
import os
import logging
from datetime import datetime, timedelta
from google.cloud import logging as cloud_logging
from google.cloud import firestore
import json
import time

admin_bp = Blueprint('admin', __name__)
logger = logging.getLogger(__name__)

def verify_passcode(passcode):
    """Verify admin passcode against stored hash"""
    # Get passcode hash from environment variable
    # Set ADMIN_PASSCODE_HASH in Cloud Run environment variables
    # To generate: python -c "import hashlib; print(hashlib.sha256('your_passcode'.encode()).hexdigest())"
    admin_passcode_hash = os.getenv('ADMIN_PASSCODE_HASH')
    
    if not admin_passcode_hash:
        # Default hash for "divinebridge2024" - CHANGE THIS IN PRODUCTION!
        # To set your own passcode hash in Cloud Run:
        # gcloud run services update divinebridge --region=us-central1 \
        #   --set-env-vars ADMIN_PASSCODE_HASH=$(python -c "import hashlib; print(hashlib.sha256('your_passcode'.encode()).hexdigest())")
        logger.warning("ADMIN_PASSCODE_HASH not set in environment, using default (INSECURE!)")
        default_hash = "a8f5f167f44f4964e6c998dee827110c0d6e6d4e96c2b8c7b8a3c9e8f7a6b5c4d"
        admin_passcode_hash = default_hash
    
    # Hash the provided passcode
    passcode_hash = hashlib.sha256(passcode.encode()).hexdigest()
    
    # Constant-time comparison to prevent timing attacks
    return passcode_hash == admin_passcode_hash

def admin_required(f):
    """Decorator to require admin passcode authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('admin_authenticated'):
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

@admin_bp.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    """Admin login page with passcode"""
    if request.method == 'POST':
        passcode = request.form.get('passcode', '')
        
        if verify_passcode(passcode):
            session['admin_authenticated'] = True
            session.permanent = True
            return redirect(url_for('admin.ai_assistant'))
        else:
            return render_template('admin_login.html', error='Invalid passcode')
    
    return render_template('admin_login.html')

@admin_bp.route('/admin/logout', methods=['POST'])
def admin_logout():
    """Admin logout"""
    session.pop('admin_authenticated', None)
    return jsonify({'success': True})

@admin_bp.route('/admin/ai-assistant')
def ai_assistant():
    """Main AI assistant chat interface"""
    if not session.get('admin_authenticated'):
        return redirect(url_for('admin.admin_login'))
    
    return render_template('admin_ai_assistant.html')

@admin_bp.route('/admin/api/task-list/<task_list_id>', methods=['GET'])
@admin_required
def get_task_list(task_list_id):
    """Retrieve a specific task list by ID"""
    try:
        db = get_firestore_client()
        task_list_doc = db.collection('daily_task_lists').document(task_list_id).get()
        
        if not task_list_doc.exists:
            return jsonify({'error': 'Task list not found'}), 404
        
        task_list_data = task_list_doc.to_dict()
        return jsonify({
            'success': True,
            'task_list': task_list_data
        })
        
    except Exception as e:
        logger.error(f"Error retrieving task list: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/admin/api/task-lists', methods=['GET'])
@admin_required
def list_task_lists():
    """List all daily task lists"""
    try:
        db = get_firestore_client()
        limit = request.args.get('limit', 10, type=int)
        
        task_lists = db.collection('daily_task_lists')\
            .order_by('generated_at', direction=firestore.Query.DESCENDING)\
            .limit(limit)\
            .stream()
        
        lists = []
        for doc in task_lists:
            data = doc.to_dict()
            lists.append({
                'id': doc.id,
                'date': data.get('date'),
                'generated_at': data.get('generated_at').isoformat() if data.get('generated_at') else None,
                'tasks_count': len(data.get('task_list', [])),
                'admin_tasks_count': data.get('admin_tasks_count', 0),
                'errors_count': data.get('errors_count', 0),
                'warnings_count': data.get('warnings_count', 0)
            })
        
        return jsonify({
            'success': True,
            'task_lists': lists
        })
        
    except Exception as e:
        logger.error(f"Error listing task lists: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/admin/api/message', methods=['POST'])
@admin_required
def process_message():
    """Add admin message to queue for automated processing"""
    try:
        data = request.get_json()
        user_message = data.get('message', '').strip()
        
        if not user_message:
            return jsonify({'error': 'Message cannot be empty'}), 400
        
        logger.info(f"Admin message received: {user_message[:100]}...")
        
        # Add message to Firestore queue
        db = get_firestore_client()
        task_ref = db.collection('admin_tasks').document()
        
        task_data = {
            'message': user_message,
            'status': 'pending',
            'created_at': datetime.utcnow(),
            'created_by': session.get('admin_authenticated', True),
            'attempts': 0,
            'error': None,
            'fixes_applied': [],
            'deployment_status': None,
            'summary': None
        }
        
        task_ref.set(task_data)
        task_id = task_ref.id
        
        logger.info(f"Task {task_id} added to queue")
        
        return jsonify({
            'success': True,
            'message': 'Task added to queue. AI will process it automatically within 5 minutes.',
            'task_id': task_id,
            'status': 'pending'
        })
        
    except Exception as e:
        logger.error(f"Error adding task to queue: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def get_firestore_client():
    """Get Firestore client instance"""
    from firebase_auth import get_firestore_client as _get_firestore_client
    return _get_firestore_client()

@admin_bp.route('/admin/api/generate-daily-report', methods=['POST'])
def generate_daily_report():
    """
    Generate daily task list from admin tasks and production errors
    Called by Cloud Scheduler daily at 5pm
    Creates combined task list and sends email
    """
    from auth_decorators import verify_cloud_scheduler
    
    # Verify Cloud Scheduler request
    user_agent = request.headers.get('User-Agent', '')
    auth_header = request.headers.get('Authorization', '')
    
    # Allow local testing
    if request.remote_addr not in ['127.0.0.1', 'localhost'] and \
       'Google-Cloud-Scheduler' not in user_agent and \
       not auth_header.startswith('Bearer '):
        logger.warning(f"Unauthorized Cloud Scheduler access attempt from {request.remote_addr}")
        return jsonify({'error': 'Forbidden'}), 403
    
    try:
        db = get_firestore_client()
        
        # Step 1: Get all pending admin tasks
        pending_tasks = db.collection('admin_tasks')\
            .where('status', '==', 'pending')\
            .order_by('created_at')\
            .stream()
        
        admin_tasks_list = []
        for task_doc in pending_tasks:
            task_data = task_doc.to_dict()
            admin_tasks_list.append({
                'id': task_doc.id,
                'message': task_data.get('message', ''),
                'created_at': task_data.get('created_at'),
            })
        
        # Step 2: Fetch recent production errors (last 24 hours)
        logs_summary = fetch_recent_logs(hours=24)
        analysis = analyze_logs(logs_summary)
        
        # Step 3: Create combined task list
        task_list = create_combined_task_list(admin_tasks_list, logs_summary, analysis)
        
        # Step 4: Save task list to Firestore
        task_list_ref = db.collection('daily_task_lists').document()
        task_list_data = {
            'date': datetime.utcnow().date().isoformat(),
            'generated_at': datetime.utcnow(),
            'task_list': task_list,
            'admin_tasks_count': len(admin_tasks_list),
            'errors_count': analysis.get('total_errors', 0),
            'warnings_count': analysis.get('total_warnings', 0),
        }
        task_list_ref.set(task_list_data)
        task_list_id = task_list_ref.id
        
        # Step 5: Mark admin tasks as reviewed
        for task in admin_tasks_list:
            db.collection('admin_tasks').document(task['id']).update({
                'status': 'reviewed',
                'reviewed_at': datetime.utcnow(),
                'task_list_id': task_list_id
            })
        
        # Step 6: Create and send email
        email_summary = create_daily_report_email(task_list, admin_tasks_list, analysis, logs_summary)
        email_sent = send_daily_report_email(email_summary)
        
        logger.info(f"Daily report generated: {task_list_id}, {len(task_list)} tasks, email sent: {email_sent}")
        
        return jsonify({
            'success': True,
            'task_list_id': task_list_id,
            'tasks_count': len(task_list),
            'admin_tasks_count': len(admin_tasks_list),
            'errors_count': analysis.get('total_errors', 0),
            'email_sent': email_sent
        })
        
    except Exception as e:
        logger.error(f"Error generating daily report: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def create_combined_task_list(admin_tasks_list, logs_summary, analysis):
    """
    Create a combined task list from admin tasks and production errors
    """
    task_list = []
    
    # Add admin tasks
    for task in admin_tasks_list:
        task_list.append({
            'type': 'admin_task',
            'priority': 'high',
            'description': task['message'],
            'source': 'Admin',
            'created_at': task['created_at'].isoformat() if task.get('created_at') else None,
            'task_id': task['id']
        })
    
    # Add error-based tasks
    errors = analysis.get('errors', [])
    for error in errors[:20]:  # Limit to 20 most recent errors
        error_msg = error.get('message', '')[:200]
        
        # Categorize error — order matters: more specific patterns first
        lower_msg = error_msg.lower()
        category = 'general'
        if any(kw in lower_msg for kw in ['firestore', 'database', 'query', 'index']):
            category = 'database'
        elif any(kw in lower_msg for kw in ['auth', 'login', 'token', 'session', 'credential']):
            category = 'authentication'
        elif any(kw in lower_msg for kw in ['audio', 'webrtc', 'peer', 'mediasoup', 'sfu']):
            category = 'audio'
        elif any(kw in lower_msg for kw in ['scheduler', 'cron', 'job']):
            category = 'scheduler'
        elif any(kw in lower_msg for kw in ['connectionpool', 'urlopen', 'requests.adapters']):
            category = 'network'
        
        task_list.append({
            'type': 'error',
            'priority': 'high' if category != 'general' else 'medium',
            'description': f"Fix {category} error: {error_msg}",
            'source': 'Production Error',
            'category': category,
            'error_details': {
                'timestamp': error.get('timestamp'),
                'severity': error.get('severity', 'ERROR'),
                'full_message': error.get('message', '')
            }
        })
    
    # Add warning-based tasks (lower priority)
    warnings = analysis.get('warnings', [])
    for warning in warnings[:10]:  # Limit to 10 most recent warnings
        warning_msg = warning.get('message', '')
        # Filter out None, empty, or invalid warning messages
        if not warning_msg or warning_msg == 'None' or warning_msg.lower() == 'none' or len(warning_msg.strip()) == 0:
            continue
        
        warning_msg = warning_msg[:200]
        task_list.append({
            'type': 'warning',
            'priority': 'low',
            'description': f"Review warning: {warning_msg}",
            'source': 'Production Warning',
            'warning_details': {
                'timestamp': warning.get('timestamp'),
                'full_message': warning.get('message', '')
            }
        })
    
    # Add pattern-based tasks
    patterns = analysis.get('patterns', {})
    for pattern, count in patterns.items():
        if count > 5:  # Only if pattern occurs frequently
            task_list.append({
                'type': 'pattern',
                'priority': 'medium',
                'description': f"Investigate {pattern.replace('_', ' ')} pattern ({count} occurrences)",
                'source': 'Log Analysis',
                'pattern': pattern,
                'occurrences': count
            })
    
    return task_list

def create_daily_report_email(task_list, admin_tasks_list, analysis, logs_summary):
    """Create email summary for daily task list"""
    date_str = datetime.utcnow().strftime('%Y-%m-%d')
    
    # Group tasks by priority
    high_priority = [t for t in task_list if t.get('priority') == 'high']
    medium_priority = [t for t in task_list if t.get('priority') == 'medium']
    low_priority = [t for t in task_list if t.get('priority') == 'low']
    
    summary_html = f"""
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
            .content {{ padding: 20px; background: #f9f9f9; }}
            .section {{ margin: 20px 0; padding: 15px; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
            .task-item {{ padding: 10px; margin: 8px 0; border-left: 4px solid #667eea; background: #f5f5f5; }}
            .task-item.high {{ border-left-color: #d32f2f; }}
            .task-item.medium {{ border-left-color: #f57c00; }}
            .task-item.low {{ border-left-color: #388e3c; }}
            .task-type {{ font-size: 12px; color: #666; text-transform: uppercase; }}
            .task-description {{ font-weight: 500; margin: 5px 0; }}
            .task-source {{ font-size: 12px; color: #999; }}
            .summary-stats {{ display: flex; gap: 20px; margin: 20px 0; }}
            .stat-box {{ flex: 1; padding: 15px; background: white; border-radius: 8px; text-align: center; }}
            .stat-number {{ font-size: 32px; font-weight: bold; color: #667eea; }}
            .stat-label {{ font-size: 14px; color: #666; margin-top: 5px; }}
            ul {{ margin: 10px 0; padding-left: 20px; }}
            li {{ margin: 5px 0; }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📋 Daily Task List - {date_str}</h1>
            <p>Generated at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
        </div>
        
        <div class="content">
            <div class="summary-stats">
                <div class="stat-box">
                    <div class="stat-number">{len(task_list)}</div>
                    <div class="stat-label">Total Tasks</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">{len(admin_tasks_list)}</div>
                    <div class="stat-label">Admin Tasks</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">{analysis.get('total_errors', 0)}</div>
                    <div class="stat-label">Errors</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">{analysis.get('total_warnings', 0)}</div>
                    <div class="stat-label">Warnings</div>
                </div>
            </div>
    """
    
    # High Priority Tasks
    if high_priority:
        summary_html += """
            <div class="section">
                <h2>🔴 High Priority Tasks</h2>
        """
        for task in high_priority:
            summary_html += f"""
                <div class="task-item high">
                    <div class="task-type">{task.get('type', 'task')}</div>
                    <div class="task-description">{task.get('description', '')}</div>
                    <div class="task-source">Source: {task.get('source', 'Unknown')}</div>
                </div>
            """
        summary_html += "</div>"
    
    # Medium Priority Tasks
    if medium_priority:
        summary_html += """
            <div class="section">
                <h2>🟡 Medium Priority Tasks</h2>
        """
        for task in medium_priority:
            summary_html += f"""
                <div class="task-item medium">
                    <div class="task-type">{task.get('type', 'task')}</div>
                    <div class="task-description">{task.get('description', '')}</div>
                    <div class="task-source">Source: {task.get('source', 'Unknown')}</div>
                </div>
            """
        summary_html += "</div>"
    
    # Low Priority Tasks
    if low_priority:
        summary_html += """
            <div class="section">
                <h2>🟢 Low Priority Tasks</h2>
        """
        for task in low_priority:
            summary_html += f"""
                <div class="task-item low">
                    <div class="task-type">{task.get('type', 'task')}</div>
                    <div class="task-description">{task.get('description', '')}</div>
                    <div class="task-source">Source: {task.get('source', 'Unknown')}</div>
                </div>
            """
        summary_html += "</div>"
    
    summary_html += """
        </div>
    </body>
    </html>
    """
    
    return {
        'html': summary_html,
        'text': f"""
Daily Task List - {date_str}
============================

Total Tasks: {len(task_list)}
Admin Tasks: {len(admin_tasks_list)}
Errors: {analysis.get('total_errors', 0)}
Warnings: {analysis.get('total_warnings', 0)}

High Priority ({len(high_priority)}):
{chr(10).join([f"- {t.get('description', '')}" for t in high_priority[:10]])}

Medium Priority ({len(medium_priority)}):
{chr(10).join([f"- {t.get('description', '')}" for t in medium_priority[:10]])}

Low Priority ({len(low_priority)}):
{chr(10).join([f"- {t.get('description', '')}" for t in low_priority[:10]])}
        """
    }

def send_daily_report_email(email_summary):
    """Send daily report email to admin"""
    try:
        from config import get_config
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.utils import formataddr
        import smtplib
        import json
        
        logger.info("Initializing email configuration for daily report...")
        config = get_config()
        
        # Get email credentials from config (lowercase attributes)
        email_user = config.email_user
        email_password = config.email_password
        
        # Parse if JSON string
        if isinstance(email_user, str):
            try:
                email_user = json.loads(email_user)
            except json.JSONDecodeError:
                pass
        
        if isinstance(email_password, str):
            try:
                email_password = json.loads(email_password)
            except json.JSONDecodeError:
                pass
        
        if not email_user or not email_password:
            logger.error("Email credentials not configured - email_user or email_password is missing")
            return False
        
        smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
        smtp_port = int(os.getenv('SMTP_PORT', '587'))
        
        logger.info(f"Sending email to jeancalmere.kubwayo@divinebridge.io from {email_user}")
        
        msg = MIMEMultipart('alternative')
        msg['From'] = formataddr(("Divine Bridge AI Assistant", email_user))
        msg['To'] = 'jeancalmere.kubwayo@divinebridge.io'
        msg['Subject'] = f'Daily Task List - {datetime.utcnow().strftime("%Y-%m-%d")}'
        
        msg.attach(MIMEText(email_summary['text'], 'plain'))
        msg.attach(MIMEText(email_summary['html'], 'html'))
        
        logger.info(f"Connecting to SMTP server: {smtp_server}:{smtp_port}")
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            logger.info("SMTP TLS started, logging in...")
            server.login(email_user, email_password)
            logger.info("SMTP login successful, sending message...")
            server.send_message(msg)
            logger.info("Email message sent successfully")
        
        logger.info("Daily report email sent successfully to jeancalmere.kubwayo@divinebridge.io")
        return True
        
    except Exception as e:
        logger.error(f"Error sending daily report email: {str(e)}", exc_info=True)
        logger.error(f"Error type: {type(e).__name__}")
        if hasattr(e, 'args'):
            logger.error(f"Error args: {e.args}")
        return False

def fetch_recent_logs(hours=1):
    """Fetch logs from Cloud Logging for the specified time range with retry logic"""
    max_retries = 3
    retry_delay = 2
    
    for attempt in range(max_retries):
        try:
            # Initialize Cloud Logging client with retry
            client = cloud_logging.Client()
            
            # Calculate time range
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(hours=hours)
            
            # Format timestamps for Cloud Logging filter
            start_str = start_time.strftime('%Y-%m-%dT%H:%M:%SZ')
            end_str = end_time.strftime('%Y-%m-%dT%H:%M:%SZ')
            
            # Filter for errors and warnings
            filter_str = f'timestamp >= "{start_str}" AND timestamp <= "{end_str}" AND (severity >= "ERROR" OR severity = "WARNING")'
            
            logger.info(f"Fetching logs from {start_time} to {end_time} (attempt {attempt + 1}/{max_retries})")
            
            entries = []
            try:
                for entry in client.list_entries(filter_=filter_str, page_size=100, order_by="timestamp desc"):
                    # Extract text payload with better error handling
                    text_payload = None
                    try:
                        if isinstance(entry.payload, str):
                            text_payload = entry.payload
                        elif isinstance(entry.payload, dict):
                            # Try common fields
                            text_payload = entry.payload.get('message') or \
                                          entry.payload.get('textPayload') or \
                                          entry.payload.get('jsonPayload', {}).get('message') or \
                                          str(entry.payload)
                        elif hasattr(entry.payload, 'get'):
                            text_payload = entry.payload.get('message', str(entry.payload))
                        else:
                            text_payload = str(entry.payload)
                    except Exception as e:
                        logger.warning(f"Error extracting payload: {e}")
                        text_payload = str(entry.payload)[:500]
                    
                    entry_data = {
                        'timestamp': entry.timestamp.isoformat() if entry.timestamp else None,
                        'severity': str(entry.severity),
                        'resource': entry.resource.type if entry.resource else None,
                        'text': text_payload[:1000] if text_payload else 'No message available',
                        'labels': dict(entry.labels) if entry.labels else {}
                    }
                    entries.append(entry_data)
            except Exception as e:
                logger.warning(f"Error fetching error/warning logs (attempt {attempt + 1}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (attempt + 1))
                    continue
                else:
                    raise
            
            # Also get recent INFO logs for context
            info_filter = f'timestamp >= "{start_str}" AND timestamp <= "{end_str}" AND severity = "INFO"'
            
            info_entries = []
            try:
                for entry in client.list_entries(filter_=info_filter, page_size=50, order_by="timestamp desc"):
                    text_payload = None
                    try:
                        if isinstance(entry.payload, str):
                            text_payload = entry.payload
                        elif isinstance(entry.payload, dict):
                            text_payload = entry.payload.get('message') or \
                                          entry.payload.get('textPayload') or \
                                          str(entry.payload)
                        else:
                            text_payload = str(entry.payload)
                    except:
                        text_payload = str(entry.payload)[:500]
                    
                    # Filter for important INFO messages
                    text_lower = text_payload.lower() if text_payload else ''
                    if any(keyword in text_lower for keyword in ['deploy', 'firebase', 'auth', 'error', 'critical', 'scheduler']):
                        entry_data = {
                            'timestamp': entry.timestamp.isoformat() if entry.timestamp else None,
                            'severity': str(entry.severity),
                            'text': text_payload[:1000] if text_payload else '',
                        }
                        info_entries.append(entry_data)
            except Exception as e:
                logger.warning(f"Error fetching info logs: {e}")
            
            return {
                'entries': entries,
                'info_entries': info_entries,
                'time_range': {
                    'start': start_time.isoformat(),
                    'end': end_time.isoformat()
                }
            }
            
        except Exception as e:
            logger.error(f"Error fetching logs from Cloud Logging (attempt {attempt + 1}/{max_retries}): {e}", exc_info=True)
            if attempt < max_retries - 1:
                logger.info(f"Retrying in {retry_delay * (attempt + 1)} seconds...")
                time.sleep(retry_delay * (attempt + 1))
            else:
                logger.error("All retry attempts failed for Cloud Logging")
                return {
                    'entries': [],
                    'info_entries': [],
                    'error': str(e)
                }
    
    # Should not reach here, but just in case
    return {
        'entries': [],
        'info_entries': [],
        'error': 'Failed after all retries'
    }

def analyze_logs(logs_summary):
    """Analyze logs for errors, patterns, and issues"""
    errors = []
    warnings = []
    patterns = {}
    
    for entry in logs_summary.get('entries', []):
        # Extract text payload properly
        text_raw = entry.get('text', '')
        if not text_raw:
            # Try to get from labels or other fields
            text_raw = entry.get('labels', {}).get('message', '') or str(entry)
        
        text = text_raw.lower() if text_raw else ''
        severity = str(entry.get('severity', '')).upper()
        
        # Extract a meaningful message
        message = text_raw[:500] if text_raw else 'No message available'
        
        if severity == 'ERROR':
            errors.append({
                'timestamp': entry.get('timestamp'),
                'message': message,
                'resource': entry.get('resource'),
                'severity': severity
            })
        elif severity == 'WARNING':
            # Only add warnings with actual messages
            if message and message != 'none' and len(message.strip()) > 0:
                warnings.append({
                    'timestamp': entry.get('timestamp'),
                    'message': message,
                    'severity': severity
                })
        
        # Detect patterns (only if we have text)
        if text:
            if 'authentication' in text or 'auth' in text:
                patterns['authentication_issues'] = patterns.get('authentication_issues', 0) + 1
            if 'webrtc' in text or 'audio' in text:
                patterns['audio_issues'] = patterns.get('audio_issues', 0) + 1
            if 'scheduler' in text:
                patterns['scheduler_issues'] = patterns.get('scheduler_issues', 0) + 1
            if 'firestore' in text or 'database' in text:
                patterns['database_issues'] = patterns.get('database_issues', 0) + 1
    
    return {
        'errors': errors,
        'warnings': warnings,
        'patterns': patterns,
        'total_errors': len(errors),
        'total_warnings': len(warnings)
    }

def create_summary(user_message, logs_summary, analysis):
    """Create comprehensive summary for email"""
    summary_html = f"""
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
            .content {{ padding: 20px; background: #f9f9f9; }}
            .section {{ margin: 20px 0; padding: 15px; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
            .error {{ color: #d32f2f; font-weight: bold; }}
            .warning {{ color: #f57c00; }}
            .success {{ color: #388e3c; }}
            .code {{ background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; overflow-x: auto; }}
            .timestamp {{ color: #666; font-size: 12px; }}
            ul {{ margin: 10px 0; padding-left: 20px; }}
            li {{ margin: 5px 0; }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🤖 AI Assistant Task Summary</h1>
            <p>Task processed at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
        </div>
        
        <div class="content">
            <div class="section">
                <h2>📝 Your Task</h2>
                <p>{user_message}</p>
            </div>
            
            <div class="section">
                <h2>📊 System Status (Last Hour)</h2>
                <p><strong>Total Log Entries:</strong> {len(logs_summary.get('entries', []))}</p>
                <p><strong>Errors Found:</strong> <span class="error">{analysis.get('total_errors', 0)}</span></p>
                <p><strong>Warnings Found:</strong> <span class="warning">{analysis.get('total_warnings', 0)}</span></p>
            </div>
    """
    
    # Add error details
    if analysis.get('errors'):
        summary_html += """
            <div class="section">
                <h2>❌ Errors Detected</h2>
                <ul>
        """
        for error in analysis['errors'][:10]:  # Limit to 10 most recent
            summary_html += f"""
                    <li>
                        <span class="timestamp">{error.get('timestamp', 'N/A')}</span><br>
                        <span class="error">{error.get('message', '')[:300]}</span>
                    </li>
            """
        summary_html += """
                </ul>
            </div>
        """
    
    # Add warning details
    if analysis.get('warnings'):
        summary_html += """
            <div class="section">
                <h2>⚠️ Warnings Detected</h2>
                <ul>
        """
        for warning in analysis['warnings'][:10]:
            summary_html += f"""
                    <li>
                        <span class="timestamp">{warning.get('timestamp', 'N/A')}</span><br>
                        <span class="warning">{warning.get('message', '')[:300]}</span>
                    </li>
            """
        summary_html += """
                </ul>
            </div>
        """
    
    # Add patterns
    if analysis.get('patterns'):
        summary_html += """
            <div class="section">
                <h2>🔍 Detected Patterns</h2>
                <ul>
        """
        for pattern, count in analysis['patterns'].items():
            summary_html += f"""
                    <li><strong>{pattern.replace('_', ' ').title()}:</strong> {count} occurrences</li>
            """
        summary_html += """
                </ul>
            </div>
        """
    
    # Add recent INFO logs
    if logs_summary.get('info_entries'):
        summary_html += """
            <div class="section">
                <h2>ℹ️ Recent Activity</h2>
                <ul>
        """
        for entry in logs_summary['info_entries'][:5]:
            summary_html += f"""
                    <li>
                        <span class="timestamp">{entry.get('timestamp', 'N/A')}</span><br>
                        {entry.get('text', '')[:200]}
                    </li>
            """
        summary_html += """
                </ul>
            </div>
        """
    
    summary_html += """
            <div class="section">
                <h2>📌 Next Steps</h2>
                <p>Review the errors and warnings above. If any critical issues were detected, immediate action may be required.</p>
                <p>You can access the admin panel at: <a href="https://divinebridge-853408757178.us-central1.run.app/admin/ai-assistant">Admin AI Assistant</a></p>
            </div>
        </div>
    </body>
    </html>
    """
    
    return {
        'html': summary_html,
        'text': f"""
AI Assistant Task Summary
========================

Task: {user_message}

System Status (Last Hour):
- Total Log Entries: {len(logs_summary.get('entries', []))}
- Errors: {analysis.get('total_errors', 0)}
- Warnings: {analysis.get('total_warnings', 0)}

Errors:
{chr(10).join([f"- {e.get('message', '')[:200]}" for e in analysis.get('errors', [])[:5]])}

Patterns Detected:
{chr(10).join([f"- {k}: {v}" for k, v in analysis.get('patterns', {}).items()])}
        """
    }

def send_admin_email(summary):
    """Send email summary to admin"""
    try:
        from email_sender import EmailSender
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.utils import formataddr
        import smtplib
        
        sender = EmailSender()
        
        msg = MIMEMultipart('alternative')
        msg['From'] = formataddr(("Divine Bridge AI Assistant", sender.sender_email))
        msg['To'] = 'jeancalmere.kubwayo@divinebridge.io'
        msg['Subject'] = f'AI Assistant Summary - {datetime.utcnow().strftime("%Y-%m-%d %H:%M")}'
        
        msg.attach(MIMEText(summary['text'], 'plain'))
        msg.attach(MIMEText(summary['html'], 'html'))
        
        with smtplib.SMTP(sender.smtp_server, sender.smtp_port) as server:
            server.starttls()
            server.login(sender.sender_email, sender.sender_password)
            server.send_message(msg)
        
        logger.info("Admin email sent successfully")
        return True
        
    except Exception as e:
        logger.error(f"Error sending admin email: {e}", exc_info=True)
        return False

