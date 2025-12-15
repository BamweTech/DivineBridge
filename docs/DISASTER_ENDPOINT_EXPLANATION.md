# How the Disaster Endpoint Works

## Overview

The disaster endpoint (`/prayers/disaster/<disaster_type>/<location>`) creates SEO-optimized landing pages for specific disasters mentioned in daily prayers. These pages include custom-generated prayers tailored to each disaster and location.

---

## Flow Diagram

```
Daily Prayer Generation
    ↓
Disaster Extraction (AI)
    ↓
Metadata Storage (with disasters array)
    ↓
Sitemap Generation (creates URLs)
    ↓
User visits /prayers/disaster/earthquake/japan
    ↓
Check Cache (24-hour expiry)
    ↓
Generate/Cache Prayer (if needed)
    ↓
Render SEO-Optimized Page
```

---

## Step-by-Step Process

### 1. **Daily Prayer Generation** (`prayer_generator.py`)

When a daily prayer is generated:

```python
# In prayer_generator.py, after generating prayer content:
prayer_data = {
    'content': response,  # The prayer text
    'date': today,
    'created_at': datetime.now().isoformat(),
    'source': 'generated'
}

# Extract disaster metadata from prayer
from disaster_extractor import get_disaster_extractor
extractor = get_disaster_extractor()
metadata = extractor.extract_disasters(response)
prayer_data['metadata'] = metadata
```

**Key Point:** The daily prayer text is analyzed to extract disaster information.

---

### 2. **Disaster Extraction** (`disaster_extractor.py`)

The `DisasterExtractor` class uses AI (Perplexity) to analyze the prayer text and extract:

- **Disaster types** (typhoon, earthquake, flood, etc.)
- **Locations** (countries/regions affected)
- **Severity** (minor, moderate, severe, catastrophic)
- **Casualties** (if mentioned)
- **Topics** (natural disasters, humanitarian aid, etc.)
- **Affected regions** (broader geographic areas)

**Example Prayer Text:**
```
"Heavenly Father, we lift up Japan shaken by a powerful earthquake..."
```

**Extracted Metadata:**
```json
{
  "disasters": [
    {
      "type": "earthquake",
      "locations": ["Japan"],
      "severity": "severe",
      "casualties": null,
      "details": "Powerful earthquake shaking Japan"
    }
  ],
  "topics": ["natural disasters", "earthquake"],
  "affected_regions": ["Japan"]
}
```

**Disaster Types Supported:**
- typhoon, hurricane, cyclone
- earthquake
- flood, flooding
- landslide
- drought
- wildfire, fire
- tornado
- tsunami
- volcanic_eruption, volcano
- conflict, war
- epidemic, pandemic
- famine
- refugee_crisis
- storm

---

### 3. **Sitemap Generation** (`routes/seo_bp.py`)

The sitemap automatically creates URLs for disaster pages:

```python
# In sitemap() function:
for disaster in disasters:
    if disaster.get('type') and disaster.get('locations'):
        disaster_type = disaster['type'].lower().replace(' ', '-')
        for location in disaster['locations'][:3]:  # Max 3 locations per disaster
            location_slug = location.lower().replace(' ', '-').replace(',', '')
            
            xml_content.append(f'<loc>{base_url}/prayers/disaster/{disaster_type}/{location_slug}</loc>')
```

**Example URLs Created:**
- `/prayers/disaster/earthquake/japan`
- `/prayers/disaster/flood/pacific-northwest`
- `/prayers/disaster/typhoon/philippines`

---

### 4. **Disaster Hub Page** (`/disasters`)

The `/disasters` endpoint aggregates all disasters from the last 7 days:

```python
@seo_bp.route('/disasters')
def disasters_hub():
    # Collect disasters from last 7 days
    for i in range(7):
        date = today - timedelta(days=i)
        prayer = storage_handler.get_prayer(date_str)
        
        if prayer and 'metadata' in prayer:
            disasters = metadata.get('disasters', [])
            # Add to disaster_map (deduplicated)
```

**Purpose:** SEO discovery page that lists all current disasters with links to specific pages.

---

### 5. **Disaster Prayer Page** (`/prayers/disaster/<disaster_type>/<location>`)

When a user visits a disaster-specific page:

#### Step 5a: Check Cache (24-hour expiry)

```python
cache_key = f"disaster_prayer_{disaster_type}_{location}"
cached = storage_handler.bucket.blob(f'cache/{cache_key}.json').download_as_text()

# Check if cache is fresh (within 24 hours)
if (datetime.now() - cache_time).total_seconds() < 86400:
    disaster_prayer = cached_data['prayer']  # Use cached prayer
```

**Why Cache?**
- Avoids regenerating the same prayer repeatedly
- Faster page loads
- Reduces AI API costs
- 24-hour expiry ensures prayers stay current

#### Step 5b: Generate Prayer (if not cached)

```python
if not disaster_prayer:
    disaster_prayer = _generate_disaster_prayer(disaster_display, location_display)
    
    # Cache for 24 hours
    cache_data = {
        'prayer': disaster_prayer,
        'timestamp': datetime.now().isoformat(),
        'disaster_type': disaster_display,
        'location': location_display
    }
    blob.upload_from_string(json.dumps(cache_data))
```

---

### 6. **Prayer Generation** (`_generate_disaster_prayer()`)

The function generates a custom prayer for each disaster/location combination:

```python
def _generate_disaster_prayer(disaster_type, location):
    client = get_perplexity_client()
    set_client_model('sonar')  # Fast model for short prayers
    
    prompt = f"""Write a heartfelt Christian prayer for those affected by {disaster_type} in {location}.
    
    REQUIREMENTS:
    - Start with "Heavenly Father,"
    - Length: 100-150 words
    - Mention {location} and {disaster_type} specifically
    - Address specific needs:
      * Those who lost homes, loved ones, or possessions
      * Families separated or in fear
      * Children who are scared and traumatized
      * Rescue workers and first responders
      * Medical teams and aid workers
      * Government leaders making decisions
      * Community healing and rebuilding
    - Include a brief biblical reference or promise
    - End with "In Jesus' name, Amen."
    """
    
    response = client.generate_response(prompt)
    # Clean and validate response
    return prayer
```

**Key Features:**
- Uses Perplexity AI (sonar model - fast and cost-effective)
- 100-150 words (shorter than daily prayer)
- Specific to disaster type and location
- Includes fallback prayer if generation fails

**Fallback Prayer:**
If AI generation fails, a template prayer is used:
```python
return f"""Heavenly Father, we come before You with hearts heavy for the people of {location} affected by {disaster_type}..."""
```

---

### 7. **Page Rendering**

The page is rendered using a Jinja2 template (`DISASTER_PAGE_TEMPLATE`):

**SEO Elements:**
- Title: `Prayer for People Affected by {disaster_type} in {location} | Divine Bridge`
- Meta description with disaster and location
- Open Graph tags for social sharing
- JSON-LD structured data (Article schema)
- Canonical URL

**Content:**
- Hero section with disaster type and location
- Custom-generated prayer
- Call-to-action buttons (Request Prayer, Join Prayer Room, Find Relief Organizations)
- Links to daily global prayer

---

## File Structure

```
routes/seo_bp.py
    ├── /disasters (hub page)
    ├── /prayers/disaster/<type>/<location> (specific pages)
    └── _generate_disaster_prayer() (prayer generation)

disaster_extractor.py
    └── DisasterExtractor.extract_disasters() (AI extraction)

prayer_generator.py
    └── Uses DisasterExtractor after generating daily prayer

Cloud Storage:
    ├── prayers/{date}.json (daily prayers with metadata)
    └── cache/disaster_prayer_{type}_{location}.json (cached prayers)
```

---

## Caching Strategy

**Cache Location:** `cache/disaster_prayer_{disaster_type}_{location}.json`

**Cache Structure:**
```json
{
  "prayer": "Heavenly Father, we come before You...",
  "timestamp": "2025-12-13T10:30:00",
  "disaster_type": "Earthquake",
  "location": "Japan"
}
```

**Cache Expiry:** 24 hours (86400 seconds)

**Why Cache?**
1. **Performance:** Faster page loads
2. **Cost:** Reduces AI API calls
3. **Consistency:** Same prayer for 24 hours
4. **Reliability:** Fallback if generation fails

---

## Example Flow

**Scenario:** Daily prayer mentions "earthquake in Japan"

1. **Daily Prayer Generated:**
   ```
   "Heavenly Father, we lift up Japan shaken by a powerful earthquake..."
   ```

2. **Disaster Extracted:**
   ```json
   {
     "type": "earthquake",
     "locations": ["Japan"],
     "severity": "severe"
   }
   ```

3. **Sitemap Updated:**
   ```
   /prayers/disaster/earthquake/japan
   ```

4. **User Visits:** `/prayers/disaster/earthquake/japan`

5. **Cache Check:** No cached prayer found

6. **Prayer Generated:**
   ```
   "Heavenly Father, we come before You with hearts heavy for the people of Japan affected by earthquake. We pray for those who have lost their homes..."
   ```

7. **Prayer Cached:** Saved to Cloud Storage

8. **Page Rendered:** SEO-optimized page with custom prayer

9. **Next Visit (within 24h):** Uses cached prayer (faster!)

---

## Error Handling

**If AI Generation Fails:**
- Falls back to template prayer
- Logs warning
- Page still renders (graceful degradation)

**If Cache Fails:**
- Generates new prayer
- Logs warning
- Continues normally

**If Disaster Not Found:**
- Returns 404 error
- Logs error

---

## SEO Benefits

1. **Unique Content:** Each disaster gets a custom prayer
2. **Keyword Targeting:** Pages target "prayer for [disaster] in [location]"
3. **Fresh Content:** New disasters create new pages automatically
4. **Internal Linking:** Disaster pages link to main prayer room
5. **Structured Data:** Article schema helps Google understand content
6. **Sitemap Integration:** All disaster pages automatically indexed

---

## Performance Considerations

**Optimizations:**
- ✅ 24-hour caching reduces API calls
- ✅ Fast AI model (sonar) for quick generation
- ✅ Cloud Storage caching for fast retrieval
- ✅ Deduplication prevents duplicate pages

**Limitations:**
- Max 3 locations per disaster type (prevents URL spam)
- 24-hour cache means prayers don't update instantly
- AI generation can take 2-5 seconds (first time)

---

## Monitoring

**Logs to Watch:**
- `Generated disaster prayer for {type}/{location}: {word_count} words`
- `Using cached disaster prayer for {type}/{location}`
- `Using fallback prayer for {type}/{location}: {error}`

**Metrics:**
- Cache hit rate
- Generation success rate
- Page load times
- SEO rankings for disaster keywords

---

## Future Enhancements

**Potential Improvements:**
1. **Longer Cache:** Extend to 48-72 hours for less frequent disasters
2. **Prayer Updates:** Allow manual refresh of cached prayers
3. **More Details:** Include disaster-specific information (casualties, dates)
4. **User Submissions:** Allow users to submit disaster-specific prayers
5. **Multi-language:** Generate prayers in multiple languages
6. **Prayer History:** Show previous prayers for same disaster

---

## Summary

The disaster endpoint creates SEO-optimized pages by:

1. **Extracting** disasters from daily prayers using AI
2. **Generating** custom prayers for each disaster/location
3. **Caching** prayers for 24 hours for performance
4. **Rendering** SEO-optimized pages with structured data
5. **Automatically** creating URLs in sitemap for Google indexing

This creates a scalable system where every disaster mentioned in daily prayers gets its own dedicated prayer page, improving SEO and providing targeted content for users searching for prayers about specific disasters.
