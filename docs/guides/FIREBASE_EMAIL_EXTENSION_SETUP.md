# Firebase Send Email Extension Setup Guide

## Overview
This guide explains how to set up the Firebase "Send Email" extension to send email notifications when new users sign up.

## Prerequisites
- Firebase project: `divinebridge`
- Firebase Send Email extension installed
- Access to Firebase Console

---

## Step 1: Configure the Firebase Send Email Extension

### 1.1 Access Firebase Extensions
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **divinebridge**
3. In the left sidebar, click **Extensions** (or **Build** → **Extensions**)

### 1.2 Find the Send Email Extension
1. Look for **"Send emails via SMTP"** or **"Trigger Email"** extension
2. If not installed, click **"Install extension"** or **"Browse Extensions"**
3. Search for "Send Email" or "Trigger Email"

### 1.3 Configure Extension Settings

When installing/editing the extension, configure these settings:

**Collection Path:**
```
mail_new_user
```

**SMTP Connection URI:**
- If using Gmail: `smtps://smtp.gmail.com:465`
- Or use your SMTP server credentials

**SMTP Password:**
- Your email service password (Gmail App Password if using Gmail)

**Default FROM Address:**
```
noreply@divinebridge.io
```
(Or your preferred sender email)

**Default REPLY-TO Address:**
```
jeancalmere.kubwayo@divinebridge.io
```

### 1.4 Extension Configuration Details

The extension will:
- Monitor the `mail_new_user` collection
- Automatically send emails when new documents are added
- Mark documents as processed after sending

---

## Step 2: Verify Collection Structure

The collection will be created automatically when your code writes the first document. The document structure should match:

```json
{
  "to": "jeancalmere.kubwayo@divinebridge.io",
  "message": {
    "subject": "New User Signup: John Doe",
    "text": "Plain text email content...",
    "html": "<html>HTML email content...</html>"
  }
}
```

---

## Step 3: Test the Setup

### 3.1 Test Locally
1. Create a test user account through your signup form
2. Check Firestore Console → Firestore Database → `mail_new_user` collection
3. Verify a document was created with the correct structure

### 3.2 Check Extension Logs
1. In Firebase Console → Extensions
2. Click on your Send Email extension
3. View **Logs** tab to see if emails are being sent
4. Check for any errors

### 3.3 Verify Email Delivery
1. Check the inbox of `jeancalmere.kubwayo@divinebridge.io`
2. Verify the email was received
3. Check spam folder if not in inbox

---

## Step 4: Firestore Security Rules (Optional)

The collection is written to using Firebase Admin SDK (server-side), which bypasses security rules. However, if you want to add explicit rules:

```javascript
// In firestore.rules
match /mail_new_user/{document=**} {
  // Allow extension to read/write
  allow read, write: if false; // Extension uses admin privileges
}
```

**Note:** The extension runs with admin privileges, so it doesn't need explicit rules.

---

## Step 5: Troubleshooting

### Emails Not Sending?

1. **Check Extension Status:**
   - Firebase Console → Extensions → Your extension
   - Verify it's **Active** and not showing errors

2. **Check Extension Logs:**
   - View logs in the extension dashboard
   - Look for error messages

3. **Verify Document Structure:**
   - Check Firestore → `mail_new_user` collection
   - Ensure documents have `to` and `message` fields
   - Verify `message.subject`, `message.text`, and `message.html` exist

4. **Check SMTP Credentials:**
   - Verify SMTP connection URI is correct
   - Ensure password/credentials are valid
   - For Gmail, use an App Password (not regular password)

5. **Check Email Limits:**
   - Some SMTP services have rate limits
   - Verify you haven't exceeded daily limits

### Common Issues

**Issue:** Extension not triggering
- **Solution:** Verify collection name matches exactly: `mail_new_user`
- **Solution:** Check extension configuration in Firebase Console

**Issue:** Emails going to spam
- **Solution:** Configure SPF/DKIM/DMARC records (see EMAIL_CONFIGURATION_GUIDE.md)
- **Solution:** Use a custom domain for sending emails

**Issue:** SMTP authentication errors
- **Solution:** For Gmail, generate an App Password
- **Solution:** Verify SMTP connection URI format

---

## Step 6: Monitor and Maintain

### Regular Checks:
1. Monitor extension logs weekly
2. Verify emails are being sent successfully
3. Check for failed document processing
4. Review email delivery rates

### Maintenance:
- Update SMTP credentials if they expire
- Monitor extension usage and costs
- Review and optimize email templates

---

## Quick Reference

**Collection Name:** `mail_new_user`

**Document Structure:**
```json
{
  "to": "recipient@email.com",
  "message": {
    "subject": "Email Subject",
    "text": "Plain text version",
    "html": "<html>HTML version</html>"
  }
}
```

**Extension Location:**
- Firebase Console → Extensions → Send Email Extension

**Logs Location:**
- Firebase Console → Extensions → [Your Extension] → Logs

---

## Additional Resources

- [Firebase Extensions Documentation](https://firebase.google.com/products/extensions)
- [Send Email Extension Docs](https://github.com/firebase/extensions/tree/master/firestore-send-email)
- [Email Configuration Guide](./EMAIL_CONFIGURATION_GUIDE.md)

---

## Support

If you encounter issues:
1. Check extension logs in Firebase Console
2. Review Firestore documents in `mail_new_user` collection
3. Verify SMTP credentials are correct
4. Check email service provider status

