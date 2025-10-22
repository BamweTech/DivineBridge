# Quick Start: Testing with Local Storage

## TL;DR
```bash
# Enable local storage for testing
export USE_LOCAL_STORAGE=true

# Run the test suite
python3 test_local_moderation.py

# Start the app with local storage
python3 app.py
```

## What This Does

✅ **No Cloud Storage** - All data stored locally in `local_storage_data/`  
✅ **No Production Impact** - Test freely without affecting live data  
✅ **AI Moderation** - Test content moderation with Perplexity AI  
✅ **Fast & Offline** - Works without internet (except for AI calls)

## Test Results You Should See

```
Good Content Approved: ✅ PASS
Spam Content Rejected: ✅ PASS
Offensive Content Rejected: ✅ PASS
Local Storage Working: ✅ PASS
```

## Testing Different Content Types

### ✅ Good Content (Should Be Approved)
- "Please pray for my sick grandmother"
- "Thank God for healing my father"
- "Prayer for strength during difficult times"

### ❌ Spam (Should Be Rejected)
- "Buy our miracle water for $99"
- "Visit mywebsite.com for blessed oils"
- "Call 555-1234 for instant healing"

### ❌ Offensive (Should Be Rejected)
- Hate speech against any group
- Threats or harassment
- Explicit/sexual content

## View Stored Data

```bash
# View all prayer requests
cat local_storage_data/prayer_requests/*/*.json | jq

# View all testimonies
cat local_storage_data/testimonies/*/*.json | jq

# Count total items
find local_storage_data -name "*.json" | wc -l
```

## Clean Up Test Data

```bash
# Delete all local test data
rm -rf local_storage_data/
```

## Switch Back to Production

```bash
# Disable local storage
unset USE_LOCAL_STORAGE

# Or explicitly set to false
export USE_LOCAL_STORAGE=false
```

## Common Issues

### ❌ Still using Cloud Storage?
**Problem**: You see "☁️ Using CloudStorageHandler" instead of "🔧 Using LocalStorageHandler"

**Solution**:
```bash
# Make sure environment variable is set BEFORE running
export USE_LOCAL_STORAGE=true
python3 app.py  # You should see "🔧 Using LocalStorageHandler"
```

### ❌ AI Moderation not working?
**Problem**: All content auto-approved or errors in logs

**Solution**: Check your Perplexity API key is set in Secret Manager
```bash
gcloud secrets versions access latest --secret="perplexity-api-key"
```

### ❌ Permission errors on local_storage_data/?
**Problem**: Can't write to local storage directory

**Solution**:
```bash
rm -rf local_storage_data/
mkdir -p local_storage_data
chmod 755 local_storage_data
```

## Pro Tips

1. **Always test locally first** - Use local storage for all new features
2. **Review moderation logs** - Check what content is being rejected and why
3. **Test edge cases** - Try borderline content to tune moderation sensitivity
4. **Clear data between tests** - Fresh start prevents confusion
5. **Never commit test data** - `local_storage_data/` is in `.gitignore`

## Next Steps

After testing locally:
1. ✅ Verify moderation is working correctly
2. ✅ Test all user flows (submit, view, approve)
3. ✅ Check logs for any errors
4. ✅ Clear test data: `rm -rf local_storage_data/`
5. ✅ Switch back to Cloud Storage: `unset USE_LOCAL_STORAGE`
6. ✅ Test in production (if needed)

For more details, see [LOCAL_STORAGE_GUIDE.md](LOCAL_STORAGE_GUIDE.md)

