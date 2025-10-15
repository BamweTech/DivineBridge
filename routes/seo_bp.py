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
        
        prompt = f"""Write a short, heartfelt Christian prayer for those affected by {disaster_type} in {location}.

REQUIREMENTS:
- Start with "Heavenly Father,"
- Keep it SHORT: 50-100 words
- Mention {location} and {disaster_type} specifically
- Pray for: victims, families, rescue workers, community recovery
- End with "In Jesus' name, Amen."
- Natural, compassionate tone
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
        
        # Validate length (50-150 words)
        word_count = len(prayer.split())
        if word_count < 30 or word_count > 150:
            logger.warning(f"Disaster prayer word count out of range: {word_count} words")
            raise ValueError("Prayer length invalid")
        
        logger.info(f"Generated disaster prayer for {disaster_type}/{location}: {word_count} words")
        return prayer
        
    except Exception as e:
        logger.warning(f"Using fallback prayer for {disaster_type}/{location}: {e}")
        # Return a compassionate fallback prayer
        return f"""Heavenly Father, we lift up the people of {location} affected by {disaster_type}. 
Comfort those who are hurting, protect those in danger, and provide for those in need. 
Give strength to rescue workers and wisdom to leaders. May Your peace and presence be felt 
in {location} today. In Jesus' name, Amen."""

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
        <h2 style="color: #0f56ff; margin-bottom: 1.5rem; font-size: 1.5rem;">A Prayer for {{ location }}</h2>
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
            Whether you're affected by {{ disaster_type }} or want to support those who are, we're here for you.
        </p>
        <a href="/prayers" class="cta-button">Submit Prayer Request</a>
        <a href="/prayers" class="cta-button">Join Prayer Room</a>
        <a href="/home#organizations" class="cta-button">Find Relief Organizations</a>
    </div>
    
</div>
{% endblock %}
'''

