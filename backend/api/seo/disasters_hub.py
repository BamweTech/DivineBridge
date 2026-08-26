"""seo disasters_hub routes."""
from backend.api.seo._blueprint import seo_bp
from flask import jsonify, render_template_string, Response
from datetime import datetime
import requests
from backend.api.seo.helpers import (
    _clean_citation_markers,
    get_country_flag_code,
    logger,
)

# Disasters hub template - Ultra-modern, beautiful design
DISASTERS_HUB_TEMPLATE = """
{% extends "base.html" %}

{% block title %}Global Prayer Watch - Join in Prayer for Affected Communities Worldwide | Divine Bridge{% endblock %}

{% block meta_description %}Join believers worldwide in prayer for communities affected by recent disasters. Find specific prayers for floods, earthquakes, conflicts, and humanitarian crises. Stand together in prayer with our global prayer watch community.{% endblock %}

{% block meta_keywords %}global prayer watch, disaster prayer, prayer for affected communities, disaster prayer support, Christian disaster relief prayer, prayer for natural disasters, prayer for humanitarian crises, global prayer community{% endblock %}

{% block og_title %}Global Prayer Watch - Stand Together in Prayer for Affected Communities{% endblock %}
{% block og_description %}Join believers worldwide lifting up communities affected by recent disasters. Find specific prayers, stand together in faith, and participate in our global prayer watch.{% endblock %}

{% block extra_css %}
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&display=swap');

    :root {
        --primary-blue: #0f56ff;
        --primary-blue-light: #4a90e2;
        --primary-blue-dark: #1f3c88;
        --text-primary: #0a1629;
        --text-secondary: #64748b;
        --text-muted: #94a3b8;
        --surface-white: rgba(255, 255, 255, 0.95);
        --surface-glass: rgba(255, 255, 255, 0.8);
        --shadow-light: rgba(0, 0, 0, 0.04);
        --shadow-medium: rgba(0, 0, 0, 0.08);
        --shadow-heavy: rgba(0, 0, 0, 0.12);
        --border-light: rgba(15, 86, 255, 0.1);
        --border-medium: rgba(15, 86, 255, 0.2);
        --gradient-primary: linear-gradient(135deg, var(--primary-blue) 0%, var(--primary-blue-light) 100%);
        --gradient-surface: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.95) 100%);
        --animation-timing: cubic-bezier(0.4, 0, 0.2, 1);
    }

    * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        color: var(--text-primary);
    }

    .disasters-page {
        min-height: calc(100vh - 200px);
        padding: 6rem 2rem 8rem;
        background:
            radial-gradient(circle at 20% 50%, rgba(15, 86, 255, 0.03) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(74, 144, 226, 0.03) 0%, transparent 50%),
            linear-gradient(135deg, #fafbfc 0%, #ffffff 50%, #f1f5f9 100%);
        position: relative;
        overflow-x: hidden;
    }

    .disasters-page::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 100%;
        background:
            url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%230f56ff' fill-opacity='0.02'%3E%3Ccircle cx='7' cy='7' r='1'/%3E%3Ccircle cx='27' cy='7' r='1'/%3E%3Ccircle cx='47' cy='7' r='1'/%3E%3Ccircle cx='7' cy='27' r='1'/%3E%3Ccircle cx='27' cy='27' r='1'/%3E%3Ccircle cx='47' cy='27' r='1'/%3E%3Ccircle cx='7' cy='47' r='1'/%3E%3Ccircle cx='27' cy='47' r='1'/%3E%3Ccircle cx='47' cy='47' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E") repeat;
        pointer-events: none;
    }

    .disasters-container {
        max-width: 1440px;
        margin: 0 auto;
        position: relative;
        z-index: 2;
    }

    .page-header {
        text-align: center;
        margin-bottom: 6rem;
        background: var(--surface-white);
        backdrop-filter: blur(24px);
        border-radius: 36px;
        padding: 5rem 4rem;
        border: 1px solid var(--border-light);
        box-shadow:
            0 32px 80px var(--shadow-medium),
            0 16px 32px var(--shadow-light),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
        position: relative;
        overflow: hidden;
        animation: slideUp 1s var(--animation-timing);
    }

    .page-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmer 4s ease-in-out infinite;
    }

    .page-header::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(15, 86, 255, 0.02) 0%, transparent 70%);
        animation: pulse 6s ease-in-out infinite;
        pointer-events: none;
    }

    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes shimmer {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
    }

    @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 0.5; }
        50% { transform: scale(1.05); opacity: 0.8; }
    }

    .page-title {
        font-size: clamp(3rem, 6vw, 4.5rem);
        font-weight: 900;
        margin-bottom: 1rem;
        letter-spacing: -0.04em;
        line-height: 1.1;
        background: linear-gradient(135deg, var(--text-primary) 0%, var(--primary-blue-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: fadeInUp 1.2s var(--animation-timing);
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .page-subtitle {
        font-size: clamp(1.375rem, 3vw, 2rem);
        font-weight: 500;
        color: var(--text-secondary);
        margin-top: 0.75rem;
        margin-bottom: 2.5rem;
        line-height: 1.6;
        letter-spacing: -0.01em;
        animation: fadeInUp 1.4s var(--animation-timing);
        max-width: 800px;
        margin-left: auto;
        margin-right: auto;
    }

    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .prayer-intro {
        margin-top: 3.5rem;
        padding: 3rem;
        background: var(--surface-glass);
        border-radius: 28px;
        border: 1px solid var(--border-light);
        box-shadow:
            0 16px 40px var(--shadow-light),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(20px);
        position: relative;
        animation: slideUp 1.6s var(--animation-timing);
    }

    .prayer-intro::before {
        content: '';
        position: absolute;
        top: -1px;
        left: -1px;
        right: -1px;
        bottom: -1px;
        background: linear-gradient(135deg, rgba(15, 86, 255, 0.1) 0%, rgba(74, 144, 226, 0.05) 100%);
        border-radius: 28px;
        z-index: -1;
    }

    .intro-text {
        font-size: 1.25rem;
        font-weight: 400;
        color: #475569;
        line-height: 1.8;
        margin-bottom: 2.5rem;
        text-align: left;
        font-family: 'Inter', sans-serif;
    }

    .prayer-verse {
        margin: 0;
        padding: 2.5rem 3rem;
        background: linear-gradient(135deg, rgba(15, 86, 255, 0.03) 0%, rgba(74, 144, 226, 0.06) 100%);
        border-left: 5px solid var(--primary-blue);
        border-radius: 20px;
        font-style: italic;
        position: relative;
        box-shadow: 0 8px 24px var(--shadow-light);
    }

    .prayer-verse::before {
        content: '"';
        position: absolute;
        top: -10px;
        left: 20px;
        font-size: 4rem;
        color: rgba(15, 86, 255, 0.1);
        font-family: 'Georgia', serif;
    }

    .verse-text {
        font-size: 1.25rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 1rem;
        line-height: 1.7;
        position: relative;
        z-index: 2;
    }

    .verse-citation {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-secondary);
        font-style: normal;
        display: block;
        text-align: right;
        font-family: 'Inter', sans-serif;
    }

    .section-title {
        font-size: clamp(2rem, 4vw, 3rem);
        font-weight: 800;
        color: var(--text-primary);
        margin-bottom: 1.5rem;
        text-align: center;
        letter-spacing: -0.02em;
        line-height: 1.2;
        position: relative;
    }

    .section-title::after {
        content: '';
        position: absolute;
        bottom: -10px;
        left: 50%;
        transform: translateX(-50%);
        width: 60px;
        height: 3px;
        background: var(--gradient-primary);
        border-radius: 2px;
    }

    .section-intro {
        font-size: 1.25rem;
        font-weight: 400;
        color: var(--text-secondary);
        line-height: 1.7;
        margin-bottom: 4rem;
        text-align: center;
        max-width: 900px;
        margin-left: auto;
        margin-right: auto;
    }

    .prayer-opportunities {
        margin-top: 5rem;
    }

    .prayer-cta-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--gradient-primary);
        color: white;
        padding: 1.25rem 3rem;
        border-radius: 20px;
        text-decoration: none;
        font-weight: 700;
        font-size: 1.25rem;
        transition: all 0.4s var(--animation-timing);
        border: none;
        width: 100%;
        text-align: center;
        box-shadow:
            0 8px 24px rgba(15, 86, 255, 0.4),
            0 4px 12px rgba(15, 86, 255, 0.3);
        position: relative;
        overflow: hidden;
        font-family: 'Inter', sans-serif;
        letter-spacing: 0.5px;
        animation: pulse 2s ease-in-out infinite;
    }

    .prayer-cta-primary::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
        transition: left 0.6s ease;
    }

    .prayer-cta-primary:hover::before {
        left: 100%;
    }

    .prayer-cta-primary:hover {
        background: linear-gradient(135deg, var(--primary-blue-dark) 0%, var(--primary-blue) 100%);
        transform: translateY(-4px) scale(1.02);
        box-shadow:
            0 16px 40px rgba(15, 86, 255, 0.5),
            0 8px 20px rgba(15, 86, 255, 0.4);
    }

    .prayer-cta-primary:active {
        transform: translateY(-2px) scale(1.01);
    }

    @keyframes pulse {
        0%, 100% { box-shadow: 0 8px 24px rgba(15, 86, 255, 0.4), 0 4px 12px rgba(15, 86, 255, 0.3); }
        50% { box-shadow: 0 12px 32px rgba(15, 86, 255, 0.5), 0 6px 16px rgba(15, 86, 255, 0.4); }
    }

    .prayer-resources {
        margin-top: 6rem;
        padding: 0;
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.98) 0%, 
            rgba(248, 250, 252, 0.95) 100%);
        border-radius: 40px;
        border: none;
        text-align: center;
        box-shadow:
            0 32px 80px rgba(0, 0, 0, 0.08),
            0 16px 40px rgba(0, 0, 0, 0.06),
            0 8px 20px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        position: relative;
        overflow: hidden;
        isolation: isolate;
    }

    .prayer-resources::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 6px;
        background: var(--gradient-primary);
        background-size: 200% 100%;
        animation: shimmerFlow 5s ease-in-out infinite;
        z-index: 3;
    }

    .prayer-resources::after {
        content: '';
        position: absolute;
        top: -45%;
        left: -45%;
        width: 190%;
        height: 190%;
        background: radial-gradient(circle, 
            rgba(15, 86, 255, 0.03) 0%, 
            rgba(74, 144, 226, 0.015) 30%,
            transparent 70%);
        animation: rotate 25s linear infinite;
        pointer-events: none;
    }

    @keyframes rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .resource-links {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 1.75rem;
        margin-top: 0;
        padding: 0 4rem 5rem;
        position: relative;
        z-index: 2;
    }

    .resource-link {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.875rem;
        padding: 2rem 2rem;
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.9) 100%);
        color: var(--primary-blue);
        text-decoration: none;
        border-radius: 24px;
        font-weight: 700;
        font-size: 1.0625rem;
        border: 2px solid var(--border-medium);
        transition: all 0.4s var(--animation-timing);
        backdrop-filter: blur(16px);
        box-shadow: 
            0 8px 24px rgba(0, 0, 0, 0.06),
            0 4px 12px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        position: relative;
        overflow: hidden;
        font-family: 'Inter', sans-serif;
        min-height: 140px;
    }

    .resource-link::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--gradient-primary);
        opacity: 0;
        transition: opacity 0.4s ease;
        z-index: 1;
    }

    .resource-link::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, 
            rgba(255, 255, 255, 0.3) 0%, 
            transparent 70%);
        opacity: 0;
        transition: opacity 0.4s ease;
        z-index: 2;
    }

    .resource-link:hover::before {
        opacity: 1;
    }

    .resource-link:hover::after {
        opacity: 1;
    }

    .link-icon {
        font-size: 2rem;
        position: relative;
        z-index: 3;
        transition: transform 0.4s ease;
    }

    .link-text {
        position: relative;
        z-index: 3;
        transition: color 0.4s ease;
    }

    .resource-link:hover .link-icon {
        transform: scale(1.15) rotate(5deg);
    }

    .resource-link:hover {
        color: white;
        border-color: var(--primary-blue);
        transform: translateY(-6px) scale(1.02);
        box-shadow: 
            0 16px 40px rgba(15, 86, 255, 0.3),
            0 8px 20px rgba(15, 86, 255, 0.2);
    }

    .resource-link:hover .link-text {
        color: white;
    }

    .empty-message {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 1.5rem;
        color: var(--text-primary);
        animation: fadeInUp 1.8s var(--animation-timing);
    }

    .empty-cta {
        color: var(--text-secondary);
        font-size: 1.125rem;
    }

    .empty-cta a {
        color: var(--primary-blue);
        font-weight: 700;
        text-decoration: none;
        transition: all 0.2s ease;
        border-bottom: 2px solid transparent;
        padding-bottom: 2px;
    }

    .empty-cta a:hover {
        border-bottom-color: var(--primary-blue);
        color: var(--primary-blue-dark);
    }

    .disasters-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
        gap: 2.5rem;
        margin-top: 4rem;
    }

    .disaster-card {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 1) 100%);
        border-radius: 32px;
        padding: 0;
        border: none;
        box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.08),
            0 8px 24px rgba(0, 0, 0, 0.06),
            0 4px 12px rgba(15, 86, 255, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        transition: all 0.6s var(--animation-timing);
        position: relative;
        overflow: visible;
        backdrop-filter: blur(20px);
        animation: cardSlideUp 0.8s var(--animation-timing) backwards;
        animation-delay: calc(var(--card-index, 0) * 0.1s);
        isolation: isolate;
    }

    @keyframes cardSlideUp {
        from {
            opacity: 0;
            transform: translateY(40px) scale(0.95);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }

    /* Card top accent bar with gradient */
    .disaster-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 6px;
        background: linear-gradient(90deg, 
            var(--primary-blue) 0%, 
            var(--primary-blue-light) 25%,
            var(--primary-blue) 50%,
            var(--primary-blue-light) 75%,
            var(--primary-blue) 100%);
        background-size: 300% 100%;
        animation: shimmerFlow 4s ease-in-out infinite;
        animation-delay: calc(var(--card-index, 0) * 0.2s);
        z-index: 3;
    }

    @keyframes shimmerFlow {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
    }

    /* Animated gradient overlay on hover */
    .disaster-card::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, 
            rgba(15, 86, 255, 0.08) 0%, 
            rgba(74, 144, 226, 0.04) 30%,
            transparent 70%);
        opacity: 0;
        transition: opacity 0.6s ease, transform 0.6s ease;
        pointer-events: none;
        border-radius: 50%;
        transform: scale(0.5);
    }

    .disaster-card:hover::after {
        opacity: 1;
        transform: scale(1);
    }

    /* Card content wrapper */
    .disaster-card > * {
        position: relative;
        z-index: 2;
    }

    .disaster-card:hover {
        transform: translateY(-16px) scale(1.015);
        box-shadow:
            0 32px 80px rgba(0, 0, 0, 0.12),
            0 16px 40px rgba(0, 0, 0, 0.08),
            0 8px 20px rgba(15, 86, 255, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
    }

    .disaster-card.severe::before,
    .disaster-card.catastrophic::before {
        background: linear-gradient(90deg, 
            #ef4444 0%, 
            #dc2626 25%,
            #ef4444 50%,
            #dc2626 75%,
            #ef4444 100%);
        background-size: 300% 100%;
        height: 6px;
    }

    .disaster-card-header-grouped {
        text-align: center;
        padding: 3rem 2.5rem 2rem;
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.5) 100%);
        position: relative;
        margin-bottom: 0;
        overflow: visible;
    }

    .disaster-card-header-grouped::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 80%;
        height: 1px;
        background: linear-gradient(90deg, 
            transparent 0%,
            rgba(15, 86, 255, 0.2) 50%,
            transparent 100%);
    }

    .disaster-type-title {
        font-size: clamp(1.75rem, 3vw, 2.25rem);
        font-weight: 900;
        color: var(--text-primary);
        margin-bottom: 1.5rem;
        letter-spacing: -0.02em;
        line-height: 1.2;
        position: relative;
        display: inline-block;
        transition: all 0.4s ease;
    }

    .disaster-type-title::after {
        content: '';
        position: absolute;
        bottom: -8px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 3px;
        background: var(--gradient-primary);
        border-radius: 2px;
        transition: width 0.4s ease;
    }

    .disaster-card:hover .disaster-type-title::after {
        width: 60%;
    }

    .disaster-card:hover .disaster-type-title {
        background: linear-gradient(135deg, var(--text-primary) 0%, var(--primary-blue-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        transform: scale(1.02);
    }

    .country-flags-group {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.875rem;
        margin-bottom: 1.5rem;
        padding: 2rem 1.5rem 1.25rem;
        background: linear-gradient(135deg, 
            rgba(248, 250, 252, 0.8) 0%, 
            rgba(241, 245, 249, 0.6) 100%);
        border-radius: 20px;
        border: 1px solid rgba(15, 86, 255, 0.08);
        box-shadow: 
            0 4px 12px rgba(0, 0, 0, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(8px);
        position: relative;
        overflow: visible;
    }

    .country-flags-group::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, 
            transparent, 
            rgba(15, 86, 255, 0.05), 
            transparent);
        transition: left 0.6s ease;
    }

    .disaster-card:hover .country-flags-group::before {
        left: 100%;
    }

    .disaster-news-summary {
        font-size: 1.0625rem;
        font-weight: 400;
        color: #475569;
        line-height: 1.75;
        margin: 0;
        padding: 2.5rem 2.5rem;
        background: linear-gradient(135deg, 
            rgba(248, 250, 252, 0.6) 0%, 
            rgba(241, 245, 249, 0.4) 100%);
        border-radius: 0;
        border-left: 5px solid var(--primary-blue);
        border-right: 5px solid transparent;
        text-align: left;
        position: relative;
        transition: all 0.4s ease;
    }

    .disaster-news-summary::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 5px;
        height: 100%;
        background: var(--gradient-primary);
        border-radius: 0 3px 3px 0;
        transition: width 0.4s ease;
    }

    .disaster-card:hover .disaster-news-summary::before {
        width: 8px;
    }

    .disaster-card:hover .disaster-news-summary {
        background: linear-gradient(135deg, 
            rgba(248, 250, 252, 0.8) 0%, 
            rgba(241, 245, 249, 0.6) 100%);
        padding-left: 2.75rem;
    }

    .disaster-card-footer {
        display: flex;
        justify-content: center;
        align-items: center;
        margin-top: 0;
        padding: 2.5rem 2.5rem 3rem;
        border-top: 1px solid rgba(15, 86, 255, 0.08);
        background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0.5) 0%, 
            rgba(255, 255, 255, 0.95) 100%);
        position: relative;
    }

    .disaster-card-footer::before {
        content: '';
        position: absolute;
        top: -1px;
        left: 50%;
        transform: translateX(-50%);
        width: 60%;
        height: 1px;
        background: linear-gradient(90deg, 
            transparent 0%,
            rgba(15, 86, 255, 0.3) 50%,
            transparent 100%);
    }
    
    .disaster-card-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    
    .country-flag {
        width: 32px;
        height: 24px;
        object-fit: fill;
        flex-shrink: 0;
        animation: none !important;
        transform: none !important;
        transition: none !important;
        border-radius: 0 !important;
        filter: none !important;
        border: none !important;
        box-shadow: none !important;
        clip-path: none !important;
        mask: none !important;
        -webkit-mask: none !important;
        image-rendering: auto !important;
        will-change: auto !important;
        backface-visibility: visible !important;
        perspective: none !important;
    }
    
    .country-flag-small {
        width: 32px;
        height: 24px;
        object-fit: fill;
        display: block;
        animation: none !important;
        transform: none !important;
        transition: none !important;
        border-radius: 0 !important;
        filter: none !important;
        border: none !important;
        box-shadow: none !important;
        clip-path: none !important;
        mask: none !important;
        -webkit-mask: none !important;
        image-rendering: auto !important;
        will-change: auto !important;
        backface-visibility: visible !important;
        perspective: none !important;
    }
    
    img.country-flag,
    img.country-flag-small,
    img[src*="/api/flags/"] {
        width: 32px !important;
        height: 24px !important;
        object-fit: fill !important;
        border-radius: 0 !important;
        filter: none !important;
        transform: none !important;
        animation: none !important;
        transition: none !important;
        clip-path: inset(0) !important;
        mask: none !important;
        -webkit-mask: none !important;
        image-rendering: auto !important;
        -webkit-image-rendering: auto !important;
        image-rendering: crisp-edges !important;
        will-change: auto !important;
        backface-visibility: visible !important;
        perspective: none !important;
        -webkit-transform: none !important;
        -moz-transform: none !important;
        -ms-transform: none !important;
        -o-transform: none !important;
    }
    
    /* Prevent any hover effects on flags */
    img.country-flag:hover,
    img.country-flag-small:hover,
    img[src*="/api/flags/"]:hover {
        transform: none !important;
        animation: none !important;
        transition: none !important;
        filter: none !important;
    }
    
    /* Flag tooltip styling */
    .flag-tooltip-wrapper {
        position: relative;
        display: inline-block;
        z-index: 10;
    }
    
    .flag-tooltip {
        visibility: hidden;
        opacity: 0;
        background-color: #1a1a1a;
        color: #ffffff;
        text-align: center;
        padding: 0.5rem 0.9rem;
        border-radius: 6px;
        font-size: 0.85rem;
        font-weight: 500;
        white-space: nowrap;
        position: absolute;
        z-index: 10000;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    
    .flag-tooltip::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border-width: 5px;
        border-style: solid;
        border-color: #1a1a1a transparent transparent transparent;
    }
    
    .flag-tooltip-wrapper:hover .flag-tooltip {
        visibility: visible;
        opacity: 1;
    }
    
    .disaster-card-title {
        flex: 1;
    }
    
    .disaster-type {
        display: inline-block;
        background: #f5f5f5;
        color: #333;
        padding: 0.5rem 1rem;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
        border: 1px solid #e0e0e0;
    }
    
    .disaster-card.severe .disaster-type {
        background: #fee2e2;
        border-color: #dc2626;
        color: #dc2626;
    }
    
    .disaster-location {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1a1a1a;
        margin: 0;
    }
    
    .disaster-news-summary {
        font-size: 0.95rem;
        color: #4a4a4a;
        line-height: 1.6;
        margin: 1rem 0;
        padding: 1rem;
        background: #f9f9f9;
        border-radius: 12px;
        border-left: 3px solid #c0c0c0;
    }
    
    .disaster-card-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1.5rem;
        padding-top: 1rem;
        border-top: 1px solid #e0e0e0;
    }
    
    .disaster-card-footer .disaster-type {
        margin-left: auto;
    }
    
    
    .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        background: #ffffff;
        border-radius: 24px;
        border: 1px solid #e0e0e0;
        color: #1a1a1a;
    }
    
    .empty-state p {
        font-size: 1.2rem;
        margin-bottom: 1rem;
        color: #4a4a4a;
    }
    
    .empty-state a {
        color: #0f56ff;
        font-weight: 600;
        text-decoration: underline;
    }
    
    .info-section {
        text-align: center;
        margin-top: 4rem;
        padding: 3rem 2rem;
        background: #ffffff;
        border-radius: 24px;
        border: 1px solid #e0e0e0;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }
    
    .info-section h3 {
        color: #1a1a1a;
        margin-bottom: 1rem;
        font-size: 1.8rem;
    }
    
    .info-section p {
        color: #4a4a4a;
        margin-bottom: 1.5rem;
        max-width: 700px;
        margin-left: auto;
        margin-right: auto;
        line-height: 1.6;
    }
    
    .info-section a {
        display: inline-block;
        background: #0f56ff;
        color: white;
        padding: 1rem 2rem;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 600;
        transition: all 0.3s ease;
        border: 1px solid #0f56ff;
    }
    
    .info-section a:hover {
        background: #1f3c88;
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(15, 86, 255, 0.3);
    }
    
    .empty-state {
        text-align: center;
        padding: 5rem 2rem;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.98) 100%);
        border-radius: 32px;
        border: 1px solid rgba(15, 86, 255, 0.1);
        color: #1e293b;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.06);
    }
    
    .empty-state p {
        font-size: 1.25rem;
        margin-bottom: 1rem;
        color: #475569;
        font-weight: 500;
    }
    
    .empty-state a {
        color: #0f56ff;
        font-weight: 600;
        text-decoration: none;
        transition: all 0.2s ease;
    }
    
    .empty-state a:hover {
        text-decoration: underline;
        color: #1f3c88;
    }
    
    @media (max-width: 768px) {
        .disasters-grid {
            grid-template-columns: 1fr;
            gap: 1.5rem;
        }
        
        .page-header {
            padding: 2.5rem 1.5rem;
            margin-bottom: 3rem;
        }
        
        .prayer-intro {
            padding: 1.5rem;
        }
        
        .disaster-card {
            padding: 2rem 1.5rem;
        }
        
        .disaster-card-header {
            flex-direction: column;
            align-items: flex-start;
        }
        
        .disasters-page {
            padding: 3rem 1rem 4rem;
        }
        
        .prayer-resources {
            padding: 2.5rem 1.5rem;
        }
        
        .resource-links {
            grid-template-columns: 1fr;
            padding: 0 1.5rem 3rem;
        }
        
        .resource-link {
            width: 100%;
            padding: 1.75rem 1.5rem;
            min-height: 120px;
        }
    }
    
    @media (max-width: 480px) {
        .page-title {
            font-size: 2rem;
        }
        
        .page-subtitle {
            font-size: 1.125rem;
        }
        
        .section-title {
            font-size: 1.5rem;
        }
    }
</style>
<!-- JSON-LD Structured Data for SEO -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Global Prayer Watch",
  "description": "Join believers worldwide in prayer for communities affected by recent disasters. Stand together in prayer with our global prayer watch community.",
  "url": "{{ request.url }}",
  "mainEntity": {
    "@type": "ItemList",
    "itemListElement": [
      {% for disaster in disasters %}
      {
        "@type": "ListItem",
        "position": {{ loop.index }},
        "item": {
          "@type": "WebPage",
          "name": "Prayer for {{ disaster.type_display }}",
          "url": "{{ request.url_root }}globalprayerwatch/{{ disaster.url_slug }}",
          "description": "Prayer for communities affected by {{ disaster.type_display }} in {{ disaster.affected_countries|join(', ') }}"
        }
      }{% if not loop.last %},{% endif %}
      {% endfor %}
    ]
  },
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": "{{ request.url_root }}"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Global Prayer Watch",
        "item": "{{ request.url }}"
      }
    ]
  }
}
</script>
{% endblock %}

{% block content %}
<main class="disasters-page" role="main">
    <div class="disasters-container">
        <header class="page-header">
            <h1 class="page-title">Global Prayer Watch</h1>
            <p class="page-subtitle">Stand Together in Prayer</p>
            <div class="prayer-intro">
                <p class="intro-text">In times of crisis, we come together as one body in Christ, lifting up our brothers and sisters around the world. Here you'll find specific prayers for communities currently facing hardship, that we might intercede with compassion and hope.</p>
                <blockquote class="prayer-verse" cite="https://www.biblegateway.com/passage/?search=Philippians+4%3A6&version=NIV">
                    <p class="verse-text">"Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God."</p>
                    <cite class="verse-citation">— Philippians 4:6</cite>
                </blockquote>
            </div>
        </header>
        
        {% if disasters %}
        <section class="prayer-opportunities" aria-label="Current prayer opportunities">
            <header class="section-header">
                <h2 class="section-title">Communities Needing Our Prayers</h2>
                <p class="section-intro">Join us in lifting up these affected communities. Each prayer is crafted specifically for their situation, that we might intercede with understanding and compassion.</p>
            </header>

            <div class="disasters-grid" role="list">
                {% for disaster in disasters %}
                <article class="disaster-card {{ disaster.severity }}" itemscope itemtype="https://schema.org/Event" role="listitem" style="--card-index: {{ loop.index0 }}">
                    <header class="disaster-card-header-grouped">
                        <h3 class="disaster-type-title" itemprop="name">{{ disaster.type_display }}</h3>
                        <div class="country-flags-group" aria-label="Affected countries">
                            {% for flag_info in disaster.country_flags %}
                            <div class="flag-tooltip-wrapper">
                                <img src="/api/flags/{{ flag_info.flag_code }}"
                                     alt="{{ flag_info.country }} flag"
                                     class="country-flag-small"
                                     title="{{ flag_info.country }}"
                                     data-country="{{ flag_info.country }}"
                                     style="width: 32px; height: 24px; object-fit: fill; display: block; animation: none !important; transform: none !important; transition: none !important; border-radius: 0 !important; filter: none !important; border: none !important; box-shadow: none !important; will-change: auto !important; backface-visibility: visible !important; perspective: none !important; -webkit-transform: none !important; cursor: pointer;"
                                     onerror="this.src='/api/flags/xx';">
                                <span class="flag-tooltip">{{ flag_info.country }}</span>
                            </div>
                            {% endfor %}
                        </div>
                    </header>

                    {% if disaster.summary %}
                    <div class="disaster-news-summary" itemprop="description">
                        {{ disaster.summary }}
                    </div>
                    {% endif %}

                    <footer class="disaster-card-footer">
                        <a href="/globalprayerwatch/{{ disaster.url_slug }}" class="prayer-cta-primary" aria-label="Join in prayer for {{ disaster.type_display }}">
                            <span class="cta-text">Join in Prayer</span>
                            <svg class="cta-arrow" width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8.5 13.5L13.5 8.5M13.5 8.5H10.1667M13.5 8.5V11.8333" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </a>
                    </footer>
                </article>
                {% endfor %}
            </div>
        </section>
        {% else %}
        <section class="empty-state" aria-label="No current prayer needs" role="status">
            <div class="empty-content">
                <div class="empty-icon">🙏</div>
                <h2 class="empty-title">Praise God</h2>
                <p class="empty-message">No breaking disasters requiring immediate prayer in recent hours.</p>
                <p class="empty-cta">Continue in prayer with our <a href="/prayers">daily global prayer</a> covering ongoing needs worldwide.</p>
            </div>
        </section>
        {% endif %}
        
        <section class="prayer-resources" aria-label="Additional prayer resources">
            <header class="section-header">
                <h2 class="section-title">Continue in Prayer Together</h2>
                <p class="section-intro">Prayer is a gift we share as the body of Christ. Whether you're seeking prayer or want to join others in intercession, we're here to walk alongside you.</p>
            </header>
            <nav class="resource-links" aria-label="Prayer resources">
                <a href="/prayers" class="resource-link">
                    <span class="link-icon">🙏</span>
                    <span class="link-text">Daily Global Prayer</span>
                </a>
                <a href="/prayers" class="resource-link">
                    <span class="link-icon">👥</span>
                    <span class="link-text">Join Prayer Room</span>
                </a>
                <a href="/home#organizations" class="resource-link">
                    <span class="link-icon">🤝</span>
                    <span class="link-text">Find Relief Organizations</span>
                </a>
            </nav>
        </section>
    </div>
</main>
{% endblock %}
"""


@seo_bp.route("/globalprayerwatch")
def disasters_hub():
    """Hub page showing all current disasters grouped by type from hourly breaking news monitoring"""
    try:
        from flask import current_app
        from backend.services.disaster.disaster_prayer_service import get_disaster_prayer_service

        # Get disaster prayer service
        service = get_disaster_prayer_service(current_app.storage_handler)

        # Get active disaster prayers (prioritizes grouped prayers)
        disaster_prayers = service.get_active_disaster_prayers()

        # Normalize disaster types function (matches disaster_prayer_service normalization)
        def normalize_disaster_type_for_display(disaster_type: str) -> str:
            """Normalize disaster type to standard format for grouping"""
            disaster_type = disaster_type.lower().strip()
            type_mapping = {
                "hurricane": "typhoon",
                "cyclone": "typhoon",
                "storm": "typhoon",  # Normalize storm to typhoon (same weather system type)
                "flooding": "flood",
                "wildfire": "fire",
                "volcanic_eruption": "volcano",
                "pandemic": "epidemic",
                "war": "conflict",
                "refugee_crisis": "conflict",
                "mass shooting": "mass_shooting",
                "gun violence": "mass_shooting",
                "plane crash": "major_accident",
                "plane_crash": "major_accident",
                "aviation accident": "major_accident",
                "airport incident": "major_accident",
                "train derailment": "major_accident",
                "building collapse": "major_accident",
                "explosion": "major_accident",
            }
            return type_mapping.get(disaster_type, disaster_type)

        # First pass: Collect all entries by normalized type
        entries_by_normalized_type = {}
        for prayer_data in disaster_prayers:
            # Check if it's a grouped prayer
            if prayer_data.get("is_grouped") or prayer_data.get("affected_countries"):
                disaster_type = prayer_data.get("disaster_type", "")
                # Normalize the type for grouping (storm -> typhoon, etc.)
                disaster_type_normalized = (
                    normalize_disaster_type_for_display(disaster_type).replace(" ", "_").replace("-", "_")
                )

                if disaster_type_normalized not in entries_by_normalized_type:
                    entries_by_normalized_type[disaster_type_normalized] = []
                entries_by_normalized_type[disaster_type_normalized].append(prayer_data)

        # Second pass: Merge countries from all entries of the same normalized type, keep most recent
        disasters_by_type = {}
        for disaster_type_normalized, entries in entries_by_normalized_type.items():
            if len(entries) == 1:
                # Only one entry, use it as-is
                disasters_by_type[disaster_type_normalized] = entries[0]
            else:
                # Multiple entries - merge countries and keep most recent
                logger.info(f"Merging {len(entries)} entries for normalized type {disaster_type_normalized}")

                # Find the most recent entry
                most_recent_entry = max(
                    entries, key=lambda x: datetime.fromisoformat(x.get("created_at", "2000-01-01"))
                )

                # Merge all countries from all entries
                all_countries = set()
                for entry in entries:
                    all_countries.update(entry.get("affected_countries", []))

                # Update the most recent entry with merged countries
                most_recent_entry["affected_countries"] = list(all_countries)
                disasters_by_type[disaster_type_normalized] = most_recent_entry

                logger.info(
                    f"Merged {len(entries)} entries for {disaster_type_normalized}: {len(all_countries)} total countries"
                )

        # Transform to display format
        grouped_disasters = []
        for disaster_type, prayer_data in disasters_by_type.items():
            affected_countries = prayer_data.get("affected_countries", [])

            # Get flag codes for all affected countries
            country_flags = []
            for country in affected_countries:
                flag_code = get_country_flag_code(country)
                if flag_code:
                    country_flags.append({"country": country, "flag_code": flag_code})

            # Create URL slug
            disaster_slug = disaster_type.lower().replace("_", "-").replace(" ", "-")
            url_slug = disaster_slug

            grouped_disasters.append(
                {
                    "type": disaster_type,
                    "type_display": prayer_data.get(
                        "disaster_type_display", disaster_type.replace("_", " ").replace("-", " ").title()
                    ),
                    "affected_countries": affected_countries,
                    "country_flags": country_flags,
                    "summary": _clean_citation_markers(prayer_data.get("summary", "")),
                    "severity": prayer_data.get("overall_severity", "moderate"),
                    "created_at": prayer_data.get("created_at", ""),
                    "url_slug": url_slug,
                    "prayer_id": prayer_data.get("id", ""),
                }
            )

        # Sort by created_at (most recent first) and severity
        severity_order = {"catastrophic": 0, "severe": 1, "moderate": 2, "minor": 3}
        grouped_disasters.sort(
            key=lambda x: (severity_order.get(x.get("severity", "moderate"), 3), x.get("created_at", "")), reverse=True
        )

        today = datetime.now()

        return render_template_string(
            DISASTERS_HUB_TEMPLATE,
            disasters=grouped_disasters,
            disasters_by_country={},  # Keep for backward compatibility
            today=today.strftime("%B %d, %Y"),
        )

    except Exception as e:
        logger.error(f"Error rendering disasters hub: {e}")
        return jsonify({"error": "Failed to load disasters"}), 500


@seo_bp.route("/api/flags/<country_code>")
def proxy_flag(country_code):
    """Proxy flag images to avoid CORB issues"""
    try:
        # Use correct flagcdn.com format: 60x45 (width x height) instead of w60
        flag_url = f"https://flagcdn.com/60x45/{country_code.lower()}.png"
        logger.info(f"Fetching flag from {flag_url} for country code {country_code}")
        response = requests.get(flag_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})

        logger.info(
            f"Flag response status: {response.status_code}, content length: {len(response.content)}, content-type: {response.headers.get('Content-Type', 'unknown')}"
        )

        if response.status_code == 200 and len(response.content) > 100:
            return Response(
                response.content,
                mimetype="image/png",
                headers={
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*",
                    "Content-Length": str(len(response.content)),
                },
            )
        else:
            logger.warning(
                f"Flag request failed for {country_code}: status={response.status_code}, size={len(response.content)}"
            )
            # Fallback to default flag
            fallback_url = "https://flagcdn.com/60x45/xx.png"
            fallback_response = requests.get(fallback_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
            if fallback_response.status_code == 200 and len(fallback_response.content) > 100:
                return Response(
                    fallback_response.content,
                    mimetype="image/png",
                    headers={
                        "Cache-Control": "public, max-age=86400",
                        "Access-Control-Allow-Origin": "*",
                        "Content-Length": str(len(fallback_response.content)),
                    },
                )
    except Exception as e:
        logger.error(f"Error proxying flag {country_code}: {e}", exc_info=True)

    # Return empty 1x1 transparent PNG if all else fails
    logger.warning(f"Returning transparent PNG fallback for {country_code}")
    transparent_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
    return Response(transparent_png, mimetype="image/png", headers={"Cache-Control": "no-cache"})
