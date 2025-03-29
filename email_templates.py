def get_welcome_email_template(first_name, prayer):
    """
    Generate the welcome email template
    Args:
        first_name (str): The recipient's first name
        prayer (str): The prayer content
    Returns:
        tuple: A tuple containing the subject and body of the email
    """
    subject = "Welcome to Divine Bridge"
    body = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #0066cc; font-size: 28px; margin-bottom: 10px;">Divine Bridge</h1>
                <p style="color: #666; font-size: 16px;">Uniting Hearts in Global Prayer</p>
            </div>

            <div style="margin-bottom: 30px;">
                <p style="font-size: 16px; line-height: 1.6;">Dear {first_name},</p>
                <p style="font-size: 16px; line-height: 1.6;">Welcome to Divine Bridge! We are delighted to have you join our global prayer community.</p>
                <p style="font-size: 16px; line-height: 1.6; font-style: italic; margin-top: 10px;">Thank you for joining us in prayer today. As we unite our hearts in faith, we lift up those affected by global events, seeking God's comfort, healing, and divine intervention.</p>
            </div>

            <div style="background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); padding: 25px; border-radius: 15px; margin: 30px 0; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                <h2 style="color: #0066cc; font-size: 20px; margin-bottom: 15px; text-align: center;">Today's Prayer</h2>
                <p style="font-size: 16px; line-height: 1.8; color: #444; white-space: pre-line;">{prayer}</p>
            </div>

            <div style="margin-top: 30px;">
                <p style="font-size: 16px; line-height: 1.6;">We look forward to sharing more prayers with you in the days ahead.</p>
            </div>

            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="font-size: 16px; line-height: 1.6; color: #666;">Blessings,<br>The Divine Bridge team</p>
                <p style="font-size: 14px; color: #999; margin-top: 20px;">If you have any questions, please contact us at <a href="mailto:divinebridge.prayer@gmail.com" style="color: #0066cc; text-decoration: none;">divinebridge.prayer@gmail.com</a></p>
            </div>
        </div>
        """
    
    return subject, body 