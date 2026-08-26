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
        <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #0066cc; font-size: 24px; margin-bottom: 10px;">Divine Bridge</h1>
        </div>

        <div style="margin-bottom: 20px;">
            <p style="font-size: 16px; line-height: 1.6;">Dear {first_name},</p>
            <p style="font-size: 16px; line-height: 1.6;">Welcome to Divine Bridge! We are delighted to have you join our global prayer community.</p>
        </div>

        <div style="background: #f5f7fa; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h2 style="color: #0066cc; font-size: 18px; margin-bottom: 15px; text-align: center;">Today's Prayer</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #333; white-space: pre-line;">{prayer}</p>
        </div>

        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="font-size: 14px; color: #666;">Blessings,<br>The Divine Bridge team</p>
        </div>
    </div>
    """

    return subject, body
