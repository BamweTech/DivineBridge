# Firebase Send Email Extension Troubleshooting

## Issue: Documents Created But No Emails Sent

If documents are being created in the `mail_new_user` collection but emails are not being sent, follow these steps:

---

## Step 1: Verify Extension is Installed and Active

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **divinebridge**
3. Navigate to **Extensions** (or **Build** → **Extensions**)
4. Look for **"Send emails via SMTP"** or **"Trigger Email"** extension
5. Verify it shows **Active** status (not Paused or Error)

**If extension is not installed:**
- Click **"Browse Extensions"** or **"Install Extension"**
- Search for "Send Email" or "Trigger Email"
- Install and configure it (see FIREBASE_EMAIL_EXTENSION_SETUP.md)

---

## Step 2: Verify Extension Configuration

Check that the extension is configured to monitor the correct collection:

1. Click on your Send Email extension
2. Go to **Configuration** tab
3. Verify **Collection Path** is set to: `mail_new_user`
4. Verify **SMTP Connection URI** is correct (e.g., `smtps://smtp.gmail.com:465`)
5. Verify **SMTP Password** is set (Gmail App Password if using Gmail)
6. Verify **Default FROM Address** is set
7. Click **Save** if you made any changes

---

## Step 3: Check Extension Logs

1. In Firebase Console → Extensions → Your Send Email extension
2. Click on **Logs** tab
3. Look for:
   - Error messages
   - "Processing document" messages
   - "Email sent successfully" messages
   - SMTP connection errors
   - Authentication errors

**Common log errors:**
- `SMTP authentication failed` → Check SMTP password/credentials
- `Connection refused` → Check SMTP connection URI
- `Collection not found` → Verify collection name matches exactly
- `Document format invalid` → Check document structure

---

## Step 4: Verify Document Structure

The document structure should match exactly:

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

**Required fields:**
- ✅ `to` (string) - recipient email address
- ✅ `message` (object) - email content
  - ✅ `subject` (string) - email subject
  - ✅ `text` (string) - plain text version
  - ✅ `html` (string) - HTML version

**To verify your documents:**
1. Go to Firestore Console → `mail_new_user` collection
2. Open a document
3. Verify all required fields are present
4. Check that field names match exactly (case-sensitive)

---

## Step 5: Test the Extension Manually

### Option A: Create a Test Document

1. Go to Firestore Console → `mail_new_user` collection
2. Click **Add Document**
3. Use auto-generated ID
4. Add these fields:
   - Field: `to` (string) → Value: `jeancalmere.kubwayo@divinebridge.io`
   - Field: `message` (map) → Add nested fields:
     - `subject` (string) → `Test Email`
     - `text` (string) → `This is a test email`
     - `html` (string) → `<html><body><p>This is a test email</p></body></html>`
5. Click **Save**
6. Check extension logs to see if it processes the document
7. Check your email inbox

### Option B: Check if Extension Processes Documents

1. Create a test document (as above)
2. Wait 1-2 minutes
3. Check extension logs for processing activity
4. If no activity, the extension might not be monitoring the collection

---

## Step 6: Common Issues and Solutions

### Issue: Extension Not Processing Documents

**Possible causes:**
1. Collection name mismatch
2. Extension not active
3. Extension configuration error

**Solutions:**
- Verify collection name is exactly `mail_new_user` (case-sensitive)
- Restart the extension (disable and re-enable)
- Check extension status in Firebase Console

### Issue: SMTP Authentication Errors

**Error in logs:** `SMTP authentication failed` or `535 Authentication failed`

**Solutions:**
- For Gmail: Use an **App Password** (not your regular password)
  - Go to Google Account → Security → 2-Step Verification → App Passwords
  - Generate a new app password
  - Use it in the extension configuration
- Verify SMTP connection URI format:
  - Gmail: `smtps://smtp.gmail.com:465`
  - Other: Check your email provider's SMTP settings

### Issue: Connection Refused

**Error in logs:** `Connection refused` or `ECONNREFUSED`

**Solutions:**
- Verify SMTP server address and port
- Check firewall settings
- Verify SMTP connection URI format is correct
- Try different port (465 for SSL, 587 for TLS)

### Issue: Emails Going to Spam

**Solutions:**
- Configure SPF/DKIM/DMARC records (see EMAIL_CONFIGURATION_GUIDE.md)
- Use a custom domain for sending emails
- Avoid spam trigger words in subject/content
- Include unsubscribe link

### Issue: Extension Shows Errors

**Solutions:**
- Check extension logs for specific error messages
- Verify all required configuration fields are set
- Try disabling and re-enabling the extension
- Check Firebase project billing (some extensions require billing enabled)

---

## Step 7: Verify Extension is Monitoring Collection

1. Create a test document in `mail_new_user`
2. Wait 30-60 seconds
3. Check extension logs for:
   - "Processing document" message
   - Any error messages
4. If no activity appears, the extension might not be monitoring the collection

**If extension is not processing:**
- Verify collection path in extension configuration
- Check if extension has proper permissions
- Try reinstalling the extension

---

## Step 8: Check Email Service Limits

Some email services have rate limits:

- **Gmail:** 500 emails/day (free), 2000/day (Google Workspace)
- **SendGrid:** 100/day (free tier)
- **AWS SES:** Starts with sandbox mode (limited)

**If you've hit limits:**
- Wait 24 hours for limits to reset
- Upgrade your email service plan
- Use a different email service

---

## Step 9: Manual Verification Checklist

- [ ] Extension is installed and shows "Active" status
- [ ] Collection path is set to `mail_new_user`
- [ ] SMTP credentials are correct
- [ ] Test document was created in Firestore
- [ ] Extension logs show processing activity
- [ ] No errors in extension logs
- [ ] Email service limits not exceeded
- [ ] Checked spam/junk folder
- [ ] Email address is correct: `jeancalmere.kubwayo@divinebridge.io`

---

## Quick Test Script

Run this to verify document structure:

```python
from firebase_admin import firestore
from firebase_auth import initialize_firebase, get_firestore_client

initialize_firebase()
db = get_firestore_client()

# Check latest document
docs = list(db.collection('mail_new_user').order_by('__name__', direction=firestore.Query.DESCENDING).limit(1).stream())
if docs:
    doc = docs[0]
    data = doc.to_dict()
    print(f"Document ID: {doc.id}")
    print(f"Has 'to': {'to' in data}")
    print(f"Has 'message': {'message' in data}")
    if 'message' in data:
        msg = data['message']
        print(f"Message has 'subject': {'subject' in msg}")
        print(f"Message has 'text': {'text' in msg}")
        print(f"Message has 'html': {'html' in msg}")
```

---

## Next Steps

If emails are still not being sent after checking all the above:

1. **Check Extension Logs** - Most important step
2. **Verify SMTP Credentials** - Use App Password for Gmail
3. **Test with Manual Document** - Create a test document to verify extension works
4. **Contact Support** - If extension shows errors, check Firebase support

---

## Additional Resources

- [Firebase Extensions Documentation](https://firebase.google.com/products/extensions)
- [Send Email Extension GitHub](https://github.com/firebase/extensions/tree/master/firestore-send-email)
- [Gmail App Passwords](https://support.google.com/accounts/answer/185833)

