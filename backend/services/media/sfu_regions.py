"""Regional SFU URL selection for Voice Link and multi-region media routing."""

from __future__ import annotations

import os
from datetime import datetime

SFU_REGION_US = "us"
SFU_REGION_EU = "eu"
SFU_REGION_AP = "ap"
VALID_SFU_REGIONS = frozenset({SFU_REGION_US, SFU_REGION_EU, SFU_REGION_AP})

DEFAULT_SFU_URLS = {
    SFU_REGION_US: "wss://sfu.divinebridge.io/ws",
    SFU_REGION_EU: "wss://sfu-eu.divinebridge.io/ws",
    SFU_REGION_AP: "wss://sfu-ap.divinebridge.io/ws",
}

# Europe, Africa, Middle East → EU SFU (europe-west)
EU_COUNTRY_CODES = frozenset(
    {
        "AD",
        "AL",
        "AT",
        "BA",
        "BE",
        "BG",
        "BY",
        "CH",
        "CY",
        "CZ",
        "DE",
        "DK",
        "EE",
        "ES",
        "FI",
        "FR",
        "GB",
        "GR",
        "HR",
        "HU",
        "IE",
        "IS",
        "IT",
        "LI",
        "LT",
        "LU",
        "LV",
        "MC",
        "MD",
        "ME",
        "MK",
        "MT",
        "NL",
        "NO",
        "PL",
        "PT",
        "RO",
        "RS",
        "RU",
        "SE",
        "SI",
        "SK",
        "SM",
        "UA",
        "VA",
        "XK",
        "DZ",
        "AO",
        "BJ",
        "BW",
        "BF",
        "BI",
        "CM",
        "CV",
        "CF",
        "TD",
        "KM",
        "CG",
        "CD",
        "CI",
        "DJ",
        "EG",
        "GQ",
        "ER",
        "ET",
        "GA",
        "GM",
        "GH",
        "GN",
        "GW",
        "KE",
        "LS",
        "LR",
        "LY",
        "MG",
        "MW",
        "ML",
        "MR",
        "MU",
        "MA",
        "MZ",
        "NA",
        "NE",
        "NG",
        "RW",
        "ST",
        "SN",
        "SC",
        "SL",
        "SO",
        "ZA",
        "SS",
        "SD",
        "SZ",
        "TZ",
        "TG",
        "TN",
        "UG",
        "ZM",
        "ZW",
        "AE",
        "BH",
        "IL",
        "IQ",
        "IR",
        "JO",
        "KW",
        "LB",
        "OM",
        "PS",
        "QA",
        "SA",
        "SY",
        "TR",
        "YE",
    }
)

# Asia-Pacific → AP SFU (future region; defaults to US URL until deployed)
AP_COUNTRY_CODES = frozenset(
    {
        "AF",
        "AM",
        "AU",
        "AZ",
        "BD",
        "BN",
        "BT",
        "KH",
        "CN",
        "FJ",
        "GE",
        "HK",
        "ID",
        "IN",
        "JP",
        "KG",
        "KR",
        "KZ",
        "LA",
        "LK",
        "MM",
        "MN",
        "MO",
        "MY",
        "NP",
        "NZ",
        "PG",
        "PH",
        "PK",
        "SG",
        "TH",
        "TJ",
        "TL",
        "TM",
        "TW",
        "UZ",
        "VN",
    }
)


# Approximate great-circle distances (km) between SFU datacenter regions
REGION_DISTANCE_KM = {
    ("ap", "eu"): 10200,
    ("ap", "us"): 15500,
    ("eu", "us"): 6200,
}

# Guest joins via mobile web — weight their path more heavily when picking SFU
HOST_PATH_WEIGHT = 0.4
GUEST_PATH_WEIGHT = 0.6


def get_deployed_sfu_regions():
    """Regions with a live SFU VM. AP omitted until SFU_REGIONS_ENABLED includes it."""
    raw = os.getenv("SFU_REGIONS_ENABLED", "us,eu")
    regions = [r.strip().lower() for r in raw.split(",") if r.strip()]
    valid = [r for r in regions if r in VALID_SFU_REGIONS]
    return valid or [SFU_REGION_US]


def region_pair_distance(region_a: str, region_b: str) -> float:
    if region_a == region_b:
        return 0.0
    key = tuple(sorted([region_a, region_b]))
    return float(REGION_DISTANCE_KM.get(key, 10000))


def _candidate_regions_for_pair(host_region: str, guest_region: str) -> set:
    """Enabled SFU regions that can serve this host/guest pair."""
    enabled = set(get_deployed_sfu_regions())
    candidates = set()
    for region in (host_region, guest_region):
        if region in enabled:
            candidates.add(region)
    for region in (host_region, guest_region):
        if region not in enabled:
            nearest = min(
                enabled,
                key=lambda candidate: region_pair_distance(region, candidate),
            )
            candidates.add(nearest)
    return candidates or {SFU_REGION_US}


def pick_optimal_voice_link_sfu_region(host_region: str, guest_region: str) -> str:
    """
    Pick the SFU region that best serves both parties.

    Uses guest-weighted geographic distance (60% guest / 40% host) so the browser
    guest's fragile path matters more, without blindly always picking the guest
    region when a third region is closer for both (e.g. US + EU → EU, not US).

    Ties favour the guest's region.
    """
    host_region = (host_region or SFU_REGION_US).lower()
    guest_region = (guest_region or SFU_REGION_US).lower()
    if host_region == guest_region:
        return host_region

    candidates = _candidate_regions_for_pair(host_region, guest_region)
    best_region = host_region
    best_score = float("inf")

    for candidate in candidates:
        score = HOST_PATH_WEIGHT * region_pair_distance(
            host_region, candidate
        ) + GUEST_PATH_WEIGHT * region_pair_distance(guest_region, candidate)
        if score < best_score:
            best_score = score
            best_region = candidate
        elif score == best_score and candidate == guest_region:
            best_region = guest_region

    return best_region


def get_sfu_url_for_region(region: str) -> str:
    """Return the WSS URL for a region, with env overrides."""
    region = (region or SFU_REGION_US).lower()
    if region not in VALID_SFU_REGIONS:
        region = SFU_REGION_US

    env_key = f"SFU_URL_{region.upper()}"
    url = (os.getenv(env_key) or "").strip()
    if url:
        return url

    # Legacy single SFU_URL applies to US only
    if region == SFU_REGION_US:
        legacy = (os.getenv("SFU_URL") or "").strip()
        if legacy:
            return legacy

    return DEFAULT_SFU_URLS[region]


def country_code_to_region(country_code: str | None) -> str:
    code = (country_code or "").strip().upper()
    if not code or code == "XX" or code == "T1":
        return SFU_REGION_US
    if code in EU_COUNTRY_CODES:
        return SFU_REGION_EU
    if code in AP_COUNTRY_CODES:
        return SFU_REGION_AP
    return SFU_REGION_US


def timezone_to_region(timezone_name: str | None) -> str | None:
    tz = (timezone_name or "").strip()
    if not tz:
        return None
    lower = tz.lower()
    if lower.startswith("europe/") or lower.startswith("africa/"):
        return SFU_REGION_EU
    if lower.startswith("asia/") or lower.startswith("australia/") or lower.startswith("pacific/"):
        return SFU_REGION_AP
    if lower.startswith("america/") or lower.startswith("us/") or lower.startswith("canada/"):
        return SFU_REGION_US
    return None


def resolve_sfu_region_from_request(headers=None, body=None):
    """
    Pick SFU region for a new Voice Link room.

    Priority: explicit body sfu_region → body timezone → CF-IPCountry →
    X-Appengine-Country → US default.
    """
    body = body or {}
    headers = headers or {}

    explicit = (body.get("sfu_region") or "").strip().lower()
    if explicit in VALID_SFU_REGIONS:
        return explicit

    tz_region = timezone_to_region(body.get("timezone"))
    if tz_region:
        return tz_region

    country = headers.get("CF-IPCountry") or headers.get("X-Appengine-Country") or headers.get("X-Country-Code") or ""
    return country_code_to_region(country)


def get_sfu_url_for_room(room_data):
    """Resolve SFU WSS URL from a room document, with legacy fallback."""
    if not room_data:
        return get_sfu_url_for_region(SFU_REGION_US)

    stored_url = (room_data.get("sfu_url") or "").strip()
    if stored_url:
        return stored_url

    stored_region = (room_data.get("sfu_region") or "").strip().lower()
    if stored_region in VALID_SFU_REGIONS:
        return get_sfu_url_for_region(stored_region)

    return get_sfu_url_for_region(SFU_REGION_US)


def build_voice_link_sfu_fields(headers=None, body=None):
    """Return sfu_region + sfu_url for a new voice_link room."""
    region = resolve_sfu_region_from_request(headers=headers, body=body)
    return {
        "sfu_region": region,
        "sfu_url": get_sfu_url_for_region(region),
        "sfu_selected_by": "host",
    }


def maybe_migrate_voice_link_sfu_at_guest_join(
    room_data,
    guest_user_id,
    host_id,
    participants,
    headers=None,
    body=None,
):
    """
    When the guest joins as the second participant, re-pin the call to the
    pair-optimal SFU if it differs from the host's initial region.
    """
    if not room_data or room_data.get("room_type") != "voice_link":
        return {}
    if not guest_user_id or guest_user_id == host_id:
        return {}

    active_count = sum(1 for p in (participants or []) if p.get("is_active", True) is not False)
    if active_count != 2:
        return {}

    current_region = (room_data.get("sfu_region") or SFU_REGION_US).lower()
    host_region = current_region
    guest_region = resolve_sfu_region_from_request(headers=headers, body=body)
    optimal_region = pick_optimal_voice_link_sfu_region(host_region, guest_region)
    if optimal_region == current_region:
        return {}

    return {
        "sfu_region": optimal_region,
        "sfu_url": get_sfu_url_for_region(optimal_region),
        "sfu_selected_by": "pair_optimal",
        "sfu_host_region": host_region,
        "sfu_guest_region": guest_region,
        "sfu_migrated_at": datetime.utcnow(),
    }
