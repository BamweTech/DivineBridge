"""
Enhanced Email Service for Divine Bridge
Sends combined daily verse + prayer emails with timezone-aware delivery
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
from email.utils import formataddr
import logging
import os
from datetime import datetime
from config import get_config

logger = logging.getLogger(__name__)


class EnhancedEmailService:
    """Email service for sending daily verse and prayer emails"""
    
    def __init__(self):
        """Initialize email service with blessings@divinebridge.io"""
        try:
            config = get_config()
            
            # Check for test/dev email credentials first (for local testing)
            test_email = os.getenv('TEST_EMAIL_USER')
            test_password = os.getenv('TEST_EMAIL_PASSWORD')
            
            if test_email and test_password:
                # Use test credentials for local development
                self.sender_email = test_email
                self.sender_password = test_password
                logger.info(f"Using TEST email credentials: {self.sender_email}")
            else:
                # Use production credentials (blessings@divinebridge.io)
                self.sender_email = os.getenv('PRODUCTION_EMAIL_USER', 'blessings@divinebridge.io')
                self.sender_password = config.email_password
                logger.info(f"Using PRODUCTION email credentials: {self.sender_email}")
            
            self.smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
            self.smtp_port = int(os.getenv('SMTP_PORT', '587'))
            
            if not self.sender_password:
                raise ValueError("Email password not configured")
                
            logger.info(f"Enhanced EmailService initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing EnhancedEmailService: {e}")
            raise
    
    def send_daily_content(self, recipient_email, first_name, verse_data, prayer_data, timezone='UTC'):
        """
        Send combined daily verse and prayer email
        
        Args:
            recipient_email: Subscriber's email
            first_name: Subscriber's first name
            verse_data: Dict with 'reference', 'text'
            prayer_data: Dict with 'content', 'date'
            timezone: Subscriber's timezone (e.g., 'America/New_York')
        
        Returns:
            bool: True if sent successfully
        """
        try:
            # Format date based on timezone
            now = datetime.now()
            date_str = now.strftime('%A, %B %d, %Y')
            
            # Create message with related for embedded images
            msg = MIMEMultipart('related')
            msg['From'] = formataddr(("Divine Bridge", self.sender_email))
            msg['To'] = recipient_email
            msg['Subject'] = f"Your Blessings - {date_str}"
            
            # Email headers for deliverability
            msg['List-Unsubscribe'] = f"<https://divinebridge.io/unsubscribe?email={recipient_email}>"
            msg['List-Unsubscribe-Post'] = "List-Unsubscribe=One-Click"
            msg['Precedence'] = "bulk"
            
            # Create alternative part for text/html
            msg_alternative = MIMEMultipart('alternative')
            msg.attach(msg_alternative)
            
            # Plain text version
            plain_text = self._create_plain_text(first_name, date_str, verse_data, prayer_data, recipient_email)
            
            # HTML version with website theme
            html_body = self._create_html_body(first_name, date_str, verse_data, prayer_data, recipient_email)
            
            # Attach both versions to alternative
            msg_alternative.attach(MIMEText(plain_text, 'plain', 'utf-8'))
            msg_alternative.attach(MIMEText(html_body, 'html', 'utf-8'))
            
            # Attach logo as embedded image (use gold version for Christmas season)
            try:
                import os
                # Use gold logo for Christmas season (December)
                current_month = datetime.now().month
                if current_month == 12:  # December - Christmas season
                    logo_path = os.path.join(os.path.dirname(__file__), 'assets', 'logos', 'LogoOnly1_gold.png')
                    # Fallback to regular logo if gold version doesn't exist
                    if not os.path.exists(logo_path):
                        logo_path = os.path.join(os.path.dirname(__file__), 'assets', 'logos', 'LogoOnly1.png')
                else:
                    logo_path = os.path.join(os.path.dirname(__file__), 'assets', 'logos', 'LogoOnly1.png')
                
                with open(logo_path, 'rb') as img:
                    from email.mime.image import MIMEImage
                    img_data = MIMEImage(img.read())
                    img_data.add_header('Content-ID', '<logo_image>')
                    img_data.add_header('Content-Disposition', 'inline', filename='logo.png')
                    msg.attach(img_data)
            except Exception as e:
                logger.warning(f"Could not attach logo: {e}")
            
            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.sender_email, self.sender_password)
                server.send_message(msg)
            
            logger.info(f"Daily content email sent to: {recipient_email}")
            return True
            
        except Exception as e:
            logger.error(f"Error sending daily email to {recipient_email}: {e}")
            return False
    
    def _create_plain_text(self, first_name, date_str, verse_data, prayer_data, recipient_email):
        """Create plain text version of email"""
        return f"""
Divine Bridge - Your Blessings
{date_str}

Dear {first_name},

May this day be filled with God's grace and peace.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TODAY'S VERSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{verse_data.get('reference', '')}

"{verse_data.get('text', '')}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TODAY'S GLOBAL PRAYER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{prayer_data.get('content', '')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Join thousands of believers in a unified mission of faith, hope, and spiritual growth.

Visit Divine Bridge: https://divinebridge.io
Share on Social Media: https://divinebridge.io/share

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Blessings,
The Divine Bridge Team

To unsubscribe: https://divinebridge.io/unsubscribe?email={recipient_email}
"""
    
    def _create_html_body(self, first_name, date_str, verse_data, prayer_data, recipient_email):
        """Create HTML email with subtle Christmas theme - gold and white only"""
        # Create SVG tree pattern for background (faded gold) - simplified for email compatibility
        tree_svg = """data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='200'%3E%3Cg opacity='0.06'%3E%3Cpath d='M75 10 L60 50 L90 50 Z' fill='%23FFD700'/%3E%3Cpath d='M75 45 L50 90 L100 90 Z' fill='%23FFD700'/%3E%3Cpath d='M75 85 L40 140 L110 140 Z' fill='%23FFD700'/%3E%3Crect x='72' y='140' width='6' height='25' fill='%23FFD700'/%3E%3C/g%3E%3C/svg%3E"""
        
        return f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        @media only screen and (max-width: 600px) {{
            .email-container {{
                width: 100% !important;
                max-width: 100% !important;
            }}
            .content-padding {{
                padding: 20px 15px !important;
            }}
            .verse-card, .prayer-card {{
                padding: 20px 15px !important;
            }}
            .cta-text {{
                font-size: 13px !important;
            }}
            .logo-cell {{
                text-align: center !important;
                width: 100% !important;
                padding: 0 !important;
            }}
            .logo-img {{
                display: block !important;
                margin: 0 auto 8px auto !important;
                text-align: center !important;
            }}
            .header-logo-table {{
                width: 100% !important;
                margin: 0 auto !important;
            }}
            .header-logo-table td {{
                text-align: center !important;
                width: 100% !important;
            }}
            .header-tagline {{
                font-size: 11px !important;
                letter-spacing: 0.5px !important;
                white-space: nowrap !important;
                text-align: center !important;
            }}
        }}
    </style>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #ffffff; min-height: 100vh;">
    
    <!-- Email Container -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #ffffff; padding: 40px 20px;">
        <tr>
            <td align="center">
                
                <!-- Main Content Card -->
                <table cellpadding="0" cellspacing="0" border="0" width="600" class="email-container" style="max-width: 600px; background: #ffffff; border-radius: 24px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); overflow: hidden; border: 1px solid rgba(255, 215, 0, 0.2);">
                    
                    <!-- Header with Logo -->
                    <tr>
                        <td style="background: #ffffff; padding: 40px 30px 30px; text-align: center; position: relative; background-image: url('{tree_svg}'); background-repeat: repeat; background-position: center; background-size: 200px 300px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" class="header-logo-table">
                                <tr>
                                    <td class="logo-cell" align="center" style="text-align: center; width: 100%;">
                                        <img src="cid:logo_image" alt="Divine Bridge" class="logo-img" width="60" height="60" style="display: block; margin: 0 auto 8px auto; border: 0; text-align: center;" />
                                    </td>
                                </tr>
                            </table>
                            <div class="header-tagline" style="color: #B8860B; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-align: center; margin-top: 8px;">CHRISTMAS BLESSINGS</div>
                            <div class="header-tagline" style="color: #666; font-size: 11px; font-weight: 500; letter-spacing: 0.5px; text-align: center; margin-top: 6px;">UNITING HEARTS IN GLOBAL PRAYER</div>
                            
                            <!-- Subtle gold border -->
                            <div style="margin-top: 20px; height: 1px; background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.3), transparent);"></div>
                        </td>
                    </tr>
                    
                    <!-- Greeting -->
                    <tr>
                        <td class="content-padding" style="padding: 30px 30px 20px; background: #ffffff;">
                            <p style="font-size: 18px; color: #333; margin: 0 0 10px 0; font-weight: 600;">Dear {first_name},</p>
                            <p style="font-size: 15px; color: #666; margin: 0; line-height: 1.6;">May this Christmas season be filled with God's grace, peace, and abundant blessings. Here are your daily blessings:</p>
                        </td>
                    </tr>
                    
                    <!-- Verse Section -->
                    <tr>
                        <td class="content-padding" style="padding: 0 30px 30px; background: #ffffff;">
                            <div class="verse-card" style="background: #ffffff; border-radius: 12px; padding: 25px; border-left: 3px solid rgba(255, 215, 0, 0.4); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04); position: relative;">
                                <div style="color: rgba(184, 134, 11, 0.7); font-size: 11px; font-weight: 600; letter-spacing: 1px; margin-bottom: 12px; text-align: center; text-transform: uppercase;">TODAY'S VERSE</div>
                                <div style="color: #B8860B; font-size: 16px; font-weight: 600; margin-bottom: 15px; text-align: center;">{verse_data.get('reference', '')}</div>
                                <div style="color: #333; font-size: 17px; line-height: 1.8; font-style: italic; text-align: center; padding: 0 10px;">"{verse_data.get('text', '')}"</div>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Subtle Divider -->
                    <tr>
                        <td style="padding: 0 30px; background: #ffffff;">
                            <div style="text-align: center; margin: 20px 0;">
                                <div style="display: inline-block; height: 1px; width: 80px; background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.3), transparent);"></div>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Prayer Section -->
                    <tr>
                        <td class="content-padding" style="padding: 30px; background: #ffffff;">
                            <div class="prayer-card" style="background: #ffffff; border-radius: 12px; padding: 25px; border-top: 3px solid rgba(255, 215, 0, 0.4); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04); position: relative;">
                                <div style="color: rgba(184, 134, 11, 0.7); font-size: 11px; font-weight: 600; letter-spacing: 1px; margin-bottom: 15px; text-align: center; text-transform: uppercase;">TODAY'S GLOBAL PRAYER</div>
                                <div style="color: #333; font-size: 16px; line-height: 1.8; white-space: pre-line; padding: 0 5px;">{prayer_data.get('content', '')}</div>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- CTA Section -->
                    <tr>
                        <td class="content-padding" style="padding: 0 30px 30px; background: #ffffff;">
                            <div style="background: #ffffff; border-radius: 12px; padding: 25px; text-align: center; border: 1px solid rgba(255, 215, 0, 0.2);">
                                <p style="color: #333; font-size: 16px; font-weight: 600; margin: 0 0 10px 0;">Join Our Global Prayer Community</p>
                                <p class="cta-text" style="color: #666; font-size: 14px; margin: 0 0 20px 0; line-height: 1.6;">Join thousands of believers in a unified mission of faith, hope, and spiritual growth this Christmas season.</p>
                                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                                    <tr>
                                        <td align="center">
                                            <a href="https://divinebridge.io/prayers" style="display: inline-block; background: rgba(255, 215, 0, 0.15); color: #B8860B; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 5px; border: 1px solid rgba(255, 215, 0, 0.3);">Request a Prayer</a>
                                        </td>
                                    </tr>
                                </table>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: #ffffff; padding: 25px 30px; border-top: 1px solid rgba(255, 215, 0, 0.15);">
                            <p style="font-size: 15px; color: #333; margin: 0; font-weight: 500;">Christmas Blessings,</p>
                            <p style="font-size: 14px; color: #666; margin: 5px 0 0 0;"><span style="color: #B8860B; font-weight: 600;">The Divine Bridge Team</span></p>
                        </td>
                    </tr>
                    
                    <!-- Unsubscribe -->
                    <tr>
                        <td style="background: #ffffff; padding: 0 30px 30px;">
                            <p style="font-size: 12px; color: #999; text-align: center; margin: 0;">
                                <a href="https://divinebridge.io/unsubscribe?email={recipient_email}" style="color: #B8860B; text-decoration: underline;">Unsubscribe</a> | 
                                <a href="https://divinebridge.io/privacy-policy" style="color: #B8860B; text-decoration: underline;">Privacy Policy</a>
                            </p>
                        </td>
                    </tr>
                    
                </table>
                
                <!-- Footer Logo -->
                <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; margin-top: 20px;">
                    <tr>
                        <td align="center">
                            <p style="color: #999; font-size: 12px; margin: 10px 0;">
                                © 2025 Divine Bridge. All rights reserved.
                            </p>
                            <p style="color: #999; font-size: 11px; margin: 5px 0;">
                                <a href="https://divinebridge.io" style="color: #B8860B; text-decoration: none;">divinebridge.io</a>
                            </p>
                        </td>
                    </tr>
                </table>
                
            </td>
        </tr>
    </table>
    
</body>
</html>
"""


    def send_new_user_notification(self, admin_email, user_name, user_email, user_id, signup_date, auth_provider='email'):
        """
        Send notification email to admin when a new user signs up
        
        Args:
            admin_email: Admin email address to notify
            user_name: Full name of the new user
            user_email: Email of the new user
            user_id: Firebase user ID
            signup_date: Signup date/time string
            auth_provider: Authentication provider (email, google, etc.)
        
        Returns:
            bool: True if sent successfully
        """
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = formataddr(("Divine Bridge", self.sender_email))
            msg['To'] = admin_email
            msg['Subject'] = f'New User Signup: {user_name}'
            
            # Plain text version
            plain_text = f"""
New User Signup - Divine Bridge

A new user has signed up for Divine Bridge.

Name: {user_name}
Auth Provider: {auth_provider}
Signup Date: {signup_date}

This is an automated notification from Divine Bridge.
"""
            
            # HTML version
            html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }}
        .container {{
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}
        h2 {{
            color: #1f3c88;
            margin-top: 0;
        }}
        .info-box {{
            background: #f8f9fa;
            border-left: 4px solid #0f56ff;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }}
        .info-row {{
            margin: 10px 0;
        }}
        .label {{
            font-weight: 600;
            color: #333;
        }}
        .value {{
            color: #666;
        }}
        .footer {{
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
            font-size: 12px;
            color: #999;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h2>New User Signup - Divine Bridge</h2>
        <p>A new user has signed up for Divine Bridge.</p>
        
        <div class="info-box">
            <div class="info-row">
                <span class="label">Name:</span> <span class="value">{user_name}</span>
            </div>
            <div class="info-row">
                <span class="label">Auth Provider:</span> <span class="value">{auth_provider}</span>
            </div>
            <div class="info-row">
                <span class="label">Signup Date:</span> <span class="value">{signup_date}</span>
            </div>
        </div>
        
        <div class="footer">
            <p>This is an automated notification from Divine Bridge.</p>
        </div>
    </div>
</body>
</html>
"""
            
            # Attach both versions
            msg.attach(MIMEText(plain_text, 'plain', 'utf-8'))
            msg.attach(MIMEText(html_body, 'html', 'utf-8'))
            
            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.sender_email, self.sender_password)
                server.send_message(msg)
            
            logger.info(f"New user notification email sent to {admin_email} for user: {user_email}")
            return True
            
        except Exception as e:
            logger.error(f"Error sending new user notification email: {e}")
            return False


# Singleton instance
_email_service = None

def get_email_service():
    """Get or create the email service singleton"""
    global _email_service
    if _email_service is None:
        _email_service = EnhancedEmailService()
    return _email_service

