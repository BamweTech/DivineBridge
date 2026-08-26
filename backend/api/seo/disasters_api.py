"""seo disasters_api routes."""
from backend.api.seo._blueprint import seo_bp
from flask import request, jsonify
from backend.core.auth.decorators import verify_cloud_scheduler
from backend.api.seo.helpers import logger


@seo_bp.route("/api/disasters/organizations", methods=["GET"])
def get_disaster_organizations():
    """API endpoint to fetch organizations for a disaster type and affected countries"""
    try:
        from backend.services.community.nonprofit_service import get_nonprofit_service

        disaster_type = request.args.get("type", "")
        countries = request.args.get("countries", "")

        if not disaster_type or not countries:
            return jsonify({"error": "Missing required parameters: type and countries"}), 400

        # Parse countries (comma-separated)
        affected_countries = [c.strip() for c in countries.split(",") if c.strip()]

        if not affected_countries:
            return jsonify({"error": "No valid countries provided"}), 400

        # Get nonprofit service
        nonprofit_service = get_nonprofit_service()

        # Create disaster dict for organization lookup
        disaster_dict = {"type": disaster_type.lower(), "locations": affected_countries, "details": ""}

        # Use first country as primary location for organization search
        primary_location = affected_countries[0]
        logger.info(f"Fetching organizations for {disaster_type} in {primary_location}")

        disaster_orgs = nonprofit_service._get_disaster_organizations(disaster_dict)
        # Limit to 3 organizations
        organizations = disaster_orgs[:3] if disaster_orgs else []

        logger.info(f"Found {len(organizations)} organizations for {disaster_type}")

        return (
            jsonify({"organizations": organizations, "disaster_type": disaster_type, "countries": affected_countries}),
            200,
        )

    except Exception as e:
        logger.error(f"Error fetching organizations for disaster: {e}", exc_info=True)
        return jsonify({"error": "Failed to fetch organizations"}), 500


@seo_bp.route("/api/disasters/generate-hourly", methods=["POST"])
@verify_cloud_scheduler()
def generate_hourly_disaster_prayers():
    """
    Hourly endpoint to search for breaking disasters and generate customized prayers
    Triggered by Cloud Scheduler every hour
    """
    try:
        from flask import current_app
        from backend.services.disaster.disaster_prayer_service import get_disaster_prayer_service

        logger.info("Cloud Scheduler triggered hourly disaster prayer generation")

        # Get disaster prayer service
        service = get_disaster_prayer_service(current_app.storage_handler)

        # Process breaking disasters
        result = service.process_hourly_disasters()

        if result.get("success"):
            logger.info(f"Hourly processing complete: {result.get('prayers_generated', 0)} prayers generated")
            return (
                jsonify(
                    {
                        "success": True,
                        "disasters_found": result.get("disasters_found", 0),
                        "prayers_generated": result.get("prayers_generated", 0),
                    }
                ),
                200,
            )
        else:
            logger.error(f"Hourly processing failed: {result.get('error')}")
            return jsonify({"success": False, "error": result.get("error", "Unknown error")}), 500

    except Exception as e:
        logger.error(f"Error in hourly disaster prayer generation: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
