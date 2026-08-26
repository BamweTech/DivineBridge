# 🔍 Authentication Flow Analysis - Deployment Issue

## The Problem

**User Flow:**
1. User logs in → Flask session created (stored in `flask_session/` directory)
2. New Cloud Run deployment → **Container restarts, session files are LOST** (Cloud Run is stateless)
3. User clicks "Create Room" → Frontend sends request with:
   - Firebase ID token (in Authorization header)
   - Flask session cookie (points to non-existent session file)
4. Backend receives request:
   - Tries Firebase ID token verification first
   - If that fails, falls back to Flask session
   - Session file doesn't exist → Returns 401
5. Frontend tries to refresh Firebase token
6. If refresh fails or network error → User sees error
7. User has to logout/login to get new session

## Root Cause

**Cloud Run is stateless** - Flask sessions stored in files (`flask_session/`) are lost on every deployment or container restart. This means:
- Session files are ephemeral
- Session cookies become invalid after deployments
- Backend can't verify old session cookies

## Current Flow (Problematic)

### Frontend (`prayer-rooms.js`)
```javascript
async makeAuthenticatedRequest(url, options) {
    // 1. Get Firebase ID token (cached)
    let idToken = await this.getFirebaseIdToken(false);
    
    // 2. Make request with token
    let response = await makeRequest(idToken);
    
    // 3. If 401, refresh token
    if (response.status === 401) {
        idToken = await this.getFirebaseIdToken(true); // Force refresh
        response = await makeRequest(idToken); // Retry
    }
}
```

**Issues:**
- `getFirebaseIdToken` has 2-second timeout - might be too short
- If Firebase auth state isn't ready, returns null
- No retry logic if token refresh fails

### Backend (`prayer_room_bp.py`)
```python
def get_user_from_session():
    # 1. Try Firebase ID token first
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        try:
            decoded_token = auth.verify_id_token(id_token)
            return user_data
        except Exception as e:
            logging.warning(f"Token verification failed: {e}")
            # Falls through to session check
    
    # 2. Fallback to Flask session (PROBLEM: Session file doesn't exist after deployment)
    user = session.get('user')
    if not user:
        return None  # Returns 401
```

**Issues:**
- Firebase token verification errors are logged but not detailed
- Falls back to session which is unreliable after deployments
- No specific error messages to help debug

## The Fix Strategy

### 1. **Improve Firebase Token Handling (Frontend)**
- Increase timeout for auth state check
- Add retry logic for token refresh
- Better error messages
- Ensure we wait for Firebase auth to be fully ready

### 2. **Improve Backend Token Verification**
- More detailed error logging
- Better error messages for debugging
- Don't silently fall back to session if token verification fails with specific errors
- Add retry logic for transient Firebase API errors

### 3. **Add Session Regeneration (Backend)**
- If Firebase token is valid but session is missing, regenerate session
- This allows Flask session to work again after deployment

### 4. **Better Error Handling**
- Frontend should show clear error messages
- Backend should return specific error codes
- Logging should help diagnose issues

## Implementation Plan

### Phase 1: Frontend Improvements
- [ ] Increase `getFirebaseIdToken` timeout to 5 seconds
- [ ] Add retry logic for token refresh failures
- [ ] Better error messages for users
- [ ] Ensure Firebase auth is fully initialized before making requests

### Phase 2: Backend Improvements
- [ ] Improve Firebase token verification error handling
- [ ] Add session regeneration when Firebase token is valid
- [ ] Better error logging with full stack traces
- [ ] Return specific error codes for different failure types

### Phase 3: Testing
- [ ] Test authentication flow after deployment
- [ ] Test with expired tokens
- [ ] Test with network errors
- [ ] Test token refresh scenarios

