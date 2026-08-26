# Prayer Groups Feature - Brainstorming Document

> **Date:** January 2025  
> **Status:** Brainstorming/Planning  
> **Goal:** Enable small prayer groups to form with full access to chat and live calls

---

## 🎯 Overview

### Vision
Enable users to create and join small, persistent prayer groups where members can:
- Have dedicated group chat (separate from prayer room chat)
- Create group-specific live prayer rooms
- Build ongoing community relationships
- Share prayer requests within the group
- Schedule recurring group prayer sessions

### Key Differentiators from Current Prayer Rooms
- **Persistent vs Temporary**: Groups exist permanently, rooms are session-based
- **Membership vs Open**: Groups have defined members, rooms can be public/private
- **Community Building**: Groups enable ongoing relationships, rooms are event-based
- **Dedicated Features**: Groups have their own chat, prayer requests, and history

---

## 🏗️ Core Features

### 1. Group Creation & Management

#### Group Types
- **Public Groups**: Discoverable in directory, anyone can request to join
- **Private Groups**: Invite-only, not discoverable
- **Closed Groups**: Full, no new members (for established groups)

#### Group Settings
- **Name**: Max 50 characters
- **Description**: Max 500 characters
- **Group Image**: Optional custom image/logo
- **Max Members**: Default 20, configurable (3-50)
- **Privacy Level**: Public/Private/Closed
- **Join Approval**: Require admin approval or auto-approve
- **Group Rules**: Optional text guidelines for members

#### Group Roles
- **Admin**: Full control (create, edit, delete, manage members)
- **Moderator**: Can manage members, moderate chat, create rooms
- **Member**: Can participate in chat, join rooms, submit prayer requests
- **Pending**: Awaiting approval to join

### 2. Group Chat

#### Features
- **Persistent Chat**: Separate from prayer room chat, always available
- **Message Types**:
  - Text messages
  - Prayer requests (group-specific)
  - Scripture sharing
  - Praise reports
  - Announcements (admin/moderator only)
- **Message History**: Full history accessible to all members
- **Notifications**: Real-time notifications for new messages
- **Read Receipts**: Optional, see who read messages
- **Message Reactions**: Emoji reactions to messages

#### Technical Implementation
- Use Firestore `group_chat_messages` collection
- Real-time listeners for instant updates
- Pagination for message history
- Content moderation integration

### 3. Group Prayer Rooms

#### Features
- **Group Rooms**: Create rooms specifically for the group
- **Quick Start**: One-click room creation for group members
- **Scheduled Sessions**: Recurring group prayer times
- **Room History**: Track past group prayer sessions
- **Member-Only Access**: Rooms automatically restricted to group members

#### Integration with Existing System
- Extend current prayer room system
- Add `group_id` field to prayer rooms
- Filter rooms by group membership
- Group rooms inherit group permissions

### 4. Group Prayer Requests

#### Features
- **Group-Specific Requests**: Submit requests visible only to group members
- **Request Tracking**: Mark requests as answered/prayed for
- **Request History**: Archive of all group prayer requests
- **Priority Requests**: Mark urgent requests

### 5. Group Directory & Discovery

#### Discovery Features
- **Browse Public Groups**: Search and filter by:
  - Name/keywords
  - Member count
  - Activity level
  - Focus area (e.g., "Youth", "Seniors", "Marriage", "Healing")
- **Recommendations**: Suggest groups based on:
  - User interests
  - Location
  - Activity patterns
- **Group Cards**: Display group info, member count, recent activity

---

## 📊 Data Structure Design

### Firestore Collections

#### `prayer_groups/{group_id}`
```json
{
  "group_id": "group_abc123",
  "name": "Morning Prayer Warriors",
  "description": "Daily morning prayer group for encouragement",
  "image_url": "https://storage.../group_image.jpg",
  "created_by": "user_123",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z",
  "privacy": "public", // "public" | "private" | "closed"
  "max_members": 20,
  "current_member_count": 8,
  "join_approval_required": false,
  "group_rules": "Be respectful, keep prayer requests confidential",
  "tags": ["morning", "daily", "encouragement"],
  "is_active": true,
  "settings": {
    "allow_member_room_creation": true,
    "allow_member_invites": true,
    "default_room_privacy": "group_only"
  }
}
```

#### `group_members/{group_id}/members/{user_id}`
```json
{
  "user_id": "user_456",
  "user_name": "John Doe",
  "user_email": "john@example.com",
  "role": "member", // "admin" | "moderator" | "member"
  "joined_at": "2025-01-10T08:00:00Z",
  "status": "active", // "active" | "pending" | "left" | "removed"
  "invited_by": "user_123",
  "last_active": "2025-01-15T09:30:00Z",
  "notification_preferences": {
    "chat_messages": true,
    "prayer_requests": true,
    "room_created": true,
    "member_joined": false
  }
}
```

#### `group_chat_messages/{group_id}/messages/{message_id}`
```json
{
  "message_id": "msg_xyz789",
  "group_id": "group_abc123",
  "user_id": "user_456",
  "user_name": "John Doe",
  "message": "Praying for everyone today!",
  "message_type": "text", // "text" | "prayer_request" | "scripture" | "praise" | "announcement"
  "timestamp": "2025-01-15T10:15:00Z",
  "edited_at": null,
  "reactions": {
    "🙏": ["user_123", "user_789"],
    "❤️": ["user_456"]
  },
  "reply_to": null, // Optional: message_id if replying
  "is_pinned": false
}
```

#### `group_prayer_requests/{group_id}/requests/{request_id}`
```json
{
  "request_id": "req_123",
  "group_id": "group_abc123",
  "user_id": "user_456",
  "user_name": "John Doe",
  "title": "Prayer for healing",
  "content": "Please pray for my mother's recovery...",
  "status": "active", // "active" | "answered" | "closed"
  "priority": "normal", // "urgent" | "normal"
  "created_at": "2025-01-15T10:00:00Z",
  "answered_at": null,
  "prayed_by_count": 5,
  "prayed_by": ["user_123", "user_789", ...]
}
```

#### `group_rooms/{group_id}/rooms/{room_id}`
```json
{
  "room_id": "room_xyz",
  "group_id": "group_abc123",
  "room_name": "Weekly Group Prayer",
  "created_by": "user_123",
  "created_at": "2025-01-15T10:00:00Z",
  "scheduled_time": "2025-01-15T18:00:00Z",
  "is_recurring": true,
  "recurrence_pattern": "weekly", // "daily" | "weekly" | "monthly"
  "status": "scheduled", // "scheduled" | "active" | "completed" | "cancelled"
  "participant_count": 0
}
```

#### User Profile Extension
Add to `users/{user_id}`:
```json
{
  "groups": {
    "member_of": ["group_abc123", "group_def456"],
    "admin_of": ["group_abc123"],
    "pending_requests": ["group_ghi789"]
  }
}
```

---

## 🔄 User Flows

### Flow 1: Creating a Group
1. User clicks "Create Group" button
2. Fill out group form:
   - Name (required)
   - Description (optional)
   - Privacy setting
   - Max members
   - Join approval requirement
3. Upload group image (optional)
4. Submit → Group created
5. User automatically becomes admin
6. Redirect to group page
7. Share invite link/code

### Flow 2: Joining a Group
**Public Group:**
1. Browse group directory
2. Click on group card
3. View group details
4. Click "Join Group"
5. If approval required → status: pending
6. If auto-approve → status: member, added immediately

**Private Group:**
1. Receive invite link/code
2. Click link or enter code
3. View group preview
4. Click "Accept Invitation"
5. Added as member

### Flow 3: Group Chat
1. Navigate to group page
2. Open chat panel
3. Type message
4. Send → Message appears in real-time
5. Other members receive notification
6. Members can react, reply, or view history

### Flow 4: Creating Group Prayer Room
1. From group page, click "Start Prayer Room"
2. Optionally set room name (defaults to group name)
3. Click "Create & Join"
4. Room created with `group_id` field
5. All group members notified
6. Room automatically restricted to group members
7. Redirect to prayer room interface

### Flow 5: Group Prayer Request
1. From group page, click "Submit Prayer Request"
2. Fill out request form
3. Optionally mark as urgent
4. Submit → Request appears in:
   - Group chat (as announcement)
   - Group prayer requests list
5. Members can mark as "Prayed For"
6. Requestor can mark as "Answered"

---

## 🔐 Security & Permissions

### Firestore Security Rules

```javascript
// Prayer groups collection
match /prayer_groups/{groupId} {
  // Read: public groups visible to all, private groups only to members
  allow read: if request.auth != null && 
    (resource.data.privacy == 'public' || 
     request.auth.uid in resource.data.member_ids);
  
  // Create: authenticated users only
  allow create: if request.auth != null &&
    request.resource.data.created_by == request.auth.uid;
  
  // Update: only admins
  allow update: if request.auth != null &&
    get(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid)).data.role == 'admin';
  
  // Delete: only admins
  allow delete: if request.auth != null &&
    get(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid)).data.role == 'admin';
}

// Group members subcollection
match /group_members/{groupId}/members/{userId} {
  // Read: group members can see other members
  allow read: if request.auth != null &&
    exists(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid));
  
  // Create: admins can add, users can add themselves if public/auto-approve
  allow create: if request.auth != null &&
    (request.auth.uid == userId || 
     get(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid)).data.role in ['admin', 'moderator']);
  
  // Update: admins can update roles, users can update their own preferences
  allow update: if request.auth != null &&
    (request.auth.uid == userId ||
     get(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid)).data.role in ['admin', 'moderator']);
  
  // Delete: admins can remove, users can leave themselves
  allow delete: if request.auth != null &&
    (request.auth.uid == userId ||
     get(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid)).data.role in ['admin', 'moderator']);
}

// Group chat messages
match /group_chat_messages/{groupId}/messages/{messageId} {
  // Read: only group members
  allow read: if request.auth != null &&
    exists(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid));
  
  // Create: only active group members
  allow create: if request.auth != null &&
    exists(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid)) &&
    get(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid)).data.status == 'active';
  
  // Update/Delete: only message author or admins/moderators
  allow update, delete: if request.auth != null &&
    (resource.data.user_id == request.auth.uid ||
     get(/databases/$(database)/documents/group_members/$(groupId)/members/$(request.auth.uid)).data.role in ['admin', 'moderator']);
}
```

### Backend API Permissions
- **Group Creation**: Authenticated users only
- **Group Management**: Admin role required
- **Member Management**: Admin/Moderator roles
- **Chat Access**: Active members only
- **Room Creation**: Members (if allowed in settings) or Admin/Moderator

---

## 🎨 UI/UX Considerations

### Group Page Layout
```
┌─────────────────────────────────────┐
│  [Group Image]  Group Name          │
│                 8 members • Public  │
│  [Join/Leave] [Settings] [Invite]   │
├─────────────────────────────────────┤
│  Tabs: [Chat] [Rooms] [Requests]    │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  Chat Panel (60% width)      │  │
│  │  ┌─────────────────────────┐ │  │
│  │  │ Message History         │ │  │
│  │  │                         │ │  │
│  │  └─────────────────────────┘ │  │
│  │  [Type message...] [Send]   │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  Sidebar (40% width)         │  │
│  │  • Members List              │  │
│  │  • Quick Actions             │  │
│  │  • Group Info                │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Mobile Considerations
- Stack chat and sidebar vertically
- Bottom sheet for member list
- Floating action button for "Start Prayer Room"
- Swipe gestures for navigation

### Key UI Components Needed
1. **Group Directory Page**: Grid/list of public groups
2. **Group Detail Page**: Full group information and actions
3. **Group Chat Interface**: Real-time messaging
4. **Group Settings Page**: Admin controls
5. **Member Management**: Add/remove/role management
6. **Invite Modal**: Share invite links/codes

---

## 🔌 Integration Points

### With Existing Prayer Rooms
- Add `group_id` field to `prayer_rooms` collection
- Filter rooms by group in directory
- Auto-restrict group rooms to members
- Show group badge on group rooms

### With Prayer Requests
- Add `group_id` field to prayer requests
- Filter requests by group
- Group-specific request feed

### With User Profiles
- Show groups user belongs to
- Display group activity/participation
- Group badges/achievements

### With Notifications
- Group chat notifications
- New member notifications
- Room created notifications
- Prayer request notifications

---

## 📱 API Endpoints Needed

### Group Management
```
POST   /api/groups/create              # Create new group
GET    /api/groups                     # List groups (with filters)
GET    /api/groups/{group_id}          # Get group details
PUT    /api/groups/{group_id}           # Update group (admin only)
DELETE /api/groups/{group_id}          # Delete group (admin only)
```

### Membership
```
POST   /api/groups/{group_id}/join     # Join group
POST   /api/groups/{group_id}/leave    # Leave group
POST   /api/groups/{group_id}/invite   # Invite user (admin/moderator)
GET    /api/groups/{group_id}/members  # List members
PUT    /api/groups/{group_id}/members/{user_id}  # Update member role
DELETE /api/groups/{group_id}/members/{user_id}  # Remove member
```

### Group Chat
```
GET    /api/groups/{group_id}/chat     # Get chat history
POST   /api/groups/{group_id}/chat     # Send message
PUT    /api/groups/{group_id}/chat/{message_id}  # Edit message
DELETE /api/groups/{group_id}/chat/{message_id}  # Delete message
POST   /api/groups/{group_id}/chat/{message_id}/react  # Add reaction
```

### Group Rooms
```
POST   /api/groups/{group_id}/rooms/create  # Create group room
GET    /api/groups/{group_id}/rooms         # List group rooms
GET    /api/groups/{group_id}/rooms/history # Past group rooms
```

### Group Prayer Requests
```
POST   /api/groups/{group_id}/requests     # Submit request
GET    /api/groups/{group_id}/requests      # List requests
PUT    /api/groups/{group_id}/requests/{request_id}  # Update request
POST   /api/groups/{group_id}/requests/{request_id}/prayed  # Mark as prayed
```

---

## 🚀 Implementation Phases

### Phase 1: Core Group Structure (MVP)
**Goal**: Basic group creation and membership
- [ ] Data models (Firestore collections)
- [ ] Security rules
- [ ] Backend API endpoints (create, join, leave, list)
- [ ] Basic group page UI
- [ ] Member management
- [ ] Integration with user profiles

**Timeline**: 2-3 weeks

### Phase 2: Group Chat
**Goal**: Persistent group chat functionality
- [ ] Chat message collection structure
- [ ] Real-time chat interface
- [ ] Message history with pagination
- [ ] Message reactions
- [ ] Chat notifications
- [ ] Mobile chat UI

**Timeline**: 2-3 weeks

### Phase 3: Group Prayer Rooms
**Goal**: Group-specific prayer rooms
- [ ] Extend prayer room system with `group_id`
- [ ] Group room creation flow
- [ ] Auto-restrict to group members
- [ ] Group room directory
- [ ] Room history tracking
- [ ] Scheduled group sessions

**Timeline**: 1-2 weeks

### Phase 4: Group Prayer Requests
**Goal**: Group-specific prayer request system
- [ ] Group prayer request collection
- [ ] Request submission and management
- [ ] Request feed in group page
- [ ] "Prayed For" tracking
- [ ] Request status management

**Timeline**: 1 week

### Phase 5: Discovery & Polish
**Goal**: Group discovery and UX improvements
- [ ] Group directory with search/filters
- [ ] Group recommendations
- [ ] Group analytics
- [ ] Advanced settings
- [ ] Mobile optimizations
- [ ] Performance optimizations

**Timeline**: 2 weeks

---

## 💡 Additional Feature Ideas

### Future Enhancements
1. **Group Events**: Schedule group events beyond prayer rooms
2. **Group Resources**: Share files, documents, links
3. **Group Polls**: Quick polls for group decisions
4. **Group Calendar**: Shared calendar for group activities
5. **Group Analytics**: Track engagement, activity metrics
6. **Group Templates**: Pre-configured group types
7. **Group Merging**: Combine similar groups
8. **Group Partnerships**: Connect related groups
9. **Group Challenges**: Spiritual challenges for groups
10. **Group Giving**: Group-based donation campaigns

### Integration Ideas
- **Daily Prayer**: Share daily prayer in group chat
- **Disaster Alerts**: Group-specific disaster prayer alerts
- **Testimonies**: Group-specific testimony sharing
- **Scripture Study**: Group Bible study sessions

---

## ⚠️ Considerations & Challenges

### Technical Challenges
1. **Real-time Sync**: Ensuring chat messages sync across devices
2. **Scalability**: Handling many groups with many members
3. **Notifications**: Managing notification preferences
4. **Search**: Efficient group search and filtering
5. **Permissions**: Complex permission logic for different roles

### User Experience Challenges
1. **Onboarding**: Helping users understand groups vs rooms
2. **Discovery**: Making it easy to find relevant groups
3. **Engagement**: Keeping groups active and engaged
4. **Moderation**: Handling inappropriate content/members
5. **Privacy**: Balancing privacy with discoverability

### Business Considerations
1. **Abuse Prevention**: Preventing spam groups, fake groups
2. **Content Moderation**: Moderating group chat and requests
3. **Support**: Handling group disputes, issues
4. **Analytics**: Tracking group success metrics
5. **Limits**: Deciding on group size limits, creation limits

---

## 📋 Next Steps

1. **Review & Refine**: Review this document with stakeholders
2. **Prioritize Features**: Decide on MVP vs full feature set
3. **Design Mockups**: Create UI/UX mockups for key screens
4. **Technical Design**: Detailed technical architecture
5. **Prototype**: Build basic prototype for testing
6. **User Testing**: Test with small group of users
7. **Iterate**: Refine based on feedback
8. **Launch**: Phased rollout starting with MVP

---

## 📚 References

- Current Prayer Room System: `routes/prayer_room_bp.py`
- Current Chat System: `routes/prayer_room_bp.py` (chat endpoints)
- User Authentication: `routes/auth_bp.py`
- Firestore Rules: `firestore.rules`
- Prayer Room Spec: `archive/analyses/LIVE_PRAYER_ROOM_SPECIFICATION.md`

---

**Questions to Consider:**
1. Should groups have a maximum size limit? (Suggested: 3-50 members)
2. Can users create unlimited groups or should there be limits?
3. Should groups expire if inactive? (e.g., 90 days no activity)
4. How should group disputes be handled?
5. Should there be group verification/badges for established groups?
6. What level of moderation tools do admins need?
7. Should groups be able to have subgroups or chapters?
8. How should group discovery work? (search, recommendations, categories)
