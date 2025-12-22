"""
SEO Blueprint - Sitemap, structured data, and SEO optimization
"""
from flask import Blueprint, request, make_response, jsonify, render_template_string, Response
from datetime import datetime, timedelta
import logging
import requests
import re
from auth_decorators import verify_cloud_scheduler

seo_bp = Blueprint('seo', __name__)
logger = logging.getLogger(__name__)


def _clean_citation_markers(text: str) -> str:
    """Remove citation markers like [1][2] from text"""
    if not text:
        return text
    # Remove citation markers [1], [2], etc.
    cleaned = re.sub(r'\[\d+\]', '', text)
    # Clean up multiple spaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned


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
        
        # Static pages - Public pages only (exclude auth/profile pages)
        static_pages = [
            ('/', '1.0', 'daily'),  # Home page
            ('/home', '0.9', 'daily'),  # Main home page with daily content
            ('/prayers', '1.0', 'daily'),  # Prayer Room - main feature
            ('/prayer-room', '0.9', 'daily'),  # Live Prayer Room directory
            ('/daily-prayer', '0.95', 'daily'),  # Daily prayer dedicated page
            ('/globalprayerwatch', '0.9', 'daily'),  # Global Prayer Watch hub (SEO discovery page)
            ('/about', '0.7', 'monthly'),  # About page
            ('/contact', '0.6', 'monthly'),  # Contact page
            ('/faq', '0.6', 'monthly'),  # FAQ page
            ('/privacy-policy', '0.3', 'yearly'),  # Privacy policy
            ('/terms-of-service', '0.3', 'yearly'),  # Terms of service
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
                    # Note: Using /globalprayerwatch/{type} format (no location) to match actual route
                    if isinstance(prayer, dict) and 'metadata' in prayer:
                        metadata = prayer['metadata']
                        disasters = metadata.get('disasters', [])
                        
                        # Track disaster types we've already added (deduplicate by type)
                        added_disaster_types = set()
                        
                        for disaster in disasters:
                            if disaster.get('type'):
                                disaster_type = disaster['type'].lower().replace(' ', '-').replace('_', '-')
                                
                                # Only add each disaster type once (deduplicate)
                                if disaster_type not in added_disaster_types:
                                    added_disaster_types.add(disaster_type)
                                    
                                    xml_content.append('  <url>')
                                    xml_content.append(f'    <loc>{base_url}/globalprayerwatch/{disaster_type}</loc>')
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


@seo_bp.route('/api/disasters/organizations', methods=['GET'])
def get_disaster_organizations():
    """API endpoint to fetch organizations for a disaster type and affected countries"""
    try:
        from flask import current_app
        from nonprofit_service import get_nonprofit_service
        
        disaster_type = request.args.get('type', '')
        countries = request.args.get('countries', '')
        
        if not disaster_type or not countries:
            return jsonify({'error': 'Missing required parameters: type and countries'}), 400
        
        # Parse countries (comma-separated)
        affected_countries = [c.strip() for c in countries.split(',') if c.strip()]
        
        if not affected_countries:
            return jsonify({'error': 'No valid countries provided'}), 400
        
        # Get nonprofit service
        nonprofit_service = get_nonprofit_service()
        
        # Create disaster dict for organization lookup
        disaster_dict = {
            'type': disaster_type.lower(),
            'locations': affected_countries,
            'details': ''
        }
        
        # Use first country as primary location for organization search
        primary_location = affected_countries[0]
        logger.info(f"Fetching organizations for {disaster_type} in {primary_location}")
        
        disaster_orgs = nonprofit_service._get_disaster_organizations(disaster_dict)
        # Limit to 3 organizations
        organizations = disaster_orgs[:3] if disaster_orgs else []
        
        logger.info(f"Found {len(organizations)} organizations for {disaster_type}")
        
        return jsonify({
            'organizations': organizations,
            'disaster_type': disaster_type,
            'countries': affected_countries
        }), 200
        
    except Exception as e:
        logger.error(f"Error fetching organizations for disaster: {e}", exc_info=True)
        return jsonify({'error': 'Failed to fetch organizations'}), 500


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


@seo_bp.route('/globalprayerwatch')
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
                'summary': _clean_citation_markers(prayer_data.get('summary', '')),
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


@seo_bp.route('/globalprayerwatch/<disaster_type>')
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
        
        # Collect all matching entries for this disaster type (same logic as hub page)
        matching_entries = []
        for prayer_data in active_prayers:
            # Check if it's a grouped prayer for this type
            if prayer_data.get('is_grouped') or prayer_data.get('affected_countries'):
                prayer_disaster_type = normalize_disaster_type_for_display(prayer_data.get('disaster_type', '')).replace(' ', '_').replace('-', '_')
                
                if prayer_disaster_type == disaster_type_normalized:
                    matching_entries.append(prayer_data)
        
        # Merge countries from all matching entries (same logic as hub page)
        if matching_entries:
            if len(matching_entries) == 1:
                # Only one entry, use it as-is
                disaster_data = matching_entries[0]
                disaster_prayer = _clean_citation_markers(disaster_data.get('prayer', ''))
                logger.info(f"Found single grouped disaster prayer for {disaster_type}")
            else:
                # Multiple entries - merge countries and keep most recent
                logger.info(f"Merging {len(matching_entries)} entries for {disaster_type}")
                
                # Find the most recent entry
                most_recent_entry = max(matching_entries, key=lambda x: datetime.fromisoformat(x.get('created_at', '2000-01-01')))
                
                # Merge all countries from all entries
                all_countries = set()
                for entry in matching_entries:
                    all_countries.update(entry.get('affected_countries', []))
                
                # Update the most recent entry with merged countries
                most_recent_entry['affected_countries'] = list(all_countries)
                disaster_data = most_recent_entry
                disaster_prayer = _clean_citation_markers(disaster_data.get('prayer', ''))
                
                logger.info(f"Merged {len(matching_entries)} entries for {disaster_type}: {len(all_countries)} total countries")
        else:
            disaster_data = None
            disaster_prayer = None
        
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
                    disaster_prayer = _clean_citation_markers(cached_data.get('prayer', ''))
                    logger.info(f"Using cached disaster prayer for {disaster_type}")
            except:
                pass
        
        # If still no prayer, generate fallback
        if not disaster_prayer:
            disaster_prayer = _generate_disaster_prayer(disaster_display, "affected regions")
            disaster_prayer = _clean_citation_markers(disaster_prayer)
        
        # Get country flags for all affected countries
        country_flags = []
        affected_countries = []
        summary = ''
        if disaster_data:
            affected_countries = disaster_data.get('affected_countries', [])
            summary = _clean_citation_markers(disaster_data.get('summary', ''))
            for country in affected_countries:
                flag_code = get_country_flag_code(country)
                if flag_code:
                    country_flags.append({
                        'country': country,
                        'flag_code': flag_code
                    })
        
        # Organizations will be loaded asynchronously via JavaScript to avoid blocking page load
        # Pass disaster info for async loading
        disaster_type_for_orgs = disaster_data.get('disaster_type', disaster_display.lower()) if disaster_data else disaster_display.lower()
        
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
                                    disaster_type_for_orgs=disaster_type_for_orgs,
                                    today=today.strftime('%B %d, %Y'))
        
    except Exception as e:
        logger.error(f"Error rendering disaster page: {e}")
        return jsonify({'error': 'Page not found'}), 404


# Disaster page template - Prayer-first, participation-focused
DISASTER_PAGE_TEMPLATE = '''
{% extends "base.html" %}

{% block title %}Prayer for {{ disaster_type }} - Join in Prayer for Affected Communities{% if affected_countries %} in {{ affected_countries|join(', ') }}{% endif %} | Global Prayer Watch{% endblock %}

{% block meta_description %}Join believers worldwide in prayer for communities affected by {{ disaster_type }}{% if affected_countries %} in {{ affected_countries|join(', ') }}{% endif %}. This prayer has been crafted specifically for their situation. Stand together in faith and intercession.{% endblock %}

{% block meta_keywords %}prayer for {{ disaster_type }}, {{ disaster_type }} prayer, disaster prayer, prayer for affected communities{% if affected_countries %}, prayer for {{ affected_countries|join(', ') }}{% endif %}, global prayer watch, Christian disaster prayer{% endblock %}

{% block og_title %}Prayer for {{ disaster_type }} - Join in Prayer for Affected Communities{% endblock %}
{% block og_description %}Join believers worldwide lifting up communities affected by {{ disaster_type }}{% if affected_countries %} in {{ affected_countries|join(', ') }}{% endif %}. Stand together in prayer and intercession.{% endblock %}

{% block extra_css %}
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&display=swap');

    :root {
        --primary-blue: #0f56ff;
        --primary-blue-light: #4a90e2;
        --primary-blue-dark: #1f3c88;
        --text-primary: #0a1629;
        --text-secondary: #64748b;
        --text-muted: #94a3b8;
        --surface-white: rgba(255, 255, 255, 0.95);
        --surface-glass: rgba(255, 255, 255, 0.8);
        --shadow-light: rgba(0, 0, 0, 0.04);
        --shadow-medium: rgba(0, 0, 0, 0.08);
        --shadow-heavy: rgba(0, 0, 0, 0.12);
        --border-light: rgba(15, 86, 255, 0.1);
        --border-medium: rgba(15, 86, 255, 0.2);
        --gradient-primary: linear-gradient(135deg, var(--primary-blue) 0%, var(--primary-blue-light) 100%);
        --gradient-surface: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.95) 100%);
        --animation-timing: cubic-bezier(0.4, 0, 0.2, 1);
    }

    * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        color: var(--text-primary);
    }

    .disaster-prayer-page {
        min-height: calc(100vh - 200px);
        padding: 4rem 2rem 6rem;
        background:
            radial-gradient(circle at 30% 70%, rgba(15, 86, 255, 0.03) 0%, transparent 50%),
            radial-gradient(circle at 70% 30%, rgba(74, 144, 226, 0.03) 0%, transparent 50%),
            linear-gradient(135deg, #fafbfc 0%, #ffffff 50%, #f1f5f9 100%);
        position: relative;
        overflow-x: hidden;
    }

    .disaster-prayer-page::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 100%;
        background:
            url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%230f56ff' fill-opacity='0.015'%3E%3Ccircle cx='10' cy='10' r='1.5'/%3E%3Ccircle cx='40' cy='10' r='1.5'/%3E%3Ccircle cx='70' cy='10' r='1.5'/%3E%3Ccircle cx='10' cy='40' r='1.5'/%3E%3Ccircle cx='40' cy='40' r='1.5'/%3E%3Ccircle cx='70' cy='40' r='1.5'/%3E%3Ccircle cx='10' cy='70' r='1.5'/%3E%3Ccircle cx='40' cy='70' r='1.5'/%3E%3Ccircle cx='70' cy='70' r='1.5'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E") repeat;
        pointer-events: none;
        animation: floatBackground 20s ease-in-out infinite;
    }

    @keyframes floatBackground {
        0%, 100% { transform: translate(0, 0); }
        25% { transform: translate(-10px, -10px); }
        50% { transform: translate(10px, -20px); }
        75% { transform: translate(-5px, 10px); }
    }
    
    .breadcrumb {
        font-size: 0.9rem;
        color: #64748b;
        margin-bottom: 2rem;
        text-align: left;
        max-width: 1200px;
        margin-left: auto;
        margin-right: auto;
        padding: 0 1rem;
        font-weight: 500;
    }
    
    .breadcrumb a {
        color: #0f56ff;
        text-decoration: none;
        transition: all 0.2s ease;
    }
    
    .breadcrumb a:hover {
        text-decoration: underline;
        color: #1f3c88;
    }
    
    .disaster-hero {
        background: var(--surface-white);
        color: #333;
        padding: 5rem 4rem;
        text-align: center;
        margin-bottom: 5rem;
        max-width: 1200px;
        margin-left: auto;
        margin-right: auto;
        border-radius: 40px;
        box-shadow:
            0 32px 80px var(--shadow-medium),
            0 16px 32px var(--shadow-light),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
        border: 1px solid var(--border-light);
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(20px);
        animation: heroSlideUp 1.2s var(--animation-timing);
    }

    .disaster-hero::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmer 4s ease-in-out infinite;
    }

    .disaster-hero::after {
        content: '';
        position: absolute;
        top: -30%;
        left: -30%;
        width: 160%;
        height: 160%;
        background: radial-gradient(circle, rgba(15, 86, 255, 0.02) 0%, transparent 70%);
        animation: heroPulse 8s ease-in-out infinite;
        pointer-events: none;
    }

    @keyframes heroSlideUp {
        from {
            opacity: 0;
            transform: translateY(40px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes heroPulse {
        0%, 100% { transform: scale(1); opacity: 0.3; }
        50% { transform: scale(1.05); opacity: 0.6; }
    }
    
    .disaster-hero h1 {
        font-size: clamp(2.5rem, 5vw, 4rem);
        margin-bottom: 1.5rem;
        font-weight: 900;
        color: var(--text-primary);
        letter-spacing: -0.03em;
        line-height: 1.1;
        background: linear-gradient(135deg, var(--text-primary) 0%, var(--primary-blue-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        position: relative;
        z-index: 2;
    }

    .hero-subtitle {
        font-size: clamp(1.25rem, 2.5vw, 1.5rem);
        color: var(--text-secondary);
        line-height: 1.7;
        max-width: 900px;
        margin: 0 auto;
        font-weight: 500;
        position: relative;
        z-index: 2;
    }
    
    .prayer-content {
        max-width: 1000px;
        margin: 0 auto 5rem;
        padding: 0 1.5rem;
        position: relative;
        z-index: 2;
    }

    .affected-communities {
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.98) 0%, 
            rgba(248, 250, 252, 0.95) 100%);
        border-radius: 36px;
        padding: 0;
        margin-bottom: 4rem;
        box-shadow:
            0 24px 64px rgba(0, 0, 0, 0.08),
            0 12px 32px rgba(0, 0, 0, 0.06),
            0 4px 16px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        text-align: center;
        border: none;
        position: relative;
        overflow: visible;
        animation: contentSlideUp 1.4s var(--animation-timing);
        isolation: isolate;
    }

    .affected-communities::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 6px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmerFlow 4s ease-in-out infinite;
        z-index: 3;
    }

    .affected-communities::after {
        content: '';
        position: absolute;
        top: -40%;
        left: -40%;
        width: 180%;
        height: 180%;
        background: radial-gradient(circle, 
            rgba(15, 86, 255, 0.04) 0%, 
            rgba(74, 144, 226, 0.02) 30%,
            transparent 70%);
        animation: subtleRotate 20s linear infinite;
        pointer-events: none;
    }

    @keyframes contentSlideUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes subtleRotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .communities-title {
        font-size: clamp(1.875rem, 3vw, 2.5rem);
        font-weight: 900;
        color: var(--text-primary);
        margin-bottom: 0;
        letter-spacing: -0.02em;
        line-height: 1.2;
        position: relative;
        z-index: 2;
        padding: 3.5rem 3rem 2rem;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.5) 100%);
    }

    .communities-title::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 80px;
        height: 4px;
        background: var(--gradient-primary);
        border-radius: 2px;
    }

    .country-flags-section {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 1rem;
        margin-bottom: 2rem;
        padding: 3rem 2.5rem 2rem;
        background: linear-gradient(135deg, 
            rgba(248, 250, 252, 0.8) 0%, 
            rgba(241, 245, 249, 0.6) 100%);
        border-radius: 24px;
        border: 1px solid rgba(15, 86, 255, 0.1);
        box-shadow: 
            0 8px 20px rgba(0, 0, 0, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(10px);
        position: relative;
        z-index: 2;
        margin-left: 3rem;
        margin-right: 3rem;
        overflow: visible;
    }

    .situation-summary {
        color: #475569;
        font-style: italic;
        font-size: 1.1875rem;
        line-height: 1.8;
        margin: 0;
        padding: 2.5rem 3rem 3.5rem;
        font-weight: 400;
        position: relative;
        z-index: 2;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.5) 0%, 
            rgba(255, 255, 255, 0.95) 100%);
        border-top: 1px solid rgba(15, 86, 255, 0.08);
    }

    .situation-summary::before {
        content: '';
        position: absolute;
        top: -1px;
        left: 50%;
        transform: translateX(-50%);
        width: 60%;
        height: 1px;
        background: linear-gradient(90deg, 
            transparent 0%,
            rgba(15, 86, 255, 0.3) 50%,
            transparent 100%);
    }

    .prayer-section {
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.98) 0%, 
            rgba(255, 255, 255, 1) 100%);
        border-radius: 40px;
        padding: 0;
        margin-bottom: 4rem;
        box-shadow:
            0 32px 80px rgba(0, 0, 0, 0.08),
            0 16px 40px rgba(0, 0, 0, 0.06),
            0 8px 20px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        border: none;
        position: relative;
        overflow: hidden;
        animation: contentSlideUp 1.6s var(--animation-timing);
        isolation: isolate;
    }

    .prayer-section::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 6px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmerFlow 5s ease-in-out infinite;
        z-index: 3;
    }

    .prayer-section::after {
        content: '';
        position: absolute;
        top: -35%;
        left: -35%;
        width: 170%;
        height: 170%;
        background: radial-gradient(circle, 
            rgba(15, 86, 255, 0.03) 0%, 
            rgba(74, 144, 226, 0.015) 30%,
            transparent 70%);
        animation: subtleRotate 25s linear infinite reverse;
        pointer-events: none;
    }

    .prayer-title {
        font-size: clamp(1.875rem, 3vw, 2.75rem);
        font-weight: 900;
        color: var(--text-primary);
        margin-bottom: 0;
        text-align: center;
        letter-spacing: -0.02em;
        line-height: 1.2;
        position: relative;
        z-index: 2;
        padding: 4rem 4rem 3rem;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.5) 100%);
    }

    .prayer-title::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 100px;
        height: 4px;
        background: var(--gradient-primary);
        border-radius: 2px;
    }

    .prayer-text {
        line-height: 2.2;
        color: #1e293b;
        white-space: pre-wrap;
        font-size: 1.25rem;
        text-align: left;
        font-weight: 400;
        position: relative;
        z-index: 2;
        font-family: 'Inter', sans-serif;
        padding: 0 4rem 4rem;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.5) 0%, 
            rgba(255, 255, 255, 0.98) 100%);
    }

    .prayer-text::before {
        content: '';
        position: absolute;
        top: 0;
        left: 4rem;
        right: 4rem;
        height: 1px;
        background: linear-gradient(90deg, 
            transparent 0%,
            rgba(15, 86, 255, 0.2) 50%,
            transparent 100%);
    }

    .organizations-section {
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.98) 0%, 
            rgba(248, 250, 252, 0.95) 100%);
        border-radius: 40px;
        padding: 0;
        margin-bottom: 4rem;
        box-shadow:
            0 32px 80px rgba(0, 0, 0, 0.08),
            0 16px 40px rgba(0, 0, 0, 0.06),
            0 8px 20px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        border: none;
        position: relative;
        overflow: hidden;
        animation: contentSlideUp 1.7s var(--animation-timing);
        isolation: isolate;
    }

    .organizations-section::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 6px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmerFlow 5s ease-in-out infinite;
        z-index: 3;
    }

    .organizations-section::after {
        content: '';
        position: absolute;
        top: -35%;
        left: -35%;
        width: 170%;
        height: 170%;
        background: radial-gradient(circle, 
            rgba(15, 86, 255, 0.03) 0%, 
            rgba(74, 144, 226, 0.015) 30%,
            transparent 70%);
        animation: subtleRotate 25s linear infinite;
        pointer-events: none;
    }

    .organizations-title {
        font-size: clamp(1.875rem, 3vw, 2.75rem);
        font-weight: 900;
        color: var(--text-primary);
        margin-bottom: 0;
        text-align: center;
        letter-spacing: -0.02em;
        line-height: 1.2;
        position: relative;
        z-index: 2;
        padding: 4rem 4rem 1.5rem;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.5) 100%);
    }

    .organizations-title::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 100px;
        height: 4px;
        background: var(--gradient-primary);
        border-radius: 2px;
    }

    .organizations-intro {
        font-size: 1.1875rem;
        color: var(--text-secondary);
        line-height: 1.75;
        text-align: center;
        margin: 0;
        padding: 0 4rem 3rem;
        font-weight: 400;
        position: relative;
        z-index: 2;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.5) 0%, 
            rgba(255, 255, 255, 0.98) 100%);
    }

    .organizations-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4rem;
        color: var(--text-secondary);
        position: relative;
        z-index: 2;
    }

    .loading-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid rgba(15, 86, 255, 0.1);
        border-top-color: var(--primary-blue);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 1rem;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .organizations-loading p {
        font-size: 1rem;
        font-weight: 500;
        color: var(--text-secondary);
    }

    .organizations-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 2rem;
        padding: 0 4rem 4rem;
        position: relative;
        z-index: 2;
    }

    .organization-card {
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.9) 100%);
        border-radius: 24px;
        padding: 2.5rem;
        border: 2px solid var(--border-light);
        box-shadow: 
            0 8px 24px rgba(0, 0, 0, 0.06),
            0 4px 12px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        transition: all 0.4s var(--animation-timing);
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(16px);
    }

    .organization-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, 
            transparent, 
            rgba(15, 86, 255, 0.05), 
            transparent);
        transition: left 0.6s ease;
    }

    .organization-card:hover::before {
        left: 100%;
    }

    .organization-card:hover {
        transform: translateY(-4px);
        box-shadow: 
            0 16px 40px rgba(0, 0, 0, 0.1),
            0 8px 20px rgba(15, 86, 255, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
        border-color: var(--border-medium);
    }

    .org-logo-wrapper {
        display: flex;
        justify-content: center;
        align-items: center;
        margin-bottom: 1.5rem;
        height: 80px;
    }

    .org-logo {
        max-width: 120px;
        max-height: 80px;
        object-fit: contain;
        border-radius: 8px;
    }

    .org-content {
        text-align: center;
    }

    .org-name {
        font-size: 1.375rem;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: 1rem;
        line-height: 1.3;
    }

    .org-description {
        font-size: 1rem;
        color: var(--text-secondary);
        line-height: 1.6;
        margin-bottom: 1.5rem;
        min-height: 3.2em;
    }

    .org-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
        flex-wrap: wrap;
    }

    .org-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.75rem 1.5rem;
        border-radius: 12px;
        font-weight: 600;
        font-size: 0.9375rem;
        text-decoration: none;
        transition: all 0.3s var(--animation-timing);
        border: 2px solid var(--border-medium);
        position: relative;
        overflow: hidden;
    }

    .org-website {
        background: var(--surface-white);
        color: var(--primary-blue);
    }

    .org-donate {
        background: var(--gradient-primary);
        color: white;
        border-color: var(--primary-blue);
    }

    .org-link:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(15, 86, 255, 0.3);
    }

    .org-website:hover {
        background: rgba(15, 86, 255, 0.05);
        border-color: var(--primary-blue);
    }

    .org-donate:hover {
        background: linear-gradient(135deg, var(--primary-blue-dark) 0%, var(--primary-blue) 100%);
    }

    .prayer-participation {
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.98) 0%, 
            rgba(248, 250, 252, 0.95) 100%);
        border-radius: 36px;
        padding: 0;
        text-align: center;
        margin-top: 4rem;
        border: none;
        box-shadow:
            0 24px 64px rgba(0, 0, 0, 0.08),
            0 12px 32px rgba(0, 0, 0, 0.06),
            0 4px 16px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        position: relative;
        overflow: hidden;
        animation: contentSlideUp 1.8s var(--animation-timing);
        isolation: isolate;
    }

    .prayer-participation::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 6px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmerFlow 4s ease-in-out infinite;
        z-index: 3;
    }

    .prayer-participation::after {
        content: '';
        position: absolute;
        top: -30%;
        left: -30%;
        width: 160%;
        height: 160%;
        background: radial-gradient(circle, 
            rgba(15, 86, 255, 0.05) 0%, 
            rgba(74, 144, 226, 0.025) 30%,
            transparent 70%);
        animation: subtleRotate 15s linear infinite;
        pointer-events: none;
    }

    .participation-text {
        font-size: 1.3125rem;
        color: #475569;
        line-height: 1.75;
        margin-bottom: 3rem;
        font-weight: 500;
        position: relative;
        z-index: 2;
        padding: 3.5rem 3rem 0;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.5) 100%);
    }

    .prayer-resources {
        max-width: 1200px;
        margin: 5rem auto 0;
        padding: 5rem 4rem;
        background: var(--gradient-surface);
        border-radius: 40px;
        border: 1px solid var(--border-light);
        text-align: center;
        box-shadow:
            0 32px 80px var(--shadow-medium),
            0 16px 32px var(--shadow-light);
        position: relative;
        overflow: hidden;
        animation: contentSlideUp 2s var(--animation-timing);
    }

    .prayer-resources::before {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(15, 86, 255, 0.02) 0%, transparent 70%);
        animation: rotate 25s linear infinite;
        pointer-events: none;
    }
    
    .resources-title {
        font-size: clamp(2rem, 4vw, 2.875rem);
        font-weight: 900;
        color: var(--text-primary);
        margin-bottom: 0;
        letter-spacing: -0.02em;
        line-height: 1.2;
        position: relative;
        z-index: 2;
        padding: 5rem 4rem 2.5rem;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.5) 100%);
    }

    .resources-title::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 100px;
        height: 4px;
        background: var(--gradient-primary);
        border-radius: 2px;
    }

    .resources-intro {
        font-size: 1.3125rem;
        color: var(--text-secondary);
        line-height: 1.75;
        margin-bottom: 0;
        max-width: 900px;
        margin-left: auto;
        margin-right: auto;
        font-weight: 400;
        position: relative;
        z-index: 2;
        padding: 2.5rem 4rem 4rem;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.5) 0%, 
            rgba(255, 255, 255, 0.98) 100%);
        border-top: 1px solid rgba(15, 86, 255, 0.08);
    }

    .resources-intro::before {
        content: '';
        position: absolute;
        top: -1px;
        left: 50%;
        transform: translateX(-50%);
        width: 60%;
        height: 1px;
        background: linear-gradient(90deg, 
            transparent 0%,
            rgba(15, 86, 255, 0.3) 50%,
            transparent 100%);
    }
    
    /* Flag tooltip styling for disaster page */
    .flag-tooltip-wrapper {
        position: relative;
        display: inline-block;
        z-index: 10;
    }
    
    .flag-tooltip {
        visibility: hidden;
        opacity: 0;
        background-color: #1a1a1a;
        color: #ffffff;
        text-align: center;
        padding: 0.5rem 0.9rem;
        border-radius: 6px;
        font-size: 0.85rem;
        font-weight: 500;
        white-space: nowrap;
        position: absolute;
        z-index: 10000;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    
    .flag-tooltip::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border-width: 5px;
        border-style: solid;
        border-color: #1a1a1a transparent transparent transparent;
    }
    
    .flag-tooltip-wrapper:hover .flag-tooltip {
        visibility: visible;
        opacity: 1;
    }
    
    .resource-links {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 1.5rem;
        margin-top: 3.5rem;
    }

    .resource-link {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1.25rem 2.5rem;
        background: var(--surface-white);
        color: var(--primary-blue);
        text-decoration: none;
        border-radius: 16px;
        font-weight: 600;
        font-size: 1rem;
        border: 2px solid var(--border-medium);
        transition: all 0.3s var(--animation-timing);
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 16px var(--shadow-light);
        position: relative;
        overflow: hidden;
        min-width: 200px;
        justify-content: center;
    }

    .link-icon {
        font-size: 1.25rem;
        position: relative;
        z-index: 2;
    }

    .link-text {
        position: relative;
        z-index: 2;
    }

    .resource-link::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(15, 86, 255, 0.1), transparent);
        transition: left 0.4s ease;
    }

    .resource-link:hover::before {
        left: 100%;
    }

    .resource-link:hover {
        background: var(--gradient-primary);
        color: white;
        border-color: var(--primary-blue);
        transform: translateY(-3px);
        box-shadow: 0 8px 24px rgba(15, 86, 255, 0.3);
    }
    
    @media (max-width: 1024px) {
        .prayer-content {
            max-width: 900px;
        }

        .disaster-hero {
            padding: 4rem 3rem;
            margin-bottom: 4rem;
        }
    }

    @media (max-width: 768px) {
        .disaster-prayer-page {
            padding: 3rem 1.5rem 5rem;
        }

        .disaster-hero {
            padding: 3.5rem 2.5rem;
            margin-bottom: 4rem;
            border-radius: 28px;
        }

        .disaster-hero h1 {
            font-size: clamp(2rem, 7vw, 2.75rem);
        }

        .hero-subtitle {
            font-size: clamp(1.125rem, 3vw, 1.375rem);
        }

        .prayer-content {
            padding: 0 1rem;
        }

        .affected-communities {
            padding: 2.5rem 2rem;
            margin-bottom: 3rem;
            border-radius: 24px;
        }

        .prayer-section {
            padding: 3.5rem 2.5rem;
            margin-bottom: 3rem;
            border-radius: 24px;
        }

        .prayer-participation {
            padding: 2.5rem 2rem;
            margin-top: 3rem;
            border-radius: 20px;
        }

        .prayer-resources {
            padding: 3.5rem 2.5rem;
            margin-top: 4rem;
            border-radius: 28px;
        }

        .resource-links {
            grid-template-columns: 1fr;
            padding: 0 2rem 3rem;
        }

        .resource-link {
            width: 100%;
            padding: 1.75rem 1.5rem;
            min-height: 120px;
        }

        .communities-title {
            font-size: clamp(1.5rem, 4vw, 1.875rem);
        }

        .prayer-title {
            font-size: clamp(1.375rem, 4vw, 1.75rem);
        }

        .prayer-text {
            font-size: 1.125rem;
            line-height: 2;
        }

        .resources-title {
            font-size: clamp(1.75rem, 5vw, 2.25rem);
        }
    }

    @media (max-width: 480px) {
        .disaster-prayer-page {
            padding: 2.5rem 1rem 4rem;
        }

        .disaster-hero {
            padding: 3rem 1.5rem;
            margin-bottom: 3rem;
        }

        .disaster-hero h1 {
            font-size: clamp(1.875rem, 8vw, 2.5rem);
            margin-bottom: 1.25rem;
        }

        .hero-subtitle {
            font-size: clamp(1rem, 4vw, 1.25rem);
        }

        .prayer-section {
            padding: 0;
        }

        .prayer-title {
            padding: 3rem 1.5rem 2rem;
        }

        .prayer-text {
            padding: 0 1.5rem 3rem;
        }

        .organizations-section {
            padding: 0;
            margin-bottom: 3rem;
        }

        .organizations-title {
            padding: 3rem 1.5rem 1.25rem;
        }

        .organizations-intro {
            padding: 0 1.5rem 2rem;
            font-size: 1rem;
        }

        .organizations-grid {
            padding: 0 1.5rem 3rem;
            gap: 1.25rem;
        }

        .organization-card {
            padding: 1.75rem;
        }

        .org-name {
            font-size: 1.25rem;
        }

        .org-description {
            font-size: 0.9375rem;
        }

        .org-link {
            padding: 0.625rem 1.25rem;
            font-size: 0.875rem;
        }

        .affected-communities {
            padding: 0;
        }

        .communities-title {
            padding: 2.5rem 1.5rem 1.5rem;
        }

        .country-flags-section {
            margin-left: 1.5rem;
            margin-right: 1.5rem;
            padding: 2.5rem 1.5rem 1.5rem;
        }

        .situation-summary {
            padding: 2rem 1.5rem 2.5rem;
        }

        .prayer-participation {
            padding: 0;
        }

        .participation-text {
            padding: 2.5rem 1.5rem 0;
        }

        .participation-cta-wrapper {
            padding: 0 1.5rem 2.5rem !important;
        }

        .prayer-resources {
            padding: 0;
        }

        .resources-title {
            padding: 3rem 1.5rem 2rem;
        }

        .resources-intro {
            padding: 2rem 1.5rem 3rem;
        }

        .resource-links {
            padding: 0 1.5rem 3rem;
        }

        .prayer-text {
            font-size: 1.0625rem;
        }
    }

    /* Enhanced focus states for accessibility */
    .prayer-cta-primary:focus,
    .resource-link:focus {
        outline: 3px solid var(--primary-blue);
        outline-offset: 3px;
    }

    /* Reduced motion support */
    @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
        }
    }

    /* High contrast mode support */
    @media (prefers-contrast: high) {
        :root {
            --text-primary: #000000;
            --text-secondary: #333333;
            --border-light: rgba(0, 0, 0, 0.2);
            --border-medium: rgba(0, 0, 0, 0.3);
        }
    }
</style>
<!-- JSON-LD Structured Data for SEO -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Prayer for Communities Affected by {{ disaster_type }}{% if affected_countries %} in {{ affected_countries|join(', ') }}{% endif %}",
  "description": "Join believers worldwide in prayer for communities affected by {{ disaster_type }}{% if affected_countries %} in {{ affected_countries|join(', ') }}{% endif %}. This prayer has been crafted specifically for their situation.",
  "datePublished": "{{ today }}",
  "dateModified": "{{ today }}",
  "author": {
    "@type": "Organization",
    "name": "Divine Bridge",
    "url": "{{ request.url_root }}"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Divine Bridge",
    "logo": {
      "@type": "ImageObject",
      "url": "{{ request.url_root }}static/images/LogowithName.svg"
    }
  },
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "{{ request.url }}"
  },
  "keywords": "prayer for {{ disaster_type }}, {{ disaster_type }} prayer, disaster prayer, prayer for affected communities{% if affected_countries %}, prayer for {{ affected_countries|join(', ') }}{% endif %}, global prayer watch",
  "articleSection": "Global Prayer Watch",
  "inLanguage": "en-US"
}
</script>
{% endblock %}

{% block content %}
<main class="disaster-prayer-page" role="main">
    <header class="disaster-hero">
        <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="/">Home</a>
            <span aria-hidden="true"> › </span>
            <a href="/globalprayerwatch">Global Prayer Watch</a>
            <span aria-hidden="true"> › </span>
            <span>{{ disaster_type }}</span>
        </nav>
        <h1>Prayer for {{ disaster_type }}</h1>
        <p class="hero-subtitle">Join believers worldwide in lifting up communities affected by {{ disaster_type }}{% if affected_countries %} in {{ affected_countries|join(', ') }}{% endif %}. This prayer has been crafted specifically for their situation, that we might intercede with understanding and compassion.</p>
    </header>

    <article class="prayer-content" itemscope itemtype="https://schema.org/Article">
        {% if affected_countries %}
        <div class="affected-communities" aria-label="Affected communities">
            <h2 class="communities-title">Communities We're Praying For</h2>
            <div class="country-flags-section">
                {% for flag_info in country_flags %}
                <div class="flag-tooltip-wrapper">
                    <img src="/api/flags/{{ flag_info.flag_code }}" 
                         alt="{{ flag_info.country }} flag" 
                         title="{{ flag_info.country }}"
                         data-country="{{ flag_info.country }}"
                         style="width: 32px; height: 24px; object-fit: fill; display: block; animation: none !important; transform: none !important; transition: none !important; border-radius: 0 !important; filter: none !important; border: none !important; box-shadow: none !important; will-change: auto !important; backface-visibility: visible !important; perspective: none !important; -webkit-transform: none !important; cursor: pointer;"
                         onerror="this.src='/api/flags/xx';">
                    <span class="flag-tooltip">{{ flag_info.country }}</span>
                </div>
                {% endfor %}
            </div>
            {% if summary %}
            <p class="situation-summary">{{ summary }}</p>
            {% endif %}
        </div>
        {% endif %}
        
        <section class="prayer-section" itemprop="articleBody">
            <h2 class="prayer-title">A Prayer for Affected Communities</h2>
            <div class="prayer-text" itemprop="text">{{ disaster_prayer }}</div>
        </section>
        
        {% if affected_countries %}
        <section class="organizations-section" id="organizations-section" aria-label="Organizations helping affected communities" style="display: none;">
            <h2 class="organizations-title">Organizations Actively Helping</h2>
            <p class="organizations-intro">These organizations are actively providing aid and support to the affected communities. Consider supporting their work through prayer and giving.</p>
            <div class="organizations-loading" id="organizations-loading">
                <div class="loading-spinner"></div>
                <p>Finding organizations...</p>
            </div>
            <div class="organizations-grid" id="organizations-grid" style="display: none;"></div>
        </section>
        {% endif %}
        
        <div class="prayer-participation">
            <p class="participation-text">You can join others in this prayer right now. As we lift up these communities together, we trust in God's faithfulness and care.</p>
            <div class="participation-cta-wrapper" style="padding: 0 3rem 3.5rem; position: relative; z-index: 2;">
                <a href="/prayers" class="prayer-cta-primary">Continue in Prayer Together</a>
            </div>
        </div>
    </article>
    
    <aside class="prayer-resources" aria-label="Additional prayer resources">
        <h2 class="resources-title">Continue in Prayer</h2>
        <p class="resources-intro">Prayer is a gift we share as the body of Christ. Whether you're seeking prayer or want to join others in intercession, we're here to walk alongside you.</p>
        <nav class="resource-links" aria-label="Prayer resources">
            <a href="/globalprayerwatch" class="resource-link">
                <span class="link-icon">🌍</span>
                <span class="link-text">View All Prayer Needs</span>
            </a>
            <a href="/prayers" class="resource-link">
                <span class="link-icon">🙏</span>
                <span class="link-text">Daily Global Prayer</span>
            </a>
            <a href="/prayers" class="resource-link">
                <span class="link-icon">💒</span>
                <span class="link-text">Join Prayer Room</span>
            </a>
            <a href="/home#organizations" class="resource-link">
                <span class="link-icon">🤝</span>
                <span class="link-text">Find Relief Organizations</span>
            </a>
        </nav>
    </aside>
</main>

<script>
// Load organizations asynchronously after page load
(function() {
    {% if affected_countries and disaster_type_for_orgs %}
    const disasterType = '{{ disaster_type_for_orgs }}';
    const countries = {{ affected_countries|tojson }};
    
    // Wait for page to be fully loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadOrganizations);
    } else {
        loadOrganizations();
    }
    
    function loadOrganizations() {
        const section = document.getElementById('organizations-section');
        const loading = document.getElementById('organizations-loading');
        const grid = document.getElementById('organizations-grid');
        
        if (!section || !loading || !grid) return;
        
        // Show section and loading state
        section.style.display = 'block';
        
        // Build API URL
        const countriesParam = countries.join(',');
        const apiUrl = `/api/disasters/organizations?type=${encodeURIComponent(disasterType)}&countries=${encodeURIComponent(countriesParam)}`;
        
        // Fetch organizations
        fetch(apiUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch organizations');
                }
                return response.json();
            })
            .then(data => {
                const orgs = data.organizations || [];
                
                if (orgs.length === 0) {
                    // Hide section if no organizations found
                    section.style.display = 'none';
                    return;
                }
                
                // Hide loading, show grid
                loading.style.display = 'none';
                grid.style.display = 'grid';
                
                // Render organizations
                grid.innerHTML = orgs.map(org => {
                    let logoHtml = '';
                    if (org.logo_url) {
                        logoHtml = `
                            <div class="org-logo-wrapper">
                                <img src="${escapeHtml(org.logo_url)}" alt="${escapeHtml(org.name)} logo" class="org-logo" onerror="this.style.display='none';">
                            </div>
                        `;
                    }
                    
                    let websiteLink = '';
                    if (org.website) {
                        websiteLink = `<a href="${escapeHtml(org.website)}" target="_blank" rel="noopener noreferrer" class="org-link org-website">Visit Website</a>`;
                    }
                    
                    let donateLink = '';
                    if (org.donation_url) {
                        donateLink = `<a href="${escapeHtml(org.donation_url)}" target="_blank" rel="noopener noreferrer" class="org-link org-donate">Donate</a>`;
                    }
                    
                    const description = org.description ? `<p class="org-description">${escapeHtml(org.description)}</p>` : '';
                    
                    return `
                        <div class="organization-card">
                            ${logoHtml}
                            <div class="org-content">
                                <h3 class="org-name">${escapeHtml(org.name)}</h3>
                                ${description}
                                <div class="org-actions">
                                    ${websiteLink}
                                    ${donateLink}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            })
            .catch(error => {
                console.error('Error loading organizations:', error);
                // Hide section on error
                section.style.display = 'none';
            });
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    {% endif %}
})();
</script>
{% endblock %}
'''

# Disasters hub template - Ultra-modern, beautiful design
DISASTERS_HUB_TEMPLATE = '''
{% extends "base.html" %}

{% block title %}Global Prayer Watch - Join in Prayer for Affected Communities Worldwide | Divine Bridge{% endblock %}

{% block meta_description %}Join believers worldwide in prayer for communities affected by recent disasters. Find specific prayers for floods, earthquakes, conflicts, and humanitarian crises. Stand together in prayer with our global prayer watch community.{% endblock %}

{% block meta_keywords %}global prayer watch, disaster prayer, prayer for affected communities, disaster prayer support, Christian disaster relief prayer, prayer for natural disasters, prayer for humanitarian crises, global prayer community{% endblock %}

{% block og_title %}Global Prayer Watch - Stand Together in Prayer for Affected Communities{% endblock %}
{% block og_description %}Join believers worldwide lifting up communities affected by recent disasters. Find specific prayers, stand together in faith, and participate in our global prayer watch.{% endblock %}

{% block extra_css %}
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&display=swap');

    :root {
        --primary-blue: #0f56ff;
        --primary-blue-light: #4a90e2;
        --primary-blue-dark: #1f3c88;
        --text-primary: #0a1629;
        --text-secondary: #64748b;
        --text-muted: #94a3b8;
        --surface-white: rgba(255, 255, 255, 0.95);
        --surface-glass: rgba(255, 255, 255, 0.8);
        --shadow-light: rgba(0, 0, 0, 0.04);
        --shadow-medium: rgba(0, 0, 0, 0.08);
        --shadow-heavy: rgba(0, 0, 0, 0.12);
        --border-light: rgba(15, 86, 255, 0.1);
        --border-medium: rgba(15, 86, 255, 0.2);
        --gradient-primary: linear-gradient(135deg, var(--primary-blue) 0%, var(--primary-blue-light) 100%);
        --gradient-surface: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.95) 100%);
        --animation-timing: cubic-bezier(0.4, 0, 0.2, 1);
    }

    * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        color: var(--text-primary);
    }

    .disasters-page {
        min-height: calc(100vh - 200px);
        padding: 6rem 2rem 8rem;
        background:
            radial-gradient(circle at 20% 50%, rgba(15, 86, 255, 0.03) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(74, 144, 226, 0.03) 0%, transparent 50%),
            linear-gradient(135deg, #fafbfc 0%, #ffffff 50%, #f1f5f9 100%);
        position: relative;
        overflow-x: hidden;
    }

    .disasters-page::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 100%;
        background:
            url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%230f56ff' fill-opacity='0.02'%3E%3Ccircle cx='7' cy='7' r='1'/%3E%3Ccircle cx='27' cy='7' r='1'/%3E%3Ccircle cx='47' cy='7' r='1'/%3E%3Ccircle cx='7' cy='27' r='1'/%3E%3Ccircle cx='27' cy='27' r='1'/%3E%3Ccircle cx='47' cy='27' r='1'/%3E%3Ccircle cx='7' cy='47' r='1'/%3E%3Ccircle cx='27' cy='47' r='1'/%3E%3Ccircle cx='47' cy='47' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E") repeat;
        pointer-events: none;
    }

    .disasters-container {
        max-width: 1440px;
        margin: 0 auto;
        position: relative;
        z-index: 2;
    }

    .page-header {
        text-align: center;
        margin-bottom: 6rem;
        background: var(--surface-white);
        backdrop-filter: blur(24px);
        border-radius: 36px;
        padding: 5rem 4rem;
        border: 1px solid var(--border-light);
        box-shadow:
            0 32px 80px var(--shadow-medium),
            0 16px 32px var(--shadow-light),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
        position: relative;
        overflow: hidden;
        animation: slideUp 1s var(--animation-timing);
    }

    .page-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmer 4s ease-in-out infinite;
    }

    .page-header::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(15, 86, 255, 0.02) 0%, transparent 70%);
        animation: pulse 6s ease-in-out infinite;
        pointer-events: none;
    }

    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes shimmer {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
    }

    @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 0.5; }
        50% { transform: scale(1.05); opacity: 0.8; }
    }

    .page-title {
        font-size: clamp(3rem, 6vw, 4.5rem);
        font-weight: 900;
        margin-bottom: 1rem;
        letter-spacing: -0.04em;
        line-height: 1.1;
        background: linear-gradient(135deg, var(--text-primary) 0%, var(--primary-blue-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: fadeInUp 1.2s var(--animation-timing);
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .page-subtitle {
        font-size: clamp(1.375rem, 3vw, 2rem);
        font-weight: 500;
        color: var(--text-secondary);
        margin-top: 0.75rem;
        margin-bottom: 2.5rem;
        line-height: 1.6;
        letter-spacing: -0.01em;
        animation: fadeInUp 1.4s var(--animation-timing);
        max-width: 800px;
        margin-left: auto;
        margin-right: auto;
    }

    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .prayer-intro {
        margin-top: 3.5rem;
        padding: 3rem;
        background: var(--surface-glass);
        border-radius: 28px;
        border: 1px solid var(--border-light);
        box-shadow:
            0 16px 40px var(--shadow-light),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(20px);
        position: relative;
        animation: slideUp 1.6s var(--animation-timing);
    }

    .prayer-intro::before {
        content: '';
        position: absolute;
        top: -1px;
        left: -1px;
        right: -1px;
        bottom: -1px;
        background: linear-gradient(135deg, rgba(15, 86, 255, 0.1) 0%, rgba(74, 144, 226, 0.05) 100%);
        border-radius: 28px;
        z-index: -1;
    }

    .intro-text {
        font-size: 1.25rem;
        font-weight: 400;
        color: #475569;
        line-height: 1.8;
        margin-bottom: 2.5rem;
        text-align: left;
        font-family: 'Inter', sans-serif;
    }

    .prayer-verse {
        margin: 0;
        padding: 2.5rem 3rem;
        background: linear-gradient(135deg, rgba(15, 86, 255, 0.03) 0%, rgba(74, 144, 226, 0.06) 100%);
        border-left: 5px solid var(--primary-blue);
        border-radius: 20px;
        font-style: italic;
        position: relative;
        box-shadow: 0 8px 24px var(--shadow-light);
    }

    .prayer-verse::before {
        content: '"';
        position: absolute;
        top: -10px;
        left: 20px;
        font-size: 4rem;
        color: rgba(15, 86, 255, 0.1);
        font-family: 'Georgia', serif;
    }

    .verse-text {
        font-size: 1.25rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 1rem;
        line-height: 1.7;
        position: relative;
        z-index: 2;
    }

    .verse-citation {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-secondary);
        font-style: normal;
        display: block;
        text-align: right;
        font-family: 'Inter', sans-serif;
    }

    .section-title {
        font-size: clamp(2rem, 4vw, 3rem);
        font-weight: 800;
        color: var(--text-primary);
        margin-bottom: 1.5rem;
        text-align: center;
        letter-spacing: -0.02em;
        line-height: 1.2;
        position: relative;
    }

    .section-title::after {
        content: '';
        position: absolute;
        bottom: -10px;
        left: 50%;
        transform: translateX(-50%);
        width: 60px;
        height: 3px;
        background: var(--gradient-primary);
        border-radius: 2px;
    }

    .section-intro {
        font-size: 1.25rem;
        font-weight: 400;
        color: var(--text-secondary);
        line-height: 1.7;
        margin-bottom: 4rem;
        text-align: center;
        max-width: 900px;
        margin-left: auto;
        margin-right: auto;
    }

    .prayer-opportunities {
        margin-top: 5rem;
    }

    .prayer-cta-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--gradient-primary);
        color: white;
        padding: 1.25rem 3rem;
        border-radius: 20px;
        text-decoration: none;
        font-weight: 700;
        font-size: 1.25rem;
        transition: all 0.4s var(--animation-timing);
        border: none;
        width: 100%;
        text-align: center;
        box-shadow:
            0 8px 24px rgba(15, 86, 255, 0.4),
            0 4px 12px rgba(15, 86, 255, 0.3);
        position: relative;
        overflow: hidden;
        font-family: 'Inter', sans-serif;
        letter-spacing: 0.5px;
        animation: pulse 2s ease-in-out infinite;
    }

    .prayer-cta-primary::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
        transition: left 0.6s ease;
    }

    .prayer-cta-primary:hover::before {
        left: 100%;
    }

    .prayer-cta-primary:hover {
        background: linear-gradient(135deg, var(--primary-blue-dark) 0%, var(--primary-blue) 100%);
        transform: translateY(-4px) scale(1.02);
        box-shadow:
            0 16px 40px rgba(15, 86, 255, 0.5),
            0 8px 20px rgba(15, 86, 255, 0.4);
    }

    .prayer-cta-primary:active {
        transform: translateY(-2px) scale(1.01);
    }

    @keyframes pulse {
        0%, 100% { box-shadow: 0 8px 24px rgba(15, 86, 255, 0.4), 0 4px 12px rgba(15, 86, 255, 0.3); }
        50% { box-shadow: 0 12px 32px rgba(15, 86, 255, 0.5), 0 6px 16px rgba(15, 86, 255, 0.4); }
    }

    .prayer-resources {
        margin-top: 6rem;
        padding: 0;
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.98) 0%, 
            rgba(248, 250, 252, 0.95) 100%);
        border-radius: 40px;
        border: none;
        text-align: center;
        box-shadow:
            0 32px 80px rgba(0, 0, 0, 0.08),
            0 16px 40px rgba(0, 0, 0, 0.06),
            0 8px 20px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        position: relative;
        overflow: hidden;
        isolation: isolate;
    }

    .prayer-resources::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 6px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmerFlow 5s ease-in-out infinite;
        z-index: 3;
    }

    .prayer-resources::after {
        content: '';
        position: absolute;
        top: -45%;
        left: -45%;
        width: 190%;
        height: 190%;
        background: radial-gradient(circle, 
            rgba(15, 86, 255, 0.03) 0%, 
            rgba(74, 144, 226, 0.015) 30%,
            transparent 70%);
        animation: rotate 25s linear infinite;
        pointer-events: none;
    }

    @keyframes rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .resource-links {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 1.75rem;
        margin-top: 0;
        padding: 0 4rem 5rem;
        position: relative;
        z-index: 2;
    }

    .resource-link {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.875rem;
        padding: 2rem 2rem;
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.9) 100%);
        color: var(--primary-blue);
        text-decoration: none;
        border-radius: 24px;
        font-weight: 700;
        font-size: 1.0625rem;
        border: 2px solid var(--border-medium);
        transition: all 0.4s var(--animation-timing);
        backdrop-filter: blur(16px);
        box-shadow: 
            0 8px 24px rgba(0, 0, 0, 0.06),
            0 4px 12px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        position: relative;
        overflow: hidden;
        font-family: 'Inter', sans-serif;
        min-height: 140px;
    }

    .resource-link::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--gradient-primary);
        opacity: 0;
        transition: opacity 0.4s ease;
        z-index: 1;
    }

    .resource-link::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, 
            rgba(255, 255, 255, 0.3) 0%, 
            transparent 70%);
        opacity: 0;
        transition: opacity 0.4s ease;
        z-index: 2;
    }

    .resource-link:hover::before {
        opacity: 1;
    }

    .resource-link:hover::after {
        opacity: 1;
    }

    .link-icon {
        font-size: 2rem;
        position: relative;
        z-index: 3;
        transition: transform 0.4s ease;
    }

    .link-text {
        position: relative;
        z-index: 3;
        transition: color 0.4s ease;
    }

    .resource-link:hover .link-icon {
        transform: scale(1.15) rotate(5deg);
    }

    .resource-link:hover {
        color: white;
        border-color: var(--primary-blue);
        transform: translateY(-6px) scale(1.02);
        box-shadow: 
            0 16px 40px rgba(15, 86, 255, 0.3),
            0 8px 20px rgba(15, 86, 255, 0.2);
    }

    .resource-link:hover .link-text {
        color: white;
    }

    .empty-message {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 1.5rem;
        color: var(--text-primary);
        animation: fadeInUp 1.8s var(--animation-timing);
    }

    .empty-cta {
        color: var(--text-secondary);
        font-size: 1.125rem;
    }

    .empty-cta a {
        color: var(--primary-blue);
        font-weight: 700;
        text-decoration: none;
        transition: all 0.2s ease;
        border-bottom: 2px solid transparent;
        padding-bottom: 2px;
    }

    .empty-cta a:hover {
        border-bottom-color: var(--primary-blue);
        color: var(--primary-blue-dark);
    }

    .disasters-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
        gap: 2.5rem;
        margin-top: 4rem;
    }

    .disaster-card {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 1) 100%);
        border-radius: 32px;
        padding: 0;
        border: none;
        box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.08),
            0 8px 24px rgba(0, 0, 0, 0.06),
            0 4px 12px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        transition: all 0.6s var(--animation-timing);
        position: relative;
        overflow: visible;
        backdrop-filter: blur(20px);
        animation: cardSlideUp 0.8s var(--animation-timing) backwards;
        animation-delay: calc(var(--card-index, 0) * 0.1s);
        isolation: isolate;
    }

    @keyframes cardSlideUp {
        from {
            opacity: 0;
            transform: translateY(40px) scale(0.95);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }

    /* Card top accent bar with gradient */
    .disaster-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 6px;
        background: linear-gradient(90deg, 
            var(--primary-blue) 0%, 
            var(--primary-blue-light) 25%,
            var(--primary-blue) 50%,
            var(--primary-blue-light) 75%,
            var(--primary-blue) 100%);
        background-size: 300% 100%;
        animation: shimmerFlow 4s ease-in-out infinite;
        animation-delay: calc(var(--card-index, 0) * 0.2s);
        z-index: 3;
    }

    @keyframes shimmerFlow {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
    }

    /* Animated gradient overlay on hover */
    .disaster-card::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, 
            rgba(15, 86, 255, 0.08) 0%, 
            rgba(74, 144, 226, 0.04) 30%,
            transparent 70%);
        opacity: 0;
        transition: opacity 0.6s ease, transform 0.6s ease;
        pointer-events: none;
        border-radius: 50%;
        transform: scale(0.5);
    }

    .disaster-card:hover::after {
        opacity: 1;
        transform: scale(1);
    }

    /* Card content wrapper */
    .disaster-card > * {
        position: relative;
        z-index: 2;
    }

    .disaster-card:hover {
        transform: translateY(-16px) scale(1.015);
        box-shadow:
            0 32px 80px rgba(0, 0, 0, 0.12),
            0 16px 40px rgba(0, 0, 0, 0.08),
            0 8px 20px rgba(15, 86, 255, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
    }

    .disaster-card.severe::before,
    .disaster-card.catastrophic::before {
        background: linear-gradient(90deg, 
            #ef4444 0%, 
            #dc2626 25%,
            #ef4444 50%,
            #dc2626 75%,
            #ef4444 100%);
        background-size: 300% 100%;
        height: 6px;
    }

    .disaster-card-header-grouped {
        text-align: center;
        padding: 3rem 2.5rem 2rem;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.5) 100%);
        position: relative;
        margin-bottom: 0;
        overflow: visible;
    }

    .disaster-card-header-grouped::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 80%;
        height: 1px;
        background: linear-gradient(90deg, 
            transparent 0%,
            rgba(15, 86, 255, 0.2) 50%,
            transparent 100%);
    }

    .disaster-type-title {
        font-size: clamp(1.75rem, 3vw, 2.25rem);
        font-weight: 900;
        color: var(--text-primary);
        margin-bottom: 1.5rem;
        letter-spacing: -0.02em;
        line-height: 1.2;
        position: relative;
        display: inline-block;
        transition: all 0.4s ease;
    }

    .disaster-type-title::after {
        content: '';
        position: absolute;
        bottom: -8px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 3px;
        background: var(--gradient-primary);
        border-radius: 2px;
        transition: width 0.4s ease;
    }

    .disaster-card:hover .disaster-type-title::after {
        width: 60%;
    }

    .disaster-card:hover .disaster-type-title {
        background: linear-gradient(135deg, var(--text-primary) 0%, var(--primary-blue-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        transform: scale(1.02);
    }

    .country-flags-group {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.875rem;
        margin-bottom: 1.5rem;
        padding: 2rem 1.5rem 1.25rem;
        background: linear-gradient(135deg, 
            rgba(248, 250, 252, 0.8) 0%, 
            rgba(241, 245, 249, 0.6) 100%);
        border-radius: 20px;
        border: 1px solid rgba(15, 86, 255, 0.08);
        box-shadow: 
            0 4px 12px rgba(0, 0, 0, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(8px);
        position: relative;
        overflow: visible;
    }

    .country-flags-group::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, 
            transparent, 
            rgba(15, 86, 255, 0.05), 
            transparent);
        transition: left 0.6s ease;
    }

    .disaster-card:hover .country-flags-group::before {
        left: 100%;
    }

    .disaster-news-summary {
        font-size: 1.0625rem;
        font-weight: 400;
        color: #475569;
        line-height: 1.75;
        margin: 0;
        padding: 2.5rem 2.5rem;
        background: linear-gradient(135deg, 
            rgba(248, 250, 252, 0.6) 0%, 
            rgba(241, 245, 249, 0.4) 100%);
        border-radius: 0;
        border-left: 5px solid var(--primary-blue);
        border-right: 5px solid transparent;
        text-align: left;
        position: relative;
        transition: all 0.4s ease;
    }

    .disaster-news-summary::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 5px;
        height: 100%;
        background: var(--gradient-primary);
        border-radius: 0 3px 3px 0;
        transition: width 0.4s ease;
    }

    .disaster-card:hover .disaster-news-summary::before {
        width: 8px;
    }

    .disaster-card:hover .disaster-news-summary {
        background: linear-gradient(135deg, 
            rgba(248, 250, 252, 0.8) 0%, 
            rgba(241, 245, 249, 0.6) 100%);
        padding-left: 2.75rem;
    }

    .disaster-card-footer {
        display: flex;
        justify-content: center;
        align-items: center;
        margin-top: 0;
        padding: 2.5rem 2.5rem 3rem;
        border-top: 1px solid rgba(15, 86, 255, 0.08);
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.5) 0%, 
            rgba(255, 255, 255, 0.95) 100%);
        position: relative;
    }

    .disaster-card-footer::before {
        content: '';
        position: absolute;
        top: -1px;
        left: 50%;
        transform: translateX(-50%);
        width: 60%;
        height: 1px;
        background: linear-gradient(90deg, 
            transparent 0%,
            rgba(15, 86, 255, 0.3) 50%,
            transparent 100%);
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
    
    /* Flag tooltip styling */
    .flag-tooltip-wrapper {
        position: relative;
        display: inline-block;
        z-index: 10;
    }
    
    .flag-tooltip {
        visibility: hidden;
        opacity: 0;
        background-color: #1a1a1a;
        color: #ffffff;
        text-align: center;
        padding: 0.5rem 0.9rem;
        border-radius: 6px;
        font-size: 0.85rem;
        font-weight: 500;
        white-space: nowrap;
        position: absolute;
        z-index: 10000;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    
    .flag-tooltip::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border-width: 5px;
        border-style: solid;
        border-color: #1a1a1a transparent transparent transparent;
    }
    
    .flag-tooltip-wrapper:hover .flag-tooltip {
        visibility: visible;
        opacity: 1;
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
    
    .empty-state {
        text-align: center;
        padding: 5rem 2rem;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.98) 100%);
        border-radius: 32px;
        border: 1px solid rgba(15, 86, 255, 0.1);
        color: #1e293b;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.06);
    }
    
    .empty-state p {
        font-size: 1.25rem;
        margin-bottom: 1rem;
        color: #475569;
        font-weight: 500;
    }
    
    .empty-state a {
        color: #0f56ff;
        font-weight: 600;
        text-decoration: none;
        transition: all 0.2s ease;
    }
    
    .empty-state a:hover {
        text-decoration: underline;
        color: #1f3c88;
    }
    
    @media (max-width: 768px) {
        .disasters-grid {
            grid-template-columns: 1fr;
            gap: 1.5rem;
        }
        
        .page-header {
            padding: 2.5rem 1.5rem;
            margin-bottom: 3rem;
        }
        
        .prayer-intro {
            padding: 1.5rem;
        }
        
        .disaster-card {
            padding: 2rem 1.5rem;
        }
        
        .disaster-card-header {
            flex-direction: column;
            align-items: flex-start;
        }
        
        .disasters-page {
            padding: 3rem 1rem 4rem;
        }
        
        .prayer-resources {
            padding: 2.5rem 1.5rem;
        }
        
        .resource-links {
            grid-template-columns: 1fr;
            padding: 0 1.5rem 3rem;
        }
        
        .resource-link {
            width: 100%;
            padding: 1.75rem 1.5rem;
            min-height: 120px;
        }
    }
    
    @media (max-width: 480px) {
        .page-title {
            font-size: 2rem;
        }
        
        .page-subtitle {
            font-size: 1.125rem;
        }
        
        .section-title {
            font-size: 1.5rem;
        }
    }
</style>
<!-- JSON-LD Structured Data for SEO -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Global Prayer Watch",
  "description": "Join believers worldwide in prayer for communities affected by recent disasters. Stand together in prayer with our global prayer watch community.",
  "url": "{{ request.url }}",
  "mainEntity": {
    "@type": "ItemList",
    "itemListElement": [
      {% for disaster in disasters %}
      {
        "@type": "ListItem",
        "position": {{ loop.index }},
        "item": {
          "@type": "WebPage",
          "name": "Prayer for {{ disaster.type_display }}",
          "url": "{{ request.url_root }}globalprayerwatch/{{ disaster.url_slug }}",
          "description": "Prayer for communities affected by {{ disaster.type_display }} in {{ disaster.affected_countries|join(', ') }}"
        }
      }{% if not loop.last %},{% endif %}
      {% endfor %}
    ]
  },
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": "{{ request.url_root }}"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Global Prayer Watch",
        "item": "{{ request.url }}"
      }
    ]
  }
}
</script>
{% endblock %}

{% block content %}
<main class="disasters-page" role="main">
    <div class="disasters-container">
        <header class="page-header">
            <h1 class="page-title">Global Prayer Watch</h1>
            <p class="page-subtitle">Stand Together in Prayer</p>
            <div class="prayer-intro">
                <p class="intro-text">In times of crisis, we come together as one body in Christ, lifting up our brothers and sisters around the world. Here you'll find specific prayers for communities currently facing hardship, that we might intercede with compassion and hope.</p>
                <blockquote class="prayer-verse" cite="https://www.biblegateway.com/passage/?search=Philippians+4%3A6&version=NIV">
                    <p class="verse-text">"Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God."</p>
                    <cite class="verse-citation">— Philippians 4:6</cite>
                </blockquote>
            </div>
        </header>
        
        {% if disasters %}
        <section class="prayer-opportunities" aria-label="Current prayer opportunities">
            <header class="section-header">
                <h2 class="section-title">Communities Needing Our Prayers</h2>
                <p class="section-intro">Join us in lifting up these affected communities. Each prayer is crafted specifically for their situation, that we might intercede with understanding and compassion.</p>
            </header>

            <div class="disasters-grid" role="list">
                {% for disaster in disasters %}
                <article class="disaster-card {{ disaster.severity }}" itemscope itemtype="https://schema.org/Event" role="listitem" style="--card-index: {{ loop.index0 }}">
                    <header class="disaster-card-header-grouped">
                        <h3 class="disaster-type-title" itemprop="name">{{ disaster.type_display }}</h3>
                        <div class="country-flags-group" aria-label="Affected countries">
                            {% for flag_info in disaster.country_flags %}
                            <div class="flag-tooltip-wrapper">
                                <img src="/api/flags/{{ flag_info.flag_code }}"
                                     alt="{{ flag_info.country }} flag"
                                     class="country-flag-small"
                                     title="{{ flag_info.country }}"
                                     data-country="{{ flag_info.country }}"
                                     style="width: 32px; height: 24px; object-fit: fill; display: block; animation: none !important; transform: none !important; transition: none !important; border-radius: 0 !important; filter: none !important; border: none !important; box-shadow: none !important; will-change: auto !important; backface-visibility: visible !important; perspective: none !important; -webkit-transform: none !important; cursor: pointer;"
                                     onerror="this.src='/api/flags/xx';">
                                <span class="flag-tooltip">{{ flag_info.country }}</span>
                            </div>
                            {% endfor %}
                        </div>
                    </header>

                    {% if disaster.summary %}
                    <div class="disaster-news-summary" itemprop="description">
                        {{ disaster.summary }}
                    </div>
                    {% endif %}

                    <footer class="disaster-card-footer">
                        <a href="/globalprayerwatch/{{ disaster.url_slug }}" class="prayer-cta-primary" aria-label="Join in prayer for {{ disaster.type_display }}">
                            <span class="cta-text">Join in Prayer</span>
                            <svg class="cta-arrow" width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8.5 13.5L13.5 8.5M13.5 8.5H10.1667M13.5 8.5V11.8333" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </a>
                    </footer>
                </article>
                {% endfor %}
            </div>
        </section>
        {% else %}
        <section class="empty-state" aria-label="No current prayer needs" role="status">
            <div class="empty-content">
                <div class="empty-icon">🙏</div>
                <h2 class="empty-title">Praise God</h2>
                <p class="empty-message">No breaking disasters requiring immediate prayer in recent hours.</p>
                <p class="empty-cta">Continue in prayer with our <a href="/prayers">daily global prayer</a> covering ongoing needs worldwide.</p>
            </div>
        </section>
        {% endif %}
        
        <section class="prayer-resources" aria-label="Additional prayer resources">
            <header class="section-header">
                <h2 class="section-title">Continue in Prayer Together</h2>
                <p class="section-intro">Prayer is a gift we share as the body of Christ. Whether you're seeking prayer or want to join others in intercession, we're here to walk alongside you.</p>
            </header>
            <nav class="resource-links" aria-label="Prayer resources">
                <a href="/prayers" class="resource-link">
                    <span class="link-icon">🙏</span>
                    <span class="link-text">Daily Global Prayer</span>
                </a>
                <a href="/prayers" class="resource-link">
                    <span class="link-icon">👥</span>
                    <span class="link-text">Join Prayer Room</span>
                </a>
                <a href="/home#organizations" class="resource-link">
                    <span class="link-icon">🤝</span>
                    <span class="link-text">Find Relief Organizations</span>
                </a>
            </nav>
        </section>
    </div>
</main>
{% endblock %}
'''

