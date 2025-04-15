import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
import os
import json
from datetime import datetime
import logging
from dotenv import load_dotenv
from config import get_config

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class EmailSender:
    def __init__(self):
        """
        Initialize the EmailSender with SMTP configuration.
        """
        try:
            config = get_config()
            
            # Get email credentials from config
            email_user = config.EMAIL_USER
            email_password = config.EMAIL_PASSWORD
            
            # Parse email user if it's a JSON string
            if isinstance(email_user, str):
                try:
                    email_user = json.loads(email_user)
                except json.JSONDecodeError:
                    pass  # If it's not JSON, use it as is
            
            # Parse email password if it's a JSON string
            if isinstance(email_password, str):
                try:
                    email_password = json.loads(email_password)
                except json.JSONDecodeError:
                    pass  # If it's not JSON, use it as is
            
            self.sender_email = email_user
            self.sender_password = email_password
            self.smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
            self.smtp_port = int(os.getenv('SMTP_PORT', '587'))
            
            if not all([self.sender_email, self.sender_password]):
                logger.error(f"Email credentials missing: user={bool(self.sender_email)}, password={bool(self.sender_password)}")
                raise ValueError("Email credentials not found in environment variables")
                
            logger.info("EmailSender initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing EmailSender: {e}")
            raise

    def send_daily_prayer(self, recipient_email, first_name, prayer_text):
        """
        Send daily prayer email to a subscriber.
        
        Args:
            recipient_email: Email address of the recipient
            first_name: First name of the recipient
            prayer_text: The prayer text to send
        """
        try:
            logger.debug(f"Preparing to send prayer to: {recipient_email}")
            
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = formataddr(("Divine Bridge", self.sender_email))
            msg['To'] = recipient_email
            msg['Subject'] = f"Daily Prayer | {datetime.now().strftime('%A, %B %d')}"
            
            # Add headers to ensure primary inbox delivery
            msg['List-Unsubscribe'] = f"<mailto:{self.sender_email}?subject=unsubscribe>"
            msg['Precedence'] = "normal"
            msg['X-Auto-Response-Suppress'] = "OOF, AutoReply"
            msg['X-Priority'] = "1"
            msg['X-MSMail-Priority'] = "High"
            msg['Importance'] = "high"
            msg['X-Content-Type-Options'] = "nosniff"
            msg['X-Frame-Options'] = "SAMEORIGIN"
            msg['X-XSS-Protection'] = "1; mode=block"
            msg['X-Entity-Ref-ID'] = "new"
            
            # Create plain text version
            plain_text = f"""
Daily Prayer | {datetime.now().strftime('%A, %B %d')}

{prayer_text}

Blessings,
The Divine Bridge team

To unsubscribe, please visit: https://divinebridge.io/unsubscribe
"""
            
            # Create email body with styling
            html_body = f"""
            <html>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                <div style="text-align: left; margin-bottom: 20px;">
                    <h1 style="color: #0066cc; font-size: 28px; margin-bottom: 6px;">Divine Bridge</h1>
                    <p style="color: #666; font-size: 12px;">Uniting Hearts in Global Prayer</p>
                    <p style="color: #666; font-size: 16px;">Greetings in Christ, {first_name},</p>
                    <p style="color: #666; font-size: 16px;">Thank you for being part of our global prayer community. May this prayer deepen your connection with Christ, our source of hope and peace.</p>
                </div>

                <div style="background: #f5f7fa; padding: 25px; border-radius: 15px; margin: 30px 0;">
                    <h2 style="color: #0066cc; font-size: 20px; margin-bottom: 15px; text-align: left;">Today's Prayer</h2>
                    <p style="font-size: 16px; line-height: 1.8; color: #444; white-space: pre-line;">{prayer_text}</p>
                </div>

                <div style="background: #f0f7ff; padding: 20px; border-radius: 10px; margin: 30px 0; border-left: 4px solid #0066cc;">
                    <p style="font-size: 16px; line-height: 1.6; color: #444; margin-bottom: 15px;">For daily verses, visit our website.</p>
                    <p style="font-size: 16px; line-height: 1.6; color: #444;">Help us grow our globalprayer community by sharing Divine Bridge with friends and family.</p>
                    <p style="margin-top: 15px;"><a href="https://divinebridge.io" style="background-color: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Visit Divine Bridge</a></p>
                </div>

                <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="font-size: 16px; line-height: 1.6; color: #666;">Blessings,<br>The Divine Bridge team</p>
                    <p style="font-size: 14px; color: #999; margin-top: 20px;">To unsubscribe, please <a href="https://divinebridge.io/unsubscribe" style="color: #0066cc; text-decoration: underline;">click here</a>.</p>
                </div>
            </body>
            </html>
            """
            
            # Attach both plain text and HTML versions
            msg.attach(MIMEText(plain_text, 'plain'))
            msg.attach(MIMEText(html_body, 'html'))
            
            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.sender_email, self.sender_password)
                server.send_message(msg)
                
            logger.debug(f"Prayer email sent successfully to: {recipient_email}")
            
        except Exception as e:
            logger.error(f"Error sending prayer to {recipient_email}: {e}")
            raise

    def send_prayer(self, prayer, recipient_email, first_name):
        logger.debug(f"Preparing to send prayer to: {recipient_email}")
        try:
            subject = f"Daily Prayer | {datetime.now().strftime('%A, %B %d')}"
            return self.send_daily_prayer(recipient_email, first_name, prayer)
        except Exception as e:
            logger.error(f"Error sending prayer to {recipient_email}: {e}")
            raise

    def send_unsubscribe_confirmation(self, recipient_email, first_name):
        """
        Send confirmation email to unsubscribed user.
        
        Args:
            recipient_email: Email address of the unsubscribed user
            first_name: First name of the unsubscribed user
        """
        try:
            logger.debug(f"Preparing to send unsubscribe confirmation to: {recipient_email}")
            
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = formataddr(("Divine Bridge", self.sender_email))
            msg['To'] = recipient_email
            msg['Subject'] = "Unsubscribe Confirmation"
            
            # Add headers to reduce spam likelihood
            msg['List-Unsubscribe'] = f"<mailto:{self.sender_email}?subject=unsubscribe>"
            msg['Precedence'] = "bulk"
            msg['X-Auto-Response-Suppress'] = "OOF, AutoReply"
            msg['X-Priority'] = "3"
            msg['X-MSMail-Priority'] = "Normal"
            msg['Importance'] = "normal"
            msg['X-Content-Type-Options'] = "nosniff"
            msg['X-Frame-Options'] = "SAMEORIGIN"
            msg['X-XSS-Protection'] = "1; mode=block"
            msg['X-Entity-Ref-ID'] = "new"
            
            # Create plain text version
            plain_text = f"""
You have been successfully unsubscribed from Divine Bridge daily prayers.

We're sorry to see you go. If you change your mind, you can always resubscribe by visiting our website.

Thank you for being part of our prayer community.

Blessings,
The Divine Bridge team
"""
            
            # Create HTML version
            html_body = f"""
            <html>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                <div style="text-align: left; margin-bottom: 20px;">
                    <h1 style="color: #0066cc; font-size: 28px; margin-bottom: 6px;">Divine Bridge</h1>
                    <p style="color: #666; font-size: 12px;">Uniting Hearts in Global Prayer</p>
                    <p style="color: #666; font-size: 16px;">Greetings in Christ, {first_name},</p>
                    <p style="color: #666; font-size: 16px;">Thank you for being part of our global prayer community. May this prayer deepen your connection with Christ, our source of hope and peace.</p>
                </div>

                <div style="margin-bottom: 30px;">
                    <p style="font-size: 16px; line-height: 1.6;">You have been successfully unsubscribed from Divine Bridge daily prayers.</p>
                    <p style="font-size: 16px; line-height: 1.6;">We're sorry to see you go. If you change your mind, you can always resubscribe by visiting our website.</p>
                </div>

                <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="font-size: 16px; line-height: 1.6; color: #666;">Blessings,<br>The Divine Bridge team</p>
                </div>
            </body>
            </html>
            """
            
            # Attach both plain text and HTML versions
            msg.attach(MIMEText(plain_text, 'plain'))
            msg.attach(MIMEText(html_body, 'html'))
            
            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.sender_email, self.sender_password)
                server.send_message(msg)
                
            logger.debug(f"Unsubscribe confirmation sent successfully to: {recipient_email}")
            
        except Exception as e:
            logger.error(f"Error sending unsubscribe confirmation to {recipient_email}: {e}")
            raise 

    def send_welcome_email(self, recipient_email, first_name, prayer_text):
        """
        Send welcome email to a new subscriber with today's prayer.
        
        Args:
            recipient_email: Email address of the recipient
            first_name: First name of the recipient
            prayer_text: The prayer text to send
        """
        try:
            logger.debug(f"Preparing to send welcome email to: {recipient_email}")
            
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = formataddr(("Divine Bridge", self.sender_email))
            msg['To'] = recipient_email
            msg['Subject'] = "Welcome to Divine Bridge"
            
            # Add headers to ensure primary inbox delivery
            msg['List-Unsubscribe'] = f"<mailto:{self.sender_email}?subject=unsubscribe>"
            msg['Precedence'] = "normal"
            msg['X-Auto-Response-Suppress'] = "OOF, AutoReply"
            msg['X-Priority'] = "1"
            msg['X-MSMail-Priority'] = "High"
            msg['Importance'] = "high"
            msg['X-Content-Type-Options'] = "nosniff"
            msg['X-Frame-Options'] = "SAMEORIGIN"
            msg['X-XSS-Protection'] = "1; mode=block"
            msg['X-Entity-Ref-ID'] = "new"
            
            # Create plain text version
            plain_text = f"""
Welcome to Divine Bridge, {first_name}!

Thank you for joining our prayer community. Here is today's prayer:

{prayer_text}

Blessings,
The Divine Bridge team

To unsubscribe, please visit: https://divinebridge.io/unsubscribe
"""
            
            # Create HTML version
            html_body = f"""
            <html>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                <div style="text-align: left; margin-bottom: 20px;">
                    <h1 style="color: #0066cc; font-size: 28px; margin-bottom: 6px;">Divine Bridge</h1>
                    <p style="color: #666; font-size: 12px;">Uniting Hearts in Global Prayer</p>
                    <p style="color: #666; font-size: 16px;">Greetings in Christ, {first_name},</p>
                    <p style="color: #666; font-size: 16px;">Thank you for being part of our global prayer community. May this prayer deepen your connection with Christ, our source of hope and peace.</p>
                </div>

                <div style="background: #f5f7fa; padding: 25px; border-radius: 15px; margin: 30px 0;">
                    <h2 style="color: #0066cc; font-size: 20px; margin-bottom: 15px; text-align: left;">Today's Prayer</h2>
                    <p style="font-size: 16px; line-height: 1.8; color: #444; white-space: pre-line;">{prayer_text}</p>
                </div>
                
                <div style="background: #f0f7ff; padding: 20px; border-radius: 10px; margin: 30px 0; border-left: 4px solid #0066cc;">
                    <p style="font-size: 16px; line-height: 1.6; color: #444; margin-bottom: 15px;">For daily verses, visit our website.</p>
                    <p style="font-size: 16px; line-height: 1.6; color: #444;">Help us grow our globalprayer community by sharing Divine Bridge with friends and family.</p>
                    <p style="margin-top: 15px;"><a href="https://divinebridge.io" style="background-color: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Visit Divine Bridge</a></p>
                </div>

                <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="font-size: 16px; line-height: 1.6; color: #666;">Blessings,<br>The Divine Bridge team</p>
                    <p style="font-size: 14px; color: #999; margin-top: 20px;">To unsubscribe, please <a href="https://divinebridge.io/unsubscribe" style="color: #0066cc; text-decoration: underline;">click here</a>.</p>
                </div>
            </body>
            </html>
            """
            
            # Attach both plain text and HTML versions
            msg.attach(MIMEText(plain_text, 'plain'))
            msg.attach(MIMEText(html_body, 'html'))
            
            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.sender_email, self.sender_password)
                server.send_message(msg)
                
            logger.debug(f"Welcome email sent successfully to: {recipient_email}")
            return True
            
        except Exception as e:
            logger.error(f"Error sending welcome email to {recipient_email}: {e}")
            return False 