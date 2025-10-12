#!/usr/bin/env python3
"""
Script to remove specific organization from cached data in Google Cloud Storage
"""

import json
import logging
from storage_handler import StorageHandler
from google.cloud import storage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def find_and_remove_organization(org_name_to_remove):
    """
    Find and remove an organization from all cached files
    
    Args:
        org_name_to_remove: Name of organization to remove (case-insensitive)
    """
    storage_handler = StorageHandler()
    bucket = storage_handler.bucket
    
    # List all blobs in nonprofit_cache directory
    blobs = bucket.list_blobs(prefix='nonprofit_cache/')
    
    removed_count = 0
    files_checked = 0
    
    for blob in blobs:
        if blob.name.endswith('.json'):
            files_checked += 1
            try:
                # Download and parse JSON
                content = blob.download_as_string()
                data = json.loads(content)
                
                # Check if this is an organizations array
                if isinstance(data, list):
                    original_count = len(data)
                    # Filter out the organization
                    filtered_data = [
                        org for org in data 
                        if org.get('name', '').lower() != org_name_to_remove.lower()
                    ]
                    
                    if len(filtered_data) < original_count:
                        # Organization was found and removed
                        logger.info(f"Found '{org_name_to_remove}' in {blob.name}")
                        logger.info(f"  Organizations before: {original_count}, after: {len(filtered_data)}")
                        
                        # Upload updated data
                        blob.upload_from_string(
                            json.dumps(filtered_data, indent=2),
                            content_type='application/json'
                        )
                        logger.info(f"  ✅ Updated {blob.name}")
                        removed_count += 1
                        
                elif isinstance(data, dict) and 'organizations' in data:
                    # Handle wrapped format
                    orgs = data.get('organizations', [])
                    original_count = len(orgs)
                    
                    filtered_orgs = [
                        org for org in orgs
                        if org.get('name', '').lower() != org_name_to_remove.lower()
                    ]
                    
                    if len(filtered_orgs) < original_count:
                        logger.info(f"Found '{org_name_to_remove}' in {blob.name}")
                        logger.info(f"  Organizations before: {original_count}, after: {len(filtered_orgs)}")
                        
                        data['organizations'] = filtered_orgs
                        blob.upload_from_string(
                            json.dumps(data, indent=2),
                            content_type='application/json'
                        )
                        logger.info(f"  ✅ Updated {blob.name}")
                        removed_count += 1
                        
            except Exception as e:
                logger.debug(f"Skipping {blob.name}: {e}")
                continue
    
    logger.info(f"\n{'='*60}")
    logger.info(f"SUMMARY:")
    logger.info(f"  Files checked: {files_checked}")
    logger.info(f"  Files updated: {removed_count}")
    logger.info(f"  Organization '{org_name_to_remove}' removed from {removed_count} cache files")
    logger.info(f"{'='*60}\n")
    
    return removed_count


if __name__ == "__main__":
    org_to_remove = "Moore Angels Inc"
    
    print(f"\n🔍 Searching for '{org_to_remove}' in cached organization data...")
    print(f"{'='*60}\n")
    
    count = find_and_remove_organization(org_to_remove)
    
    if count > 0:
        print(f"\n✅ Successfully removed '{org_to_remove}' from {count} cache file(s)!")
        print(f"\nThe organization will no longer appear for users.")
        print(f"Cached data has been updated in Google Cloud Storage.\n")
    else:
        print(f"\n⚠️  '{org_to_remove}' was not found in any cached files.")
        print(f"\nPossible reasons:")
        print(f"  • Organization name might be slightly different")
        print(f"  • Not in cache yet (only appears on first query)")
        print(f"  • Already removed\n")

