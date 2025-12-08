# Virtual Business Card Feature - Design Document

## Overview
Add a virtual business card feature to the user profile that allows users to generate, share, and display their contact information in a beautifully designed card format.

## Feature Requirements

### 1. Data Collection
**New Fields Needed in Firestore `users` collection:**
- `linkedin` (string, optional) - LinkedIn profile URL
- `phoneNumber` (string, optional) - Phone number
- `businessCardEnabled` (boolean, default: false) - Privacy toggle
- `businessCardSlug` (string, optional) - Custom URL slug (e.g., "john-doe")

**Existing Fields to Use:**
- `firstName` (string)
- `lastName` (string)
- `email` (string)

### 2. UI Components

#### A. Profile Page Section
- Add new section: "Business Card" below "Location Settings"
- Button: "Generate Business Card" or "View Business Card"
- Edit button to add/update LinkedIn and phone number

#### B. Business Card Display
- **Design**: Glassmorphism (water glass effect)
  - Backdrop blur
  - Semi-transparent background
  - Subtle borders
  - Gradient accents
  - Divine Bridge brand colors (blue, gold)
- **Content Layout** (Divine Bridge Focused):
  - **Divine Bridge Logo** (top, centered, no text)
  - Full name (prominent, below logo)
  - Email (clickable mailto: link)
  - Phone number (clickable tel: link, if provided)
  - LinkedIn (clickable, with icon, if provided)
  - **Mark 11:24 Verse** (prominently displayed)
    - Text: "Therefore I tell you, whatever you ask for in prayer, believe that you have received it, and it will be yours."
    - Reference: "Mark 11:24"
  - **Website URL**: divinebridge.io (or configured domain)
  - QR code (bottom right corner)

#### C. Sharing Options
- **Share via SMS**: Opens native SMS app with pre-filled message and card URL
- **QR Code**: 
  - Displayed on card
  - Scannable to open public card page
  - Downloadable as image
- **Copy Link**: Copy public card URL to clipboard
- **Download vCard**: For mobile contacts (`.vcf` file)

### 3. Public Card Page
**Route**: `/card/<slug>` or `/card/<userId>`

**Features:**
- Publicly accessible (no auth required)
- Display all business card info
- QR code for easy sharing
- "Save to Contacts" button (mobile)
- Download vCard option
- Share buttons (SMS, Email, Copy Link)

**Privacy Considerations:**
- Only accessible if `businessCardEnabled: true`
- User can disable/enable anytime
- If disabled, return 404 or "Card not available"

### 4. Technical Implementation

#### Backend Routes Needed:
1. `GET /api/profile/business-card` - Get user's business card data
2. `POST /api/profile/business-card` - Update business card fields
3. `GET /card/<slug>` - Public card page
4. `GET /api/card/<slug>/vcard` - Download vCard file
5. `GET /api/card/<slug>/qr` - Generate QR code image

#### Frontend Components:
1. Business card editor (in profile)
2. Business card display component
3. QR code generator (use library like `qrcode.js`)
4. vCard generator (client-side or server-side)
5. Share functionality (Web Share API + fallbacks)

#### Libraries Needed:
- QR Code: `qrcode.js` or `qrcode` (Python)
- vCard generation: Custom or `vobject` (Python)

#### Assets Needed:
- Divine Bridge Logo: `static/images/LogoOnly1.png` or `assets/logos/LogoOnly1.png`
- Verse Text: Mark 11:24 (hardcoded)
  - Full text: "Therefore I tell you, whatever you ask for in prayer, believe that you have received it, and it will be yours."
  - Reference: "Mark 11:24"
- Website URL: `divinebridge.io` (or from config if different)

#### Visual Card Mockup:
```
┌─────────────────────────────────────┐
│                                     │
│        [Divine Bridge Logo]         │
│         (Logo Only, No Text)         │
│                                     │
│         John Doe                    │
│                                     │
│    📧 john.doe@example.com         │
│    📱 +1 (555) 123-4567            │
│    💼 linkedin.com/in/johndoe     │
│                                     │
│    ────────────────────────────     │
│                                     │
│    "Therefore I tell you,          │
│     whatever you ask for in         │
│     prayer, believe that you        │
│     have received it, and it        │
│     will be yours."                 │
│                                     │
│              Mark 11:24             │
│                                     │
│    ────────────────────────────     │
│                                     │
│         divinebridge.io             │
│                                     │
│                          [QR Code]  │
│                                     │
└─────────────────────────────────────┘
```

**Styling Notes:**
- Logo: 80-100px height, centered
- Name: Large, bold, brand blue color
- Contact info: Medium size, with icons
- Verse: Italic or styled font, centered, brand colors
- Website: Small, centered below verse
- QR Code: 120x120px minimum, bottom right
- Glassmorphism: Applied to entire card background

### 5. Design Considerations

#### Divine Bridge Branding:
- **Logo**: Use logo without text (LogoOnly1.png or LogoOnly2.png)
- **Verse**: Mark 11:24 - "Therefore I tell you, whatever you ask for in prayer, believe that you have received it, and it will be yours."
- **Website**: Display Divine Bridge website URL (divinebridge.io or configured domain)
- **Color Scheme**: Use Divine Bridge brand colors (blue #1f3c88, gold #f5c542)
- **Typography**: Match existing Divine Bridge font styles (Poppins, etc.)

#### Glassmorphism Style:
```css
background: rgba(255, 255, 255, 0.1);
backdrop-filter: blur(20px);
border: 1px solid rgba(255, 255, 255, 0.2);
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
border-radius: 20px;
```

#### Card Layout (Divine Bridge Focused):
```
┌─────────────────────────────┐
│      [Divine Bridge Logo]   │
│        (Logo Only, No Text)  │
│                             │
│      Full Name              │
│                             │
│  📧 email@example.com      │
│  📱 +1 (555) 123-4567      │
│  💼 linkedin.com/in/name   │
│                             │
│  "Therefore I tell you,     │
│   whatever you ask for in   │
│   prayer, believe that you  │
│   have received it, and it │
│   will be yours."           │
│                             │
│         Mark 11:24          │
│                             │
│    divinebridge.io          │
│                             │
│              [QR Code]      │
└─────────────────────────────┘
```

**Design Elements:**
- **Logo**: Divine Bridge logo (LogoOnly1.png or LogoOnly2.png) at the top, centered
- **User Info**: Name, email, phone, LinkedIn in the middle section
- **Verse**: Mark 11:24 displayed prominently in italics or styled text
- **Website**: Divine Bridge website URL at bottom
- **QR Code**: Bottom right corner for easy scanning
- **Glassmorphism**: Apply water glass effect throughout

### 6. User Flow

1. **Setup**:
   - User goes to Profile
   - Clicks "Edit Business Card"
   - Enters LinkedIn URL and phone number
   - Saves

2. **View/Share**:
   - User clicks "View Business Card"
   - Card displays with all info
   - User can:
     - Share via SMS
     - Download QR code
     - Copy link
     - Download vCard

3. **Recipient**:
   - Receives link or scans QR code
   - Opens public card page
   - Can save to contacts (mobile)
   - Can view all info

### 7. Privacy & Security

- **Privacy Toggle**: Users can enable/disable public access
- **Data Validation**: 
  - Phone number format validation
  - LinkedIn URL validation
  - Email already validated
- **Rate Limiting**: Limit public card page requests
- **Slug Uniqueness**: Ensure unique slugs (fallback to userId)

### 8. Mobile Considerations

- **Save to Contacts**: Use vCard format (`.vcf`)
- **SMS Sharing**: Use `sms:` protocol
- **QR Code Scanning**: Ensure QR code is large enough (min 200x200px)
- **Responsive Design**: Card should look good on all screen sizes

### 9. Potential Issues & Solutions

**Issue 1**: Phone number format inconsistency
- **Solution**: Normalize phone numbers (E.164 format) for storage, display in readable format

**Issue 2**: LinkedIn URL validation
- **Solution**: Accept full URLs or just username, normalize to full URL

**Issue 3**: QR code size on mobile
- **Solution**: Make QR code downloadable, ensure minimum size

**Issue 4**: vCard compatibility
- **Solution**: Use standard vCard 3.0 format, test on iOS and Android

**Issue 5**: Slug collisions
- **Solution**: Check uniqueness, append numbers if needed (e.g., "john-doe-2")

### 10. Future Enhancements

- Custom card themes/colors
- Profile photo upload for card
- Social media links (Twitter, Instagram, etc.)
- Company/organization field
- Job title field
- Website URL
- Analytics (track card views)
- Custom domain support

## Implementation Phases

### Phase 1: Core Functionality
1. Add fields to Firestore schema
2. Create business card editor in profile
3. Display business card component
4. Basic sharing (copy link)

### Phase 2: Sharing Features
1. QR code generation
2. SMS sharing
3. vCard download
4. Public card page

### Phase 3: Polish
1. Glassmorphism design refinement
2. Mobile optimization
3. Error handling
4. Privacy controls

## Questions to Consider

1. **Slug vs UserId**: Should we use custom slugs or just userId for URLs?
   - **Recommendation**: Start with userId (simpler), add slug option later

2. **Required vs Optional**: Should LinkedIn and phone be required?
   - **Recommendation**: Optional, but card only shows if at least email is available

3. **Default State**: Should business card be enabled by default?
   - **Recommendation**: No, opt-in for privacy

4. **QR Code Content**: What should QR code link to?
   - **Recommendation**: Public card page URL

5. **vCard Format**: Full vCard or simplified?
   - **Recommendation**: Full vCard with all available fields

