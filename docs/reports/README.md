# Divine Bridge

A global prayer community that unites hearts in faith through daily prayers.

## Setup Instructions

1. Clone the repository:
```bash
git clone https://github.com/yourusername/divinebridge.git
cd divinebridge
```

2. Create and activate a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your credentials:
     ```
     # Email Configuration
     EMAIL_USER=your_email@gmail.com
     EMAIL_PASSWORD=your_app_specific_password
     SMTP_SERVER=smtp.gmail.com
     SMTP_PORT=587

     # Google Sheets Configuration
     GOOGLE_CREDENTIALS_FILE=credentials.json
     SPREADSHEET_ID=your_spreadsheet_id

     # Flask Configuration
     FLASK_ENV=development
     FLASK_APP=app.py
     ```

5. Set up Google Sheets API:
   - Go to Google Cloud Console
   - Create a new project
   - Enable Google Sheets API
   - Create service account credentials
   - Download the credentials JSON file and save as `credentials.json`
   - Share your Google Sheet with the service account email

6. Run the application:
```bash
python app.py
```

## Security Notes

- Never commit `.env` or `credentials.json` files
- Use app-specific passwords for Gmail
- Keep your credentials secure
- Regularly rotate passwords and API keys

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 