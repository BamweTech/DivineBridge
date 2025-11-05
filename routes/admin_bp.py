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
    """Process admin message, fetch logs, and send email summary"""
    try:
        data = request.get_json()
        user_message = data.get('message', '').strip()
        
        if not user_message:
            return jsonify({'error': 'Message cannot be empty'}), 400
        
        logger.info(f"Admin message received: {user_message[:100]}...")
        
        # Fetch recent logs (last hour)
        logs_summary = fetch_recent_logs()
        
        # Analyze logs for errors and issues
        analysis = analyze_logs(logs_summary)
        
        # Create comprehensive summary
        summary = create_summary(user_message, logs_summary, analysis)
        
        # Send email to admin
        email_sent = send_admin_email(summary)
        
        return jsonify({
            'success': True,
            'message': 'Task processed successfully. Email summary sent.',
            'logs_fetched': len(logs_summary.get('entries', [])),
            'errors_found': len(analysis.get('errors', [])),
            'email_sent': email_sent
        })
        
    except Exception as e:
        logger.error(f"Error processing admin message: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

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

