#!/usr/bin/env python3
"""Quick script to check today's prayer"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from datetime import datetime
from backend.integrations.storage_handler import StorageHandler

today = datetime.now().strftime('%Y-%m-%d')
storage = StorageHandler()
prayer = storage.get_prayer(today)

if prayer:
    content = prayer.get('content', '') if isinstance(prayer, dict) else str(prayer)
    print(f"✅ Prayer found for {today}")
    print(f"Word count: {len(content.split())}")
    print(f"\nContent:\n{content}")
    
    # Check for mentions
    mentions_shootings = 'shooting' in content.lower() or 'gun' in content.lower() or 'mass' in content.lower()
    mentions_wars = 'war' in content.lower() or 'conflict' in content.lower() or 'battle' in content.lower()
    
    if mentions_shootings:
        print("\n✅ Mentions shootings/gun violence")
    if mentions_wars:
        print("✅ Mentions wars/conflicts")
else:
    print(f"❌ No prayer found for {today}")
