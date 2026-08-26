#!/usr/bin/env python3
"""List all cached organizations to find Moore Angels Inc"""

import json
from backend.integrations.storage_handler import StorageHandler

storage_handler = StorageHandler()
bucket = storage_handler.bucket

print("\n🔍 Searching all cached organization files...\n")
print("="*70)

blobs = bucket.list_blobs(prefix='nonprofit_cache/')
found_files = []

for blob in blobs:
    if blob.name.endswith('.json'):
        try:
            content = blob.download_as_string()
            data = json.loads(content)
            
            orgs = []
            if isinstance(data, list):
                orgs = data
            elif isinstance(data, dict) and 'organizations' in data:
                orgs = data.get('organizations', [])
            
            # Check for Moore Angels
            for org in orgs:
                if 'moore' in org.get('name', '').lower() or 'angel' in org.get('name', '').lower():
                    print(f"\n📁 File: {blob.name}")
                    print(f"   Organization: {org.get('name')}")
                    print(f"   Website: {org.get('website')}")
                    print(f"   Location: {org.get('location')}")
                    found_files.append((blob.name, org))
            
        except:
            pass

print("\n" + "="*70)
print(f"\nFound {len(found_files)} matching organization(s)")

if found_files:
    print("\n✅ Files to update:")
    for filename, org in found_files:
        print(f"  • {filename}")
else:
    print("\n⚠️  No organizations matching 'Moore' or 'Angel' found in cache")
    print("\nTrying alternative search...")
    
    # List all organization names
    print("\n📋 All cached organization names:\n")
    blob_count = 0
    for blob in bucket.list_blobs(prefix='nonprofit_cache/'):
        if blob.name.endswith('.json') and blob_count < 5:
            try:
                content = blob.download_as_string()
                data = json.loads(content)
                orgs = data if isinstance(data, list) else data.get('organizations', [])
                print(f"\n{blob.name}:")
                for org in orgs[:10]:
                    print(f"  • {org.get('name')}")
                blob_count += 1
            except:
                pass

