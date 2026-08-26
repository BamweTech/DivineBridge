"""Production-safe Flask entry point.

`app.py` remains the compatibility entry point while modules are migrated into
the backend package. Both entries expose the exact same application instance.
"""

from app import app, create_app

__all__ = ["app", "create_app"]
