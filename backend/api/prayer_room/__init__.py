"""Prayer-room API package."""

from backend.api.prayer_room._blueprint import prayer_room_bp

# Import route modules for side-effect registration on prayer_room_bp.
from backend.api.prayer_room import media as media  # noqa: F401
from backend.api.prayer_room import voice_link as voice_link  # noqa: F401
from backend.api.prayer_room import lifecycle as lifecycle  # noqa: F401
from backend.api.prayer_room import participants as participants  # noqa: F401
from backend.api.prayer_room import chat as chat  # noqa: F401
from backend.api.prayer_room import rooms as rooms  # noqa: F401
from backend.api.prayer_room import scheduled as scheduled  # noqa: F401
from backend.api.prayer_room import subscriptions as subscriptions  # noqa: F401

__all__ = ["prayer_room_bp"]
