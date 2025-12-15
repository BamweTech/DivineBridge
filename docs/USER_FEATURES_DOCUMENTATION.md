# Divine Bridge - Complete User Features Documentation

> **Last Updated:** January 2025  
> **Version:** 1.0

---

## Table of Contents

1. [Daily Prayer & Verse](#daily-prayer--verse)
2. [Prayer Requests](#prayer-requests)
3. [Testimonies & Thanksgiving Wall](#testimonies--thanksgiving-wall)
4. [Live Prayer Room](#live-prayer-room)
5. [Email Subscriptions](#email-subscriptions)
6. [Organization Network](#organization-network)
7. [User Account & Profile](#user-account--profile)
8. [Social Sharing](#social-sharing)
9. [Disaster Support](#disaster-support)

---

## Daily Prayer & Verse

### Overview
Receive a fresh, AI-generated prayer and a curated Bible verse every day. These are generated automatically and available to all users, creating a shared spiritual experience across the global community.

### Why Use This Feature
- **Daily Spiritual Nourishment**: Start each day with a prayer crafted to address current events, global needs, and universal spiritual themes
- **Community Connection**: Millions of users read the same prayer daily, creating a sense of unity
- **Consistent Devotional Practice**: Build a daily habit of prayer and scripture reading
- **Context-Aware Content**: Prayers are generated with awareness of current disasters, global events, and community needs

### How to Use

#### Viewing Daily Prayer
1. **On the Website**:
   - Navigate to the **Home Page** (`/`) - the daily prayer appears prominently at the top
   - Visit the **Prayer Room** (`/prayers`) - today's prayer is always displayed first
   - Go to **Daily Prayer Page** (`/daily-prayer`) for a dedicated view

2. **In Email**:
   - Subscribe to daily emails to receive the prayer and verse at 6 AM in your timezone
   - The email includes both the prayer text and verse with beautiful formatting

3. **Download as Image**:
   - Click the download button on any prayer or verse
   - Share the beautiful image on social media or save for personal use
   - Images are optimized for sharing (1080x1080px)

#### Viewing Daily Verse
1. **On the Website**:
   - The daily verse appears on the home page
   - Each verse is selected based on the day of the year (ensuring consistency across timezones)
   - Verse includes full text and Bible reference

2. **Download Options**:
   - Download verse as a shareable image
   - Images include the verse text, reference, and date
   - Perfect for social media sharing or personal devotionals

### Key Features
- **Automatic Generation**: New prayer generated daily via Cloud Scheduler
- **Timezone Awareness**: Content adjusts based on your local date
- **Image Generation**: Beautiful, shareable images for both prayers and verses
- **Caching**: Fast loading with intelligent caching
- **Social Media Optimized**: Open Graph images for rich link previews

### Technical Details
- Prayers are 150-250 words, written in biblical language
- Verses are curated from a comprehensive Bible verse database
- Content is generated using AI with strict content moderation
- Images are cached to reduce generation time

---

## Prayer Requests

### Overview
Submit personal prayer requests to the community. Share your needs, struggles, and requests for prayer support. The community can view, pray for, and support your requests.

### Why Use This Feature
- **Community Support**: Receive prayer from a global community of believers
- **Anonymity Options**: Share as much or as little personal information as you're comfortable with
- **Track Engagement**: See how many people have viewed and prayed for your request
- **Build Prayer Network**: Connect with others who are praying for similar needs
- **Spiritual Accountability**: Publicly sharing requests can strengthen your faith journey

### How to Use

#### Submitting a Prayer Request
1. **Navigate to Prayer Room**:
   - Click "Prayer Room" in the navigation menu
   - Or visit `/prayers` directly

2. **Create Your Request**:
   - Click the "Submit Prayer Request" button (floating action button on mobile)
   - Enter a **Title** (required, max 200 characters)
   - Write your **Prayer Content** (required, 20-2000 characters)
   - Click "Submit"

3. **Content Moderation**:
   - All requests are automatically moderated by AI
   - Approved requests appear immediately in the Prayer Room
   - If rejected, you'll receive feedback on why

4. **After Submission**:
   - Your request appears in the community feed
   - Others can view and pray for your request
   - You can track views and prayer counts

#### Managing Your Requests
1. **View Your Requests**:
   - Visit your **Profile** page to see all your submitted requests
   - See engagement metrics (views, prayers received)

2. **Edit Your Request**:
   - Click "Edit" on any of your requests
   - Update title or content
   - Changes are saved immediately

3. **Delete Your Request**:
   - Click "Delete" on any of your requests
   - Only you can delete your own requests
   - Deletion is permanent

#### Praying for Others
1. **Browse Requests**:
   - Scroll through the Prayer Room feed
   - See recent requests from the community
   - Filter by date or engagement

2. **Pray for a Request**:
   - Click "I Prayed" button on any request
   - This increments the prayer count
   - Your action is recorded (synced across devices)

3. **View Full Request**:
   - Click on any request to see full details
   - View engagement statistics
   - Share the request with others

### Key Features
- **AI Content Moderation**: Automatic approval/rejection with feedback
- **Engagement Tracking**: Views and prayer counts for each request
- **User Statistics**: Track your total prayers read and requests submitted
- **Cross-Device Sync**: Your prayed-for list syncs across all devices
- **Rate Limiting**: 10 requests per hour, 50 per day to prevent spam

### Privacy & Safety
- All content is moderated before publication
- Personal information is optional
- You control what you share
- Requests can be edited or deleted at any time

---

## Testimonies & Thanksgiving Wall

### Overview
Share stories of God's faithfulness, answered prayers, and miracles. The Thanksgiving Wall is a space to celebrate what God has done in your life and encourage others with your testimony.

### Why Use This Feature
- **Encourage Others**: Your testimony can inspire and strengthen others' faith
- **Glorify God**: Publicly acknowledge God's work in your life
- **Build Community**: Connect with others who have similar experiences
- **Document Your Journey**: Keep a record of God's faithfulness
- **Receive Encouragement**: Read others' testimonies when you need hope

### How to Use

#### Submitting a Testimony
1. **Navigate to Thanksgiving Wall**:
   - Click "Thanksgiving Wall" in navigation
   - Or visit your profile and click "Share Testimony"

2. **Choose a Category**:
   - **Healing**: Physical, emotional, or spiritual healing
   - **Provision**: Financial or material needs met
   - **Protection**: Safety from danger or harm
   - **Guidance**: Direction in decisions or life path
   - **Relationships**: Restoration or improvement in relationships
   - **Career/Education**: Professional or academic breakthroughs
   - **Spiritual Growth**: Deepening relationship with God
   - **Other**: Any other testimony of God's faithfulness

3. **Write Your Testimony**:
   - Enter a **Title** (required, max 200 characters)
   - Write your **Testimony** (required, 20-2000 characters)
   - Be specific and share details that will encourage others

4. **Submit**:
   - Click "Submit Testimony"
   - Content is automatically moderated
   - Approved testimonies appear immediately

#### Viewing Testimonies
1. **Browse the Wall**:
   - Scroll through recent testimonies
   - Filter by category if desired
   - Read full testimonies by clicking on them

2. **Engage with Testimonies**:
   - Click "Like" to show appreciation
   - Share testimonies on social media
   - View count shows how many people have read it

3. **Your Testimonies**:
   - View all your submitted testimonies on your profile
   - See engagement metrics (views, likes)
   - Edit or update if needed

### Key Features
- **8 Categories**: Organized by type of testimony
- **AI Moderation**: Automatic content review and approval
- **Engagement Metrics**: Track views and likes
- **Social Sharing**: Easy sharing to social media platforms
- **Auto-Approval**: Testimonies that pass moderation appear immediately

### Guidelines
- Be honest and authentic
- Focus on God's faithfulness
- Avoid sharing sensitive personal information
- Respect others' privacy
- Keep content appropriate and encouraging

---

## Live Prayer Room

### Overview
Join real-time audio prayer sessions with other believers. Host or participate in live prayer rooms where you can pray together, share requests, and connect through voice communication.

### Why Use This Feature
- **Real-Time Connection**: Pray with others in real-time, not just asynchronously
- **Community Building**: Build deeper relationships through shared prayer
- **Accountability**: Regular prayer sessions create spiritual discipline
- **Flexibility**: Join as a speaker (can talk) or listener (can hear only)
- **Scheduled Sessions**: Plan and RSVP to upcoming prayer sessions

### How to Use

#### Joining a Prayer Room
1. **Browse Available Rooms**:
   - Visit `/prayer-room` to see all available rooms
   - View "Live Now" rooms currently active
   - Check "Upcoming" for scheduled sessions

2. **Join a Room**:
   - Click on any room card
   - For private rooms, enter the room code if required
   - Allow microphone access when prompted

3. **Choose Your Role**:
   - **Speaker**: Can speak and be heard by others
   - **Listener**: Can hear but microphone is muted
   - You can request to become a speaker if you're a listener

#### Hosting a Prayer Room
1. **Create a Room**:
   - Click "Create Prayer Room" button
   - Enter room name and description
   - Choose privacy: Public or Private (with code)
   - Set maximum speakers (up to 20)

2. **Schedule a Session** (Optional):
   - Set date and time for your session
   - Add description and topic
   - Make it recurring if desired
   - Others can RSVP to join

3. **Manage Your Room**:
   - Mute/unmute participants
   - Promote listeners to speakers
   - Remove participants if needed
   - End the session when finished

#### During a Session
1. **Audio Controls**:
   - **Mute/Unmute**: Toggle your microphone
   - **Speaker/Listener**: Switch between roles
   - **Volume**: Adjust audio levels

2. **Chat Feature**:
   - Send text messages to all participants
   - Share prayer requests in chat
   - Coordinate prayer topics

3. **Participant List**:
   - See who's in the room
   - View who's currently speaking
   - See speaking indicators (visual feedback)

4. **WebRTC Features**:
   - Real-time peer-to-peer audio
   - Low latency communication
   - Automatic connection management
   - Handles network issues gracefully

### Key Features
- **Real-Time Audio**: WebRTC-based voice communication
- **Role Management**: Speaker/Listener roles with requests
- **Scheduled Sessions**: Plan and RSVP to upcoming sessions
- **Recurring Sessions**: Set up regular prayer meetings
- **Private Rooms**: Password-protected rooms for small groups
- **Chat Integration**: Text messaging during audio sessions
- **Mobile Optimized**: Works on mobile devices
- **Automatic Cleanup**: Inactive sessions are cleaned up automatically

### Privacy & Safety
- Host controls who can speak
- Private rooms require a code
- All participants are authenticated
- Sessions can be ended by host
- Content moderation for chat messages

### Technical Requirements
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Microphone access (for speakers)
- Stable internet connection
- No additional software required

---

## Email Subscriptions

### Overview
Receive daily prayers and verses delivered directly to your email inbox. Get your spiritual content at 6 AM in your local timezone, perfect for starting your day.

### Why Use This Feature
- **Convenience**: Get content without visiting the website
- **Consistent Timing**: Always receive emails at 6 AM your time
- **Beautiful Formatting**: Professionally designed HTML emails
- **Mobile Optimized**: Read on any device
- **Easy Unsubscribe**: One-click unsubscribe anytime

### How to Use

#### Subscribing
1. **During Signup**:
   - Email subscription is enabled by default when you create an account
   - You can opt out during signup if desired

2. **From Your Profile**:
   - Visit your Profile page
   - Toggle "Email Subscriptions" on/off
   - Changes take effect immediately

3. **From Email**:
   - Click "Subscribe" link in any email
   - Or visit the website and enable in profile

#### Managing Your Subscription
1. **Update Preferences**:
   - Visit Profile → Settings
   - Toggle email subscription on/off
   - Update your timezone if needed

2. **Unsubscribe**:
   - Click "Unsubscribe" link in any email
   - Or visit `/unsubscribe` page
   - Enter your email to unsubscribe
   - Confirmation email will be sent

3. **Resubscribe**:
   - Visit your profile
   - Re-enable email subscriptions
   - Or click "Resubscribe" in unsubscribe confirmation

### Email Content
Each daily email includes:
- **Daily Prayer**: Full text of today's AI-generated prayer
- **Daily Verse**: Bible verse with reference
- **Beautiful Design**: Professional HTML formatting
- **Mobile Friendly**: Optimized for all screen sizes
- **Social Sharing**: Easy share buttons

### Key Features
- **Timezone Aware**: Emails sent at 6 AM in your timezone
- **HTML & Plain Text**: Works in all email clients
- **One-Click Unsubscribe**: Easy to opt out
- **Resubscribe Anytime**: Rejoin whenever you want
- **No Spam**: Only daily content, no marketing emails

---

## Organization Network

### Overview
Discover local and global Christian organizations, ministries, and nonprofits. Get personalized recommendations based on your location and current prayer needs.

### Why Use This Feature
- **Find Local Ministries**: Connect with organizations in your area
- **Support Global Causes**: Discover organizations addressing current disasters
- **Take Action**: Move from prayer to practical support
- **Network Building**: Connect with like-minded ministries
- **Disaster Response**: Find organizations helping in crisis areas

### How to Use

#### Viewing Organizations
1. **On Home Page**:
   - Scroll to "Organizations" section
   - See 6 recommended organizations
   - Recommendations update based on your location and current events

2. **Organization Details**:
   - Click on any organization card
   - View full description and mission
   - See contact information
   - Visit their website

3. **Location-Based**:
   - Organizations are recommended based on your detected location
   - Mix of local and global organizations
   - Updated based on current disasters in prayers

#### Updating Your Location
1. **Automatic Detection**:
   - Location is detected from your IP address
   - No action required

2. **Manual Update**:
   - Visit Profile → Settings
   - Update your city and country
   - This improves organization recommendations

### Key Features
- **Personalized Recommendations**: Based on location and current events
- **Disaster-Aware**: Organizations addressing current crises are prioritized
- **Local & Global Mix**: Balance of nearby and international organizations
- **6 Recommendations**: Curated list of relevant organizations
- **Fast Loading**: Cached for quick access

### How Recommendations Work
1. **Location Analysis**: Your city/country is detected
2. **Disaster Extraction**: Current disasters from daily prayers are identified
3. **Organization Matching**: Organizations addressing those needs are selected
4. **Geographic Balance**: Mix of local and global organizations
5. **Caching**: Results are cached for performance

---

## User Account & Profile

### Overview
Create and manage your Divine Bridge account. Track your activity, manage preferences, and personalize your experience.

### Why Use This Feature
- **Track Your Journey**: See your prayer statistics and activity
- **Manage Content**: Edit or delete your prayers and testimonies
- **Privacy Control**: Manage what information is visible
- **Preferences**: Customize email subscriptions and notifications
- **Security**: Secure authentication and password management

### How to Use

#### Creating an Account
1. **Sign Up**:
   - Click "Sign Up" or "Get Started"
   - Enter email, password, first name, last name
   - Or use "Sign in with Google" for quick registration
   - Email verification is sent automatically

2. **Email Verification**:
   - Check your email for verification link
   - Click to verify (or use code from email)
   - Verification is optional but recommended

3. **Complete Profile**:
   - Add profile photo (optional)
   - Set timezone for email delivery
   - Enable/disable email subscriptions

#### Managing Your Profile
1. **View Profile**:
   - Click your name/avatar in navigation
   - Or visit `/profile`
   - See your statistics and activity

2. **Edit Profile**:
   - Click "Edit Profile"
   - Update name, photo, bio
   - Change timezone
   - Update email preferences

3. **Change Password**:
   - Visit "Change Password" page
   - Enter current and new password
   - Password must be strong (8+ chars, mixed case, numbers)

4. **Account Statistics**:
   - **Prayers Read**: Total prayers you've viewed
   - **Requests Submitted**: Your prayer requests
   - **Testimonies Shared**: Your testimonies
   - **Prayed For**: Requests you've prayed for

#### Security Features
1. **Password Reset**:
   - Click "Forgot Password" on login page
   - Enter your email
   - Follow link in email to reset

2. **Session Management**:
   - Sessions last 7 days
   - Automatic logout after inactivity
   - Secure session cookies

3. **Two-Factor Authentication** (Coming Soon):
   - Additional security layer
   - Optional but recommended

### Key Features
- **Firebase Authentication**: Secure, industry-standard auth
- **Google Sign-In**: Quick registration with Google account
- **Profile Management**: Full control over your information
- **Activity Tracking**: Statistics and engagement metrics
- **Privacy Controls**: Control what's visible to others
- **Email Verification**: Optional but recommended

---

## Social Sharing

### Overview
Share prayers, verses, testimonies, and prayer requests on social media. Spread encouragement and connect with others.

### Why Use This Feature
- **Spread Encouragement**: Share uplifting content with your network
- **Invite Others**: Bring friends into the prayer community
- **Document Your Journey**: Share answered prayers and testimonies
- **Build Community**: Grow the global prayer network

### How to Use

#### Sharing Content
1. **Share Daily Prayer**:
   - Click share button on daily prayer
   - Choose platform (Facebook, Twitter, WhatsApp, etc.)
   - Beautiful image is included automatically

2. **Share Verse**:
   - Click share on daily verse
   - Verse image is optimized for social media
   - Includes verse text and reference

3. **Share Prayer Request**:
   - Click share on any prayer request
   - Link includes full request details
   - Others can view and pray from the link

4. **Share Testimony**:
   - Share your testimony or others'
   - Link to full testimony page
   - Encourage others with God's faithfulness

#### Social Media Optimization
- **Open Graph Images**: Rich previews on Facebook, Twitter, LinkedIn
- **Optimized Images**: 1080x1080px images perfect for Instagram
- **Short Links**: Clean, shareable URLs
- **Mobile Friendly**: Links work perfectly on mobile

### Supported Platforms
- Facebook
- Twitter/X
- WhatsApp
- Email
- Copy Link (for any platform)

---

## Disaster Support

### Overview
Automatic detection and prayer support for global disasters and crises. The system identifies current disasters and generates targeted prayers.

### Why Use This Feature
- **Stay Informed**: Learn about current global crises
- **Pray Specifically**: Prayers are tailored to specific disasters
- **Take Action**: Connect with organizations helping in disaster areas
- **Global Awareness**: Stay connected to worldwide needs

### How to Use

1. **Automatic Integration**:
   - Disasters are automatically detected in daily prayers
   - No action required from users
   - Prayers include context about current events

2. **View Disaster Pages**:
   - SEO-optimized pages for each disaster
   - Includes prayer content and organization links
   - Shareable disaster-specific content

3. **Organization Recommendations**:
   - Organizations helping in disaster areas are prioritized
   - See organizations on home page
   - Click to learn more and support

### Key Features
- **Automatic Detection**: AI identifies disasters in news and events
- **Targeted Prayers**: Prayers address specific disaster contexts
- **SEO Pages**: Dedicated pages for each disaster
- **Organization Links**: Connect with relief organizations
- **Real-Time Updates**: Content updates as situations evolve

---

## Additional Features

### Search & Discovery
- Search prayers and testimonies
- Filter by date, category, or engagement
- Discover trending content

### Notifications (Coming Soon)
- Get notified when others pray for your request
- Daily reminders for prayer time
- Testimony engagement notifications

### Mobile App (Coming Soon)
- Native iOS and Android apps
- Push notifications
- Offline reading
- Enhanced mobile experience

---

## Getting Help

### Support Resources
- **FAQ Page**: `/faq` - Common questions answered
- **Contact Page**: `/contact` - Reach out for help
- **About Page**: `/about` - Learn more about Divine Bridge

### Community Guidelines
- Be respectful and encouraging
- Keep content appropriate
- Respect others' privacy
- Follow terms of service

### Privacy & Security
- Read our Privacy Policy: `/privacy-policy`
- Review Terms of Service: `/terms-of-service`
- Your data is secure and private

---

## Conclusion

Divine Bridge is designed to unite hearts in faith through prayer, community, and shared spiritual experiences. Whether you're seeking daily spiritual nourishment, community support, or ways to serve others, our platform provides the tools and community to help you grow in faith.

**Start your journey today at [divinebridge.io](https://divinebridge.io)**

---

*This documentation is updated regularly. For the latest features and updates, visit the website or contact support.*

