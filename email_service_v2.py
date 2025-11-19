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
            
            # Attach logo as embedded image
            try:
                import os
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
        """Create HTML email with website theme (logo blue #0f56ff)"""
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
            /* Center logo in mobile view */
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
            /* Ensure header table cell centers content */
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
                <table cellpadding="0" cellspacing="0" border="0" width="600" class="email-container" style="max-width: 600px; background: rgba(255, 255, 255, 0.95); border-radius: 24px; backdrop-filter: blur(20px); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1); overflow: hidden;">
                    
                    <!-- Header with Logo -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #ffffff 0%, #e3f2fd 50%, #bbdefb 100%); padding: 40px 30px; text-align: center;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" class="header-logo-table">
                                <tr>
                                    <td class="logo-cell" align="center" style="text-align: center; width: 100%;">
                                        <img src="cid:logo_image" alt="Divine Bridge" class="logo-img" width="60" height="60" style="display: block; margin: 0 auto 8px auto; border: 0; text-align: center;" />
                                    </td>
                                </tr>
                            </table>
                            <div class="header-tagline" style="color: #0f56ff; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-align: center;">UNITING HEARTS IN GLOBAL PRAYER</div>
                        </td>
                    </tr>
                    
                    <!-- Greeting -->
                    <tr>
                        <td class="content-padding" style="padding: 30px 30px 20px;">
                            <p style="font-size: 18px; color: #1e1e1e; margin: 0 0 10px 0;">Dear {first_name},</p>
                            <p style="font-size: 16px; color: #666; margin: 0; line-height: 1.6;">May this day be filled with God's grace and peace. Here are your blessings:</p>
                        </td>
                    </tr>
                    
                    <!-- Verse Section -->
                    <tr>
                        <td class="content-padding" style="padding: 0 30px 30px;">
                            <div class="verse-card" style="background: linear-gradient(135deg, rgba(15, 86, 255, 0.08) 0%, rgba(31, 60, 136, 0.05) 100%); border-radius: 16px; padding: 25px; border-left: 4px solid #0f56ff;">
                                <div style="color: #0f56ff; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 12px;">TODAY'S VERSE</div>
                                <div style="color: #0f56ff; font-size: 16px; font-weight: 600; margin-bottom: 15px;">{verse_data.get('reference', '')}</div>
                                <div style="color: #333; font-size: 17px; line-height: 1.8; font-style: italic;">"{verse_data.get('text', '')}"</div>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Divider -->
                    <tr>
                        <td style="padding: 0 30px;">
                            <div style="height: 1px; background: linear-gradient(90deg, transparent, #0f56ff, transparent); margin: 10px 0;"></div>
                        </td>
                    </tr>
                    
                    <!-- Prayer Section -->
                    <tr>
                        <td class="content-padding" style="padding: 30px;">
                            <div class="prayer-card" style="background: rgba(255, 255, 255, 0.25); border-radius: 16px; padding: 25px; border: 1px solid rgba(15, 86, 255, 0.15); backdrop-filter: blur(10px); box-shadow: 0 8px 16px rgba(15, 86, 255, 0.05);">
                                <div style="color: #0f56ff; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 15px;">TODAY'S GLOBAL PRAYER</div>
                                <div style="color: #333; font-size: 16px; line-height: 1.9; white-space: pre-line;">{prayer_data.get('content', '')}</div>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- CTA Section -->
                    <tr>
                        <td class="content-padding" style="padding: 0 30px 30px;">
                            <div style="background: linear-gradient(135deg, rgba(15, 86, 255, 0.05) 0%, rgba(31, 60, 136, 0.03) 100%); border-radius: 12px; padding: 25px; text-align: center;">
                                <p style="color: #1e1e1e; font-size: 16px; font-weight: 600; margin: 0 0 15px 0;">Join Our Global Prayer Community</p>
                                <p class="cta-text" style="color: #666; font-size: 14px; margin: 0 0 20px 0; line-height: 1.6;">Join thousands of believers in a unified mission of faith, hope, and spiritual growth.</p>
                                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                                    <tr>
                                        <td align="center">
                                            <a href="https://divinebridge.io/prayers" style="display: inline-block; background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 15px; margin: 5px;">Request a Prayer</a>
                                        </td>
                                    </tr>
                                </table>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-top: 1px solid #e0e0e0;">
                            <p style="font-size: 15px; color: #333; margin: 0;">Blessings,<br><span style="color: #0f56ff; font-weight: 600;">The Divine Bridge Team</span></p>
                        </td>
                    </tr>
                    
                    <!-- Unsubscribe -->
                    <tr>
                        <td style="background: #f8f9fa; padding: 0 30px 30px;">
                            <p style="font-size: 12px; color: #999; text-align: center; margin: 0;">
                                <a href="https://divinebridge.io/unsubscribe?email={recipient_email}" style="color: #0f56ff; text-decoration: underline;">Unsubscribe</a> | 
                                <a href="https://divinebridge.io/privacy-policy" style="color: #0f56ff; text-decoration: underline;">Privacy Policy</a>
                            </p>
                        </td>
                    </tr>
                    
                </table>
                
                <!-- Footer Logo -->
                <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; margin-top: 20px;">
                    <tr>
                        <td align="center">
                            <p style="color: rgba(255, 255, 255, 0.9); font-size: 13px; margin: 10px 0;">
                                © 2025 Divine Bridge. All rights reserved.
                            </p>
                            <p style="color: rgba(255, 255, 255, 0.7); font-size: 12px; margin: 5px 0;">
                                <a href="https://divinebridge.io" style="color: rgba(255, 255, 255, 0.9); text-decoration: none;">divinebridge.io</a>
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


# Singleton instance
_email_service = None

def get_email_service():
    """Get or create the email service singleton"""
    global _email_service
    if _email_service is None:
        _email_service = EnhancedEmailService()
    return _email_service

