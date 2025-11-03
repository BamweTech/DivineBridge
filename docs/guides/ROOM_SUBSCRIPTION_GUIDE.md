# Prayer Room Subscription System

## Overview

The Room Subscription System allows users to subscribe to their favorite prayer rooms and receive email notifications when those rooms are reopened by the host. This feature helps build recurring prayer communities and increases user engagement.

## User Flow

1. **User joins a prayer room** → Sees a "Subscribe" button in the control panel
2. **User clicks Subscribe** → Receives confirmation toast notification
3. **Host reopens the room** → All subscribers automatically receive an email
4. **User can unsubscribe** → Either from the room UI or via email link

## Key Features

### ✅ One-Click Subscribe
- Simple bell icon button in prayer room controls
- Toggle functionality (Subscribe/Unsubscribe)
- Visual feedback with color changes and toast notifications

### 📧 Beautiful Email Notifications
- Professional HTML email template
- Includes room name, host name, and join link
- Room code displayed prominently for private rooms
- Bible verse for inspiration
- One-click unsubscribe link

### 🔒 Privacy-Focused
- Subscribers list is private (only stored in database)
- Only subscriber count visible to host (future feature)
- Secure unsubscribe via unique link
- No spam - notifications only when room reopens

### 📱 Mobile & Desktop Support
- Works seamlessly on all devices
- Responsive design
- Toast notifications positioned appropriately

## Technical Implementation

### Database Structure

**Firestore Collection:** `room_subscriptions`

```javascript
{
  subscription_id: "auto-generated",
  room_id: "ABCDEF",              // Current room ID
  original_room_id: "ABCDEF",     // Tracks across reopens
  user_id: "firebase_uid",
  user_email: "user@example.com",
  user_name: "John Doe",
  room_name: "Morning Prayer",
  host_id: "host_firebase_uid",
  host_name: "Host Name",
  subscribed_at: timestamp,
  is_active: true,
  notification_preferences: {
    email: true,
    push: false  // Future enhancement
  }
}
```

### API Endpoints

#### 1. Subscribe to Room
**POST** `/api/prayer-room/<room_id>/subscribe`

**Authentication:** Required

**Response:**
```json
{
  "success": true,
  "message": "Successfully subscribed to room notifications",
  "subscribed": true
}
```

**Status Codes:**
- `200` - Successfully subscribed (or already subscribed)
- `401` - Authentication required
- `404` - Room not found
- `500` - Server error

---

#### 2. Unsubscribe from Room
**POST** `/api/prayer-room/<room_id>/unsubscribe`

**Authentication:** Required

**Response:**
```json
{
  "success": true,
  "message": "Successfully unsubscribed from room notifications",
  "subscribed": false
}
```

---

#### 3. Check Subscription Status
**GET** `/api/prayer-room/<room_id>/subscription-status`

**Authentication:** Optional (returns `false` if not authenticated)

**Response:**
```json
{
  "subscribed": true,
  "user_id": "firebase_uid"
}
```

---

#### 4. Unsubscribe via Email Link
**GET** `/api/prayer-room/unsubscribe-link?sub_id=<subscription_id>`

**Authentication:** Not required

**Response:** HTML page confirming unsubscription

## Email Template

The notification email includes:

1. **Header**: Gradient blue background with "Prayer Room is Live!" message
2. **Content Card**:
   - Personalized greeting
   - Room name and host name
   - Room code (for private rooms) in highlighted box
   - "Join Prayer Room Now" call-to-action button
   - Inspirational Bible verse (Matthew 18:20)
3. **Footer**:
   - Divine Bridge branding
   - Unsubscribe link

### Email Example

```
🙏 Prayer Room is Live!

Hello John!

Mary has opened Morning Prayer for prayer.

You're receiving this because you subscribed to updates for this prayer room.

┌─────────────────┐
│ Room Code: XYZ123│
└─────────────────┘

[Join Prayer Room Now]

🌟 "For where two or three gather in my name, there am I with them." - Matthew 18:20

Divine Bridge - Connecting Hearts in Prayer
Don't want these notifications? Unsubscribe from this room
```

## Frontend JavaScript API

### Initialize Subscription System

```javascript
window.roomSubscription.init();
```

### Check Subscription Status

```javascript
await window.roomSubscription.checkSubscriptionStatus();
console.log(window.roomSubscription.isSubscribed); // true/false
```

### Subscribe

```javascript
await window.roomSubscription.subscribe();
// Shows toast: "✓ Subscribed! You'll get notified when this room reopens."
```

### Unsubscribe

```javascript
await window.roomSubscription.unsubscribe();
// Shows toast: "✓ Unsubscribed from room notifications"
```

### Show Toast Notification

```javascript
window.roomSubscription.showToast('Message here', 'success'); // or 'error', 'info'
```

## Notification Logic

### When Room is Reopened

1. Host clicks "Reopen" on an inactive room
2. Backend creates new room with same settings
3. Backend queries `room_subscriptions` for `original_room_id`
4. For each active subscriber with `notification_preferences.email === true`:
   - Build personalized email with room details
   - Generate join URL (with room code if private)
   - Send email asynchronously
5. Room creation completes (notifications don't block)

### Original Room Tracking

Subscriptions track `original_room_id`, so if a room is reopened multiple times, subscribers still get notified. Example:

```
Room A (original) -> User subscribes
Room A closed
Room B created (reopen of A) -> User notified
Room B closed
Room C created (reopen of B) -> User notified (still linked to original A)
```

## User Experience

### Button States

**Not Subscribed:**
- Text: "Subscribe"
- Icon: Gray bell
- Tooltip: "Subscribe to room updates"

**Subscribed:**
- Text: "Subscribed"
- Icon: Green bell
- Background: Green gradient
- Tooltip: "Unsubscribe from room updates"

### Toast Notifications

**Success (Green):**
- "✓ Subscribed! You'll get notified when this room reopens."
- "✓ Unsubscribed from room notifications"

**Error (Red):**
- "Please sign in to subscribe to room updates"
- "Failed to subscribe: [error message]"

## Privacy & Anti-Spam

### Privacy Measures
- ✅ Subscriber emails never exposed to other users
- ✅ Subscriber list never displayed publicly
- ✅ Only individual subscription status visible to user
- ✅ One-click unsubscribe in every email

### Anti-Spam
- ✅ Notifications only sent when room is reopened (not on schedule)
- ✅ Each notification includes unsubscribe link
- ✅ Unsubscribe link requires no authentication
- ✅ Future: Rate limiting on notifications

## Future Enhancements

### Phase 2 (Push Notifications)
- Browser push notifications
- Mobile app push notifications
- Notification preferences (email + push, email only, push only)

### Phase 3 (Advanced Features)
- **Digest Mode**: Weekly digest of room activity
- **Quiet Hours**: Don't notify during user's sleep hours
- **Notification History**: See all past notifications
- **Subscriber Count**: Show host how many people subscribed
- **Scheduled Room Reminders**: Notify 15 minutes before scheduled rooms

### Phase 4 (Community Features)
- **Subscription Management Page**: See all subscribed rooms
- **Favorite Rooms**: Quick access to subscribed rooms
- **Room Recommendations**: "You might also like these rooms"
- **Prayer Group Management**: Create permanent prayer groups

## Testing Checklist

### Backend Tests
- [ ] Subscribe to room successfully
- [ ] Prevent duplicate subscriptions
- [ ] Unsubscribe from room successfully
- [ ] Check subscription status (authenticated)
- [ ] Check subscription status (unauthenticated)
- [ ] Unsubscribe via email link (no auth required)
- [ ] Send notifications when room is reopened
- [ ] Track subscriptions across room reopens
- [ ] Handle missing user email gracefully

### Frontend Tests
- [ ] Subscribe button appears in prayer room
- [ ] Button hidden by default, shown after init
- [ ] Subscribe updates button state and shows toast
- [ ] Unsubscribe updates button state and shows toast
- [ ] Button reflects current subscription status on page load
- [ ] Toast animations work smoothly
- [ ] Works on mobile and desktop
- [ ] Handle authentication errors (401)
- [ ] Handle network errors gracefully

### Email Tests
- [ ] Email sent when room is reopened
- [ ] Email includes correct room name and host
- [ ] Email includes join link
- [ ] Email includes room code for private rooms
- [ ] Email styled correctly (HTML rendering)
- [ ] Unsubscribe link works
- [ ] Multiple subscribers receive emails
- [ ] No emails sent if no subscribers

## Monitoring & Analytics

### Key Metrics to Track
- **Subscription Rate**: % of users who subscribe after joining
- **Reopen Engagement**: % of subscribers who join after notification
- **Unsubscribe Rate**: % of subscribers who unsubscribe
- **Email Open Rate**: Track email opens (future)
- **Email Click Rate**: Track join link clicks (future)

### Logs to Monitor
```python
# Look for these in app.log
"User {user_id} subscribed to room {room_id}"
"User {user_id} unsubscribed from room {room_id}"
"User unsubscribed via email link: {sub_id}"
"Sent {count} email notifications for reopened room {new_room_id}"
```

## Troubleshooting

### Issue: Notifications not sent
**Check:**
1. `email_service.py` is configured correctly
2. SMTP credentials are valid
3. Subscribers have valid email addresses
4. `notification_preferences.email === true`
5. Check logs for email sending errors

### Issue: Subscribe button not appearing
**Check:**
1. `window.roomSubscription.init()` is called
2. Room ID is correctly passed to template: `{{ room_id }}`
3. Button HTML is present with `id="subscribeBtn"`
4. JavaScript console for errors

### Issue: Subscriptions not tracked across reopens
**Check:**
1. `original_room_id` is set when reopening
2. Query uses `original_room_id` not `room_id`
3. Firestore indexes are up to date

## Security Considerations

### Authentication
- All subscription endpoints require authentication except email unsubscribe
- Firebase ID tokens validated on backend
- Email unsubscribe uses unique subscription ID (not user ID)

### Data Privacy
- User emails stored securely in Firestore
- Subscriber list never exposed via API
- Unsubscribe doesn't require authentication (privacy-friendly)

### Abuse Prevention
- Rate limiting on API endpoints (future)
- Email sending throttling (future)
- Captcha on unauth endpoints if needed (future)

## Deployment Checklist

Before deploying to production:

- [ ] Firestore indexes created for `room_subscriptions` collection
- [ ] Email service configured and tested
- [ ] Email templates render correctly in major email clients
- [ ] Frontend JavaScript bundle includes new code
- [ ] CSS for subscribe button and toasts included
- [ ] Test email delivery to various providers (Gmail, Outlook, etc.)
- [ ] Monitor logs for errors after initial rollout
- [ ] Test on mobile devices
- [ ] Verify unsubscribe links work from emails

## Firestore Indexes Required

```javascript
// Required composite indexes
collection: "room_subscriptions"
fields: [
  { fieldPath: "original_room_id", order: "ASCENDING" },
  { fieldPath: "user_id", order: "ASCENDING" },
  { fieldPath: "is_active", order: "ASCENDING" }
]

collection: "room_subscriptions"
fields: [
  { fieldPath: "original_room_id", order: "ASCENDING" },
  { fieldPath: "is_active", order: "ASCENDING" },
  { fieldPath: "notification_preferences.email", order: "ASCENDING" }
]
```

## Support & Questions

For questions or issues:
1. Check logs in `app.log` for errors
2. Review this guide for troubleshooting
3. Test endpoints with Postman/curl
4. Check Firestore console for data
5. Verify email service configuration

---

**Last Updated:** November 3, 2025
**Version:** 1.0
**Status:** Production Ready ✅

