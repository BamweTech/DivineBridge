# Admin AI Assistant Setup Guide

## Overview

The Admin AI Assistant is a passcode-protected chat interface that allows you to:
- Post tasks and questions
- Automatically fetch and analyze logs from the last hour
- Receive detailed email summaries at jeancalmere.kubwayo@divinebridge.io

## Access

**URL:** `https://divinebridge-853408757178.us-central1.run.app/admin/login`

**Default Passcode:** `divinebridge2024` (⚠️ **CHANGE THIS IN PRODUCTION!**)

## Setting a Custom Passcode

### Step 1: Generate Passcode Hash

```bash
python -c "import hashlib; print(hashlib.sha256('your_secure_passcode'.encode()).hexdigest())"
```

### Step 2: Set in Cloud Run

```bash
gcloud run services update divinebridge --region=us-central1 \
  --set-env-vars ADMIN_PASSCODE_HASH=$(python -c "import hashlib; print(hashlib.sha256('your_secure_passcode'.encode()).hexdigest())")
```

### Step 3: Redeploy (if needed)

The environment variable will be available immediately, but you may need to redeploy if the service was already running.

## How It Works

1. **Login**: Enter passcode at `/admin/login`
2. **Post Task**: Type your task/question in the chat interface
3. **Processing**: 
   - System fetches logs from Cloud Logging (last hour)
   - Analyzes errors, warnings, and patterns
   - Creates comprehensive summary
4. **Email**: Summary sent to `jeancalmere.kubwayo@divinebridge.io`

## Features

### Log Analysis

The system automatically:
- ✅ Fetches ERROR and WARNING level logs from last hour
- ✅ Analyzes patterns (authentication, audio, scheduler, database issues)
- ✅ Identifies critical errors and warnings
- ✅ Provides context with recent INFO logs

### Email Summary Includes

- 📝 Your original task/question
- 📊 System status overview
- ❌ Error details (up to 10 most recent)
- ⚠️ Warning details (up to 10 most recent)
- 🔍 Detected patterns and trends
- ℹ️ Recent important activity

## Security

- **Passcode Protection**: SHA256 hashed passcodes
- **Session-based Auth**: Flask sessions for authenticated state
- **CSRF Exempt**: Admin routes are exempt from CSRF (passcode protects instead)
- **Environment Variables**: Passcode hash stored in Cloud Run env vars (not in code)

## Troubleshooting

### Cannot Access Admin Panel

1. Check passcode is correct
2. Verify `ADMIN_PASSCODE_HASH` is set in Cloud Run
3. Check browser console for errors
4. Verify session is working (check cookies)

### Logs Not Fetching

1. Verify Google Cloud Logging API is enabled
2. Check service account has `logging.logEntries.list` permission
3. Review Cloud Run logs for errors

### Email Not Sending

1. Check email credentials in Secret Manager
2. Verify SMTP settings
3. Check Cloud Run logs for email errors
4. Confirm recipient email is correct: `jeancalmere.kubwayo@divinebridge.io`

## API Endpoints

### POST `/admin/api/message`

Process a task and send email summary.

**Request:**
```json
{
  "message": "Check for any authentication errors in the last hour"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Task processed successfully. Email summary sent.",
  "logs_fetched": 45,
  "errors_found": 3,
  "email_sent": true
}
```

### POST `/admin/logout`

Logout from admin panel.

## Files

- `routes/admin_bp.py` - Admin blueprint and API endpoints
- `templates/admin_login.html` - Login page
- `templates/admin_ai_assistant.html` - Chat interface
- `docs/guides/ADMIN_AI_ASSISTANT_SETUP.md` - This guide

## Example Tasks

- "Check for authentication errors"
- "Analyze WebRTC connection issues"
- "Review scheduler errors from the last hour"
- "What errors occurred after the latest deployment?"
- "Check for database connection issues"

