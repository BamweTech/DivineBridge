import logging
from flask import current_app
from google.cloud import secretmanager
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr

logger = logging.getLogger(__name__)

class EmailService:
    def __init__(self):
        self.smtp_server = current_app.config.get('SMTP_SERVER', 'smtp.gmail.com')
        self.smtp_port = current_app.config.get('SMTP_PORT', 587)
        self.sender_email = current_app.config.get('SENDER_EMAIL', 'blessings@divinebridge.io')
        self.sender_password = self._get_sender_password()
        
    def _get_sender_password(self):
        """Get email password from Secret Manager"""
        try:
            client = secretmanager.SecretManagerServiceClient()
            name = f"projects/{current_app.config['PROJECT_ID']}/secrets/email-password/versions/latest"
            response = client.access_secret_version(request={"name": name})
            return response.payload.data.decode('UTF-8')
        except Exception as e:
            logger.error(f"Error getting email password: {e}")
            return None
            
    def send_password_reset_email(self, recipient_email, reset_link):
        """Send password reset email"""
        try:
            # Create message
            message = MIMEMultipart('alternative')
            message['From'] = formataddr(("Divine Bridge", self.sender_email))
            message['To'] = recipient_email
            message['Subject'] = "Divine Bridge - Password Reset"
            message['X-Auto-Response-Suppress'] = "OOF, AutoReply"
            
            plain_text = f"""Divine Bridge password reset

We received a request to reset the password for your Divine Bridge account.

Reset your password:
{reset_link}

If you did not request this, you can safely ignore this email.

This link will expire in 1 hour.

Blessings,
The Divine Bridge Team
"""

            # Create email body
            body = f"""
            <html>
                <body>
                    <h2>Password Reset Request</h2>
                    <p>You have requested to reset your password for your Divine Bridge account.</p>
                    <p>Click the link below to reset your password:</p>
                    <p><a href="{reset_link}">Reset Password</a></p>
                    <p>If you did not request this password reset, please ignore this email.</p>
                    <p>This link will expire in 1 hour.</p>
                    <br>
                    <p>Best regards,<br>The Divine Bridge Team</p>
                </body>
            </html>
            """
            
            message.attach(MIMEText(plain_text, 'plain'))
            message.attach(MIMEText(body, 'html'))
            
            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.sender_email, self.sender_password)
                server.send_message(message)
                
            logger.info(f"Password reset email sent to {recipient_email}")
            return True
            
        except Exception as e:
            logger.error(f"Error sending password reset email: {e}")
            return False 