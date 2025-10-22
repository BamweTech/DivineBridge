# Non-Profit Organizations Feature - Design Document

## Overview
Connect prayer with action by highlighting 5 non-profit organizations helping with challenges mentioned in daily prayers and local to the user's location.

---

## 1. Feature Objectives

### Primary Goals
- **Bridge Prayer & Action**: Move users from prayer to tangible support
- **Local Impact**: Prioritize organizations in user's geographic area
- **Disaster Response**: Highlight organizations addressing current crises
- **Daily Refresh**: Keep content relevant to current daily prayer

### Success Metrics
- User engagement with organization links
- Click-through rates to donation pages
- User location data collection rate
- Organization cache hit rate (efficiency)

---

## 2. User Location Strategy

### 2.1 Multi-Tier Location Detection

**Tier 1: IP-Based Geolocation (Automatic)**
- **When**: On first visit, before signup
- **How**: Use IP geolocation API (e.g., ipapi.co, ipinfo.io, MaxMind)
- **Accuracy**: City-level
- **Advantages**: No user input required, works immediately
- **Limitations**: Can be inaccurate for VPNs/proxies
- **Storage**: Session/localStorage until user creates profile

**Tier 2: Profile Data (User-Provided)**
- **When**: During signup or profile editing
- **Fields**:
  - Country (dropdown)
  - City (text input with autocomplete)
  - Language (dropdown, optional)
- **Advantages**: More accurate, user's actual location
- **Overrides**: IP-based detection once set
- **Storage**: Firebase user metadata or database

**Tier 3: Fallback**
- **Default**: United States, New York (if all detection fails)
- **Reason**: Largest non-profit database, safe fallback

### 2.2 Data Structure
```json
{
  "user_id": "firebase_uid",
  "location": {
    "country": "United States",
    "country_code": "US",
    "city": "New York",
    "state": "NY",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "detection_method": "ip" | "user_provided",
    "detected_at": "2025-10-10T00:00:00Z",
    "updated_at": "2025-10-10T00:00:00Z"
  },
  "language": "en"
}
```

---

## 3. Organization Data Management

### 3.1 AI-Powered Curation (Perplexity AI)

**Initial Query Structure:**
```
Find 10 reputable non-profit organizations in {city}, {country} that focus on:
- General humanitarian aid
- Disaster relief
- Community development

For each organization, provide:
1. Official name
2. Brief description (2-3 sentences)
3. Official website URL
4. Donation page URL
5. Logo URL (if publicly available)
6. Primary focus areas

Format the response as JSON.
```

**Disaster-Specific Query:**
```
Find 5 reputable non-profit organizations actively responding to {disaster_type} in {location}. 

Focus on organizations that:
- Are currently active in disaster response
- Have verified donation pages
- Are transparent about fund usage

Provide: name, description, website, donation link, logo URL.
Format as JSON.
```

### 3.2 Caching Strategy

**Cache Structure (Google Cloud Storage):**
```
Path: organizations/{country_code}/{city_slug}/general.json
Path: organizations/{country_code}/{city_slug}/disasters/{disaster_type}.json

Example:
organizations/US/new-york/general.json
organizations/PH/manila/disasters/typhoon.json
organizations/NP/kathmandu/disasters/flood.json
```

**Cache Entry Format:**
```json
{
  "location": {
    "country": "United States",
    "country_code": "US",
    "city": "New York"
  },
  "query_type": "general" | "disaster",
  "disaster_type": "typhoon" | "flood" | "earthquake" | null,
  "organizations": [
    {
      "name": "American Red Cross - Greater New York",
      "description": "Provides emergency assistance, disaster relief...",
      "website": "https://www.redcross.org/local/new-york.html",
      "donation_url": "https://www.redcross.org/donate",
      "logo_url": "https://www.redcross.org/logo.png",
      "focus_areas": ["disaster relief", "emergency assistance"],
      "verified": true,
      "last_verified": "2025-10-10T00:00:00Z"
    }
  ],
  "generated_at": "2025-10-10T00:00:00Z",
  "expires_at": "2025-11-10T00:00:00Z",
  "cache_version": "1.0"
}
```

**Cache Policy:**
- **TTL**: 30 days for general organizations
- **TTL**: 7 days for disaster-specific organizations (more dynamic)
- **Invalidation**: Manual override if organization becomes controversial
- **Size limit**: 100 cities per country (auto-cleanup oldest)

### 3.3 Fallback Strategy

If Perplexity fails or cache is empty:
1. **Primary**: Serve from static fallback list (top 10 global organizations)
2. **Secondary**: Show generic disaster relief organizations (Red Cross, UNICEF, etc.)
3. **Display**: "Organizations serving globally" instead of location-specific

**Static Fallback Organizations:**
```json
[
  {
    "name": "International Red Cross",
    "description": "Global humanitarian network providing disaster relief...",
    "website": "https://www.icrc.org",
    "donation_url": "https://www.icrc.org/en/donate",
    "logo_url": "/static/images/nonprofits/redcross.png",
    "focus_areas": ["disaster relief", "emergency response", "healthcare"]
  }
]
```

---

## 4. Daily Prayer Disaster Extraction

### 4.1 AI-Powered Extraction

**When**: Immediately after daily prayer is generated

**Extraction Prompt:**
```
Analyze this prayer and extract all disaster-related information:

{daily_prayer_content}

Return a JSON object with:
{
  "disasters": [
    {
      "type": "typhoon" | "earthquake" | "flood" | "landslide" | "storm" | "fire" | "drought" | "conflict" | "epidemic",
      "locations": ["country1", "country2"],
      "severity": "minor" | "moderate" | "severe",
      "casualties": number or null
    }
  ]
}

If no disasters mentioned, return empty array.
```

**Example Output:**
```json
{
  "disasters": [
    {
      "type": "typhoon",
      "locations": ["Philippines", "Vietnam", "Thailand", "Taiwan", "China"],
      "severity": "severe",
      "casualties": 200,
      "names": ["Ragasa", "Bualoi", "Matmo"]
    },
    {
      "type": "earthquake",
      "locations": ["Philippines"],
      "severity": "severe",
      "casualties": 71,
      "details": "Cebu region"
    }
  ]
}
```

### 4.2 Storage Enhancement

**Enhanced Prayer Data Structure:**
```json
{
  "content": "Dear Heavenly Father...",
  "date": "2025-10-09",
  "created_at": "2025-10-09T19:42:08Z",
  "source": "generated",
  "metadata": {
    "disasters": [
      {
        "type": "typhoon",
        "locations": ["Philippines", "Vietnam"],
        "severity": "severe",
        "casualties": 200
      }
    ],
    "topics": ["natural disasters", "humanitarian aid"],
    "affected_regions": ["Southeast Asia", "South Asia", "Europe"],
    "extracted_at": "2025-10-09T19:42:10Z"
  }
}
```

### 4.3 Disaster Type Taxonomy

**Primary Categories:**
- `typhoon` / `hurricane` / `cyclone`
- `earthquake`
- `flood`
- `landslide`
- `drought`
- `wildfire`
- `tornado`
- `tsunami`
- `volcanic_eruption`
- `conflict` / `war`
- `epidemic` / `pandemic`
- `famine`
- `refugee_crisis`

---

## 5. Organization Selection Logic

### 5.1 Selection Algorithm

**Input:**
- User location (city, country)
- Daily prayer disasters (extracted metadata)
- Date (for randomization seed)

**Output:**
- 5 organizations (3 general + 2 disaster-specific)

**Algorithm:**
```python
def select_organizations(user_location, prayer_disasters, date):
    """
    Select 5 organizations to display
    
    Returns:
        - 3 general organizations (local to user)
        - 2 disaster-specific organizations (matching prayer)
    """
    
    # 1. Get general organizations for user's city
    general_orgs = get_cached_organizations(
        country=user_location.country,
        city=user_location.city,
        type='general'
    )
    
    # If cache miss, query Perplexity
    if not general_orgs:
        general_orgs = query_perplexity_for_organizations(
            location=user_location,
            type='general'
        )
        cache_organizations(general_orgs, user_location, type='general')
    
    # Randomly select 3 from available (using date as seed for daily consistency)
    random.seed(date)
    selected_general = random.sample(general_orgs, min(3, len(general_orgs)))
    
    # 2. Get disaster-specific organizations
    disaster_orgs = []
    for disaster in prayer_disasters[:2]:  # Top 2 disasters from prayer
        orgs = get_cached_organizations(
            country=disaster.locations[0],  # Primary affected country
            disaster_type=disaster.type
        )
        
        if not orgs:
            orgs = query_perplexity_for_organizations(
                location=disaster.locations[0],
                disaster_type=disaster.type
            )
            cache_organizations(orgs, disaster.locations[0], disaster.type)
        
        if orgs:
            disaster_orgs.extend(random.sample(orgs, min(1, len(orgs))))
    
    # Combine: 3 general + 2 disaster-specific
    selected_orgs = selected_general + disaster_orgs[:2]
    
    # If we don't have 5, fill with more general orgs
    if len(selected_orgs) < 5:
        remaining = [o for o in general_orgs if o not in selected_orgs]
        selected_orgs.extend(random.sample(remaining, min(5 - len(selected_orgs), len(remaining))))
    
    return selected_orgs[:5]
```

### 5.2 Prioritization Rules

**Priority Order:**
1. **Local + Disaster Match**: Organizations in user's city working on prayer disasters (highest priority)
2. **Disaster-Specific**: Organizations responding to prayer disasters (any location)
3. **Local General**: Organizations in user's city (general humanitarian)
4. **Regional**: Organizations in user's country/region
5. **Global**: International organizations (fallback)

---

## 6. UI/UX Design

### 6.1 Component Design

**Section Title:**
```
"Take Action: Support Organizations Helping Those in Need"
```

**Card Layout (per organization):**
```html
┌─────────────────────────────────────────────────────────┐
│  [LOGO]  Organization Name                              │
│          ─────────────────                              │
│                                                          │
│  Brief description (2-3 lines)...                       │
│                                                          │
│  🎯 Focus: Disaster Relief, Emergency Aid               │
│  📍 Location: Manila, Philippines                       │
│                                                          │
│  [Learn More] [Donate Now]                              │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Visual Design

**Styling:**
- **Container**: Full-width section, subtle gradient background
- **Cards**: Glass-morphism design, 5 cards in responsive grid
- **Badges**: 
  - "🏠 LOCAL" badge for user's city organizations
  - "🚨 RESPONDING NOW" badge for disaster-specific orgs
- **Colors**:
  - Local orgs: Green accent (#10b981)
  - Disaster orgs: Red/Orange accent (#f59e0b)
  - General: Blue accent (#3b82f6)

**Responsive Layout:**
- **Desktop**: 2-3 columns
- **Tablet**: 2 columns
- **Mobile**: 1 column (stacked)

### 6.3 Placement

**On Home Page:**
```
[Daily Verse Section]
      ↓
[Community Prayer Requests]
  - Daily Prayer (full content)
  - Preview of prayer requests
      ↓
[Take Action Section] ← NEW
  - 5 Organization Cards
      ↓
[Features Section]
      ↓
[CTA Section]
```

**Section Structure:**
- Header: "Take Action: Organizations Making a Difference"
- Subheader: "Support these organizations helping people in [User's City] and those affected by [Disaster Type]"
- Organization grid (5 cards)
- Footer note: "Organizations refreshed daily"

---

## 7. Technical Implementation

### 7.1 Database Schema

**New Collection: `user_locations`**
```python
# Cloud Firestore or Cloud Storage
{
  "user_id": "firebase_uid",
  "country": "United States",
  "country_code": "US",
  "city": "New York",
  "state": "NY",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "language": "en",
  "detection_method": "ip" | "user_provided",
  "ip_address": "1.2.3.4",  # Hashed for privacy
  "created_at": "2025-10-10T00:00:00Z",
  "updated_at": "2025-10-10T00:00:00Z"
}
```

**Cache Collection: `organization_cache`**
```
Path: organizations/{country_code}/{city_slug}/general/{cache_date}.json
Path: organizations/disasters/{disaster_type}/{country_code}/{cache_date}.json

Example:
organizations/US/new-york/general/2025-10-10.json
organizations/disasters/typhoon/PH/2025-10-10.json
```

**Prayer Metadata Enhancement:**
```python
# Add to existing prayer data structure
{
  "content": "...",
  "date": "2025-10-10",
  "source": "generated",
  "metadata": {  # NEW
    "disasters": [...],
    "topics": [...],
    "affected_countries": [...],
    "extracted_at": "..."
  }
}
```

### 7.2 New Backend Components

#### A. `location_service.py`
```python
class LocationService:
    """Handle user location detection and management"""
    
    def get_user_location(user_id=None):
        """Get user location from profile or IP"""
        pass
    
    def detect_location_from_ip(ip_address):
        """Use IP geolocation API"""
        pass
    
    def save_user_location(user_id, location_data):
        """Save location to user profile"""
        pass
    
    def update_user_location(user_id, city, country, language):
        """Update user-provided location"""
        pass
```

#### B. `nonprofit_service.py`
```python
class NonprofitService:
    """Handle non-profit organization queries and caching"""
    
    def get_organizations_for_user(user_location, prayer_disasters, date):
        """Main entry point - get 5 organizations"""
        pass
    
    def query_perplexity_for_organizations(location, disaster_type=None):
        """Query Perplexity AI for organizations"""
        pass
    
    def cache_organizations(orgs, location, cache_type, disaster_type=None):
        """Save organizations to cache"""
        pass
    
    def get_cached_organizations(location, cache_type, disaster_type=None):
        """Retrieve from cache if available and not expired"""
        pass
    
    def validate_organization_data(org_data):
        """Ensure organization data has required fields"""
        pass
```

#### C. `disaster_extractor.py`
```python
class DisasterExtractor:
    """Extract disaster information from prayer text"""
    
    def extract_disasters(prayer_content):
        """Use AI to extract disasters from prayer"""
        pass
    
    def categorize_disaster_type(disaster_description):
        """Map disaster description to standard taxonomy"""
        pass
    
    def extract_locations(disaster_text):
        """Extract country/region names"""
        pass
    
    def enrich_prayer_with_metadata(prayer_data):
        """Add metadata to prayer after generation"""
        pass
```

### 7.3 API Endpoints

**New Routes (`routes/nonprofit_bp.py`):**

```python
@nonprofit_bp.route('/organizations', methods=['GET'])
def get_organizations():
    """
    Get 5 organizations for current user
    
    Query params:
        - user_id (optional, from auth)
        - ip (auto-detected)
    
    Returns:
        {
          "organizations": [...],
          "user_location": {...},
          "disaster_context": {...}
        }
    """
    pass

@nonprofit_bp.route('/location', methods=['POST'])
def update_location():
    """
    Update user's location preference
    
    Body:
        {
          "city": "Los Angeles",
          "country": "United States",
          "country_code": "US",
          "language": "en"
        }
    """
    pass

@nonprofit_bp.route('/organizations/refresh', methods=['POST'])
def refresh_organizations():
    """Force refresh organizations (invalidate cache)"""
    pass
```

### 7.4 Frontend Integration

**Component: `OrganizationSection.js` (inline in index.html)**

```javascript
async function loadOrganizations() {
    try {
        // Get user's location (from Firebase profile or IP)
        const response = await fetch('/api/nonprofit/organizations');
        const data = await response.json();
        
        if (data.organizations && data.organizations.length > 0) {
            displayOrganizations(data.organizations, data.user_location);
        }
    } catch (error) {
        console.error('Error loading organizations:', error);
        // Show fallback or hide section
    }
}

function displayOrganizations(orgs, location) {
    const container = document.getElementById('organizations-container');
    
    container.innerHTML = orgs.map(org => `
        <div class="org-card ${org.badge_type}">
            ${org.badge ? `<span class="org-badge">${org.badge}</span>` : ''}
            <div class="org-header">
                ${org.logo_url ? `<img src="${org.logo_url}" alt="${org.name}" class="org-logo">` : ''}
                <h3 class="org-name">${org.name}</h3>
            </div>
            <p class="org-description">${org.description}</p>
            <div class="org-meta">
                <span class="org-focus">🎯 ${org.focus_areas.join(', ')}</span>
                ${org.location ? `<span class="org-location">📍 ${org.location}</span>` : ''}
            </div>
            <div class="org-actions">
                <a href="${org.website}" target="_blank" class="org-btn learn-more">Learn More</a>
                <a href="${org.donation_url}" target="_blank" class="org-btn donate">Donate Now</a>
            </div>
        </div>
    `).join('');
}
```

---

## 8. Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [x] Create `location_service.py`
- [x] Implement IP geolocation (ipapi.co free tier)
- [x] Add location fields to user profile schema
- [x] Create `disaster_extractor.py`
- [x] Test disaster extraction with existing daily prayer

### Phase 2: Organization Curation (Week 2)
- [x] Create `nonprofit_service.py`
- [x] Implement Perplexity AI query for organizations
- [x] Build caching system in Cloud Storage
- [x] Create fallback static organization list
- [x] Test with multiple cities/disasters

### Phase 3: Integration (Week 3)
- [x] Create API endpoints (`nonprofit_bp.py`)
- [x] Integrate disaster extraction into prayer generation
- [x] Auto-enrich prayers with metadata on creation
- [x] Test end-to-end flow

### Phase 4: UI Implementation (Week 4)
- [x] Design organization card component
- [x] Add to home page (below prayer preview)
- [x] Implement responsive layout
- [x] Add loading states and error handling
- [x] Mobile optimization

### Phase 5: Testing & Optimization (Week 5)
- [x] Test with various locations (US, PH, NP, etc.)
- [x] Verify cache hit rates
- [x] Load testing (100+ concurrent users)
- [x] A/B test card designs
- [x] Monitor Perplexity API costs

---

## 9. Technical Specifications

### 9.1 Dependencies

**New Python Packages:**
```txt
requests>=2.31.0          # HTTP requests
geoip2>=4.7.0            # IP geolocation (if using MaxMind)
python-geoip>=1.2        # Alternative geolocation
pycountry>=23.12.11      # Country/city validation
```

**External APIs:**
- **IP Geolocation**: ipapi.co (free tier: 1000 requests/day)
  - Endpoint: `https://ipapi.co/{ip}/json/`
  - Returns: city, country, coordinates
  - Fallback: ipinfo.io, freegeoip.app

- **Perplexity AI**: Already integrated
  - Additional cost: ~2-3 queries per new city
  - Caching reduces to ~1-2 queries/day

### 9.2 Performance Considerations

**Caching Strategy:**
- **Cache Hit Rate Target**: >90% (most users in common cities)
- **Perplexity Calls**: Max 10-20/day (after initial population)
- **Load Time Impact**: +0.5-1s on first visit, <0.1s cached

**Optimization:**
- Lazy load organizations (fetch after page renders)
- Show skeleton loaders while fetching
- Prefetch during prayer generation (background job)
- CDN for organization logos

### 9.3 Data Privacy

**IP Address Handling:**
- Hash IP before storing: `sha256(ip + salt)`
- Never store raw IP in database
- Only use for geolocation, then discard
- GDPR compliance: User can override with manual location

**User Data:**
- Location is optional
- Can be cleared/updated anytime
- Not shared with third parties
- Used only for organization recommendations

---

## 10. Perplexity AI Prompts

### 10.1 General Organizations Prompt

```
Task: Find reputable non-profit organizations in {city}, {country}.

Criteria:
- Must have official website and donation page
- Focus on: humanitarian aid, disaster relief, community development, poverty alleviation, mental health
- Preferably local or with local chapters
- Well-established and transparent

Return 10 organizations as JSON:
[
  {
    "name": "Organization official name",
    "description": "2-3 sentence description of their work and impact",
    "website": "https://official-website.org",
    "donation_url": "https://donate-page.org",
    "logo_url": "https://logo-if-available.png" or null,
    "focus_areas": ["disaster relief", "poverty"],
    "location": "City, Country"
  }
]

Important:
- Verify all URLs are valid and official
- Description should highlight local impact
- Include only verified, reputable organizations
- Prefer organizations with charity ratings (e.g., 4-star on Charity Navigator)
```

### 10.2 Disaster-Specific Prompt

```
Task: Find non-profit organizations actively responding to {disaster_type} in {location}.

Context from today's prayer:
{prayer_excerpt}

Criteria:
- Currently active in disaster response
- Accepting donations for this specific disaster
- Transparent about fund usage
- Verified official websites

Return 5 organizations as JSON:
[
  {
    "name": "Organization name",
    "description": "How they're specifically helping with {disaster_type} in {location}",
    "website": "official website",
    "donation_url": "disaster-specific donation page if available",
    "logo_url": "logo URL or null",
    "focus_areas": ["{disaster_type}", "emergency relief"],
    "location": "Primary operating location",
    "disaster_response": "Specific actions they're taking for this disaster"
  }
]

Prioritize:
- Organizations already on the ground
- Those with established track records
- Local organizations when possible
- International orgs with local partnerships
```

### 10.3 Disaster Extraction Prompt

```
Analyze this prayer and extract ALL disaster-related information:

Prayer:
{prayer_content}

Return JSON only:
{
  "disasters": [
    {
      "type": "typhoon" | "earthquake" | "flood" | "landslide" | "storm" | "wildfire" | "drought" | "conflict" | "epidemic" | "famine",
      "locations": ["Country1", "Country2", "Specific Region"],
      "severity": "minor" | "moderate" | "severe" | "catastrophic",
      "casualties": number or null,
      "names": ["Disaster Name"] or null,
      "details": "Brief summary"
    }
  ],
  "topics": ["natural disasters", "humanitarian crisis", etc.],
  "affected_regions": ["Southeast Asia", "Nepal", etc.]
}

Rules:
- Extract ALL disasters mentioned
- Be specific with locations (country-level minimum)
- Categorize by type from the taxonomy above
- If no disasters, return empty arrays
```

---

## 11. Error Handling & Edge Cases

### 11.1 Error Scenarios

**1. Perplexity API Failure:**
- **Retry**: 3 attempts with exponential backoff
- **Fallback**: Serve static global organizations
- **User Message**: "Showing global organizations"

**2. Cache Miss + API Failure:**
- **Fallback**: Broader region query (country-level)
- **Fallback 2**: Continental/global organizations
- **Never**: Show empty section

**3. Invalid Organization Data:**
- **Validation**: Check all URLs, filter out broken links
- **Skip**: Organizations with missing critical fields
- **Log**: For manual review and cache cleanup

**4. Location Detection Failure:**
- **Default**: Use New York, US
- **Prompt**: Ask user to set location in profile
- **Show**: General global organizations

### 11.2 Edge Cases

**User in Country with No Data:**
- Show regional organizations (e.g., "Africa", "Southeast Asia")
- Include 2-3 global organizations
- Suggest user can update location

**No Disasters in Today's Prayer:**
- Show 5 general local organizations
- Focus on community development, poverty, mental health

**Same Disaster Daily:**
- Rotate disaster-specific organizations (use date seed)
- Don't show same 2 orgs every day

**User Changes Location:**
- Invalidate old organization cache
- Fetch new organizations immediately
- Update on next page load

---

## 12. Content Moderation & Quality

### 12.1 Organization Verification

**Automated Checks:**
- URL validation (website and donation link accessible)
- SSL certificate verification
- Domain age check (avoid newly created scam sites)
- Cross-reference with Charity Navigator API (if available)

**Manual Review:**
- First 10 organizations per city reviewed manually
- Controversial organizations flagged for review
- User reports trigger manual verification

### 12.2 Exclusion Criteria

**Never Show:**
- Organizations with fraud allegations
- Political organizations (unless humanitarian focus)
- Religious organizations requiring conversion
- Unverified crowdfunding campaigns
- Organizations with low transparency ratings

### 12.3 Update Mechanism

**Weekly Review:**
- Check for organization updates/closures
- Verify donation links still active
- Update descriptions if needed

**User Feedback:**
- "Report Issue" link on each card
- Logs sent to admin for review
- Auto-hide if multiple reports

---

## 13. Analytics & Monitoring

### 13.1 Metrics to Track

**User Engagement:**
- Organization card impressions
- Click-through rate (Learn More vs Donate)
- Organizations per page view
- User location distribution

**Technical Metrics:**
- Cache hit rate (target: >90%)
- Perplexity API calls per day
- Average query response time
- Organization data freshness

**Business Metrics:**
- Estimated donations driven (via UTM parameters)
- User feedback/reports
- Popular organization types
- Geographic distribution

### 13.2 Logging

```python
# Log structure
{
  "event": "organizations_displayed",
  "user_id": "uid123",
  "location": "New York, US",
  "organizations": ["org1_id", "org2_id", ...],
  "disaster_context": ["typhoon", "flood"],
  "cache_hit": true,
  "timestamp": "2025-10-10T12:00:00Z"
}

{
  "event": "organization_clicked",
  "user_id": "uid123",
  "organization_name": "Red Cross NY",
  "action": "learn_more" | "donate",
  "timestamp": "2025-10-10T12:05:00Z"
}
```

---

## 14. Cost Estimation

### 14.1 API Costs

**Perplexity AI:**
- **General Organizations**: ~10 new cities/day × 1 query = 10 queries/day
- **Disaster Organizations**: ~2-3 new disasters/week × 2 queries = ~1 query/day
- **Disaster Extraction**: 1 query/day (with daily prayer)
- **Total**: ~12 queries/day = ~360 queries/month
- **Cost**: $360/month (assuming $1/query, depends on model)
- **Optimization**: Cache reduces to ~100 queries/month = $100/month

**IP Geolocation:**
- **Free Tier**: ipapi.co (1000 requests/day)
- **Estimated Usage**: 50-100 new users/day
- **Cost**: $0 (within free tier)
- **Upgrade**: $10/month for 30K requests if needed

**Cloud Storage:**
- **Organization Cache**: ~500 KB/city × 100 cities = 50 MB
- **Cost**: Negligible (~$0.01/month)

**Total Monthly Cost:** ~$100-$360 (mostly Perplexity AI)

### 14.2 Cost Optimization

**Strategies:**
1. **Aggressive Caching**: 30-day TTL for general orgs
2. **Pre-populate**: Top 50 cities during deployment
3. **Batch Queries**: Combine multiple city queries
4. **User Clustering**: Group nearby cities
5. **Fallback First**: Check static list before AI query

---

## 15. Implementation Checklist

### Backend
- [ ] Create `location_service.py` with IP geolocation
- [ ] Create `nonprofit_service.py` with Perplexity integration
- [ ] Create `disaster_extractor.py` with AI extraction
- [ ] Add location fields to user profile (Firebase/Storage)
- [ ] Create organization cache structure in Cloud Storage
- [ ] Build API routes (`nonprofit_bp.py`)
- [ ] Integrate disaster extraction into prayer generation
- [ ] Create fallback static organization list
- [ ] Implement cache invalidation logic
- [ ] Add error handling and retry logic

### Frontend
- [ ] Design organization card component (HTML/CSS)
- [ ] Add organization section to home page
- [ ] Implement loading states (skeleton loaders)
- [ ] Add "Take Action" section header
- [ ] Integrate location detection on first visit
- [ ] Add location selector in profile page
- [ ] Implement click tracking (analytics)
- [ ] Mobile-responsive design
- [ ] Accessibility (ARIA labels, keyboard nav)
- [ ] Error states and fallbacks

### Testing
- [ ] Unit tests for each service
- [ ] Integration tests for full flow
- [ ] Test with 10+ different cities
- [ ] Test disaster extraction accuracy
- [ ] Test cache hit/miss scenarios
- [ ] Load testing (100+ concurrent users)
- [ ] Cross-browser testing
- [ ] Mobile device testing

### Documentation
- [ ] API endpoint documentation
- [ ] Cache structure documentation
- [ ] Organization data format spec
- [ ] Admin guide for manual reviews
- [ ] User privacy policy update

---

## 16. Future Enhancements

### Phase 2 Features
- **User Donations Tracking**: Track which organizations users support
- **Impact Stories**: Show real stories from organizations
- **Volunteer Opportunities**: Not just donations, but volunteer links
- **Monthly Spotlight**: Feature one organization per month
- **User Reviews**: Let users review/rate organizations
- **Email Integration**: Send weekly organization highlights
- **Social Sharing**: Share specific organizations on social media

### Advanced Features
- **ML-Based Matching**: Learn user preferences over time
- **Impact Calculator**: Show estimated impact of donation amounts
- **Recurring Donation Setup**: Direct integration with payment providers
- **Organization Comparison**: Side-by-side comparison tool
- **Prayer-to-Action Tracking**: Connect prayers to donations made

---

## 17. Security & Compliance

### Data Protection
- **GDPR**: User location is opt-in, can be deleted
- **CCPA**: Clear privacy policy about location usage
- **Data Minimization**: Only store essential location fields
- **Encryption**: All data encrypted at rest and in transit

### Content Security
- **URL Validation**: All external links validated before display
- **XSS Prevention**: Sanitize all organization descriptions
- **HTTPS Only**: No mixed content
- **Rate Limiting**: Prevent API abuse

---

## 18. Success Criteria

### Launch Metrics (First 30 Days)
- **Feature Adoption**: >50% of visitors see organizations
- **Engagement**: >10% click-through to org websites
- **Donations**: >5% click donate buttons
- **Cache Efficiency**: >85% cache hit rate
- **Load Time**: <1.5s for organization section
- **Error Rate**: <1% of requests

### Long-Term Goals (3-6 Months)
- **Impact**: Facilitate $10K+ in donations
- **Coverage**: 100+ cities cached
- **Accuracy**: >90% relevant organization matches
- **User Feedback**: >4.5/5 star rating for feature
- **Cost Efficiency**: <$100/month for API calls

---

## 19. Risk Mitigation

### Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Perplexity returns scam orgs | High | Automated validation + manual review |
| API cost exceeds budget | Medium | Aggressive caching + query limits |
| Slow load time | Medium | Lazy loading + skeleton loaders |
| Inaccurate location detection | Low | User override in profile |
| Cache becomes stale | Low | 30-day expiration + manual refresh |
| Organization closes/changes | Low | Weekly verification + user reports |
| Privacy concerns | Medium | Clear opt-out + data deletion |

---

## 20. Development Timeline

**Total Estimated Time: 4-5 weeks**

### Week 1: Foundation
- Day 1-2: Location service + IP geolocation
- Day 3-4: Disaster extractor + AI integration
- Day 5: Testing and refinement

### Week 2: Organization Service
- Day 1-2: Perplexity integration + prompt engineering
- Day 3-4: Caching system + Cloud Storage setup
- Day 5: Fallback list + validation

### Week 3: API & Integration
- Day 1-2: API endpoints + routes
- Day 3-4: Prayer metadata enhancement
- Day 5: End-to-end testing

### Week 4: UI Implementation
- Day 1-2: Component design + CSS
- Day 3-4: Integration + responsive design
- Day 5: Polish + accessibility

### Week 5: Testing & Launch
- Day 1-2: Comprehensive testing
- Day 3: Bug fixes
- Day 4: Staging deployment
- Day 5: Production launch + monitoring

---

## 21. Monitoring & Iteration

### Post-Launch Monitoring (First 7 Days)

**Daily Checks:**
- [ ] Cache hit rate
- [ ] Perplexity API call volume
- [ ] Error logs
- [ ] User feedback
- [ ] Load time metrics
- [ ] Click-through rates

**Weekly Reviews:**
- [ ] Top 10 viewed organizations
- [ ] Geographic distribution
- [ ] Disaster type coverage
- [ ] Cost analysis
- [ ] User location accuracy

### Iteration Plan

**Week 1-2 Adjustments:**
- Tune cache TTL based on hit rates
- Adjust organization count if needed
- Refine Perplexity prompts for better results
- Fix any UI/UX issues

**Month 1-3 Enhancements:**
- Add more cities to cache
- Expand disaster taxonomy
- Improve matching algorithm
- Add user preferences

---

## 22. Open Questions for Discussion

1. **Should we allow users to suggest organizations?**
   - Pro: Community-driven, more comprehensive
   - Con: Requires moderation, potential spam

2. **Should we show donation amounts raised?**
   - Pro: Social proof, transparency
   - Con: Tracking complexity, privacy

3. **Should organizations be globally consistent or per-user?**
   - Global: Same orgs for all users in a city (simpler caching)
   - Per-user: Personalized based on user history (more complex)

4. **How to handle international disasters?**
   - Show global orgs even if user is elsewhere?
   - Or keep it strictly local + disaster-specific?

5. **Should we partner with organizations directly?**
   - Pro: Verified data, potential revenue sharing
   - Con: Bias toward partners, less diversity

---

## Summary

This feature will:
- ✅ Connect prayer with tangible action
- ✅ Highlight local organizations serving the user's community
- ✅ Respond dynamically to global disasters mentioned in daily prayers
- ✅ Use AI for intelligent curation and matching
- ✅ Implement efficient caching to minimize costs
- ✅ Provide users with vetted, reputable organizations
- ✅ Scale efficiently with user growth

**Next Steps:**
1. Review this document and provide feedback
2. Prioritize features for MVP vs Phase 2
3. Begin Phase 1 implementation
4. Set up monitoring and analytics
5. Launch beta to small user group

---

**Document Version:** 1.0  
**Created:** October 10, 2025  
**Author:** Divine Bridge Development Team  
**Status:** Awaiting Review & Approval

