from flask import Flask, render_template, request, jsonify
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
from dotenv import load_dotenv
import threading

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = Flask(__name__)
sheet_handler = SheetHandler('divinebridge-676c7c0963dd.json')
email_sender = EmailSender()
prayer_scheduler = PrayerScheduler()

# Initialize and start the prayer scheduler in a background thread
scheduler_thread = threading.Thread(target=prayer_scheduler.run, daemon=True)
scheduler_thread.start()

def load_bible_verses():
    try:
        with open('static/bible_verses.json', 'r') as file:
            data = json.load(file)
            return data['verses']
    except Exception as e:
        logger.error(f"Error loading Bible verses: {e}")
        return []

def get_daily_verse():
    verses = load_bible_verses()
    if not verses:
        return {
            "text": "Do you not know that you are God's temple and that God's Spirit dwells in you?",
            "reference": "1 Corinthians 3:16"
        }
    
    # Use the day of the year as a seed for consistent daily selection
    day_of_year = datetime.now().timetuple().tm_yday
    random.seed(day_of_year)
    verse = random.choice(verses)
    random.seed()  # Reset the seed
    return verse

@app.route('/')
def index():
    daily_verse = get_daily_verse()
    return render_template('index.html', verse=daily_verse)

@app.route('/prayer')
def get_prayer():
    try:
        # Get today's prayer
        today = datetime.now().strftime('%Y-%m-%d')
        prayer_file = f'prayers/{today}.txt'
        
        if not os.path.exists(prayer_file):
            logger.error(f"Prayer file for today ({prayer_file}) not found")
            return jsonify({
                'success': False,
                'message': 'Prayer not found'
            }), 404
            
        with open(prayer_file, 'r') as file:
            prayer = file.read().strip()
            
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
        send_welcome_email(first_name, email)
        
        return jsonify({'success': True, 'message': 'Successfully subscribed!'})
        
    except Exception as e:
        logger.error(f"Error in subscribe route: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/verse')
def get_verse():
    try:
        verse = get_daily_verse()
        return jsonify({
            'success': True,
            'verse': verse['text'],
            'reference': verse['reference']
        })
    except Exception as e:
        logger.error(f"Error getting daily verse: {e}")
        return jsonify({
            'success': False,
            'message': 'Error getting daily verse'
        }), 500

if __name__ == '__main__':
    app.run(debug=True) 