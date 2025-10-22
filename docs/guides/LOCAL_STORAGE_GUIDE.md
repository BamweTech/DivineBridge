# Local Storage System for Testing

This guide explains how to use the local file-based storage system for testing prayer requests, testimonies, and content moderation without affecting production data.

## Overview

The local storage system (`local_storage.py`) provides a JSON-based file storage that mirrors the Cloud Storage interface. It's perfect for:
- Testing content moderation without creating real prayer requests
- Rapid development and testing
- Offline development
- Avoiding accidental production data modifications

## Setup

### 1. Enable Local Storage

Set the environment variable before running your app or tests:

```bash
export USE_LOCAL_STORAGE=true
```

Or in your shell configuration (`.zshrc`, `.bashrc`, etc.):

```bash
echo 'export USE_LOCAL_STORAGE=true' >> ~/.zshrc
source ~/.zshrc
```

### 2. Verify It's Working

When you start the app, you should see:
```
🔧 Using LocalStorageHandler for development
```

Instead of:
```
☁️  Using CloudStorageHandler for production
```

## Directory Structure

Local storage creates a `local_storage_data/` directory with the following structure:

```
local_storage_data/
├── prayer_requests/
│   └── 2025-10-20/
│       ├── uuid1.json
│       └── uuid2.json
├── testimonies/
│   └── 2025-10-20/
│       └── uuid3.json
├── prayers/
│   └── 2025-10-20.json
├── images/
│   ├── verse_2025-10-20.png
│   └── prayer_2025-10-20.png
└── organizations/
    └── cached_orgs.json
```

## Usage

### Running the Test Suite

The included test script demonstrates all functionality:

```bash
# Make it executable
chmod +x test_local_moderation.py

# Run the tests
python3 test_local_moderation.py
```

This will test:
1. ✅ Good content (should be approved)
2. ❌ Spam/advertising (should be rejected)
3. ❌ Offensive content (should be rejected)
4. 💾 Prayer request storage
5. 💾 Testimony storage

### Using with the Flask App

```bash
# Set environment variable
export USE_LOCAL_STORAGE=true

# Run the app
python3 app.py
```

Now all prayer requests and testimonies submitted through the app will be stored locally in `local_storage_data/`.

### Viewing Stored Data

All data is stored as human-readable JSON files:

```bash
# View a prayer request
cat local_storage_data/prayer_requests/2025-10-20/*.json | jq

# View all testimonies
cat local_storage_data/testimonies/*/*.json | jq

# Count prayer requests
find local_storage_data/prayer_requests -name "*.json" | wc -l
```

### Clearing Test Data

To clear all local storage:

```bash
rm -rf local_storage_data/
```

Or use the Python API:

```python
from local_storage import LocalStorageHandler

storage = LocalStorageHandler()
storage.clear_all()
```

## API Reference

### LocalStorageHandler Methods

#### Prayer Requests
- `save_prayer_request(prayer_data)` - Save a new prayer request
- `get_prayer_request(prayer_id, date_str)` - Get a specific prayer request
- `get_all_prayer_requests(limit=50)` - Get all prayer requests (newest first)
- `update_prayer_request(prayer_id, updates, date_str)` - Update a prayer request
- `delete_prayer_request(prayer_id, date_str)` - Delete a prayer request

#### Testimonies
- `save_testimony(testimony_data)` - Save a new testimony
- `get_testimony(testimony_id, date_str)` - Get a specific testimony
- `get_all_testimonies(approved_only=True, limit=50)` - Get testimonies
- `update_testimony(testimony_id, updates)` - Update a testimony

#### Daily Prayers
- `save_prayer(date_str, prayer_text)` - Save a daily prayer
- `get_prayer(date_str)` - Get a daily prayer

#### Images
- `save_verse_image(date_str, image_data)` - Save verse image
- `get_verse_image(date_str)` - Get verse image
- `save_prayer_image(date_str, image_data)` - Save prayer image
- `get_prayer_image(date_str)` - Get prayer image

#### Utilities
- `get_stats()` - Get storage statistics
- `clear_all()` - Clear all local storage (⚠️ use with caution!)

## Testing Content Moderation

### Manual Testing

```python
from content_moderator import moderate_content

# Test good content
result = moderate_content(
    "Prayer for healing",
    "Please pray for my sick grandmother",
    "prayer_request"
)
print(f"Approved: {result['approved']}")
print(f"Summary: {result['summary']}")

# Test spam
result = moderate_content(
    "Buy miracle pills",
    "Visit our website to buy miracle pills for only $99",
    "prayer_request"
)
print(f"Approved: {result['approved']}")
print(f"Reason: {result.get('reason', 'N/A')}")
```

### Testing via API

```bash
# Submit a good prayer request
curl -X POST http://localhost:5001/api/prayer/request \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Prayer for healing",
    "content": "Please pray for my recovery"
  }'

# Submit spam (should be rejected)
curl -X POST http://localhost:5001/api/prayer/request \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Buy products",
    "content": "Visit mywebsite.com to buy our amazing products"
  }'
```

## Switching Back to Production

To use Cloud Storage again:

```bash
# Unset the environment variable
unset USE_LOCAL_STORAGE

# Or set it to false
export USE_LOCAL_STORAGE=false
```

## Best Practices

1. **Always use local storage for testing** - Never test content moderation with production storage
2. **Clear test data regularly** - Keep your `local_storage_data/` directory clean
3. **Review moderation results** - Check that the AI is correctly identifying problematic content
4. **Test edge cases** - Try borderline content to ensure the moderation is balanced
5. **Commit with production storage** - Always `unset USE_LOCAL_STORAGE` before deploying

## Troubleshooting

### Data not appearing in local storage

Check that:
1. `USE_LOCAL_STORAGE=true` is set
2. You see "🔧 Using LocalStorageHandler for development" in logs
3. The `local_storage_data/` directory exists
4. File permissions are correct

### API still using Cloud Storage

Restart the Flask app after setting the environment variable:

```bash
export USE_LOCAL_STORAGE=true
pkill -f "python.*app.py"  # Kill existing process
python3 app.py              # Start fresh
```

## Notes

- Local storage does not require Google Cloud credentials
- Data is stored as JSON files, not blobs
- File paths are relative to the project root
- Images are stored as `.png` files
- All timestamps use ISO 8601 format

## Support

If you encounter issues:
1. Check the app logs for errors
2. Verify the `local_storage_data/` directory structure
3. Ensure proper file permissions
4. Try clearing and regenerating the data

