# Scheduled Rooms UI/UX Design - RSVP System

## Overview

This document outlines the complete UI/UX design for displaying scheduled prayer rooms publicly and enabling users to RSVP. The goal is to create an intuitive, engaging experience that encourages participation and builds community.

---

## Current State vs Proposed State

### Current State ❌
- Scheduled rooms only visible to host in "My Rooms" modal
- No public discovery
- No way for others to RSVP
- Host must manually share room codes
- No participant tracking

### Proposed State ✅
- Public scheduled sessions visible to all
- One-click RSVP with email/account
- Participant count displayed
- Calendar integration
- Automatic notifications to RSVPs
- Sharable links for private sessions

---

## Display Locations

### 1. **Prayer Rooms Directory Page** (`/prayer-room`) - PRIMARY

#### Layout Structure:

```
┌─────────────────────────────────────────────────────┐
│  🔵 Divine Bridge - Live Prayer Rooms               │
└─────────────────────────────────────────────────────┘

Left Panel                    Right Panel (New Tabs)
┌───────────────────┐        ┌─────────────────────────┐
│ ✚ Create Room     │        │ [Live Now] [Upcoming]   │
│ 🔑 Join w/ Code   │        ├─────────────────────────┤
│ 📅 Schedule       │        │                         │
│ 🏠 My Rooms       │        │  UPCOMING SESSIONS      │
└───────────────────┘        │                         │
                             │  ┌──────────────────┐   │
                             │  │ 📅 Morning Prayer│   │
                             │  │ Tomorrow, 9:00 AM│   │
                             │  │ 👥 12 going      │   │
                             │  │ [I'm Interested] │   │
                             │  └──────────────────┘   │
                             │                         │
                             │  ┌──────────────────┐   │
                             │  │ 🙏 Evening Praise│   │
                             │  │ Today, 7:00 PM   │   │
                             │  │ 👥 8 going       │   │
                             │  │ [✓ Going]        │   │
                             │  └──────────────────┘   │
                             └─────────────────────────┘
```

#### Implementation:
```html
<div class="right-panel">
    <div class="room-tabs">
        <button class="tab-btn active" data-tab="live">Live Now</button>
        <button class="tab-btn" data-tab="upcoming">Upcoming</button>
    </div>
    
    <div id="liveTab" class="tab-content active">
        <h3>Active Rooms</h3>
        <div id="roomsList">
            <!-- Active rooms here -->
        </div>
    </div>
    
    <div id="upcomingTab" class="tab-content">
        <h3>Upcoming Sessions</h3>
        <div id="scheduledRoomsList">
            <!-- Scheduled rooms with RSVP here -->
        </div>
    </div>
</div>
```

---

### 2. **Scheduled Room Card Design**

#### Public Scheduled Room Card:

```
┌────────────────────────────────────────────────────┐
│ 📅 Morning Prayer with Pastor John                │
│ ─────────────────────────────────────────────────  │
│                                                    │
│ 🕐 Tomorrow, November 4 at 9:00 AM EST           │
│ ⏱️  Duration: 30 minutes                          │
│ 🔓 Public session - everyone welcome              │
│                                                    │
│ 📝 Join us for morning prayers and meditation...  │
│                                                    │
│ ┌────────────────┐  ┌────────────────────────┐   │
│ │ 👥 12 Going     │  │ 💬 5 Comments          │   │
│ └────────────────┘  └────────────────────────┘   │
│                                                    │
│ ┌──────────────────────────────────────────────┐ │
│ │          ✓ You're Going                      │ │
│ │   [Change RSVP ▼] [📅 Add to Calendar]      │ │
│ └──────────────────────────────────────────────┘ │
│                                                    │
│ 🔗 Share    💬 Discuss    ℹ️ Details              │
└────────────────────────────────────────────────────┘
```

#### Private Scheduled Room Card:

```
┌────────────────────────────────────────────────────┐
│ 🔒 Family Prayer Circle                           │
│ ─────────────────────────────────────────────────  │
│                                                    │
│ 🕐 Sunday, November 5 at 6:00 PM EST             │
│ ⏱️  Duration: 45 minutes                          │
│ 🔐 Private - Room code required                   │
│                                                    │
│ 📝 Weekly family prayer time...                   │
│                                                    │
│ ┌────────────────┐  ┌────────────────────────┐   │
│ │ 👥 6 Going      │  │ 🔑 ROOM123             │   │
│ └────────────────┘  └────────────────────────┘   │
│                                                    │
│ ┌──────────────────────────────────────────────┐ │
│ │          [I'm Interested] 👋                 │ │
│ │   Need room code to join                     │ │
│ └──────────────────────────────────────────────┘ │
│                                                    │
│ 🔗 Share Link                                     │
└────────────────────────────────────────────────────┘
```

---

## RSVP Interface Design

### RSVP Button States:

#### 1. **Not Logged In**
```
┌──────────────────────────────────────┐
│     [Sign In to RSVP] 👤             │
└──────────────────────────────────────┘
```
*Clicking opens login/signup modal*

#### 2. **Logged In, Not RSVPed**
```
┌──────────────────────────────────────┐
│     [I'm Interested] 👋              │
│                                      │
│  Or choose:                          │
│  • Going ✓                           │
│  • Maybe 🤔                          │
│  • Can't Go ❌                       │
└──────────────────────────────────────┘
```

#### 3. **RSVPed as "Going"**
```
┌──────────────────────────────────────┐
│  ✓ You're Going                      │
│  [Change RSVP ▼]                     │
│                                      │
│  Dropdown:                           │
│  • Going ✓ (current)                │
│  • Maybe 🤔                          │
│  • Not Going ❌                      │
│  • Remove RSVP 🗑️                   │
└──────────────────────────────────────┘
```

#### 4. **RSVPed as "Maybe"**
```
┌──────────────────────────────────────┐
│  🤔 You Might Go                     │
│  [Change RSVP ▼]                     │
└──────────────────────────────────────┘
```

---

## Detailed View Modal

When user clicks "Details" or the session card:

```
┌──────────────────────────────────────────────────────┐
│  Morning Prayer with Pastor John                  [×]│
├──────────────────────────────────────────────────────┤
│                                                      │
│  📅 Tomorrow, November 4, 2025                      │
│  🕐 9:00 AM - 9:30 AM EST (30 minutes)             │
│  🔓 Public Session                                  │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ About This Session:                            │ │
│  │ Join us for a peaceful morning of prayer and   │ │
│  │ meditation. We'll focus on gratitude and hope. │ │
│  │                                                │ │
│  │ What to expect:                                │ │
│  │ • Opening prayer                               │ │
│  │ • Scripture reading                            │ │
│  │ • Shared prayer time                           │ │
│  │ • Closing blessing                             │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  👤 Hosted by: Pastor John Smith                    │
│     "Leading morning prayers for 5 years"           │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  👥 12 People Going                            │ │
│  │  ─────────────────────────────────────────────  │ │
│  │  [Profile Pics] Sarah, Mike, Emma...          │ │
│  │  [+9 more]                                     │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │     [✓ You're Going]  [Change ▼]            │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  📅 Add to Calendar                          │   │
│  │     • Google Calendar                        │   │
│  │     • Apple Calendar (.ics)                  │   │
│  │     • Outlook                                │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  🔔 Notification Preferences                 │   │
│  │  ☑ 24 hours before                           │   │
│  │  ☑ 15 minutes before                         │   │
│  │  ☑ When session goes live                    │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  🔗 Share:  [Copy Link] [Email] [WhatsApp]         │
│                                                      │
│  [Close]                              [Join Room]   │
└──────────────────────────────────────────────────────┘
```

---

## Home Page Integration

### Option 1: Featured Upcoming Sessions

Add a section to the home page (`/` or `/home`):

```
┌──────────────────────────────────────────────────┐
│  🙏 Join Upcoming Prayer Sessions                │
├──────────────────────────────────────────────────┤
│                                                  │
│  [Card] Morning Prayer    [Card] Evening Praise │
│  Today, 9:00 AM           Tomorrow, 7:00 PM     │
│  👥 12 going              👥 8 going             │
│  [RSVP]                   [RSVP]                 │
│                                                  │
│  [View All Upcoming Sessions →]                  │
└──────────────────────────────────────────────────┘
```

### Option 2: Calendar View

Add a calendar widget:

```
┌──────────────────────────────────────────┐
│  November 2025                           │
├──────────────────────────────────────────┤
│  Sun  Mon  Tue  Wed  Thu  Fri  Sat      │
│                   1    2    3    4       │
│   5    6    7    8    9   10   11       │
│                              🔵           │
│  12   13   14   15   16   17   18       │
│  🔵                                      │
│                                          │
│  🔵 = Scheduled session                 │
│  Click date to see sessions              │
└──────────────────────────────────────────┘
```

---

## Mobile View Design

### Mobile Scheduled Room Card:

```
┌────────────────────────────────┐
│ 📅 Morning Prayer              │
│ with Pastor John               │
├────────────────────────────────┤
│                                │
│ 🕐 Tomorrow at 9:00 AM        │
│ ⏱️  30 min • 🔓 Public         │
│                                │
│ 👥 12 Going                    │
│                                │
│ ┌────────────────────────────┐ │
│ │ [✓ You're Going]     [▼]  │ │
│ └────────────────────────────┘ │
│                                │
│ 📅 Add Calendar  🔗 Share     │
│                                │
│ [View Details]                 │
└────────────────────────────────┘
```

### Mobile RSVP Flow:

1. **Tap "I'm Interested"**
   ```
   ┌──────────────────────┐
   │ RSVP for Session     │
   ├──────────────────────┤
   │                      │
   │ How's your interest? │
   │                      │
   │ [ ] Going ✓          │
   │ [ ] Maybe 🤔         │
   │ [ ] Interested 👋    │
   │                      │
   │ Get reminders:       │
   │ [x] 15 min before    │
   │ [x] When it starts   │
   │                      │
   │ [Confirm]  [Cancel]  │
   └──────────────────────┘
   ```

2. **Success Toast**
   ```
   ┌────────────────────────────┐
   │ ✓ You're going!            │
   │ We'll remind you before    │
   │ the session starts.        │
   └────────────────────────────┘
   ```

---

## Discovery & Filtering

### Filter Bar:

```
┌──────────────────────────────────────────────────┐
│ 🔍 Find Sessions                                 │
│                                                  │
│ [Search...]                                      │
│                                                  │
│ Filters:                                         │
│ Time:     [Today] [Tomorrow] [This Week] [All] │
│ Type:     [Public] [Following] [All]            │
│ Sort by:  [Soonest] [Most Popular] [New]       │
└──────────────────────────────────────────────────┘
```

### Categories/Topics (Future):

```
┌──────────────────────────────────────────────────┐
│ Browse by Topic:                                 │
│                                                  │
│ [Morning Prayer] [Evening Praise] [Youth]       │
│ [Healing] [Worship] [Bible Study] [Intercession]│
└──────────────────────────────────────────────────┘
```

---

## Notification Examples

### Email: You're Registered

**Subject**: ✅ You're going to Morning Prayer

```
Hi Sarah,

You're registered for:

📅 Morning Prayer with Pastor John
🕐 Tomorrow, November 4 at 9:00 AM EST

We'll send you reminders:
• 15 minutes before it starts
• When the session goes live

Can't make it? Change your RSVP:
[Update RSVP]

Add to your calendar:
[Google Calendar] [Apple] [Outlook]

See you there!

[View Session Details]
```

### Email: 15 Minutes Reminder

**Subject**: 🕐 Morning Prayer starts in 15 minutes

```
Hi Sarah,

Your prayer session is starting soon!

📅 Morning Prayer with Pastor John
🕐 Starts at 9:00 AM EST (in 15 minutes)
👥 12 people going

[Join Now] → divinebridge.io/prayer-room/join?room=ABC123

Not coming anymore?
[Update RSVP]
```

### Email: Session is Live

**Subject**: 🙏 Morning Prayer is LIVE - Join Now!

```
Hi Sarah,

The session you RSVPed for just started!

📅 Morning Prayer with Pastor John
🟢 LIVE NOW

[JOIN THE ROOM NOW]
→ divinebridge.io/prayer-room/join?room=ABC123

Don't be late - join your prayer community now!

Running late? No problem, you can join anytime during
the session.
```

---

## Privacy Settings

### For Session Hosts:

```
┌──────────────────────────────────────────────┐
│ Visibility Settings                          │
├──────────────────────────────────────────────┤
│                                              │
│ Who can see this session?                    │
│ • Public - Anyone can see and RSVP          │
│ • Unlisted - Only with link                  │
│ • Private - Room code required               │
│                                              │
│ Who can RSVP?                                │
│ • Anyone                                     │
│ • Registered users only                      │
│ • By invitation only                         │
│                                              │
│ [ ] Limit attendees (max: [___])            │
│ [ ] Require approval for RSVPs               │
│ [ ] Show participant list publicly           │
│                                              │
│ [Save Settings]                              │
└──────────────────────────────────────────────┘
```

---

## Participant List Display

### In Session Card:

```
┌──────────────────────────────┐
│ 👥 12 Going                  │
│                              │
│ [🎭][🎭][🎭][🎭][🎭]        │
│ Sarah, Mike, Emma, John...   │
│ and 8 others                 │
│                              │
│ [See All →]                  │
└──────────────────────────────┘
```

### Full Participant List:

```
┌────────────────────────────────────┐
│ Participants (12 going, 3 maybe)   │
├────────────────────────────────────┤
│                                    │
│ Going (12):                        │
│ • 👤 Sarah Johnson ✓              │
│ • 👤 Mike Chen ✓                  │
│ • 👤 Emma Davis ✓                 │
│ • 👤 John Smith ✓                 │
│ ... [+8 more]                      │
│                                    │
│ Maybe (3):                         │
│ • 👤 Lisa Brown 🤔                │
│ • 👤 Tom Wilson 🤔                │
│ • 👤 Anna Lee 🤔                  │
│                                    │
│ [Close]                            │
└────────────────────────────────────┘
```

---

## Backend API Endpoints

### GET `/api/prayer-room/scheduled-sessions`
**Public endpoint** - Returns all upcoming public scheduled sessions

**Query params**:
- `?time=today|tomorrow|week|all`
- `?limit=20`
- `?offset=0`
- `?sort=soonest|popular|new`

**Response**:
```json
{
  "sessions": [
    {
      "scheduled_room_id": "abc123",
      "room_name": "Morning Prayer",
      "room_description": "Join us for...",
      "scheduled_time": 1699088400,
      "duration_minutes": 30,
      "room_privacy": "public",
      "host_id": "user123",
      "host_name": "Pastor John",
      "participant_count": {
        "going": 12,
        "maybe": 3,
        "interested": 5
      },
      "user_rsvp_status": "going", // or null if not RSVPed
      "status": "scheduled",
      "created_at": 1698483600
    }
  ],
  "total": 45,
  "has_more": true
}
```

### POST `/api/prayer-room/scheduled/<room_id>/rsvp`
**Auth required** - RSVP to a scheduled session

**Body**:
```json
{
  "rsvp_status": "going", // "going" | "maybe" | "interested"
  "reminder_preferences": {
    "email_24hour": true,
    "email_15min": true,
    "email_live": true,
    "push": false
  }
}
```

**Response**:
```json
{
  "success": true,
  "message": "RSVP confirmed",
  "rsvp_status": "going",
  "participant_count": {
    "going": 13,
    "maybe": 3,
    "interested": 5
  }
}
```

### DELETE `/api/prayer-room/scheduled/<room_id>/rsvp`
**Auth required** - Remove RSVP

### GET `/api/prayer-room/scheduled/<room_id>/participants`
**Response**:
```json
{
  "participants": [
    {
      "user_id": "user123",
      "user_name": "Sarah Johnson",
      "rsvp_status": "going",
      "rsvp_at": 1698483600
    }
  ],
  "counts": {
    "going": 12,
    "maybe": 3,
    "interested": 5
  }
}
```

---

## Implementation Phases

### Phase 1: Basic RSVP (MVP)
- [ ] Add "Upcoming" tab to prayer rooms page
- [ ] Display public scheduled sessions
- [ ] Simple "I'm Interested" button
- [ ] Track participant count
- [ ] Email confirmation on RSVP

### Phase 2: Enhanced UI
- [ ] Detailed session view modal
- [ ] RSVP status options (Going/Maybe/Interested)
- [ ] Participant list display
- [ ] Share functionality

### Phase 3: Notifications & Calendar
- [ ] Reminder emails (15 min, 24 hour)
- [ ] Calendar integration (.ics)
- [ ] Google Calendar quick add
- [ ] Notification preference settings

### Phase 4: Discovery & Social
- [ ] Search and filters
- [ ] Categories/topics
- [ ] Comments/discussion
- [ ] Following hosts
- [ ] Recommended sessions

---

## Design Tokens

### Colors:
```css
--rsvp-going: #10b981;        /* Green */
--rsvp-maybe: #f59e0b;        /* Amber */
--rsvp-interested: #3b82f6;   /* Blue */
--rsvp-not-going: #ef4444;    /* Red */
--session-public: #10b981;    /* Green */
--session-private: #6366f1;   /* Indigo */
```

### Typography:
```css
--session-title: 1.25rem / 700;
--session-meta: 0.875rem / 500;
--participant-count: 1rem / 600;
```

---

## Accessibility

- [ ] Keyboard navigation for RSVP buttons
- [ ] Screen reader announcements for RSVP changes
- [ ] ARIA labels for all interactive elements
- [ ] Focus indicators on all controls
- [ ] High contrast mode support
- [ ] Calendar date picker accessibility

---

## Testing Checklist

- [ ] RSVP as logged-in user
- [ ] RSVP prompt for logged-out user
- [ ] Change RSVP status
- [ ] Remove RSVP
- [ ] View participant list
- [ ] Private vs public session visibility
- [ ] Mobile responsive layout
- [ ] Email notifications sent
- [ ] Calendar file download
- [ ] Share link functionality

---

## Success Metrics

**Engagement**:
- RSVP rate: Target 30%+ of viewers
- Show-up rate: Target 60%+ of RSVPs join
- Repeat RSVP rate: Target 40%+ RSVP to multiple sessions

**Retention**:
- Weekly active RSVPs: Track users RSVPing weekly
- Host satisfaction: Survey hosts on participant quality

---

**Last Updated**: November 3, 2025  
**Status**: Design Spec - Ready for Implementation

