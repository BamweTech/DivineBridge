# Google Sign-In Setup Guide

## Issue
Users are trying to sign in with Google credentials but it's not working.

## Root Cause
Google OAuth sign-in needs to be properly configured in Firebase Console.

---

## Step-by-Step Setup

### Step 1: Enable Google Sign-In in Firebase

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **divinebridge**
3. Navigate to **Authentication** → **Sign-in method**
4. Click on **Google** in the providers list
5. Toggle the **Enable** switch to ON
6. Click **Save**

### Step 2: Authorize Domains

In the same Authentication section:

1. Go to **Settings** tab
2. Scroll to **Authorized domains**
3. Ensure these domains are listed:
   - ✅ `divinebridge.io`
   - ✅ `divinebridge-853408757178.us-central1.run.app`
   - ✅ `localhost` (for local testing)

4. If missing, click **Add domain** and add them

### Step 3: Configure OAuth Consent Screen (if needed)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project: **divinebridge**
3. Navigate to **APIs & Services** → **OAuth consent screen**
4. Fill in required fields:
   - **App name**: Divine Bridge
   - **User support email**: Your email
   - **Developer contact email**: Your email
   - **Authorized domains**: `divinebridge.io`
5. Add scopes (if not already added):
   - `email`
   - `profile`
   - `openid`
6. Save and continue

### Step 4: Verify OAuth Client ID

1. In Firebase Console → **Authentication** → **Sign-in method** → **Google**
2. Note the **Web SDK configuration** section
3. Verify the **Client ID** is shown
4. This should automatically work with Firebase's configuration

---

## Testing Google Sign-In

### From the Website:
1. Go to https://divinebridge.io/login
2. Click "Continue with Google"
3. Select your Google account
4. Should redirect to `/prayers` after successful login

### Expected Flow:
1. **Client**: User clicks "Continue with Google"
2. **Firebase**: Opens Google OAuth popup
3. **Google**: User selects account and authorizes
4. **Firebase**: Returns ID token
5. **Client**: Sends ID token to `/api/auth/login`
6. **Server**: Verifies token and creates session
7. **Client**: Redirects to Prayer Room

### Common Issues:

#### Issue 1: Popup Blocked
**Symptom**: Nothing happens when clicking Google sign-in
**Solution**: Check browser console for popup blocker warnings

#### Issue 2: "Unauthorized domain"
**Symptom**: Error in popup: "This app is blocked"
**Solution**: Add `divinebridge.io` to authorized domains (Step 2 above)

#### Issue 3: "OAuth client not found"
**Symptom**: "Error 400: invalid_client"
**Solution**: Ensure Google sign-in is enabled in Firebase (Step 1)

#### Issue 4: CORS errors
**Symptom**: Network errors in console
**Solution**: Verify authorized domains include your domain

---

## Debugging

### Check Browser Console:
1. Open DevTools (F12)
2. Go to Console tab
3. Look for errors when clicking "Continue with Google"
4. Common errors:
   - `auth/unauthorized-domain`
   - `auth/popup-blocked`
   - `auth/popup-closed-by-user`

### Check Firebase Logs:
```bash
# Check recent authentication events
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=divinebridge AND httpRequest.requestUrl=~\"/api/auth/\"" --limit 50 --project=divinebridge
```

---

## Current Status

### ✅ What's Working:
- Email/password authentication
- Session management
- Firestore profile creation
- Email verification

### ⚠️ Needs Configuration:
- Google OAuth sign-in (check Step 1-3 above)

---

## Quick Fix Checklist

- [ ] Enable Google provider in Firebase Console
- [ ] Verify `divinebridge.io` is in authorized domains
- [ ] Test Google sign-in on https://divinebridge.io/login
- [ ] Check browser console for any client-side errors
- [ ] Verify OAuth consent screen is configured

---

## After Enabling Google Sign-In

Once Google OAuth is enabled:
1. ✅ Users can sign in with their Google account
2. ✅ Firestore profile auto-created with `email_subscribed: true`
3. ✅ Users automatically subscribed to Sunday emails
4. ✅ Seamless one-click authentication

**Most likely fix**: Just enable Google in Firebase Console Authentication → Sign-in method! 🔐✨

