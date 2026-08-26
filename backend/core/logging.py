"""Structured logging configuration for the Flask runtime."""

import json
import logging
import logging.config
import os
from datetime import datetime


class CloudRunFormatter(logging.Formatter):
    """Serialize application logs into the Cloud Run-friendly JSON shape."""

    def format(self, record):
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "function": record.funcName,
            "line": record.lineno,
        }

        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id

        if record.exc_info:
            log_entry["error"] = self.formatException(record.exc_info)

        return json.dumps(log_entry)


def setup_logging():
    """Configure logging for the application."""
    config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "cloud_run": {"()": CloudRunFormatter},
            "standard": {"format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s"},
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "cloud_run"
                if os.getenv("FLASK_ENV") == "production" or os.getenv("K_SERVICE")
                else "standard",
                "stream": "ext://sys.stdout",
            }
        },
        "loggers": {
            "app": {"handlers": ["console"], "level": "INFO", "propagate": False},
            "firebase_auth": {"handlers": ["console"], "level": "INFO", "propagate": False},
            "storage_handler": {"handlers": ["console"], "level": "INFO", "propagate": False},
        },
        "root": {"level": "INFO", "handlers": ["console"]},
    }

    logging.config.dictConfig(config)

    return {
        "app": logging.getLogger("app"),
        "firebase_auth": logging.getLogger("firebase_auth"),
        "storage_handler": logging.getLogger("storage_handler"),
    }
