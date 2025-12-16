"""
SEO Blueprint - Sitemap, structured data, and SEO optimization
"""
from flask import Blueprint, request, make_response, jsonify, render_template_string, Response
from datetime import datetime, timedelta
import logging
import requests
from auth_decorators import verify_cloud_scheduler

seo_bp = Blueprint('seo', __name__)
logger = logging.getLogger(__name__)


def get_country_flag_code(country_name: str) -> str:
    """
    Convert country name to ISO 3166-1 alpha-2 code for flag API
    Common country name mappings
    """
    country_mapping = {
        'united states': 'us',
        'united states of america': 'us',
        'usa': 'us',
        'united kingdom': 'gb',
        'uk': 'gb',
        'south korea': 'kr',
        'north korea': 'kp',
        'russia': 'ru',
        'russian federation': 'ru',
        'philippines': 'ph',
        'japan': 'jp',
        'china': 'cn',
        'india': 'in',
        'brazil': 'br',
        'mexico': 'mx',
        'canada': 'ca',
        'australia': 'au',
        'germany': 'de',
        'france': 'fr',
        'italy': 'it',
        'spain': 'es',
        'netherlands': 'nl',
        'belgium': 'be',
        'switzerland': 'ch',
        'austria': 'at',
        'sweden': 'se',
        'norway': 'no',
        'denmark': 'dk',
        'finland': 'fi',
        'poland': 'pl',
        'czech republic': 'cz',
        'greece': 'gr',
        'portugal': 'pt',
        'ireland': 'ie',
        'new zealand': 'nz',
        'south africa': 'za',
        'egypt': 'eg',
        'nigeria': 'ng',
        'kenya': 'ke',
        'ethiopia': 'et',
        'tanzania': 'tz',
        'uganda': 'ug',
        'ghana': 'gh',
        'morocco': 'ma',
        'algeria': 'dz',
        'tunisia': 'tn',
        'libya': 'ly',
        'sudan': 'sd',
        'angola': 'ao',
        'mozambique': 'mz',
        'madagascar': 'mg',
        'cameroon': 'cm',
        'ivory coast': 'ci',
        'niger': 'ne',
        'burkina faso': 'bf',
        'mali': 'ml',
        'malawi': 'mw',
        'zambia': 'zm',
        'zimbabwe': 'zw',
        'senegal': 'sn',
        'chad': 'td',
        'somalia': 'so',
        'guinea': 'gn',
        'rwanda': 'rw',
        'benin': 'bj',
        'burundi': 'bi',
        'togo': 'tg',
        'sierra leone': 'sl',
        'liberia': 'lr',
        'central african republic': 'cf',
        'mauritania': 'mr',
        'eritrea': 'er',
        'gambia': 'gm',
        'botswana': 'bw',
        'namibia': 'na',
        'gabon': 'ga',
        'lesotho': 'ls',
        'guinea-bissau': 'gw',
        'equatorial guinea': 'gq',
        'mauritius': 'mu',
        'eswatini': 'sz',
        'djibouti': 'dj',
        'comoros': 'km',
        'cape verde': 'cv',
        'sao tome and principe': 'st',
        'seychelles': 'sc',
        'indonesia': 'id',
        'thailand': 'th',
        'vietnam': 'vn',
        'malaysia': 'my',
        'singapore': 'sg',
        'myanmar': 'mm',
        'cambodia': 'kh',
        'laos': 'la',
        'bangladesh': 'bd',
        'pakistan': 'pk',
        'sri lanka': 'lk',
        'nepal': 'np',
        'bhutan': 'bt',
        'maldives': 'mv',
        'afghanistan': 'af',
        'iran': 'ir',
        'iraq': 'iq',
        'israel': 'il',
        'palestine': 'ps',
        'jordan': 'jo',
        'lebanon': 'lb',
        'syria': 'sy',
        'saudi arabia': 'sa',
        'united arab emirates': 'ae',
        'uae': 'ae',
        'qatar': 'qa',
        'kuwait': 'kw',
        'bahrain': 'bh',
        'oman': 'om',
        'yemen': 'ye',
        'turkey': 'tr',
        'azerbaijan': 'az',
        'armenia': 'am',
        'georgia': 'ge',
        'kazakhstan': 'kz',
        'uzbekistan': 'uz',
        'turkmenistan': 'tm',
        'kyrgyzstan': 'kg',
        'tajikistan': 'tj',
        'mongolia': 'mn',
        'taiwan': 'tw',
        'hong kong': 'hk',
        'macau': 'mo',
        'north macedonia': 'mk',
        'bosnia and herzegovina': 'ba',
        'croatia': 'hr',
        'serbia': 'rs',
        'montenegro': 'me',
        'albania': 'al',
        'kosovo': 'xk',
        'moldova': 'md',
        'belarus': 'by',
        'ukraine': 'ua',
        'estonia': 'ee',
        'latvia': 'lv',
        'lithuania': 'lt',
        'slovenia': 'si',
        'slovakia': 'sk',
        'hungary': 'hu',
        'romania': 'ro',
        'bulgaria': 'bg',
        'cuba': 'cu',
        'jamaica': 'jm',
        'haiti': 'ht',
        'dominican republic': 'do',
        'puerto rico': 'pr',
        'trinidad and tobago': 'tt',
        'barbados': 'bb',
        'bahamas': 'bs',
        'belize': 'bz',
        'costa rica': 'cr',
        'panama': 'pa',
        'nicaragua': 'ni',
        'honduras': 'hn',
        'el salvador': 'sv',
        'guatemala': 'gt',
        'colombia': 'co',
        'venezuela': 've',
        'ecuador': 'ec',
        'peru': 'pe',
        'bolivia': 'bo',
        'paraguay': 'py',
        'uruguay': 'uy',
        'chile': 'cl',
        'argentina': 'ar',
        'guyana': 'gy',
        'suriname': 'sr',
        'french guiana': 'gf',
        'fiji': 'fj',
        'papua new guinea': 'pg',
        'new caledonia': 'nc',
        'french polynesia': 'pf',
        'samoa': 'ws',
        'tonga': 'to',
        'vanuatu': 'vu',
        'solomon islands': 'sb',
        'micronesia': 'fm',
        'palau': 'pw',
        'marshall islands': 'mh',
        'kiribati': 'ki',
        'nauru': 'nr',
        'tuvalu': 'tv'
    }
    
    # Normalize country name
    country_lower = country_name.lower().strip()
    
    # Check mapping first
    if country_lower in country_mapping:
        return country_mapping[country_lower]
    
    # If it's already a 2-letter code, return as-is
    if len(country_lower) == 2:
        return country_lower
    
    # Try to extract from common patterns
    # For multi-word countries, try first word or common abbreviation
    words = country_lower.split()
    if words:
        # Try first word
        if words[0] in country_mapping:
            return country_mapping[words[0]]
    
    # Default: return lowercase first two letters (not ideal but better than nothing)
    return country_lower[:2] if len(country_lower) >= 2 else 'xx'


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
        
        # Get base URL (force HTTPS for production)
        base_url = request.url_root.rstrip('/')
        # Cloud Run is behind load balancer, always use HTTPS for production
        if 'divinebridge.io' in base_url or 'run.app' in base_url:
            base_url = base_url.replace('http://', 'https://')
        
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


@seo_bp.route('/api/disasters/generate-hourly', methods=['POST'])
@verify_cloud_scheduler()
def generate_hourly_disaster_prayers():
    """
    Hourly endpoint to search for breaking disasters and generate customized prayers
    Triggered by Cloud Scheduler every hour
    """
    try:
        from flask import current_app
        from disaster_prayer_service import get_disaster_prayer_service
        
        logger.info("Cloud Scheduler triggered hourly disaster prayer generation")
        
        # Get disaster prayer service
        service = get_disaster_prayer_service(current_app.storage_handler)
        
        # Process breaking disasters
        result = service.process_hourly_disasters()
        
        if result.get('success'):
            logger.info(f"Hourly processing complete: {result.get('prayers_generated', 0)} prayers generated")
            return jsonify({
                'success': True,
                'disasters_found': result.get('disasters_found', 0),
                'prayers_generated': result.get('prayers_generated', 0)
            }), 200
        else:
            logger.error(f"Hourly processing failed: {result.get('error')}")
            return jsonify({
                'success': False,
                'error': result.get('error', 'Unknown error')
            }), 500
            
    except Exception as e:
        logger.error(f"Error in hourly disaster prayer generation: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@seo_bp.route('/disasters')
def disasters_hub():
    """Hub page showing all current disasters grouped by type from hourly breaking news monitoring"""
    try:
        from flask import current_app
        from disaster_prayer_service import get_disaster_prayer_service
        
        # Get disaster prayer service
        service = get_disaster_prayer_service(current_app.storage_handler)
        
        # Get active disaster prayers (prioritizes grouped prayers)
        disaster_prayers = service.get_active_disaster_prayers()
        
        # Normalize disaster types function (matches disaster_prayer_service normalization)
        def normalize_disaster_type_for_display(disaster_type: str) -> str:
            """Normalize disaster type to standard format for grouping"""
            disaster_type = disaster_type.lower().strip()
            type_mapping = {
                'hurricane': 'typhoon',
                'cyclone': 'typhoon',
                'storm': 'typhoon',  # Normalize storm to typhoon (same weather system type)
                'flooding': 'flood',
                'wildfire': 'fire',
                'volcanic_eruption': 'volcano',
                'pandemic': 'epidemic',
                'war': 'conflict',
                'refugee_crisis': 'conflict',
                'mass shooting': 'mass_shooting',
                'gun violence': 'mass_shooting'
            }
            return type_mapping.get(disaster_type, disaster_type)
        
        # First pass: Collect all entries by normalized type
        entries_by_normalized_type = {}
        for prayer_data in disaster_prayers:
            # Check if it's a grouped prayer
            if prayer_data.get('is_grouped') or prayer_data.get('affected_countries'):
                disaster_type = prayer_data.get('disaster_type', '')
                # Normalize the type for grouping (storm -> typhoon, etc.)
                disaster_type_normalized = normalize_disaster_type_for_display(disaster_type).replace(' ', '_').replace('-', '_')
                
                if disaster_type_normalized not in entries_by_normalized_type:
                    entries_by_normalized_type[disaster_type_normalized] = []
                entries_by_normalized_type[disaster_type_normalized].append(prayer_data)
        
        # Second pass: Merge countries from all entries of the same normalized type, keep most recent
        disasters_by_type = {}
        for disaster_type_normalized, entries in entries_by_normalized_type.items():
            if len(entries) == 1:
                # Only one entry, use it as-is
                disasters_by_type[disaster_type_normalized] = entries[0]
            else:
                # Multiple entries - merge countries and keep most recent
                logger.info(f"Merging {len(entries)} entries for normalized type {disaster_type_normalized}")
                
                # Find the most recent entry
                most_recent_entry = max(entries, key=lambda x: datetime.fromisoformat(x.get('created_at', '2000-01-01')))
                
                # Merge all countries from all entries
                all_countries = set()
                for entry in entries:
                    all_countries.update(entry.get('affected_countries', []))
                
                # Update the most recent entry with merged countries
                most_recent_entry['affected_countries'] = list(all_countries)
                disasters_by_type[disaster_type_normalized] = most_recent_entry
                
                logger.info(f"Merged {len(entries)} entries for {disaster_type_normalized}: {len(all_countries)} total countries")
        
        # Transform to display format
        grouped_disasters = []
        for disaster_type, prayer_data in disasters_by_type.items():
            affected_countries = prayer_data.get('affected_countries', [])
            
            # Get flag codes for all affected countries
            country_flags = []
            for country in affected_countries:
                flag_code = get_country_flag_code(country)
                if flag_code:
                    country_flags.append({
                        'country': country,
                        'flag_code': flag_code
                    })
            
            # Create URL slug
            disaster_slug = disaster_type.lower().replace('_', '-').replace(' ', '-')
            url_slug = disaster_slug
            
            grouped_disasters.append({
                'type': disaster_type,
                'type_display': prayer_data.get('disaster_type_display', disaster_type.replace('_', ' ').replace('-', ' ').title()),
                'affected_countries': affected_countries,
                'country_flags': country_flags,
                'summary': prayer_data.get('summary', ''),
                'severity': prayer_data.get('overall_severity', 'moderate'),
                'created_at': prayer_data.get('created_at', ''),
                'url_slug': url_slug,
                'prayer_id': prayer_data.get('id', '')
            })
        
        # Sort by created_at (most recent first) and severity
        severity_order = {'catastrophic': 0, 'severe': 1, 'moderate': 2, 'minor': 3}
        grouped_disasters.sort(key=lambda x: (
            severity_order.get(x.get('severity', 'moderate'), 3),
            x.get('created_at', '')
        ), reverse=True)
        
        today = datetime.now()
        
        return render_template_string(DISASTERS_HUB_TEMPLATE, 
                                    disasters=grouped_disasters,
                                    disasters_by_country={},  # Keep for backward compatibility
                                    today=today.strftime('%B %d, %Y'))
        
    except Exception as e:
        logger.error(f"Error rendering disasters hub: {e}")
        return jsonify({'error': 'Failed to load disasters'}), 500


@seo_bp.route('/api/flags/<country_code>')
def proxy_flag(country_code):
    """Proxy flag images to avoid CORB issues"""
    try:
        # Use correct flagcdn.com format: 60x45 (width x height) instead of w60
        flag_url = f"https://flagcdn.com/60x45/{country_code.lower()}.png"
        logger.info(f"Fetching flag from {flag_url} for country code {country_code}")
        response = requests.get(flag_url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        
        logger.info(f"Flag response status: {response.status_code}, content length: {len(response.content)}, content-type: {response.headers.get('Content-Type', 'unknown')}")
        
        if response.status_code == 200 and len(response.content) > 100:
            return Response(
                response.content,
                mimetype='image/png',
                headers={
                    'Cache-Control': 'public, max-age=86400',
                    'Access-Control-Allow-Origin': '*',
                    'Content-Length': str(len(response.content))
                }
            )
        else:
            logger.warning(f"Flag request failed for {country_code}: status={response.status_code}, size={len(response.content)}")
            # Fallback to default flag
            fallback_url = "https://flagcdn.com/60x45/xx.png"
            fallback_response = requests.get(fallback_url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
            if fallback_response.status_code == 200 and len(fallback_response.content) > 100:
                return Response(
                    fallback_response.content,
                    mimetype='image/png',
                    headers={
                        'Cache-Control': 'public, max-age=86400',
                        'Access-Control-Allow-Origin': '*',
                        'Content-Length': str(len(fallback_response.content))
                    }
                )
    except Exception as e:
        logger.error(f"Error proxying flag {country_code}: {e}", exc_info=True)
    
    # Return empty 1x1 transparent PNG if all else fails
    logger.warning(f"Returning transparent PNG fallback for {country_code}")
    transparent_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
    return Response(transparent_png, mimetype='image/png', headers={'Cache-Control': 'no-cache'})


@seo_bp.route('/prayers/watchtower/<disaster_type>')
def disaster_prayer_page(disaster_type):
    """SEO-optimized landing page for grouped disaster prayers by type"""
    try:
        from flask import current_app
        from disaster_prayer_service import get_disaster_prayer_service
        
        # Format for display
        disaster_display = disaster_type.replace('-', ' ').replace('_', ' ').title()
        disaster_type_normalized = disaster_type.lower().replace('-', '_').replace(' ', '_')
        
        storage_handler = current_app.storage_handler
        service = get_disaster_prayer_service(storage_handler)
        
        # Get active disaster prayers and find matching grouped prayer
        disaster_prayer = None
        disaster_data = None
        
        # Normalize disaster type function (matches disaster_prayer_service normalization)
        def normalize_disaster_type_for_display(disaster_type: str) -> str:
            """Normalize disaster type to standard format for matching"""
            disaster_type = disaster_type.lower().strip()
            type_mapping = {
                'hurricane': 'typhoon',
                'cyclone': 'typhoon',
                'storm': 'typhoon',  # Normalize storm to typhoon (same weather system type)
                'flooding': 'flood',
                'wildfire': 'fire',
                'volcanic_eruption': 'volcano',
                'pandemic': 'epidemic',
                'war': 'conflict',
                'refugee_crisis': 'conflict',
                'mass shooting': 'mass_shooting',
                'gun violence': 'mass_shooting'
            }
            return type_mapping.get(disaster_type, disaster_type)
        
        active_prayers = service.get_active_disaster_prayers()
        for prayer_data in active_prayers:
            # Check if it's a grouped prayer for this type
            if prayer_data.get('is_grouped') or prayer_data.get('affected_countries'):
                prayer_disaster_type = normalize_disaster_type_for_display(prayer_data.get('disaster_type', '')).replace(' ', '_').replace('-', '_')
                
                if prayer_disaster_type == disaster_type_normalized:
                    disaster_prayer = prayer_data.get('prayer', '')
                    disaster_data = prayer_data
                    logger.info(f"Found grouped disaster prayer for {disaster_type}")
                    break
        
        # If not found, try old cache system (backward compatibility)
        if not disaster_prayer:
            cache_key = f"disaster_prayer_{disaster_type}"
            try:
                cached = storage_handler.bucket.blob(f'cache/{cache_key}.json').download_as_text()
                import json
                from datetime import datetime as dt
                cached_data = json.loads(cached)
                cache_time = dt.fromisoformat(cached_data.get('timestamp', '2020-01-01'))
                
                if (datetime.now() - cache_time).total_seconds() < 86400:
                    disaster_prayer = cached_data['prayer']
                    logger.info(f"Using cached disaster prayer for {disaster_type}")
            except:
                pass
        
        # If still no prayer, generate fallback
        if not disaster_prayer:
            disaster_prayer = _generate_disaster_prayer(disaster_display, "affected regions")
        
        # Get country flags for all affected countries
        country_flags = []
        affected_countries = []
        summary = ''
        if disaster_data:
            affected_countries = disaster_data.get('affected_countries', [])
            summary = disaster_data.get('summary', '')
            for country in affected_countries:
                flag_code = get_country_flag_code(country)
                if flag_code:
                    country_flags.append({
                        'country': country,
                        'flag_code': flag_code
                    })
        
        today = datetime.now()
        
        return render_template_string(DISASTER_PAGE_TEMPLATE,
                                    disaster_type=disaster_display,
                                    location=None,
                                    disaster_prayer=disaster_prayer,
                                    prayer=disaster_prayer,
                                    country_flag_code=None,
                                    country_flags=country_flags,
                                    affected_countries=affected_countries,
                                    summary=summary,
                                    today=today.strftime('%B %d, %Y'))
        
    except Exception as e:
        logger.error(f"Error rendering disaster page: {e}")
        return jsonify({'error': 'Page not found'}), 404


# Disaster page template with SEO optimization
DISASTER_PAGE_TEMPLATE = '''
{% extends "base.html" %}

{% block title %}Prayer for People Affected by {{ disaster_type }}{% if location %} in {{ location }}{% endif %} | Divine Bridge{% endblock %}

{% block og_title %}Join Us in Prayer for People Affected by {{ disaster_type }}{% if location %} in {{ location }}{% endif %}{% endblock %}
{% block og_description %}Unite with thousands of believers praying for those affected by {{ disaster_type }}{% if location %} in {{ location }}{% endif %}. Submit prayer requests and find hope.{% endblock %}

{% block extra_css %}
<style>
    .disaster-hero {
        background: linear-gradient(to bottom, #f8f8f8 0%, #e8e8e8 100%);
        color: #333;
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
        background: #f5f5f5;
        padding: 3rem 2rem;
        text-align: center;
        margin-top: 3rem;
        border-radius: 16px;
    }
    
    .cta-button {
        display: inline-block;
        background: #0f56ff;
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
    <h1>🙏 Prayer for People Affected by {{ disaster_type }}{% if location %} in {{ location }}{% endif %}</h1>
    <p>Join thousands of believers worldwide lifting up those affected by {{ disaster_type }}{% if location %} in {{ location }}{% endif %}. You are not alone in prayer.</p>
</div>

<div class="prayer-content">
    <div class="prayer-card">
        {% if location %}
        <h2 style="color: #0f56ff; margin-bottom: 1.5rem; font-size: 1.5rem;">A Prayer for People Affected by {{ disaster_type }} in {{ location }}</h2>
        {% else %}
        <h2 style="color: #0f56ff; margin-bottom: 1.5rem; font-size: 1.5rem;">A Prayer for People Affected by {{ disaster_type }}</h2>
        {% if affected_countries %}
        <div style="margin-bottom: 1.5rem; text-align: center;">
            <p style="color: #666; margin-bottom: 0.5rem;">Affected Countries:</p>
            <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem; margin-bottom: 1rem;">
                {% for flag_info in country_flags %}
                <img src="/api/flags/{{ flag_info.flag_code }}" 
                     alt="{{ flag_info.country }} flag" 
                     style="width: 32px; height: 24px; object-fit: fill; display: block; animation: none !important; transform: none !important; transition: none !important; border-radius: 0 !important; filter: none !important; border: none !important; box-shadow: none !important; will-change: auto !important; backface-visibility: visible !important; perspective: none !important; -webkit-transform: none !important;"
                     onerror="this.src='/api/flags/xx';">
                {% endfor %}
            </div>
            {% if summary %}
            <p style="color: #666; font-style: italic; font-size: 0.95rem;">{{ summary }}</p>
            {% endif %}
        </div>
        {% endif %}
        {% endif %}
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
            Whether you're affected by {{ disaster_type }}{% if location %} in {{ location }}{% endif %} or want to support those who are, we're here for you.
        </p>
        <a href="/prayers" class="cta-button">Request Prayer</a>
        <a href="/prayers" class="cta-button">Join Prayer Room</a>
        <a href="/home#organizations" class="cta-button">Find Relief Organizations</a>
    </div>
    
</div>
{% endblock %}
'''

# Disasters hub template with glassmorphic design
DISASTERS_HUB_TEMPLATE = '''
{% extends "base.html" %}

{% block title %}Current Disasters & Crisis Prayer Support | Divine Bridge{% endblock %}

{% block meta_description %}Find prayers for current disasters worldwide. Dedicated prayer pages for floods, earthquakes, conflicts, and humanitarian crises. Join our global prayer community.{% endblock %}

{% block og_title %}Join us in prayer for affected communities by recent events - Divine Bridge{% endblock %}
{% block og_description %}Discover prayer support for current disasters and crises worldwide. Each disaster has a dedicated prayer page with specific prayers for affected communities.{% endblock %}

{% block extra_css %}
<style>
    .disasters-page {
        min-height: calc(100vh - 200px);
        padding: 6rem 2rem 4rem;
        background: linear-gradient(to bottom, #ffffff 0%, #f5f5f5 50%, #e8e8e8 100%);
        position: relative;
    }
    
    .disasters-page::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(5px);
    }
    
    .disasters-container {
        max-width: 1400px;
        margin: 0 auto;
        position: relative;
        z-index: 1;
    }
    
    .page-header {
        text-align: center;
        margin-bottom: 4rem;
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(20px);
        border-radius: 24px;
        padding: 3rem 2rem;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }
    
    .page-title {
        font-size: 3rem;
        color: #1a1a1a;
        margin-bottom: 1rem;
        font-weight: 700;
    }
    
    .page-subtitle {
        font-size: 1.2rem;
        color: #4a4a4a;
        max-width: 800px;
        margin: 0 auto;
        line-height: 1.6;
    }
    
    .disasters-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
        gap: 2rem;
        margin-top: 3rem;
    }
    
    .disaster-card {
        background: #ffffff;
        border-radius: 24px;
        padding: 2rem;
        border: 1px solid #e0e0e0;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        position: relative;
        overflow: hidden;
    }
    
    .disaster-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: #c0c0c0;
        opacity: 0.8;
    }
    
    .disaster-card:hover {
        transform: translateY(-8px) scale(1.02);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        border-color: #c0c0c0;
    }
    
    .disaster-card.severe::before {
        background: #dc2626;
    }
    
    .disaster-card.catastrophic::before {
        background: #dc2626;
    }
    
    .disaster-card-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    
    .country-flag {
        width: 32px;
        height: 24px;
        object-fit: fill;
        flex-shrink: 0;
        animation: none !important;
        transform: none !important;
        transition: none !important;
        border-radius: 0 !important;
        filter: none !important;
        border: none !important;
        box-shadow: none !important;
        clip-path: none !important;
        mask: none !important;
        -webkit-mask: none !important;
        image-rendering: auto !important;
        will-change: auto !important;
        backface-visibility: visible !important;
        perspective: none !important;
    }
    
    .country-flag-small {
        width: 32px;
        height: 24px;
        object-fit: fill;
        display: block;
        animation: none !important;
        transform: none !important;
        transition: none !important;
        border-radius: 0 !important;
        filter: none !important;
        border: none !important;
        box-shadow: none !important;
        clip-path: none !important;
        mask: none !important;
        -webkit-mask: none !important;
        image-rendering: auto !important;
        will-change: auto !important;
        backface-visibility: visible !important;
        perspective: none !important;
    }
    
    img.country-flag,
    img.country-flag-small,
    img[src*="/api/flags/"] {
        width: 32px !important;
        height: 24px !important;
        object-fit: fill !important;
        border-radius: 0 !important;
        filter: none !important;
        transform: none !important;
        animation: none !important;
        transition: none !important;
        clip-path: inset(0) !important;
        mask: none !important;
        -webkit-mask: none !important;
        image-rendering: auto !important;
        -webkit-image-rendering: auto !important;
        image-rendering: crisp-edges !important;
        will-change: auto !important;
        backface-visibility: visible !important;
        perspective: none !important;
        -webkit-transform: none !important;
        -moz-transform: none !important;
        -ms-transform: none !important;
        -o-transform: none !important;
    }
    
    /* Prevent any hover effects on flags */
    img.country-flag:hover,
    img.country-flag-small:hover,
    img[src*="/api/flags/"]:hover {
        transform: none !important;
        animation: none !important;
        transition: none !important;
        filter: none !important;
    }
    
    .disaster-card-title {
        flex: 1;
    }
    
    .disaster-type {
        display: inline-block;
        background: #f5f5f5;
        color: #333;
        padding: 0.5rem 1rem;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
        border: 1px solid #e0e0e0;
    }
    
    .disaster-card.severe .disaster-type {
        background: #fee2e2;
        border-color: #dc2626;
        color: #dc2626;
    }
    
    .disaster-location {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1a1a1a;
        margin: 0;
    }
    
    .disaster-news-summary {
        font-size: 0.95rem;
        color: #4a4a4a;
        line-height: 1.6;
        margin: 1rem 0;
        padding: 1rem;
        background: #f9f9f9;
        border-radius: 12px;
        border-left: 3px solid #c0c0c0;
    }
    
    .disaster-card-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1.5rem;
        padding-top: 1rem;
        border-top: 1px solid #e0e0e0;
    }
    
    .disaster-card-footer .disaster-type {
        margin-left: auto;
    }
    
    .disaster-link {
        display: inline-flex;
        align-items: center;
        background: #0f56ff;
        color: white;
        padding: 0.875rem 1.75rem;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 600;
        transition: all 0.3s ease;
        border: 1px solid #0f56ff;
    }
    
    .disaster-link:hover {
        background: #1f3c88;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(15, 86, 255, 0.3);
    }
    
    .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        background: #ffffff;
        border-radius: 24px;
        border: 1px solid #e0e0e0;
        color: #1a1a1a;
    }
    
    .empty-state p {
        font-size: 1.2rem;
        margin-bottom: 1rem;
        color: #4a4a4a;
    }
    
    .empty-state a {
        color: #0f56ff;
        font-weight: 600;
        text-decoration: underline;
    }
    
    .info-section {
        text-align: center;
        margin-top: 4rem;
        padding: 3rem 2rem;
        background: #ffffff;
        border-radius: 24px;
        border: 1px solid #e0e0e0;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }
    
    .info-section h3 {
        color: #1a1a1a;
        margin-bottom: 1rem;
        font-size: 1.8rem;
    }
    
    .info-section p {
        color: #4a4a4a;
        margin-bottom: 1.5rem;
        max-width: 700px;
        margin-left: auto;
        margin-right: auto;
        line-height: 1.6;
    }
    
    .info-section a {
        display: inline-block;
        background: #0f56ff;
        color: white;
        padding: 1rem 2rem;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 600;
        transition: all 0.3s ease;
        border: 1px solid #0f56ff;
    }
    
    .info-section a:hover {
        background: #1f3c88;
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(15, 86, 255, 0.3);
    }
    
    @media (max-width: 768px) {
        .disasters-grid {
            grid-template-columns: 1fr;
            gap: 1.5rem;
        }
        
        .page-title {
            font-size: 2rem;
        }
        
        .disaster-card-header {
            flex-direction: column;
            align-items: flex-start;
        }
        
        .disasters-page {
            padding: 4rem 1rem 2rem;
        }
    }
</style>
{% endblock %}

{% block content %}
<div class="disasters-page">
    <div class="disasters-container">
        <div class="page-header">
            <h1 class="page-title">Join us in prayer, for the affected communities by recent events</h1>
            <div class="prayer-verse" style="margin-top: 2rem; padding: 1.5rem; background: #ffffff; border-radius: 16px; border: 1px solid #e0e0e0; text-align: center; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
                <p style="font-size: 1.1rem; font-style: italic; margin-bottom: 0.5rem; color: #1a1a1a;">
                    "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God."
                </p>
                <p style="font-size: 0.9rem; color: #666;">
                    — Philippians 4:6
                </p>
            </div>
        </div>
        
        {% if disasters %}
        <div class="disasters-grid">
            {% for disaster in disasters %}
            <div class="disaster-card {{ disaster.severity }}">
                <div class="disaster-card-header-grouped" style="text-align: center; margin-bottom: 1.5rem;">
                    <h2 class="disaster-type-title" style="font-size: 1.8rem; font-weight: 700; color: #1a1a1a; margin-bottom: 1rem;">
                        {{ disaster.type_display }}
                    </h2>
                    <div class="country-flags-group" style="display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem; margin-bottom: 1rem;">
                        {% for flag_info in disaster.country_flags %}
                        <img src="/api/flags/{{ flag_info.flag_code }}" 
                             alt="{{ flag_info.country }} flag" 
                             class="country-flag-small"
                             style="width: 32px; height: 24px; object-fit: fill; display: block; animation: none !important; transform: none !important; transition: none !important; border-radius: 0 !important; filter: none !important; border: none !important; box-shadow: none !important; will-change: auto !important; backface-visibility: visible !important; perspective: none !important; -webkit-transform: none !important;"
                             onerror="this.src='/api/flags/xx';">
                        {% endfor %}
                    </div>
                </div>
                
                {% if disaster.summary %}
                <div class="disaster-news-summary" style="text-align: center;">
                    {{ disaster.summary }}
                </div>
                {% endif %}
                
                <div class="disaster-card-footer" style="justify-content: center;">
                    <a href="/prayers/watchtower/{{ disaster.url_slug }}" class="disaster-link">
                        Let Pray
                    </a>
                </div>
            </div>
            {% endfor %}
        </div>
        {% else %}
        <div class="empty-state">
            <p style="font-size: 1.2rem; margin-bottom: 1rem;">🙏 Praise God - No breaking disasters in recent hours</p>
            <p>Visit our <a href="/prayers">Prayer Room</a> for today's global prayer.</p>
        </div>
        {% endif %}
    </div>
</div>
{% endblock %}
'''

