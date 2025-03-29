import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
import os
from datetime import datetime
import logging
from dotenv import load_dotenv
from sheet_handler import SheetHandler

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
            self.sender_email = os.getenv('EMAIL_USER')
            self.sender_password = os.getenv('EMAIL_PASSWORD')
            self.smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
            self.smtp_port = int(os.getenv('SMTP_PORT', '587'))
            
            if not all([self.sender_email, self.sender_password]):
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
            msg = MIMEMultipart()
            msg['From'] = formataddr(("Divine Bridge", self.sender_email))
            msg['To'] = recipient_email
            msg['Subject'] = f"Daily Prayer | {datetime.now().strftime('%A, %B %d')}"
            
            # Create email body with styling
            html_body = f"""
            <html>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                <div style="text-align: left; margin-bottom: 30px;">
                    <h1 style="color: #0066cc; font-size: 28px; margin-bottom: 6px;">Divine Bridge</h1>
                    <p style="color: #666; font-size: 12px;">Uniting Hearts in Global Prayer</p>
                </div>

                <div style="background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); padding: 25px; border-radius: 15px; margin: 30px 0; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                    <h2 style="color: #0066cc; font-size: 20px; margin-bottom: 15px; text-align: left;">Let's Pray!</h2>
                    <p style="font-size: 16px; line-height: 1.8; color: #444; white-space: pre-line;">{prayer_text}</p>
                </div>

                <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="font-size: 16px; line-height: 1.6; color: #666;">Blessings,<br>The Divine Bridge team</p>
                    <p style="font-size: 14px; color: #999; margin-top: 20px;">If you have any questions, please contact us at <a href="mailto:{self.sender_email}" style="color: #0066cc; text-decoration: none;">{self.sender_email}</a></p>
                </div>
            </body>
            </html>
            """
            
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