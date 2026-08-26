"""seo sitemap routes."""
from backend.api.seo._blueprint import seo_bp
from flask import request, make_response, jsonify
from datetime import datetime, timedelta
from backend.api.seo.helpers import logger


@seo_bp.route("/sitemap.xml")
def sitemap():
    """Generate dynamic sitemap with all pages, prayers, and disaster-specific pages"""
    try:
        from flask import current_app

        # Get base URL (force HTTPS for production)
        base_url = request.url_root.rstrip("/")
        # Cloud Run is behind load balancer, always use HTTPS for production
        if "divinebridge.io" in base_url or "run.app" in base_url:
            base_url = base_url.replace("http://", "https://")

        # Build sitemap XML
        xml_content = ['<?xml version="1.0" encoding="UTF-8"?>']
        xml_content.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')

        # Static pages - Public pages only (exclude auth/profile pages)
        static_pages = [
            ("/", "1.0", "daily"),  # Home page
            ("/home", "0.9", "daily"),  # Main home page with daily content
            ("/prayers", "1.0", "daily"),  # Prayer Room - main feature
            ("/prayer-room", "0.9", "daily"),  # Live Prayer Room directory
            ("/daily-prayer", "0.95", "daily"),  # Daily prayer dedicated page
            ("/globalprayerwatch", "0.9", "daily"),  # Global Prayer Watch hub (SEO discovery page)
            ("/about", "0.7", "monthly"),  # About page
            ("/contact", "0.6", "monthly"),  # Contact page
            ("/faq", "0.6", "monthly"),  # FAQ page
            ("/privacy-policy", "0.3", "yearly"),  # Privacy policy
            ("/terms-of-service", "0.3", "yearly"),  # Terms of service
        ]

        for path, priority, changefreq in static_pages:
            xml_content.append("  <url>")
            xml_content.append(f"    <loc>{base_url}{path}</loc>")
            xml_content.append(f"    <changefreq>{changefreq}</changefreq>")
            xml_content.append(f"    <priority>{priority}</priority>")
            xml_content.append(f'    <lastmod>{datetime.now().strftime("%Y-%m-%d")}</lastmod>')
            xml_content.append("  </url>")

        # Daily prayers (last 30 days)
        storage_handler = current_app.storage_handler
        today = datetime.now()

        for i in range(30):
            date = today - timedelta(days=i)
            date_str = date.strftime("%Y-%m-%d")

            try:
                prayer = storage_handler.get_prayer(date_str)
                if prayer:
                    xml_content.append("  <url>")
                    xml_content.append(f"    <loc>{base_url}/prayers/daily/{date_str}</loc>")
                    xml_content.append("    <changefreq>weekly</changefreq>")
                    xml_content.append("    <priority>0.9</priority>")
                    xml_content.append(f"    <lastmod>{date_str}</lastmod>")
                    xml_content.append("  </url>")

                    # If prayer has disaster metadata, create disaster-specific URLs
                    # Note: Using /globalprayerwatch/{type} format (no location) to match actual route
                    if isinstance(prayer, dict) and "metadata" in prayer:
                        metadata = prayer["metadata"]
                        disasters = metadata.get("disasters", [])

                        # Track disaster types we've already added (deduplicate by type)
                        added_disaster_types = set()

                        for disaster in disasters:
                            if disaster.get("type"):
                                disaster_type = disaster["type"].lower().replace(" ", "-").replace("_", "-")

                                # Only add each disaster type once (deduplicate)
                                if disaster_type not in added_disaster_types:
                                    added_disaster_types.add(disaster_type)

                                    xml_content.append("  <url>")
                                    xml_content.append(f"    <loc>{base_url}/globalprayerwatch/{disaster_type}</loc>")
                                    xml_content.append("    <changefreq>weekly</changefreq>")
                                    xml_content.append(
                                        "    <priority>0.95</priority>"
                                    )  # High priority for current events
                                    xml_content.append(f"    <lastmod>{date_str}</lastmod>")
                                    xml_content.append("  </url>")
            except Exception as e:
                logger.warning(f"Error adding prayer {date_str} to sitemap: {e}")
                continue

        xml_content.append("</urlset>")

        # Create response
        response = make_response("\n".join(xml_content))
        response.headers["Content-Type"] = "application/xml; charset=utf-8"
        return response

    except Exception as e:
        logger.error(f"Error generating sitemap: {e}")
        return jsonify({"error": "Failed to generate sitemap"}), 500
