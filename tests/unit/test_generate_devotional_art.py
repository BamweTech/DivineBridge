"""Artwork backfill uses the plan theme, then the title."""

from scripts.content.generate_devotional_art import plan_theme


def test_plan_theme_prefers_theme_over_title():
    assert plan_theme({"theme": " Peace ", "title": "Other"}) == "Peace"


def test_plan_theme_falls_back_to_title_then_faith():
    assert plan_theme({"title": "Leadership"}) == "Leadership"
    assert plan_theme({}) == "Faith"
