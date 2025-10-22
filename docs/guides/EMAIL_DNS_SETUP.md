# Email DNS Setup Guide - Fix Spam Issue

## Problem
Emails from `blessings@divinebridge.io` are going to spam because proper email authentication records are missing.

## Solution: Add DNS Records

You need to add **SPF**, **DKIM**, and **DMARC** records to your DNS provider (where you manage `divinebridge.io`).

---

## Step 1: Add SPF Record

**What it does:** Tells email providers that Gmail is authorized to send emails on behalf of `divinebridge.io`.

### DNS Record to Add:
```
Type: TXT
Host: @  (or leave blank for root domain)
Value: v=spf1 include:_spf.google.com ~all
TTL: 3600
```

---

## Step 2: Generate and Add DKIM Record

**What it does:** Cryptographically signs your emails to prove they're legitimate.

### For Google Workspace / Gmail:
1. Go to [Google Admin Console](https://admin.google.com) (if using Google Workspace)
2. Navigate to **Apps** → **Google Workspace** → **Gmail** → **Authenticate email**
3. Click **Generate New Record**
4. Select domain: `divinebridge.io`
5. Copy the DKIM key provided

### DNS Record to Add:
```
Type: TXT
Host: google._domainkey
Value: v=DKIM1; k=rsa; p=[YOUR_PUBLIC_KEY_FROM_GOOGLE]
TTL: 3600
```

### If using regular Gmail (not Workspace):
You'll need to use your email provider's DKIM key or use a service like **SendGrid** or **Mailgun** for proper DKIM.

---

## Step 3: Add DMARC Record

**What it does:** Tells email providers what to do with emails that fail SPF/DKIM checks.

### DNS Record to Add:
```
Type: TXT
Host: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:postmaster@divinebridge.io; pct=100
TTL: 3600
```

**Explanation:**
- `p=quarantine`: suspicious emails go to spam
- `rua=mailto:postmaster@divinebridge.io`: send reports here
- `pct=100`: apply policy to 100% of emails

---

## Step 4: Verify DNS Records

After adding the records, wait 24-48 hours for DNS propagation, then verify:

### Check SPF:
```bash
dig +short txt divinebridge.io
```
Should show: `"v=spf1 include:_spf.google.com ~all"`

### Check DKIM:
```bash
dig +short txt google._domainkey.divinebridge.io
```
Should show your DKIM key

### Check DMARC:
```bash
dig +short txt _dmarc.divinebridge.io
```
Should show: `"v=DMARC1; p=quarantine..."`

---

## Step 5: Test Email Deliverability

### Option A: Mail Tester
1. Go to https://www.mail-tester.com/
2. Send a test email to the address provided
3. Check your score (should be 8+/10)

### Option B: MXToolbox
1. Go to https://mxtoolbox.com/dmarc.aspx
2. Enter: `divinebridge.io`
3. Verify all records are present

---

## Additional Recommendations

### 1. Add Reverse DNS (PTR Record)
If you control your email server IP, add a PTR record pointing back to `divinebridge.io`.

### 2. Warm Up Your Domain
- Start sending to small groups (10-20 people)
- Gradually increase over 2-4 weeks
- Monitor bounce rates

### 3. Email Content Best Practices
- ✅ Always include plain text version (already done)
- ✅ Include unsubscribe link (already done)
- ✅ Use embedded images instead of external links (already done with base64)
- ✅ Maintain good text-to-image ratio
- ✅ Avoid spam trigger words ("free", "click here", etc.)

### 4. Monitor Deliverability
- Set up [Google Postmaster Tools](https://postmaster.google.com/)
- Register domain to track Gmail delivery
- Monitor spam complaint rates

---

## Where to Add DNS Records

Depending on where you registered `divinebridge.io`:

### GoDaddy:
1. Log in to GoDaddy
2. Go to **My Products** → **DNS**
3. Click **Add** → Select **TXT** record
4. Add each record above

### Cloudflare:
1. Log in to Cloudflare
2. Select `divinebridge.io`
3. Go to **DNS** tab
4. Click **Add record** → Select **TXT**
5. Add each record above

### Google Domains:
1. Log in to Google Domains
2. Select `divinebridge.io`
3. Go to **DNS** tab
4. Scroll to **Custom resource records**
5. Add each record above

---

## Quick Summary

Add these 3 DNS TXT records:

| Type | Host | Value |
|------|------|-------|
| TXT | @ | `v=spf1 include:_spf.google.com ~all` |
| TXT | google._domainkey | `v=DKIM1; k=rsa; p=[GET_FROM_GOOGLE]` |
| TXT | _dmarc | `v=DMARC1; p=quarantine; rua=mailto:postmaster@divinebridge.io; pct=100` |

**After adding:** Wait 24-48 hours, then test!

---

## Need Help?

If you're unsure about your DNS provider or need help adding records, provide me with:
1. Where you registered `divinebridge.io`
2. Screenshots of your DNS management panel

---

## Testing the Fix

After DNS records are added and propagated:

1. **Send test email:**
   ```bash
   curl -X POST http://localhost:5001/api/email/test-email \
     -H "Content-Type: application/json" \
     -d '{"email": "your-email@gmail.com", "firstName": "Test"}'
   ```

2. **Check inbox** (not spam!)

3. **View email headers** in Gmail:
   - Open email
   - Click three dots → "Show original"
   - Check for:
     - `SPF: PASS`
     - `DKIM: PASS`
     - `DMARC: PASS`

---

**Once these DNS records are properly configured, your emails will have a much higher chance of landing in the inbox instead of spam!** 📧✅

