"""SEO / disaster page helpers."""
"""
SEO Blueprint - Sitemap, structured data, and SEO optimization
"""
import logging
import re


logger = logging.getLogger(__name__)


def _clean_citation_markers(text: str) -> str:
    """Remove citation markers like [1][2] from text"""
    if not text:
        return text
    # Remove citation markers [1], [2], etc.
    cleaned = re.sub(r"\[\d+\]", "", text)
    # Clean up multiple spaces
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def get_country_flag_code(country_name: str) -> str:
    """
    Convert country name to ISO 3166-1 alpha-2 code for flag API
    Common country name mappings
    """
    country_mapping = {
        "united states": "us",
        "united states of america": "us",
        "usa": "us",
        "united kingdom": "gb",
        "uk": "gb",
        "south korea": "kr",
        "north korea": "kp",
        "russia": "ru",
        "russian federation": "ru",
        "philippines": "ph",
        "japan": "jp",
        "china": "cn",
        "india": "in",
        "brazil": "br",
        "mexico": "mx",
        "canada": "ca",
        "australia": "au",
        "germany": "de",
        "france": "fr",
        "italy": "it",
        "spain": "es",
        "netherlands": "nl",
        "belgium": "be",
        "switzerland": "ch",
        "austria": "at",
        "sweden": "se",
        "norway": "no",
        "denmark": "dk",
        "finland": "fi",
        "poland": "pl",
        "czech republic": "cz",
        "greece": "gr",
        "portugal": "pt",
        "ireland": "ie",
        "new zealand": "nz",
        "south africa": "za",
        "egypt": "eg",
        "nigeria": "ng",
        "kenya": "ke",
        "ethiopia": "et",
        "tanzania": "tz",
        "uganda": "ug",
        "ghana": "gh",
        "morocco": "ma",
        "algeria": "dz",
        "tunisia": "tn",
        "libya": "ly",
        "sudan": "sd",
        "angola": "ao",
        "mozambique": "mz",
        "madagascar": "mg",
        "cameroon": "cm",
        "ivory coast": "ci",
        "niger": "ne",
        "burkina faso": "bf",
        "mali": "ml",
        "malawi": "mw",
        "zambia": "zm",
        "zimbabwe": "zw",
        "senegal": "sn",
        "chad": "td",
        "somalia": "so",
        "guinea": "gn",
        "rwanda": "rw",
        "benin": "bj",
        "burundi": "bi",
        "togo": "tg",
        "sierra leone": "sl",
        "liberia": "lr",
        "central african republic": "cf",
        "mauritania": "mr",
        "eritrea": "er",
        "gambia": "gm",
        "botswana": "bw",
        "namibia": "na",
        "gabon": "ga",
        "lesotho": "ls",
        "guinea-bissau": "gw",
        "equatorial guinea": "gq",
        "mauritius": "mu",
        "eswatini": "sz",
        "djibouti": "dj",
        "comoros": "km",
        "cape verde": "cv",
        "sao tome and principe": "st",
        "seychelles": "sc",
        "indonesia": "id",
        "thailand": "th",
        "vietnam": "vn",
        "malaysia": "my",
        "singapore": "sg",
        "myanmar": "mm",
        "cambodia": "kh",
        "laos": "la",
        "bangladesh": "bd",
        "pakistan": "pk",
        "sri lanka": "lk",
        "nepal": "np",
        "bhutan": "bt",
        "maldives": "mv",
        "afghanistan": "af",
        "iran": "ir",
        "iraq": "iq",
        "israel": "il",
        "palestine": "ps",
        "jordan": "jo",
        "lebanon": "lb",
        "syria": "sy",
        "saudi arabia": "sa",
        "united arab emirates": "ae",
        "uae": "ae",
        "qatar": "qa",
        "kuwait": "kw",
        "bahrain": "bh",
        "oman": "om",
        "yemen": "ye",
        "turkey": "tr",
        "azerbaijan": "az",
        "armenia": "am",
        "georgia": "ge",
        "kazakhstan": "kz",
        "uzbekistan": "uz",
        "turkmenistan": "tm",
        "kyrgyzstan": "kg",
        "tajikistan": "tj",
        "mongolia": "mn",
        "taiwan": "tw",
        "hong kong": "hk",
        "macau": "mo",
        "north macedonia": "mk",
        "bosnia and herzegovina": "ba",
        "croatia": "hr",
        "serbia": "rs",
        "montenegro": "me",
        "albania": "al",
        "kosovo": "xk",
        "moldova": "md",
        "belarus": "by",
        "ukraine": "ua",
        "estonia": "ee",
        "latvia": "lv",
        "lithuania": "lt",
        "slovenia": "si",
        "slovakia": "sk",
        "hungary": "hu",
        "romania": "ro",
        "bulgaria": "bg",
        "cuba": "cu",
        "jamaica": "jm",
        "haiti": "ht",
        "dominican republic": "do",
        "puerto rico": "pr",
        "trinidad and tobago": "tt",
        "barbados": "bb",
        "bahamas": "bs",
        "belize": "bz",
        "costa rica": "cr",
        "panama": "pa",
        "nicaragua": "ni",
        "honduras": "hn",
        "el salvador": "sv",
        "guatemala": "gt",
        "colombia": "co",
        "venezuela": "ve",
        "ecuador": "ec",
        "peru": "pe",
        "bolivia": "bo",
        "paraguay": "py",
        "uruguay": "uy",
        "chile": "cl",
        "argentina": "ar",
        "guyana": "gy",
        "suriname": "sr",
        "french guiana": "gf",
        "fiji": "fj",
        "papua new guinea": "pg",
        "new caledonia": "nc",
        "french polynesia": "pf",
        "samoa": "ws",
        "tonga": "to",
        "vanuatu": "vu",
        "solomon islands": "sb",
        "micronesia": "fm",
        "palau": "pw",
        "marshall islands": "mh",
        "kiribati": "ki",
        "nauru": "nr",
        "tuvalu": "tv",
    }

    # Normalize country name
    country_lower = country_name.lower().strip()

    # Check mapping first
    if country_lower in country_mapping:
        return country_mapping[country_lower]

    # If it's already a 2-letter code, return as-is
    if len(country_lower) == 2:
        return country_lower

    # Try to extract from common patterns
    # For multi-word countries, try first word or common abbreviation
    words = country_lower.split()
    if words:
        # Try first word
        if words[0] in country_mapping:
            return country_mapping[words[0]]

    # Default: return lowercase first two letters (not ideal but better than nothing)
    return country_lower[:2] if len(country_lower) >= 2 else "xx"


def _generate_disaster_prayer(disaster_type, location):
    """Generate a short, specific prayer for a disaster and location (50-100 words)"""
    try:
        from backend.integrations.perplexity_client import get_perplexity_client, set_client_model

        client = get_perplexity_client()
        set_client_model("sonar")  # Fast model for short prayers

        prompt = f"""Write a heartfelt Christian prayer for those affected by {disaster_type} in {location}.

REQUIREMENTS:
- Start with "Heavenly Father,"
- Length: 100-150 words (detailed but concise)
- Mention {location} and {disaster_type} specifically
- Address specific needs:
  * Those who lost homes, loved ones, or possessions
  * Families separated or in fear
  * Children who are scared and traumatized
  * Rescue workers and first responders
  * Medical teams and aid workers
  * Government leaders making decisions
  * Community healing and rebuilding
- Include a brief biblical reference or promise (no citation needed)
- End with "In Jesus' name, Amen."
- Compassionate, specific, and heartfelt tone
- Write as if leading a prayer gathering
- NO explanations, NO thinking tags, just the prayer text

Return ONLY the prayer text, nothing else."""

        response = client.query(prompt)

        # Clean the response - remove any <think> tags
        import re

        prayer = re.sub(r"<think>.*?</think>", "", response, flags=re.DOTALL).strip()

        # Ensure it starts correctly
        if not prayer.startswith("Heavenly Father"):
            prayer = "Heavenly Father, " + prayer

        # Ensure it ends correctly
        if not prayer.endswith("Amen.") and not prayer.endswith("Amen"):
            if "In Jesus' name" not in prayer:
                prayer = prayer.rstrip(".") + ". In Jesus' name, Amen."

        # Validate length (60-150 words)
        word_count = len(prayer.split())
        if word_count < 60 or word_count > 160:
            logger.warning(f"Disaster prayer word count out of range: {word_count} words")
            raise ValueError("Prayer length invalid")

        logger.info(f"Generated disaster prayer for {disaster_type}/{location}: {word_count} words")
        return prayer

    except Exception as e:
        logger.warning(f"Using fallback prayer for {disaster_type}/{location}: {e}")
        # Return a more detailed compassionate fallback prayer
        return f"""Heavenly Father, we come before You with hearts heavy for the people of {location} affected by {disaster_type}. We pray for those who have lost their homes, their loved ones, and their sense of security. Comfort the children who are frightened and the families torn apart by this tragedy.

We ask for Your divine protection over rescue workers and first responders as they serve tirelessly. Give wisdom to leaders making critical decisions, and provide resources for those in desperate need. May Your presence be a refuge and strength to every person facing this crisis.

Lord, we trust in Your promise to never leave nor forsake us. Bring healing, hope, and restoration to {location}. In Jesus' name, Amen."""


__all__ = [name for name in globals() if not name.startswith("__")]
