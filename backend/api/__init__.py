"""Canonical Flask API blueprint package."""

from .admin_bp import admin_bp
from .auth_bp import auth_bp
from .devotional_bp import devotional_bp
from .email_bp import email_bp
from .groups_bp import groups_bp
from .nonprofit_bp import nonprofit_bp
from .prayer_bp import prayer_bp
from .prayer_room import prayer_room_bp
from .seo import seo_bp
from .testimony_bp import testimony_bp
from .verse_bp import verse_bp

__all__ = [
    "admin_bp",
    "auth_bp",
    "devotional_bp",
    "email_bp",
    "groups_bp",
    "nonprofit_bp",
    "prayer_bp",
    "prayer_room_bp",
    "seo_bp",
    "testimony_bp",
    "verse_bp",
]
