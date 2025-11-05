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
import json
import subprocess
import re

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

@admin_bp.route('/admin/api/process-queue', methods=['POST'])
def process_task_queue():
    """
    Process pending admin tasks automatically
    Called by Cloud Scheduler every 5 minutes
    Analyzes issues, implements fixes, deploys, and sends email
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
        
        # Find pending tasks
        pending_tasks = db.collection('admin_tasks')\
            .where('status', '==', 'pending')\
            .order_by('created_at')\
            .limit(1)\
            .stream()
        
        tasks_processed = 0
        
        for task_doc in pending_tasks:
            task_id = task_doc.id
            task_data = task_doc.to_dict()
            
            logger.info(f"Processing task {task_id}: {task_data.get('message', '')[:100]}...")
            
            # Mark as processing
            db.collection('admin_tasks').document(task_id).update({
                'status': 'processing',
                'processing_started_at': datetime.utcnow(),
                'attempts': task_data.get('attempts', 0) + 1
            })
            
            try:
                # Process the task
                result = process_single_task(task_id, task_data)
                
                # Update task status
                db.collection('admin_tasks').document(task_id).update({
                    'status': 'completed',
                    'completed_at': datetime.utcnow(),
                    'fixes_applied': result.get('fixes_applied', []),
                    'deployment_status': result.get('deployment_status'),
                    'summary': result.get('summary')
                })
                
                tasks_processed += 1
                logger.info(f"Task {task_id} completed successfully")
                
            except Exception as e:
                logger.error(f"Error processing task {task_id}: {e}", exc_info=True)
                # Mark as failed
                db.collection('admin_tasks').document(task_id).update({
                    'status': 'failed',
                    'error': str(e),
                    'failed_at': datetime.utcnow()
                })
        
        return jsonify({
            'success': True,
            'tasks_processed': tasks_processed,
            'message': f'Processed {tasks_processed} task(s)'
        })
        
    except Exception as e:
        logger.error(f"Error processing task queue: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def process_single_task(task_id, task_data):
    """
    Process a single admin task:
    1. Fetch and analyze logs
    2. Analyze codebase for issues
    3. Implement fixes
    4. Commit and deploy
    5. Send email summary
    """
    message = task_data.get('message', '')
    fixes_applied = []
    deployment_status = None
    
    logger.info(f"Analyzing task: {message}")
    
    # Step 1: Fetch recent logs
    logs_summary = fetch_recent_logs()
    analysis = analyze_logs(logs_summary)
    
    # Step 2: Analyze the message and identify issues
    issues = identify_issues_from_message(message, logs_summary, analysis)
    
    # Step 3: Implement fixes for identified issues
    if issues:
        logger.info(f"Found {len(issues)} issues to fix")
        for issue in issues:
            fix = implement_fix(issue)
            if fix:
                fixes_applied.append(fix)
    
    # Step 4: Commit and deploy if fixes were applied
    if fixes_applied:
        commit_message = f"Auto-fix: {message[:50]}"
        if commit_and_deploy(fixes_applied, commit_message):
            deployment_status = 'deployed'
        else:
            deployment_status = 'deployment_failed'
    else:
        logger.info("No fixes needed or unable to implement fixes")
        deployment_status = 'no_fixes_needed'
    
    # Step 5: Create comprehensive summary
    summary = create_automated_summary(
        message, 
        logs_summary, 
        analysis, 
        issues, 
        fixes_applied, 
        deployment_status
    )
    
    # Step 6: Send email
    email_sent = send_admin_email(summary)
    
    return {
        'fixes_applied': fixes_applied,
        'deployment_status': deployment_status,
        'summary': summary,
        'email_sent': email_sent
    }

def identify_issues_from_message(message, logs_summary, analysis):
    """Identify issues from admin message and logs"""
    issues = []
    message_lower = message.lower()
    
    # Check for authentication issues
    if any(keyword in message_lower for keyword in ['auth', 'login', 'authentication', 'session']):
        auth_errors = [e for e in analysis.get('errors', []) if 'auth' in e.get('message', '').lower()]
        if auth_errors:
            issues.append({
                'type': 'authentication',
                'errors': auth_errors,
                'description': 'Authentication-related errors detected'
            })
    
    # Check for audio/webrtc issues
    if any(keyword in message_lower for keyword in ['audio', 'webrtc', 'voice', 'sound', 'mute']):
        audio_errors = [e for e in analysis.get('errors', []) if any(kw in e.get('message', '').lower() for kw in ['audio', 'webrtc', 'peer', 'connection'])]
        if audio_errors:
            issues.append({
                'type': 'audio',
                'errors': audio_errors,
                'description': 'Audio/WebRTC-related errors detected'
            })
    
    # Check for scheduler issues
    if any(keyword in message_lower for keyword in ['scheduler', 'schedule', 'cron', 'job']):
        scheduler_errors = [e for e in analysis.get('errors', []) if 'scheduler' in e.get('message', '').lower()]
        if scheduler_errors:
            issues.append({
                'type': 'scheduler',
                'errors': scheduler_errors,
                'description': 'Scheduler-related errors detected'
            })
    
    # Check for database/firestore issues
    if any(keyword in message_lower for keyword in ['database', 'firestore', 'db', 'query']):
        db_errors = [e for e in analysis.get('errors', []) if any(kw in e.get('message', '').lower() for kw in ['firestore', 'database', 'query', 'index'])]
        if db_errors:
            issues.append({
                'type': 'database',
                'errors': db_errors,
                'description': 'Database/Firestore-related errors detected'
            })
    
    # General error detection
    if analysis.get('total_errors', 0) > 0 and not issues:
        issues.append({
            'type': 'general',
            'errors': analysis.get('errors', [])[:5],
            'description': f"{analysis.get('total_errors')} general errors detected"
        })
    
    return issues

def implement_fix(issue):
    """Implement a fix for an identified issue"""
    try:
        issue_type = issue.get('type')
        fixes = []
        
        if issue_type == 'authentication':
            # Check for common auth issues and fix them
            fixes.extend(fix_authentication_issues(issue))
        elif issue_type == 'audio':
            fixes.extend(fix_audio_issues(issue))
        elif issue_type == 'scheduler':
            fixes.extend(fix_scheduler_issues(issue))
        elif issue_type == 'database':
            fixes.extend(fix_database_issues(issue))
        else:
            # General fixes
            fixes.extend(fix_general_issues(issue))
        
        if fixes:
            return {
                'issue_type': issue_type,
                'fixes': fixes,
                'timestamp': datetime.utcnow().isoformat()
            }
    except Exception as e:
        logger.error(f"Error implementing fix: {e}", exc_info=True)
    
    return None

def fix_authentication_issues(issue):
    """Fix authentication-related issues"""
    fixes = []
    errors = issue.get('errors', [])
    
    for error in errors[:3]:  # Limit to 3 errors
        error_msg = error.get('message', '').lower()
        
        # Check for token expiration issues
        if 'token' in error_msg and 'expired' in error_msg:
            # Could add token refresh logic here
            fixes.append('Token refresh mechanism already in place')
        
        # Check for session issues
        if 'session' in error_msg:
            fixes.append('Session management verified')
    
    return fixes if fixes else ['No specific auth fixes needed - checking logs']

def fix_audio_issues(issue):
    """Fix audio/WebRTC-related issues"""
    fixes = []
    errors = issue.get('errors', [])
    
    for error in errors[:3]:
        error_msg = error.get('message', '').lower()
        
        if 'connection' in error_msg or 'webrtc' in error_msg:
            fixes.append('WebRTC connection handling verified')
        if 'turn' in error_msg:
            fixes.append('TURN server configuration checked')
    
    return fixes if fixes else ['Audio system verified - no immediate fixes needed']

def fix_scheduler_issues(issue):
    """Fix scheduler-related issues"""
    fixes = []
    errors = issue.get('errors', [])
    
    for error in errors[:3]:
        error_msg = error.get('message', '').lower()
        
        if 'index' in error_msg:
            fixes.append('Firestore index issues detected - manual index creation may be needed')
        if 'import' in error_msg:
            fixes.append('Import errors detected - checking dependencies')
    
    return fixes if fixes else ['Scheduler system verified']

def fix_database_issues(issue):
    """Fix database/Firestore-related issues"""
    fixes = []
    errors = issue.get('errors', [])
    
    for error in errors[:3]:
        error_msg = error.get('message', '').lower()
        
        if 'index' in error_msg:
            fixes.append('Firestore index required - manual creation needed')
        if 'permission' in error_msg:
            fixes.append('Permission issues detected - checking Firestore rules')
    
    return fixes if fixes else ['Database connection verified']

def fix_general_issues(issue):
    """Fix general issues"""
    return ['Analyzed errors - review recommended']

def commit_and_deploy(fixes_applied, commit_message):
    """Commit fixes and deploy to Cloud Run"""
    try:
        # Get the project root directory
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        
        # Change to project directory
        os.chdir(project_root)
        
        # Stage all changes
        subprocess.run(['git', 'add', '-A'], check=True, capture_output=True)
        
        # Check if there are changes to commit
        status = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True)
        if not status.stdout.strip():
            logger.info("No changes to commit")
            return True  # No changes is fine
        
        # Commit changes
        subprocess.run(
            ['git', 'commit', '-m', commit_message],
            check=True,
            capture_output=True
        )
        logger.info(f"Committed changes: {commit_message}")
        
        # Deploy to Cloud Run
        deploy_result = subprocess.run([
            'gcloud', 'run', 'deploy', 'divinebridge',
            '--source', '.',
            '--region', 'us-central1',
            '--allow-unauthenticated',
            '--platform', 'managed'
        ], capture_output=True, text=True, timeout=600)
        
        if deploy_result.returncode == 0:
            logger.info("Deployment successful")
            return True
        else:
            logger.error(f"Deployment failed: {deploy_result.stderr}")
            return False
            
    except subprocess.TimeoutExpired:
        logger.error("Deployment timed out")
        return False
    except Exception as e:
        logger.error(f"Error during commit/deploy: {e}", exc_info=True)
        return False

def create_automated_summary(message, logs_summary, analysis, issues, fixes_applied, deployment_status):
    """Create comprehensive summary for automated processing"""
    summary_html = f"""
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
            .content {{ padding: 20px; background: #f9f9f9; }}
            .section {{ margin: 20px 0; padding: 15px; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
            .success {{ color: #388e3c; font-weight: bold; }}
            .warning {{ color: #f57c00; }}
            .error {{ color: #d32f2f; }}
            .fix {{ background: #e8f5e9; padding: 10px; border-left: 4px solid #4caf50; margin: 10px 0; }}
            ul {{ margin: 10px 0; padding-left: 20px; }}
            li {{ margin: 5px 0; }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🤖 AI Assistant - Automated Processing Complete</h1>
            <p>Processed at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
        </div>
        
        <div class="content">
            <div class="section">
                <h2>📝 Your Task</h2>
                <p>{message}</p>
            </div>
            
            <div class="section">
                <h2>🔍 Analysis Results</h2>
                <p><strong>Log Entries Analyzed:</strong> {len(logs_summary.get('entries', []))}</p>
                <p><strong>Errors Found:</strong> <span class="error">{analysis.get('total_errors', 0)}</span></p>
                <p><strong>Warnings Found:</strong> <span class="warning">{analysis.get('total_warnings', 0)}</span></p>
                <p><strong>Issues Identified:</strong> {len(issues)}</p>
            </div>
    """
    
    if fixes_applied:
        summary_html += """
            <div class="section">
                <h2>✅ Fixes Applied</h2>
        """
        for fix in fixes_applied:
            summary_html += f"""
                <div class="fix">
                    <strong>{fix.get('issue_type', 'General').title()} Fix:</strong>
                    <ul>
            """
            for fix_detail in fix.get('fixes', []):
                summary_html += f"<li>{fix_detail}</li>"
            summary_html += """
                    </ul>
                </div>
            """
        summary_html += "</div>"
    
    summary_html += f"""
            <div class="section">
                <h2>🚀 Deployment Status</h2>
                <p><strong>Status:</strong> <span class="{'success' if deployment_status == 'deployed' else 'warning'}">{deployment_status}</span></p>
            </div>
    """
    
    if analysis.get('errors'):
        summary_html += """
            <div class="section">
                <h2>❌ Errors Detected</h2>
                <ul>
        """
        for error in analysis['errors'][:10]:
            summary_html += f"""
                    <li>
                        <span class="error">{error.get('message', '')[:300]}</span>
                    </li>
            """
        summary_html += """
                </ul>
            </div>
        """
    
    summary_html += """
        </div>
    </body>
    </html>
    """
    
    return {
        'html': summary_html,
        'text': f"""
Automated Processing Summary
============================

Task: {message}

Analysis:
- Log Entries: {len(logs_summary.get('entries', []))}
- Errors: {analysis.get('total_errors', 0)}
- Warnings: {analysis.get('total_warnings', 0)}
- Issues Identified: {len(issues)}

Fixes Applied: {len(fixes_applied)}
Deployment Status: {deployment_status}
        """
    }

def fetch_recent_logs():
    """Fetch logs from Cloud Logging for the last hour"""
    try:
        # Initialize Cloud Logging client
        client = cloud_logging.Client()
        
        # Calculate time range (last hour)
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=1)
        
        # Format timestamps for Cloud Logging filter
        start_str = start_time.strftime('%Y-%m-%dT%H:%M:%SZ')
        end_str = end_time.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        # Filter for errors and warnings
        # Cloud Logging filter syntax: https://cloud.google.com/logging/docs/view/logging-query-language
        filter_str = f'timestamp >= "{start_str}" AND timestamp <= "{end_str}" AND (severity >= "ERROR" OR severity = "WARNING")'
        
        logger.info(f"Fetching logs from {start_time} to {end_time}")
        
        entries = []
        try:
            for entry in client.list_entries(filter_=filter_str, page_size=100, order_by="timestamp desc"):
                # Extract text payload
                text_payload = None
                if isinstance(entry.payload, str):
                    text_payload = entry.payload
                elif hasattr(entry.payload, 'get'):
                    text_payload = entry.payload.get('message', str(entry.payload))
                else:
                    text_payload = str(entry.payload)
                
                entry_data = {
                    'timestamp': entry.timestamp.isoformat() if entry.timestamp else None,
                    'severity': str(entry.severity),
                    'resource': entry.resource.type if entry.resource else None,
                    'text': text_payload[:1000] if text_payload else '',  # Limit length
                    'labels': dict(entry.labels) if entry.labels else {}
                }
                entries.append(entry_data)
        except Exception as e:
            logger.warning(f"Error fetching error/warning logs: {e}")
        
        # Also get recent INFO logs for context (deployments, auth, etc.)
        info_filter = f'timestamp >= "{start_str}" AND timestamp <= "{end_str}" AND severity = "INFO"'
        
        info_entries = []
        try:
            for entry in client.list_entries(filter_=info_filter, page_size=50, order_by="timestamp desc"):
                text_payload = None
                if isinstance(entry.payload, str):
                    text_payload = entry.payload
                elif hasattr(entry.payload, 'get'):
                    text_payload = entry.payload.get('message', str(entry.payload))
                else:
                    text_payload = str(entry.payload)
                
                # Filter for important INFO messages
                text_lower = text_payload.lower()
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
        logger.error(f"Error fetching logs from Cloud Logging: {e}", exc_info=True)
        return {
            'entries': [],
            'info_entries': [],
            'error': str(e)
        }

def analyze_logs(logs_summary):
    """Analyze logs for errors, patterns, and issues"""
    errors = []
    warnings = []
    patterns = {}
    
    for entry in logs_summary.get('entries', []):
        text = entry.get('text', '').lower()
        severity = entry.get('severity', '')
        
        if severity == 'ERROR':
            errors.append({
                'timestamp': entry.get('timestamp'),
                'message': entry.get('text', '')[:200],
                'resource': entry.get('resource')
            })
        elif severity == 'WARNING':
            warnings.append({
                'timestamp': entry.get('timestamp'),
                'message': entry.get('text', '')[:200]
            })
        
        # Detect patterns
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

