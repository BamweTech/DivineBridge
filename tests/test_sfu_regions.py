"""Tests for regional SFU URL selection."""

import os
from unittest.mock import patch

import sfu_regions as sr


class TestCountryToRegion:
    def test_us_country(self):
        assert sr.country_code_to_region("US") == sr.SFU_REGION_US

    def test_eu_country(self):
        assert sr.country_code_to_region("DE") == sr.SFU_REGION_EU
        assert sr.country_code_to_region("GB") == sr.SFU_REGION_EU

    def test_ap_country(self):
        assert sr.country_code_to_region("JP") == sr.SFU_REGION_AP
        assert sr.country_code_to_region("AU") == sr.SFU_REGION_AP

    def test_unknown_defaults_us(self):
        assert sr.country_code_to_region(None) == sr.SFU_REGION_US
        assert sr.country_code_to_region("XX") == sr.SFU_REGION_US


class TestTimezoneToRegion:
    def test_europe_timezone(self):
        assert sr.timezone_to_region("Europe/Paris") == sr.SFU_REGION_EU

    def test_asia_timezone(self):
        assert sr.timezone_to_region("Asia/Tokyo") == sr.SFU_REGION_AP

    def test_america_timezone(self):
        assert sr.timezone_to_region("America/Chicago") == sr.SFU_REGION_US


class TestResolveRegionFromRequest:
    def test_explicit_region_wins(self):
        region = sr.resolve_sfu_region_from_request(
            headers={"CF-IPCountry": "US"},
            body={"sfu_region": "eu"},
        )
        assert region == sr.SFU_REGION_EU

    def test_timezone_before_country(self):
        region = sr.resolve_sfu_region_from_request(
            headers={"CF-IPCountry": "US"},
            body={"timezone": "Europe/Berlin"},
        )
        assert region == sr.SFU_REGION_EU

    def test_cf_ip_country(self):
        region = sr.resolve_sfu_region_from_request(
            headers={"CF-IPCountry": "FR"},
            body={},
        )
        assert region == sr.SFU_REGION_EU


class TestGuestSfuMigration:
    def test_migrates_us_host_room_to_eu_guest(self):
        room = {
            "room_type": "voice_link",
            "sfu_region": "us",
            "sfu_url": "wss://sfu.divinebridge.io/ws",
        }
        participants = [
            {"user_id": "host1", "is_active": True, "is_host": True},
            {"user_id": "guest1", "is_active": True, "is_host": False},
        ]
        result = sr.maybe_migrate_voice_link_sfu_at_guest_join(
            room,
            "guest1",
            "host1",
            participants,
            headers={"CF-IPCountry": "FR"},
            body={},
        )
        assert result["sfu_region"] == "eu"
        assert "sfu-eu" in result["sfu_url"]
        assert result["sfu_selected_by"] == "pair_optimal"

    def test_no_migration_when_regions_match(self):
        room = {"room_type": "voice_link", "sfu_region": "eu", "sfu_url": "wss://sfu-eu.example/ws"}
        participants = [
            {"user_id": "host1", "is_active": True},
            {"user_id": "guest1", "is_active": True},
        ]
        result = sr.maybe_migrate_voice_link_sfu_at_guest_join(
            room,
            "guest1",
            "host1",
            participants,
            headers={"CF-IPCountry": "DE"},
            body={},
        )
        assert result == {}

    def test_host_join_does_not_migrate(self):
        room = {"room_type": "voice_link", "sfu_region": "us"}
        participants = [{"user_id": "host1", "is_active": True}]
        result = sr.maybe_migrate_voice_link_sfu_at_guest_join(
            room,
            "host1",
            "host1",
            participants,
            headers={"CF-IPCountry": "FR"},
            body={},
        )
        assert result == {}


class TestOptimalSfuRegion:
    def test_us_eu_pair_picks_eu(self):
        assert sr.pick_optimal_voice_link_sfu_region("us", "eu") == "eu"

    def test_eu_us_pair_picks_us(self):
        assert sr.pick_optimal_voice_link_sfu_region("eu", "us") == "us"

    @patch.dict(os.environ, {"SFU_REGIONS_ENABLED": "us,eu,ap"}, clear=False)
    def test_us_ap_pair_picks_ap_when_deployed(self):
        assert sr.pick_optimal_voice_link_sfu_region("us", "ap") == "ap"

    @patch.dict(os.environ, {"SFU_REGIONS_ENABLED": "us,eu"}, clear=False)
    def test_us_ap_guest_falls_back_to_eu_when_ap_not_deployed(self):
        # Tokyo guest, AP SFU not live → EU is closer than US for the guest
        assert sr.pick_optimal_voice_link_sfu_region("us", "ap") == "eu"

    def test_same_region_unchanged(self):
        assert sr.pick_optimal_voice_link_sfu_region("eu", "eu") == "eu"


class TestSfuUrls:
    def test_default_urls(self):
        assert "sfu.divinebridge.io" in sr.get_sfu_url_for_region("us")
        assert "sfu-eu" in sr.get_sfu_url_for_region("eu")

    @patch.dict(os.environ, {"SFU_URL_EU": "wss://custom-eu.example/ws"}, clear=False)
    def test_env_override(self):
        assert sr.get_sfu_url_for_region("eu") == "wss://custom-eu.example/ws"

    def test_room_stored_url(self):
        url = sr.get_sfu_url_for_room(
            {
                "sfu_url": "wss://sfu-eu.divinebridge.io/ws",
                "sfu_region": "eu",
            }
        )
        assert url == "wss://sfu-eu.divinebridge.io/ws"

    def test_build_voice_link_fields(self):
        fields = sr.build_voice_link_sfu_fields(
            headers={"CF-IPCountry": "IT"},
            body={},
        )
        assert fields["sfu_region"] == sr.SFU_REGION_EU
        assert fields["sfu_url"].startswith("wss://")
        assert fields["sfu_selected_by"] == "host"
