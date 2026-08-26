"""Server-rendered web pages and related helpers."""

from backend.web.card_bp import card_bp
from backend.web.health_bp import health_bp
from backend.web.pages_bp import pages_bp

__all__ = ["pages_bp", "card_bp", "health_bp"]
