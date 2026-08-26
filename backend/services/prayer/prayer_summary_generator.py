"""
Prayer Summary Generator for Divine Bridge
Generates concise summaries of prayer requests using AI.
"""

import logging
from backend.integrations.perplexity_client import get_perplexity_client, set_client_model

logger = logging.getLogger(__name__)


class PrayerSummaryGenerator:
    """Generate summaries for prayer requests using AI"""

    def __init__(self):
        """Initialize the PrayerSummaryGenerator"""
        try:
            # Use shared Perplexity client (avoids test query overhead)
            self.client = get_perplexity_client()
            # Use fastest, cheapest model for simple text summarization
            set_client_model("sonar")
            logger.info("PrayerSummaryGenerator initialized successfully (using sonar model)")

        except Exception as e:
            logger.error(f"Error initializing PrayerSummaryGenerator: {e}")
            raise

    def generate_summary(self, title: str, content: str) -> str:
        """
        Generate a concise 1-2 sentence summary of a prayer request

        Args:
            title: Prayer request title
            content: Full prayer request content

        Returns:
            Summary string (1-2 sentences)
        """
        try:
            prompt = f"""Summarize this prayer request in 1-2 sentences (max 100 characters).

Title: {title}
Content: {content}

Return ONLY the summary text, no quotes, no explanation."""

            response = self.client.query(prompt)

            # Clean up response
            summary = response.strip()

            # Remove quotes if present
            if summary.startswith('"') and summary.endswith('"'):
                summary = summary[1:-1]
            if summary.startswith("'") and summary.endswith("'"):
                summary = summary[1:-1]

            # Limit to 150 characters max
            if len(summary) > 150:
                summary = summary[:147] + "..."

            logger.debug(f"Generated summary: {summary}")
            return summary

        except Exception as e:
            logger.error(f"Error generating summary: {e}")
            # Fallback: use first 100 characters of content
            fallback = content[:97] + "..." if len(content) > 100 else content
            logger.info(f"Using fallback summary: {fallback}")
            return fallback


# Singleton instance
_summary_generator_instance = None


def get_summary_generator():
    """Get the summary generator (singleton pattern)"""
    global _summary_generator_instance
    if _summary_generator_instance is None:
        _summary_generator_instance = PrayerSummaryGenerator()
    return _summary_generator_instance
