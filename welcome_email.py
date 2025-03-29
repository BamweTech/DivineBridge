import logging
from datetime import datetime
from email_templates import get_welcome_email_template
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from dotenv import load_dotenv

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

def get_todays_prayer():
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        prayer_file = f'prayers/{today}.txt'
        
        if not os.path.exists(prayer_file):
            logger.error(f"Prayer file for today ({prayer_file}) not found")
            return "Our prayer for today is being prepared. Please check back later."
        
        with open(prayer_file, 'r') as file:
            prayer = file.read().strip()
            return prayer
    except Exception as e:
        logger.error(f"Error reading today's prayer: {e}")
        return "Our prayer for today is being prepared. Please check back later."

def send_welcome_email(first_name, recipient_email):
    """
    Send a welcome email to a new subscriber.
    
    Args:
        first_name: Subscriber's first name
        recipient_email: Subscriber's email address
    """
    try:
        logger.debug(f"Preparing to send welcome email to: {recipient_email}")
        
        # Get email configuration from environment variables
        sender_email = os.getenv('EMAIL_USER')
        sender_password = os.getenv('EMAIL_PASSWORD')
        smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
        smtp_port = int(os.getenv('SMTP_PORT', '587'))
        
        if not all([sender_email, sender_password]):
            raise ValueError("Email credentials not found in environment variables")
        
        # Get today's prayer
        prayer = get_todays_prayer()
        
        # Create message
        msg = MIMEMultipart()
        msg['From'] = formataddr(("Divine Bridge", sender_email))
        msg['To'] = recipient_email
        msg['Subject'] = "Welcome to Divine Bridge!"
        
        # Create email body with styling
        html_body = f"""
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
            <div style="text-align: left; margin-bottom: 20px;">
                <h1 style="color: #0066cc; font-size: 28px; margin-bottom: 6px;">Divine Bridge</h1>
                <p style="color: #666; font-size: 12px;">Uniting Hearts in Global Prayer</p>
            </div>

            <div style="margin-bottom: 30px;">
                <p style="font-size: 16px; line-height: 1.6;">Dear {first_name},</p>
                <p style="font-size: 16px; line-height: 1.6;">Welcome to Divine Bridge! We are delighted to have you join our global prayer community.</p>
                <p style="font-size: 16px; line-height: 1.6; font-style: italic; margin-top: 10px;">As we unite our hearts in faith, we lift up those affected by global events, seeking God's comfort, healing, and divine intervention.</p>
            </div>

            <div style="background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); padding: 25px; border-radius: 15px; margin: 30px 0; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                <h2 style="color: #0066cc; font-size: 20px; margin-bottom: 15px; text-align: left;">Today's Prayer</h2>
                <p style="font-size: 16px; line-height: 1.8; color: #444; white-space: pre-line;">{prayer}</p>
            </div>

            <div style="margin-top: 30px;">
                <p style="font-size: 16px; line-height: 1.6;">Thank you for being part of our global prayer community.</p>
            </div>

            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="font-size: 16px; line-height: 1.6; color: #666;">Blessings,<br>The Divine Bridge team</p>
                <p style="font-size: 14px; color: #999; margin-top: 20px;">If you have any questions, please contact us at <a href="mailto:{sender_email}" style="color: #0066cc; text-decoration: none;">{sender_email}</a></p>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(html_body, 'html'))
        
        # Send email
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.send_message(msg)
            
        logger.debug(f"Welcome email sent successfully to: {recipient_email}")
        
    except Exception as e:
        logger.error(f"Error sending welcome email to {recipient_email}: {e}")
        raise 