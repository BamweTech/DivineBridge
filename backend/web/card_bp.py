"""Business card API and OG image routes."""
import io
import logging
import traceback
from datetime import datetime
from io import BytesIO

import qrcode
from firebase_admin import firestore
from flask import Blueprint, Response, current_app, jsonify, request, send_file

from backend.services.prayer.image_generator import get_image_generator

card_bp = Blueprint("card_api", __name__)
logger = logging.getLogger(__name__)


@card_bp.route("/api/og-image")
def og_image():
    """Serve today's prayer image for Open Graph / social media preview"""
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        storage_handler = current_app.storage_handler

        cached_image = storage_handler.get_prayer_image(today)
        if cached_image:
            logger.info(f"Serving cached prayer image for OG preview: {today}")
            return send_file(
                BytesIO(cached_image),
                mimetype="image/jpeg",
                as_attachment=False,
                download_name=f"divine_bridge_og_{today}.jpg",
            )

        prayer = storage_handler.get_prayer(today)
        if not prayer:
            logger.warning(f"No prayer found for OG image: {today}")
            return jsonify({"error": "No prayer available"}), 404

        if isinstance(prayer, dict):
            prayer_content = prayer.get("content", "")
        else:
            prayer_content = prayer

        if not prayer_content:
            return jsonify({"error": "Prayer content is empty"}), 404

        generator = get_image_generator()
        date_str = datetime.now().strftime("%B %d, %Y")
        image_data = generator.generate_prayer_image(prayer_text=prayer_content, date=date_str)

        image_bytes = image_data.getvalue()
        storage_handler.save_prayer_image(today, image_bytes)
        logger.info(f"Generated and cached prayer image for OG preview: {today}")

        image_data.seek(0)
        return send_file(
            image_data, mimetype="image/jpeg", as_attachment=False, download_name=f"divine_bridge_og_{today}.jpg"
        )

    except Exception as e:
        logger.error(f"Error serving OG image: {e}")
        return jsonify({"error": "Failed to generate OG image"}), 500


@card_bp.route("/api/card/<user_id>/vcard")
def get_vcard(user_id):
    """Generate and download vCard file for user's business card"""
    try:
        db = firestore.client()
        user_ref = db.collection("users").document(user_id)
        user_doc = user_ref.get()

        if not user_doc.exists:
            return jsonify({"error": "User not found"}), 404

        user_data = user_doc.to_dict()

        if not user_data.get("businessCardEnabled", False):
            return jsonify({"error": "Business card not available"}), 404

        first_name = user_data.get("firstName", "")
        last_name = user_data.get("lastName", "")
        email = user_data.get("email", "")
        phone = user_data.get("phoneNumber", "")
        linkedin = user_data.get("linkedin", "")

        vcard_lines = ["BEGIN:VCARD", "VERSION:3.0"]

        if first_name or last_name:
            vcard_lines.append(f"N:{last_name};{first_name};;;")
            vcard_lines.append(f"FN:{first_name} {last_name}".strip())

        if email:
            vcard_lines.append(f"EMAIL;TYPE=INTERNET:{email}")

        if phone:
            phone_clean = "".join(filter(str.isdigit, phone))
            vcard_lines.append(f"TEL;TYPE=CELL:{phone_clean}")

        if linkedin:
            vcard_lines.append(f"URL:{linkedin}")

        vcard_lines.append("URL;TYPE=WORK:https://divinebridge.io")
        vcard_lines.append("END:VCARD")

        vcard_content = "\n".join(vcard_lines)

        return Response(
            vcard_content,
            mimetype="text/vcard",
            headers={"Content-Disposition": f'attachment; filename="{first_name}_{last_name}.vcf"'.replace(" ", "_")},
        )

    except Exception as e:
        logger.error(f"Error generating vCard: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to generate vCard"}), 500


@card_bp.route("/api/card/<user_id>/qr")
def get_qr_code(user_id):
    """Generate QR code image for user's business card"""
    try:
        db = firestore.client()
        user_ref = db.collection("users").document(user_id)
        user_doc = user_ref.get()

        if not user_doc.exists:
            logger.warning(f"QR code requested for non-existent user: {user_id}")
            return jsonify({"error": "User not found"}), 404

        user_doc.to_dict()

        request_url = request.url_root.rstrip("/")
        card_url = f"{request_url}/card/{user_id}"

        try:
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=4,
            )
            qr.add_data(card_url)
            qr.make(fit=True)

            img = qr.make_image(fill_color="black", back_color="white")

            img_bytes = io.BytesIO()
            img.save(img_bytes, format="PNG")
            img_bytes.seek(0)

            logger.info(f"Successfully generated QR code for user: {user_id}")
            return send_file(img_bytes, mimetype="image/png", as_attachment=False)
        except Exception as qr_error:
            logger.error(f"Error in QR code generation: {qr_error}")
            logger.error(traceback.format_exc())
            return jsonify({"error": "Failed to generate QR code image"}), 500

    except Exception as e:
        logger.error(f"Error generating QR code: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to generate QR code"}), 500


@card_bp.route("/api/card/<user_id>")
def get_card_data(user_id):
    """Get public business card data (for API access)"""
    try:
        db = firestore.client()
        user_ref = db.collection("users").document(user_id)
        user_doc = user_ref.get()

        if not user_doc.exists:
            return jsonify({"error": "User not found"}), 404

        user_data = user_doc.to_dict()

        if not user_data.get("businessCardEnabled", False):
            return jsonify({"error": "Business card not available"}), 404

        card_data = {
            "firstName": user_data.get("firstName", ""),
            "lastName": user_data.get("lastName", ""),
            "email": user_data.get("email", ""),
            "phoneNumber": user_data.get("phoneNumber", ""),
            "linkedin": user_data.get("linkedin", ""),
        }

        return jsonify(card_data), 200

    except Exception as e:
        logger.error(f"Error getting card data: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to get card data"}), 500
