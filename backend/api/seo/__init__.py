"""SEO / marketing pages API package."""

from backend.api.seo._blueprint import seo_bp

from backend.api.seo import sitemap as sitemap  # noqa: F401
from backend.api.seo import disasters_api as disasters_api  # noqa: F401
from backend.api.seo import disasters_hub as disasters_hub  # noqa: F401
from backend.api.seo import disaster_page as disaster_page  # noqa: F401
from backend.api.seo import group_invite as group_invite  # noqa: F401

__all__ = ["seo_bp"]
