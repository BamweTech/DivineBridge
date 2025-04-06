from flask import Flask, render_template, request, jsonify, redirect
from sheet_handler import SheetHandler
from email_sender import EmailSender
from scheduler import PrayerScheduler
from email_templates import get_welcome_email_template
import logging
import json
import random
from datetime import datetime
import os
import atexit
from welcome_email import send_welcome_email
import threading
from prayer_generator import PrayerGenerator
from logging_config import setup_logging
from config import get_config
from verse_cache import verse_cache

# Set up logging
loggers = setup_logging()
logger = loggers['app']

# Get configuration
config = get_config()

app = Flask(__name__)
sheet_handler = SheetHandler()
email_sender = EmailSender()

# Initialize components
prayer_generator = PrayerGenerator()

# Initialize and start scheduler in a separate thread
# Only start the scheduler in the main process, not in the reloader
if not os.environ.get('WERKZEUG_RUN_MAIN'):
    try:
        logger.info("Initializing prayer scheduler")
        scheduler = PrayerScheduler(prayer_generator=prayer_generator, email_sender=email_sender)
        scheduler_thread = threading.Thread(target=scheduler.run)
        scheduler_thread.daemon = True
        scheduler_thread.start()
        logger.info("Prayer scheduler thread started")
        
        # Register cleanup function
        def cleanup():
            logger.info("Cleaning up prayer scheduler")
            scheduler.scheduler.shutdown()
        atexit.register(cleanup)
    except Exception as e:
        logger.error(f"Failed to initialize prayer scheduler: {e}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/prayer')
def get_prayer():
    try:
        # Get today's prayer from Cloud Storage
        today = datetime.now().strftime('%Y-%m-%d')
        prayer = prayer_generator.storage.get_prayer(today)
        
        if not prayer:
            logger.error(f"Prayer not found for today ({today})")
            return jsonify({
                'success': False,
                'message': 'Prayer not found'
            }), 404
            
        return jsonify({
            'success': True,
            'prayer': prayer
        })
        
    except Exception as e:
        logger.error(f"Error getting prayer: {e}")
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/subscribe', methods=['POST'])
def subscribe():
    try:
        data = request.get_json()
        
        # Get form data
        email = data.get('email')
        first_name = data.get('firstName')
        last_name = data.get('lastName')
        
        # Validate all required fields
        if not email:
            return jsonify({'success': False, 'message': 'Email is required'}), 400
        if not first_name:
            return jsonify({'success': False, 'message': 'First name is required'}), 400
        if not last_name:
            return jsonify({'success': False, 'message': 'Last name is required'}), 400
            
        # Add subscriber to sheet
        sheet_handler.add_subscriber(email, first_name, last_name)
        
        # Send welcome email
        send_welcome_email(email, first_name)
        
        return jsonify({'success': True, 'message': 'Successfully subscribed!'})
        
    except Exception as e:
        logger.error(f"Error in subscribe route: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/unsubscribe', methods=['GET', 'POST'])
def unsubscribe_page():
    """Show unsubscribe page with email input form."""
    try:
        if request.method == 'POST':
            email = request.form.get('email')
            if not email:
                return render_template('unsubscribe.html', 
                                     error="Please enter your email address",
                                     sender_email=config.EMAIL_USER)
            
            # Redirect to confirm-unsubscribe with the email
            return redirect(f'/confirm-unsubscribe?email={email}')
            
        # Get email from URL parameter for GET requests
        email = request.args.get('email')
        return render_template('unsubscribe.html', 
                             email=email,
                             sender_email=config.EMAIL_USER)
    except Exception as e:
        logger.error(f"Error showing unsubscribe page: {e}")
        return redirect('/')

@app.route('/confirm-unsubscribe', methods=['GET', 'POST'])
def confirm_unsubscribe():
    """Handle unsubscribe confirmation."""
    try:
        if request.method == 'POST':
            email = request.form.get('email')
        else:
            email = request.args.get('email')
            
        if not email:
            return redirect('/unsubscribe')
            
        # Unsubscribe the user
        sheet_handler = SheetHandler()
        success = sheet_handler.unsubscribe(email)
        
        if success:
            # Send confirmation email
            email_sender = EmailSender()
            email_sender.send_unsubscribe_confirmation(email)
            return render_template('unsubscribe_confirmation.html',
                                 sender_email=config.EMAIL_USER)
        else:
            return render_template('unsubscribe.html',
                                 error="Email not found. Please check your email address and try again.",
                                 sender_email=config.EMAIL_USER)
            
    except Exception as e:
        logger.error(f"Error processing unsubscribe confirmation: {e}")
        return redirect('/unsubscribe')

@app.route('/api/today-verse')
def get_today_verse():
    """API endpoint to get today's verse from cache."""
    try:
        verse = verse_cache.get_today_verse()
        if verse:
            return jsonify({
                'verse': verse['text'],
                'reference': verse['reference'],
                'success': True
            })
        return jsonify({
            'error': 'No verse available for today',
            'success': False
        }), 404
    except Exception as e:
        logger.error(f"Error in get_today_verse: {str(e)}")
        return jsonify({
            'error': 'Internal server error',
            'success': False
        }), 500

if __name__ == '__main__':
    app.run(debug=config.DEBUG, port=5001) 