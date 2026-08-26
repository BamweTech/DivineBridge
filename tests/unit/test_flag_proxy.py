#!/usr/bin/env python3
"""
Test script for flag proxy endpoint
Run this locally to test the flag proxy before deploying
"""
import sys
import os

# Add the project root to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask
from backend.api.seo import seo_bp

app = Flask(__name__)
app.register_blueprint(seo_bp)


def test_flag_proxy():
    """Test the flag proxy endpoint"""
    print("Testing Flag Proxy Endpoint")
    print("=" * 50)

    test_codes = ["gb", "us", "id", "vn", "th", "pl", "lk"]

    with app.test_client() as client:
        for code in test_codes:
            response = client.get(f"/api/flags/{code}")
            print(f"\n{code.upper()}:")
            print(f"  Status: {response.status_code}")
            print(f"  Content-Type: {response.headers.get('Content-Type')}")
            print(f"  Content-Length: {len(response.data)} bytes")

            if response.status_code == 200 and len(response.data) > 100:
                print("  ✅ Success - Image data received")
            else:
                print("  ❌ Failed - Got fallback or error")

    print("\n" + "=" * 50)
    print("Test complete!")


if __name__ == "__main__":
    test_flag_proxy()
