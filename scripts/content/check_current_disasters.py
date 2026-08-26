#!/usr/bin/env python3
"""
Script to check current disaster list and identify old disasters that should be filtered out
"""
import sys
import os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from datetime import datetime, timedelta
from backend.services.disaster.disaster_prayer_service import get_disaster_prayer_service
from backend.integrations.storage_handler import StorageHandler
import json

def check_current_disasters():
    """Check all current disasters and their timestamps"""
    print("=" * 80)
    print("CHECKING CURRENT DISASTER LIST")
    print("=" * 80)
    print()
    
    storage = StorageHandler()
    service = get_disaster_prayer_service(storage)
    
    now = datetime.now()
    max_age = timedelta(days=7)
    current_year = datetime.now().year
    
    print(f"Current time: {now.isoformat()}")
    print(f"Current year: {current_year}")
    print(f"Max age: 7 days (before {now - max_age})")
    print()
    
    # Get all disaster prayers
    all_prayers = []
    blobs = storage.bucket.list_blobs(prefix='disaster_prayers/')
    
    print("Scanning all disaster prayers in storage...")
    print()
    
    for blob in blobs:
        if blob.name.endswith('.json'):
            try:
                content = blob.download_as_text()
                prayer_data = json.loads(content)
                all_prayers.append((blob.name, prayer_data))
            except Exception as e:
                print(f"Error reading {blob.name}: {e}")
                continue
    
    print(f"Found {len(all_prayers)} disaster prayers total")
    print()
    
    # Check each prayer
    old_disasters = []
    valid_disasters = []
    no_timestamp = []
    
    for blob_name, prayer_data in all_prayers:
        is_grouped = prayer_data.get('is_grouped', False) or 'grouped' in blob_name
        disaster_type = prayer_data.get('disaster_type', 'unknown')
        countries = prayer_data.get('affected_countries', [prayer_data.get('country', 'unknown')])
        created_at_str = prayer_data.get('created_at', '')
        timestamp_str = prayer_data.get('timestamp', '')
        
        print(f"\n{'=' * 80}")
        print(f"File: {blob_name}")
        print(f"Type: {disaster_type}")
        print(f"Countries: {', '.join(countries) if isinstance(countries, list) else countries}")
        print(f"Is Grouped: {is_grouped}")
        print(f"Created At: {created_at_str}")
        print(f"Disaster Timestamp: {timestamp_str}")
        
        # Check expiration
        expires_at_str = prayer_data.get('expires_at', '')
        if expires_at_str:
            try:
                expires_at = datetime.fromisoformat(expires_at_str)
                if expires_at <= now:
                    print(f"⚠️  EXPIRED (expired at {expires_at_str})")
                    old_disasters.append((blob_name, prayer_data, "expired"))
                    continue
            except:
                pass
        
        # Check timestamp
        if is_grouped:
            # For grouped prayers, check created_at
            if created_at_str:
                try:
                    created_at = datetime.fromisoformat(created_at_str)
                    age = now - created_at
                    if age > max_age:
                        print(f"❌ TOO OLD: Created {age.days} days ago (beyond 7-day limit)")
                        old_disasters.append((blob_name, prayer_data, f"created {age.days} days ago"))
                    elif created_at.year != current_year:
                        print(f"❌ WRONG YEAR: Created in {created_at.year} (not {current_year})")
                        old_disasters.append((blob_name, prayer_data, f"wrong year {created_at.year}"))
                    else:
                        print(f"✅ VALID: Created {age.days} days ago")
                        valid_disasters.append((blob_name, prayer_data))
                except Exception as e:
                    print(f"⚠️  ERROR parsing created_at: {e}")
                    no_timestamp.append((blob_name, prayer_data))
            else:
                print(f"⚠️  NO CREATED_AT timestamp")
                no_timestamp.append((blob_name, prayer_data))
        else:
            # For individual prayers, check disaster timestamp
            if timestamp_str:
                try:
                    disaster_time = None
                    try:
                        disaster_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                        if disaster_time.tzinfo:
                            disaster_time = disaster_time.replace(tzinfo=None)
                    except:
                        try:
                            for fmt in ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d']:
                                try:
                                    disaster_time = datetime.strptime(timestamp_str[:19], fmt)
                                    break
                                except:
                                    continue
                        except:
                            pass
                    
                    if disaster_time:
                        age = now - disaster_time
                        if disaster_time.year != current_year:
                            print(f"❌ WRONG YEAR: Disaster occurred in {disaster_time.year} (not {current_year})")
                            old_disasters.append((blob_name, prayer_data, f"wrong year {disaster_time.year}"))
                        elif age > max_age:
                            print(f"❌ TOO OLD: Disaster occurred {age.days} days ago (beyond 7-day limit)")
                            old_disasters.append((blob_name, prayer_data, f"occurred {age.days} days ago"))
                        elif age.days < 0:
                            print(f"❌ FUTURE TIMESTAMP: Disaster timestamp is in the future")
                            old_disasters.append((blob_name, prayer_data, "future timestamp"))
                        else:
                            print(f"✅ VALID: Disaster occurred {age.days} days ago")
                            valid_disasters.append((blob_name, prayer_data))
                    else:
                        # Check if contains old year string
                        if str(current_year - 1) in timestamp_str:
                            print(f"❌ OLD YEAR IN STRING: Timestamp contains {current_year - 1}")
                            old_disasters.append((blob_name, prayer_data, f"old year in string"))
                        else:
                            print(f"⚠️  COULD NOT PARSE TIMESTAMP: {timestamp_str}")
                            no_timestamp.append((blob_name, prayer_data))
                except Exception as e:
                    print(f"⚠️  ERROR parsing timestamp: {e}")
                    no_timestamp.append((blob_name, prayer_data))
            else:
                # No timestamp, check created_at as fallback
                if created_at_str:
                    try:
                        created_at = datetime.fromisoformat(created_at_str)
                        age = now - created_at
                        if age > max_age:
                            print(f"❌ TOO OLD (no timestamp, using created_at): Created {age.days} days ago")
                            old_disasters.append((blob_name, prayer_data, f"created {age.days} days ago (no timestamp)"))
                        else:
                            print(f"⚠️  NO TIMESTAMP, using created_at: Created {age.days} days ago")
                            valid_disasters.append((blob_name, prayer_data))
                    except:
                        print(f"⚠️  NO TIMESTAMP and could not parse created_at")
                        no_timestamp.append((blob_name, prayer_data))
                else:
                    print(f"⚠️  NO TIMESTAMP OR CREATED_AT")
                    no_timestamp.append((blob_name, prayer_data))
    
    # Summary
    print()
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total prayers found: {len(all_prayers)}")
    print(f"✅ Valid disasters (within 7 days): {len(valid_disasters)}")
    print(f"❌ Old/invalid disasters: {len(old_disasters)}")
    print(f"⚠️  No timestamp: {len(no_timestamp)}")
    print()
    
    if old_disasters:
        print("OLD/INVALID DISASTERS THAT SHOULD BE DELETED:")
        print("-" * 80)
        for blob_name, prayer_data, reason in old_disasters:
            disaster_type = prayer_data.get('disaster_type', 'unknown')
            countries = prayer_data.get('affected_countries', [prayer_data.get('country', 'unknown')])
            print(f"  - {blob_name}")
            print(f"    Type: {disaster_type}, Countries: {countries}")
            print(f"    Reason: {reason}")
            print()
    
    if no_timestamp:
        print("DISASTERS WITHOUT TIMESTAMPS:")
        print("-" * 80)
        for blob_name, prayer_data in no_timestamp:
            disaster_type = prayer_data.get('disaster_type', 'unknown')
            countries = prayer_data.get('affected_countries', [prayer_data.get('country', 'unknown')])
            print(f"  - {blob_name}")
            print(f"    Type: {disaster_type}, Countries: {countries}")
            print()
    
    return old_disasters, valid_disasters, no_timestamp

if __name__ == '__main__':
    old, valid, no_ts = check_current_disasters()
