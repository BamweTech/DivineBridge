"""
AI-Powered Content Moderation for Divine Bridge
Uses Perplexity AI to review prayer requests and testimonies
"""

import json
import logging
from typing import Dict, Tuple
from perplexity_client import get_perplexity_client, set_client_model

logger = logging.getLogger(__name__)


class ContentModerator:
    """AI-powered content moderation using Perplexity"""
    
    # Content guidelines from Terms of Service 4.3
    CONTENT_GUIDELINES = """
    Content must NOT contain:
    - Personal information (phone numbers, addresses, emails, full names of minors)
    - Spam or advertisements
    - Hate speech or discrimination based on race, religion, gender, etc.
    - Harassment, threats, insults, slurs, personal attacks, trolling, or profanity used to demean others
    - Sexual or explicit content
    - Violence or self-harm content
    - Illegal activities or encouragement thereof
    - Misinformation or false health claims
    - Copyright infringement
    - Political campaigning or propaganda
    - Content that is clearly NOT appropriate for a community prayer wall (e.g. random memes/jokes with no prayer intent,
      unrelated debates, pure chit-chat, link spam, or other off-topic material with no request for prayer, intercession,
      thanksgiving, or faith-related sharing)
    """
    
    def __init__(self):
        """Initialize the ContentModerator with Perplexity client"""
        try:
            self.client = get_perplexity_client()
            # Use faster sonar model for moderation
            set_client_model("sonar")
            logger.info("ContentModerator initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing ContentModerator: {e}")
            raise
    
    def moderate_content(self, title: str, content: str, content_type: str = "prayer") -> Tuple[bool, str, str]:
        """
        Moderate prayer request or testimony content using AI
        
        Args:
            title: Content title
            content: Full content text
            content_type: "prayer" or "testimony"
        
        Returns:
            Tuple of (approved: bool, reason: str, summary: str)
            - approved: True if content passes guidelines
            - reason: Explanation if not approved, empty if approved
            - summary: AI-generated summary of the content
        """
        try:
            wall_task = ""
            if content_type == "prayer wall":
                wall_task = """
TASK 1b - PRAYER WALL FIT (only for prayer wall submissions):
Is this a genuine prayer request, intercession for others, thanksgiving, or faith-related plea suitable for a community prayer wall?
Reject (approved: false) only if it is clearly not prayer-related or clearly abusive per the guidelines above.
"""

            prompt = f"""You are reviewing a {content_type} submission for a Christian prayer platform.

TITLE (internal label, may be auto-derived): {title}

CONTENT:
{content}

TASK 1 - CONTENT MODERATION:
Review if this content violates ANY of these guidelines:
{self.CONTENT_GUIDELINES}
{wall_task}
TASK 2 - GENERATE SUMMARY:
If content is appropriate, create a brief 1-2 sentence summary.

RESPOND IN THIS EXACT JSON FORMAT:
{{
  "approved": true/false,
  "violation_type": "specific violation if any, or null",
  "reason": "brief explanation if not approved, or empty string",
  "summary": "1-2 sentence summary of the content"
}}

Guidelines:
- Be lenient and gracious - only reject clear violations
- Personal struggles, raw emotion, anger directed at God, health issues, and requests for help are ALLOWED
- Short or simple genuine prayers are ALLOWED
- General location mentions (city/country) are ALLOWED
- Specific addresses, phone numbers, emails are NOT ALLOWED
- Focus on protecting users while allowing genuine prayer/testimony sharing
"""

            response = self.client.query(prompt)
            
            # Parse JSON response
            # Clean response
            response = response.strip()
            if response.startswith('```'):
                response = response.split('```')[1]
                if response.startswith('json'):
                    response = response[4:]
                response = response.strip()
            
            result = json.loads(response)
            
            approved = result.get('approved', False)
            reason = result.get('reason', '')
            summary = result.get('summary', '')
            violation_type = result.get('violation_type')
            
            if not approved:
                logger.warning(f"{content_type.capitalize()} rejected: {violation_type} - {reason}")
            else:
                logger.info(f"{content_type.capitalize()} approved with summary: {summary[:50]}...")
            
            return approved, reason, summary
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse moderation response: {e}")
            logger.error(f"Raw response: {response}")
            # On parse error, auto-approve but log for manual review
            return True, "", self._generate_fallback_summary(content)
            
        except Exception as e:
            logger.error(f"Error moderating content: {e}")
            # On error, auto-approve but log for manual review
            return True, "", self._generate_fallback_summary(content)
    
    def _generate_fallback_summary(self, content: str) -> str:
        """Generate a simple fallback summary if AI fails"""
        # Take first 100 characters as summary
        summary = content[:100]
        if len(content) > 100:
            # Try to end at a sentence
            last_period = summary.rfind('.')
            if last_period > 50:
                summary = summary[:last_period + 1]
            else:
                summary += '...'
        return summary


# Singleton instance
_content_moderator = None

def get_content_moderator():
    """Get or create the content moderator singleton"""
    global _content_moderator
    if _content_moderator is None:
        _content_moderator = ContentModerator()
    return _content_moderator

