"""Unit tests for Global Prayer Watch discovery curation helpers."""

from datetime import datetime, timedelta

import pytest

from disaster_prayer_service import DisasterPrayerService


@pytest.fixture
def svc():
    return DisasterPrayerService.__new__(DisasterPrayerService)


def _base_row(**overrides):
    now = datetime.now()
    row = {
        'type': 'flood',
        'country': 'Indonesia',
        'location': 'Medan City, North Sumatra',
        'severity': 'moderate',
        'casualties': None,
        'news_summary': (
            'Heavy rainfall triggered flooding in Medan City. About 6,900 people were '
            'affected and 30 were displaced to emergency shelters.'
        ),
        'news_source': 'AHA Centre',
        'source_url': 'https://example.com/flood',
        'timestamp': (now - timedelta(hours=12)).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'development_type': 'new_impact',
        'confidence': 'high',
    }
    row.update(overrides)
    return row


def test_normalize_discovery_country_gaza(svc):
    country, location = svc._normalize_discovery_country('Gaza', '')
    assert country == 'Palestine'
    assert location == 'Gaza Strip'


def test_normalize_severity_aliases(svc):
    assert svc._normalize_severity('high') == 'severe'
    assert svc._normalize_severity('critical') == 'severe'
    assert svc._normalize_severity('moderate') == 'moderate'


def test_rejects_vague_location(svc):
    now = datetime.now()
    disaster_time = now - timedelta(hours=6)
    row = _base_row(location='western Pacific / tracked region')
    assert svc._validate_discovery_row(row, disaster_time, now) == 'vague location'


def test_rejects_meta_phrasing(svc):
    now = datetime.now()
    disaster_time = now - timedelta(hours=6)
    row = _base_row(
        news_summary=(
            'Search results did not include a fresh update for this region. '
            'The conflict remains active with humanitarian needs.'
        )
    )
    assert svc._validate_discovery_row(row, disaster_time, now) == 'meta-commentary in summary'


def test_conflict_requires_development_signal(svc):
    now = datetime.now()
    disaster_time = now - timedelta(days=4)
    row = _base_row(
        type='conflict',
        country='Ukraine',
        location='Eastern front',
        news_summary='The war in Ukraine remains an active crisis with sustained coverage in regional media.',
        development_type='ongoing_response',
    )
    assert svc._validate_discovery_row(row, disaster_time, now) == 'conflict lacks in-window development'


def test_conflict_passes_with_development_keyword(svc):
    now = datetime.now()
    disaster_time = now - timedelta(days=4)
    row = _base_row(
        type='conflict',
        country='Ukraine',
        location='Kharkiv region',
        news_summary=(
            'Fighting near Kharkiv displaced thousands of civilians this week. '
            'Humanitarian agencies report rising aid needs along the front line.'
        ),
        development_type='ongoing_response',
    )
    assert svc._validate_discovery_row(row, disaster_time, now) is None


def test_parse_disaster_response_filters_and_dedupes(svc):
    now = datetime.now()
    ts = (now - timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%SZ')
    payload = [
        _base_row(timestamp=ts),
        _base_row(timestamp=ts, location='Medan City, North Sumatra'),
        _base_row(
            timestamp=ts,
            location='tracked region',
            news_summary='A tropical system is being monitored with no reported impacts yet.',
            development_type='forecast_watch',
        ),
    ]
    import json
    parsed = svc._parse_disaster_response(json.dumps(payload))
    assert len(parsed) == 1
    assert parsed[0]['country'] == 'Indonesia'


def test_build_event_sources_internal_only_shape(svc):
    areas = [{
        'country': 'Japan',
        'location': 'Tokyo',
        'news_source': 'Reuters',
        'source_url': 'https://reuters.com/example',
        'timestamp': '2026-06-11T12:00:00Z',
        'development_type': 'new_impact',
        'confidence': 'high',
        'news_summary': 'ignored in event_sources',
    }]
    sources = svc._build_event_sources(areas)
    assert sources == [{
        'country': 'Japan',
        'location': 'Tokyo',
        'news_source': 'Reuters',
        'source_url': 'https://reuters.com/example',
        'timestamp': '2026-06-11T12:00:00Z',
        'development_type': 'new_impact',
        'confidence': 'high',
    }]
