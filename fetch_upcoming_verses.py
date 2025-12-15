#!/usr/bin/env python3
"""Script to fetch upcoming verses from the API"""
import requests
from datetime import datetime

def fetch_upcoming_verses():
    """Fetch the next 7 verses starting from today"""
    today = datetime.now().strftime('%Y-%m-%d')
    
    # Try production first
    url = f"https://divinebridge.io/api/upcoming-verses?client_date={today}"
    
    try:
        print(f"Fetching verses from: {url}")
        response = requests.get(url, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                verses = data.get('verses', [])
                print(f"\n✅ Found {len(verses)} verses:\n")
                for i, verse in enumerate(verses, 1):
                    print(f"{i}. {verse['day_name']}, {verse['date']}")
                    print(f"   \"{verse['verse']}\"")
                    print(f"   — {verse['reference']}")
                    print(f"   (Day of year: {verse['day_of_year']})")
                    print()
                return verses
            else:
                print(f"❌ API returned success=False: {data.get('error', 'Unknown error')}")
        else:
            print(f"❌ HTTP {response.status_code}: {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching from production: {e}")
        print("\nTrying local server...")
        
        # Try local
        url = f"http://localhost:5001/api/upcoming-verses?client_date={today}"
        try:
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    verses = data.get('verses', [])
                    print(f"\n✅ Found {len(verses)} verses:\n")
                    for i, verse in enumerate(verses, 1):
                        print(f"{i}. {verse['day_name']}, {verse['date']}")
                        print(f"   \"{verse['verse']}\"")
                        print(f"   — {verse['reference']}")
                        print(f"   (Day of year: {verse['day_of_year']})")
                        print()
                    return verses
        except requests.exceptions.RequestException as e2:
            print(f"❌ Local server also failed: {e2}")
            print("\n💡 Make sure the server is running or deploy the latest changes.")
    
    return None

if __name__ == '__main__':
    fetch_upcoming_verses()
