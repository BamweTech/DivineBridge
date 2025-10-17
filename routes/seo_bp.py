"""
SEO Blueprint - Sitemap, structured data, and SEO optimization
"""
from flask import Blueprint, request, make_response, jsonify, render_template_string
from datetime import datetime, timedelta
import logging

seo_bp = Blueprint('seo', __name__)
logger = logging.getLogger(__name__)


def _generate_disaster_prayer(disaster_type, location):
    """Generate a short, specific prayer for a disaster and location (50-100 words)"""
    try:
        from perplexity_client import get_perplexity_client, set_client_model
        
        client = get_perplexity_client()
        set_client_model('sonar')  # Fast model for short prayers
        
        prompt = f"""Write a heartfelt Christian prayer for those affected by {disaster_type} in {location}.

REQUIREMENTS:
- Start with "Heavenly Father,"
- Length: 100-150 words (detailed but concise)
- Mention {location} and {disaster_type} specifically
- Address specific needs:
  * Those who lost homes, loved ones, or possessions
  * Families separated or in fear
  * Children who are scared and traumatized
  * Rescue workers and first responders
  * Medical teams and aid workers
  * Government leaders making decisions
  * Community healing and rebuilding
- Include a brief biblical reference or promise (no citation needed)
- End with "In Jesus' name, Amen."
- Compassionate, specific, and heartfelt tone
- Write as if leading a prayer gathering
- NO explanations, NO thinking tags, just the prayer text

Return ONLY the prayer text, nothing else."""

        response = client.generate_response(prompt)
        
        # Clean the response - remove any <think> tags
        import re
        prayer = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()
        
        # Ensure it starts correctly
        if not prayer.startswith("Heavenly Father"):
            prayer = "Heavenly Father, " + prayer
        
        # Ensure it ends correctly
        if not prayer.endswith("Amen.") and not prayer.endswith("Amen"):
            if "In Jesus' name" not in prayer:
                prayer = prayer.rstrip('.') + ". In Jesus' name, Amen."
        
        # Validate length (60-150 words)
        word_count = len(prayer.split())
        if word_count < 60 or word_count > 160:
            logger.warning(f"Disaster prayer word count out of range: {word_count} words")
            raise ValueError("Prayer length invalid")
        
        logger.info(f"Generated disaster prayer for {disaster_type}/{location}: {word_count} words")
        return prayer
        
    except Exception as e:
        logger.warning(f"Using fallback prayer for {disaster_type}/{location}: {e}")
        # Return a more detailed compassionate fallback prayer
        return f"""Heavenly Father, we come before You with hearts heavy for the people of {location} affected by {disaster_type}. We pray for those who have lost their homes, their loved ones, and their sense of security. Comfort the children who are frightened and the families torn apart by this tragedy.

We ask for Your divine protection over rescue workers and first responders as they serve tirelessly. Give wisdom to leaders making critical decisions, and provide resources for those in desperate need. May Your presence be a refuge and strength to every person facing this crisis.

Lord, we trust in Your promise to never leave nor forsake us. Bring healing, hope, and restoration to {location}. In Jesus' name, Amen."""

@seo_bp.route('/sitemap.xml')
def sitemap():
    """Generate dynamic sitemap with all pages, prayers, and disaster-specific pages"""
    try:
        from flask import current_app
        
        # Get base URL
        base_url = request.url_root.rstrip('/')
        
        # Build sitemap XML
        xml_content = ['<?xml version="1.0" encoding="UTF-8"?>']
        xml_content.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
        
        # Static pages
        static_pages = [
            ('/', '1.0', 'daily'),  # Home/Prayer Room
            ('/home', '0.8', 'weekly'),  # Original home
            ('/prayers', '1.0', 'daily'),  # Prayer Room
            ('/disasters', '0.9', 'daily'),  # Disasters hub (SEO discovery page)
            ('/about', '0.7', 'monthly'),
            ('/contact', '0.6', 'monthly'),
            ('/faq', '0.6', 'monthly'),
            ('/privacy-policy', '0.3', 'yearly'),
            ('/terms-of-service', '0.3', 'yearly'),
        ]
        
        for path, priority, changefreq in static_pages:
            xml_content.append('  <url>')
            xml_content.append(f'    <loc>{base_url}{path}</loc>')
            xml_content.append(f'    <changefreq>{changefreq}</changefreq>')
            xml_content.append(f'    <priority>{priority}</priority>')
            xml_content.append(f'    <lastmod>{datetime.now().strftime("%Y-%m-%d")}</lastmod>')
            xml_content.append('  </url>')
        
        # Daily prayers (last 30 days)
        storage_handler = current_app.storage_handler
        today = datetime.now()
        
        for i in range(30):
            date = today - timedelta(days=i)
            date_str = date.strftime('%Y-%m-%d')
            
            try:
                prayer = storage_handler.get_prayer(date_str)
                if prayer:
                    xml_content.append('  <url>')
                    xml_content.append(f'    <loc>{base_url}/prayers/daily/{date_str}</loc>')
                    xml_content.append('    <changefreq>weekly</changefreq>')
                    xml_content.append('    <priority>0.9</priority>')
                    xml_content.append(f'    <lastmod>{date_str}</lastmod>')
                    xml_content.append('  </url>')
                    
                    # If prayer has disaster metadata, create disaster-specific URLs
                    if isinstance(prayer, dict) and 'metadata' in prayer:
                        metadata = prayer['metadata']
                        disasters = metadata.get('disasters', [])
                        
                        for disaster in disasters:
                            if disaster.get('type') and disaster.get('locations'):
                                disaster_type = disaster['type'].lower().replace(' ', '-')
                                for location in disaster['locations'][:3]:  # Max 3 locations per disaster
                                    location_slug = location.lower().replace(' ', '-').replace(',', '')
                                    
                                    xml_content.append('  <url>')
                                    xml_content.append(f'    <loc>{base_url}/prayers/disaster/{disaster_type}/{location_slug}</loc>')
                                    xml_content.append('    <changefreq>weekly</changefreq>')
                                    xml_content.append('    <priority>0.95</priority>')  # High priority for current events
                                    xml_content.append(f'    <lastmod>{date_str}</lastmod>')
                                    xml_content.append('  </url>')
            except Exception as e:
                logger.warning(f"Error adding prayer {date_str} to sitemap: {e}")
                continue
        
        xml_content.append('</urlset>')
        
        # Create response
        response = make_response('\n'.join(xml_content))
        response.headers['Content-Type'] = 'application/xml; charset=utf-8'
        return response
        
    except Exception as e:
        logger.error(f"Error generating sitemap: {e}")
        return jsonify({'error': 'Failed to generate sitemap'}), 500


@seo_bp.route('/disasters')
def disasters_hub():
    """Hub page showing all current disasters (SEO discovery page - not linked in nav)"""
    try:
        from flask import current_app
        
        # Get today's prayer to extract disasters
        storage_handler = current_app.storage_handler
        today = datetime.now()
        
        # Collect disasters from last 7 days
        all_disasters = []
        disaster_map = {}  # Deduplicate by type+location
        
        for i in range(7):
            date = today - timedelta(days=i)
            date_str = date.strftime('%Y-%m-%d')
            
            try:
                prayer = storage_handler.get_prayer(date_str)
                if prayer and isinstance(prayer, dict) and 'metadata' in prayer:
                    metadata = prayer['metadata']
                    disasters = metadata.get('disasters', [])
                    
                    for disaster in disasters:
                        if disaster.get('type') and disaster.get('locations'):
                            disaster_type = disaster['type']
                            for location in disaster['locations']:
                                # Create unique key
                                key = f"{disaster_type}_{location}".lower()
                                if key not in disaster_map:
                                    disaster_map[key] = {
                                        'type': disaster_type,
                                        'type_display': disaster_type.replace('-', ' ').title(),
                                        'location': location,
                                        'location_display': location.title(),
                                        'severity': disaster.get('severity', 'moderate'),
                                        'date': date_str,
                                        'url_slug': f"{disaster_type.lower().replace(' ', '-')}/{location.lower().replace(' ', '-').replace(',', '')}"
                                    }
            except:
                continue
        
        # Sort by date (most recent first) and severity
        all_disasters = list(disaster_map.values())
        severity_order = {'severe': 0, 'moderate': 1, 'minor': 2}
        all_disasters.sort(key=lambda x: (x['date'], severity_order.get(x['severity'], 3)), reverse=True)
        
        return render_template_string(DISASTERS_HUB_TEMPLATE, 
                                     disasters=all_disasters,
                                     today=today.strftime('%B %d, %Y'))
        
    except Exception as e:
        logger.error(f"Error rendering disasters hub: {e}")
        return jsonify({'error': 'Failed to load disasters'}), 500


@seo_bp.route('/prayers/disaster/<disaster_type>/<location>')
def disaster_prayer_page(disaster_type, location):
    """SEO-optimized landing page for specific disasters with custom prayer"""
    try:
        from flask import current_app
        
        # Format for display
        location_display = location.replace('-', ' ').title()
        disaster_display = disaster_type.replace('-', ' ').title()
        
        # Check if we have a cached disaster-specific prayer
        cache_key = f"disaster_prayer_{disaster_type}_{location}"
        storage_handler = current_app.storage_handler
        
        # Try to get from cache (24 hour expiry)
        try:
            cached = storage_handler.bucket.blob(f'cache/{cache_key}.json').download_as_text()
            import json
            from datetime import datetime as dt
            cached_data = json.loads(cached)
            cache_time = dt.fromisoformat(cached_data.get('timestamp', '2020-01-01'))
            
            # Check if cache is still fresh (within 24 hours)
            if (datetime.now() - cache_time).total_seconds() < 86400:
                disaster_prayer = cached_data['prayer']
                logger.info(f"Using cached disaster prayer for {disaster_type}/{location}")
            else:
                disaster_prayer = None
        except:
            disaster_prayer = None
        
        # If no cache or expired, generate new prayer
        if not disaster_prayer:
            disaster_prayer = _generate_disaster_prayer(disaster_display, location_display)
            
            # Cache for 24 hours
            try:
                import json
                cache_data = {
                    'prayer': disaster_prayer,
                    'timestamp': datetime.now().isoformat(),
                    'disaster_type': disaster_display,
                    'location': location_display
                }
                blob = storage_handler.bucket.blob(f'cache/{cache_key}.json')
                blob.upload_from_string(json.dumps(cache_data))
                logger.info(f"Cached disaster prayer for {disaster_type}/{location}")
            except Exception as e:
                logger.warning(f"Failed to cache disaster prayer: {e}")
        
        today = datetime.now()
        
        return render_template_string(DISASTER_PAGE_TEMPLATE,
                                     disaster_type=disaster_display,
                                     location=location_display,
                                     disaster_prayer=disaster_prayer,
                                     today=today.strftime('%B %d, %Y'))
        
    except Exception as e:
        logger.error(f"Error rendering disaster page: {e}")
        return jsonify({'error': 'Page not found'}), 404


# Disaster page template with SEO optimization
DISASTER_PAGE_TEMPLATE = '''
{% extends "base.html" %}

{% block title %}Prayer for People Affected by {{ disaster_type }} in {{ location }} | Divine Bridge{% endblock %}

{% block og_title %}Join Us in Prayer for People Affected by {{ disaster_type }} in {{ location }}{% endblock %}
{% block og_description %}Unite with thousands of believers praying for those affected by {{ disaster_type }} in {{ location }}. Submit prayer requests and find hope.{% endblock %}

{% block extra_css %}
<style>
    .disaster-hero {
        background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
        color: white;
        padding: 4rem 2rem;
        text-align: center;
        margin-bottom: 3rem;
    }
    
    .disaster-hero h1 {
        font-size: 2.5rem;
        margin-bottom: 1rem;
        font-weight: 700;
    }
    
    .disaster-hero p {
        font-size: 1.2rem;
        opacity: 0.9;
        max-width: 800px;
        margin: 0 auto;
    }
    
    .prayer-content {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem;
    }
    
    .prayer-card {
        background: white;
        border-radius: 16px;
        padding: 2rem;
        margin-bottom: 2rem;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    
    .prayer-date {
        color: #0f56ff;
        font-weight: 600;
        margin-bottom: 1rem;
    }
    
    .prayer-text {
        line-height: 1.8;
        color: #333;
        white-space: pre-wrap;
    }
    
    .cta-section {
        background: linear-gradient(135deg, rgba(15, 86, 255, 0.1) 0%, rgba(31, 60, 136, 0.1) 100%);
        padding: 3rem 2rem;
        text-align: center;
        margin-top: 3rem;
        border-radius: 16px;
    }
    
    .cta-button {
        display: inline-block;
        background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
        color: white;
        padding: 1rem 2rem;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 600;
        margin: 0.5rem;
        transition: transform 0.3s ease;
    }
    
    .cta-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(15, 86, 255, 0.4);
    }
    
    @media (max-width: 768px) {
        .disaster-hero h1 {
            font-size: 1.8rem;
        }
        .disaster-hero p {
            font-size: 1rem;
        }
    }
</style>

<!-- JSON-LD Structured Data for SEO -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Prayer for People Affected by {{ disaster_type }} in {{ location }}",
  "description": "Join believers worldwide praying for those affected by {{ disaster_type }} in {{ location }}. Daily prayers, Bible verses, and spiritual support.",
  "datePublished": "{{ today }}",
  "author": {
    "@type": "Organization",
    "name": "Divine Bridge"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Divine Bridge",
    "logo": {
      "@type": "ImageObject",
      "url": "{{ request.url_root }}static/images/LogowithName.svg"
    }
  },
  "keywords": "prayer for {{ disaster_type }}, {{ location }} prayer, Christian disaster relief, prayer request {{ location }}, {{ disaster_type }} victims prayer"
}
</script>
{% endblock %}

{% block content %}
<!-- Disaster Prayer Landing Page -->
<div class="disaster-hero">
    <h1>🙏 Prayer for People Affected by {{ disaster_type }} in {{ location }}</h1>
    <p>Join thousands of believers worldwide lifting up those affected by {{ disaster_type }} in {{ location }}. You are not alone in prayer.</p>
</div>

<div class="prayer-content">
    <div class="prayer-card">
        <h2 style="color: #0f56ff; margin-bottom: 1.5rem; font-size: 1.5rem;">A Prayer for People Affected by {{ disaster_type }} in {{ location }}</h2>
        <div class="prayer-text">{{ disaster_prayer }}</div>
    </div>
    
    <div style="text-align: center; margin: 2rem 0; padding: 1.5rem; background: rgba(15, 86, 255, 0.05); border-radius: 12px;">
        <p style="margin-bottom: 0.5rem; font-weight: 600; color: #0f56ff;">🌍 Join Our Global Prayer Community</p>
        <p style="color: #666; font-size: 0.95rem;">See today's comprehensive prayer covering disasters worldwide</p>
        <a href="/prayers" style="display: inline-block; margin-top: 1rem; color: #0f56ff; text-decoration: none; font-weight: 600;">View Daily Global Prayer →</a>
    </div>
    
    <div class="cta-section">
        <h2 style="margin-bottom: 1.5rem;">How You Can Help</h2>
        <p style="margin-bottom: 2rem; max-width: 600px; margin-left: auto; margin-right: auto;">
            Whether you're affected by {{ disaster_type }} in {{ location }} or want to support those who are, we're here for you.
        </p>
        <a href="/prayers" class="cta-button">Request Prayer</a>
        <a href="/prayers" class="cta-button">Join Prayer Room</a>
        <a href="/home#organizations" class="cta-button">Find Relief Organizations</a>
    </div>
    
</div>
{% endblock %}
'''

# Disasters hub template
DISASTERS_HUB_TEMPLATE = '''
{% extends "base.html" %}

{% block title %}Current Disasters & Crisis Prayer Support | Divine Bridge{% endblock %}

{% block meta_description %}Find prayers for current disasters worldwide. Dedicated prayer pages for floods, earthquakes, conflicts, and humanitarian crises. Join our global prayer community.{% endblock %}

{% block og_title %}Current Disasters We're Praying For - Divine Bridge{% endblock %}
{% block og_description %}Discover prayer support for current disasters and crises worldwide. Each disaster has a dedicated prayer page with specific prayers for affected communities.{% endblock %}

{% block extra_css %}
<style>
    .disasters-page {
        min-height: calc(100vh - 200px);
        padding: 6rem 2rem 4rem;
        background: linear-gradient(135deg, rgba(15, 86, 255, 0.03) 0%, rgba(31, 60, 136, 0.03) 100%);
    }
    
    .disasters-container {
        max-width: 1200px;
        margin: 0 auto;
    }
    
    .page-header {
        text-align: center;
        margin-bottom: 3rem;
    }
    
    .page-title {
        font-size: 2.5rem;
        color: #0f56ff;
        margin-bottom: 1rem;
    }
    
    .page-subtitle {
        font-size: 1.1rem;
        color: #666;
        max-width: 700px;
        margin: 0 auto;
    }
    
    .disasters-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
        gap: 2rem;
        margin-top: 3rem;
    }
    
    .disaster-card {
        background: white;
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        border-left: 4px solid #0f56ff;
    }
    
    .disaster-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 20px rgba(15, 86, 255, 0.2);
    }
    
    .disaster-card.severe {
        border-left-color: #dc2626;
    }
    
    .disaster-type {
        display: inline-block;
        background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 20px;
        font-size: 0.9rem;
        font-weight: 600;
        margin-bottom: 1rem;
    }
    
    .disaster-card.severe .disaster-type {
        background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
    }
    
    .disaster-location {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e1e1e;
        margin-bottom: 0.5rem;
    }
    
    .disaster-date {
        font-size: 0.9rem;
        color: #666;
        margin-bottom: 1.5rem;
    }
    
    .disaster-link {
        display: inline-block;
        background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
        color: white;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        transition: transform 0.3s ease;
    }
    
    .disaster-link:hover {
        transform: scale(1.05);
    }
    
    .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        color: #666;
    }
    
    @media (max-width: 768px) {
        .disasters-grid {
            grid-template-columns: 1fr;
            gap: 1.5rem;
        }
        
        .page-title {
            font-size: 2rem;
        }
    }
</style>
{% endblock %}

{% block content %}
<div class="disasters-page">
    <div class="disasters-container">
        <div class="page-header">
            <h1 class="page-title">🌍 Current Disasters We're Praying For</h1>
            <p class="page-subtitle">
                Each disaster has a dedicated prayer page with specific prayers for affected communities. 
                These pages are updated based on our daily global prayer research.
            </p>
        </div>
        
        {% if disasters %}
        <div class="disasters-grid">
            {% for disaster in disasters %}
            <div class="disaster-card {{ disaster.severity }}">
                <span class="disaster-type">{{ disaster.type_display }}</span>
                <h2 class="disaster-location">{{ disaster.location_display }}</h2>
                <p class="disaster-date">Prayer available since {{ disaster.date }}</p>
                <a href="/prayers/disaster/{{ disaster.url_slug }}" class="disaster-link">
                    View Prayer & Support →
                </a>
            </div>
            {% endfor %}
        </div>
        {% else %}
        <div class="empty-state">
            <p style="font-size: 1.2rem; margin-bottom: 1rem;">🙏 Praise God - No major disasters in recent days</p>
            <p>Visit our <a href="/prayers" style="color: #0f56ff; font-weight: 600;">Prayer Room</a> for today's global prayer.</p>
        </div>
        {% endif %}
        
        <div style="text-align: center; margin-top: 4rem; padding: 2rem; background: rgba(15, 86, 255, 0.05); border-radius: 16px;">
            <h3 style="color: #0f56ff; margin-bottom: 1rem;">Join Our Daily Prayer</h3>
            <p style="color: #666; margin-bottom: 1.5rem; max-width: 600px; margin-left: auto; margin-right: auto;">
                Every day at midnight UTC, we research global news and create a comprehensive prayer covering 
                all current crises, disasters, and humanitarian needs worldwide.
            </p>
            <a href="/prayers" style="display: inline-block; background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%); color: white; padding: 1rem 2rem; border-radius: 12px; text-decoration: none; font-weight: 600;">
                View Today's Global Prayer
            </a>
        </div>
    </div>
</div>
{% endblock %}
'''

