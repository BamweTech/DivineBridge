# Analysis: Why Disaster Search Prompt Returns Empty Results

## Current Situation

Based on logs from December 15, 2025 at 14:09 UTC, Perplexity (`sonar-reasoning-pro`) is:
1. ✅ Correctly understanding the prompt
2. ✅ Searching for disasters
3. ✅ Finding relevant disasters (Russian strikes, Indonesia floods, etc.)
4. ❌ Filtering them out because they're outside the strict 12-hour window
5. ❌ Returning `[]` because nothing matches the criteria

## Issues Identified

### 1. **Overly Strict Time Window**
- Prompt mentions "LAST 12 HOURS" **4 times** (lines 63, 68, 87, 111)
- This creates a very strict filter that excludes valid recent disasters
- Perplexity found disasters from yesterday (Dec 14) but correctly excluded them

### 2. **Search Query Limitations**
The prompt suggests search queries like:
- `"earthquake today"` - too generic, may not catch recent events
- `"earthquake [country] [date]"` - requires knowing specific countries
- Missing time-specific search operators

### 3. **Model Behavior**
`sonar-reasoning-pro` is being very literal and strict:
- It's correctly identifying disasters
- But applying the time filter too strictly
- Not using fuzzy matching for "recent" vs "exactly 12 hours"

### 4. **Missing Flexibility**
- No fallback for "recent disasters" if nothing in exact window
- No guidance on how to handle "developing" situations
- No instruction to include disasters that are "ongoing" even if started slightly earlier

## What Perplexity Found (But Excluded)

From the logs, Perplexity found:
1. **Russian strikes in Ukraine** (Dec 14) - excluded (yesterday, not last 12 hours)
2. **Indonesia floods** (early December) - excluded (too old)
3. **EFAS flood alerts** (Dec 15) - excluded (just alerts, not actual disasters)
4. **La Niña impacts** - excluded (ongoing pattern, not breaking disaster)

## Recommendations

### Option 1: Make Time Window More Flexible (Recommended)
Change from strict "LAST 12 HOURS" to:
- "LAST 12-24 HOURS" or "RECENT disasters from the past 24 hours"
- Include "developing situations" even if started slightly earlier
- Add: "If a disaster occurred within 24 hours and is still developing, include it"

### Option 2: Improve Search Strategy
- Add more specific time-based queries: `"disaster breaking news last 12 hours"`
- Include: `"natural disaster news December 15 2025"`
- Add: `"emergency response today"` or `"disaster alert today"`

### Option 3: Add Fallback Logic
- If no disasters found in 12 hours, expand to 24 hours
- Include "ongoing disasters" that started recently but are still active
- Add instruction: "If no disasters in exact 12-hour window, include the most recent disasters from the past 24 hours"

### Option 4: Change Model Behavior
- Consider using `sonar-pro` instead of `sonar-reasoning-pro` for less strict reasoning
- Or add explicit instruction: "Be flexible with time windows - if a disaster occurred recently and is still developing, include it"

## Proposed Prompt Changes

### Change 1: More Flexible Time Window
```python
# OLD:
"You are a breaking news monitor searching for disasters and crises that occurred in the LAST 12 HOURS worldwide."

# NEW:
"You are a breaking news monitor searching for RECENT disasters and crises that occurred in the LAST 12-24 HOURS worldwide. Include disasters that are still developing or ongoing even if they started slightly earlier."
```

### Change 2: Better Search Instructions
```python
# ADD:
"Use time-specific search queries:
- 'disaster breaking news last 12 hours'
- 'natural disaster news [today's date]'
- 'emergency response [today]'
- 'disaster alert [current date]'
- Search for 'developing disaster' or 'ongoing emergency'"
```

### Change 3: More Flexible Filtering
```python
# OLD:
"CRITICAL: Only include disasters that occurred in the LAST 12 HOURS. Check timestamps carefully."

# NEW:
"CRITICAL: Prioritize disasters from the LAST 12 HOURS, but also include:
- Disasters from the past 24 hours that are still developing
- Ongoing emergencies that started recently
- Breaking news about disasters even if exact timing is unclear
- If no disasters in exact 12-hour window, include the most recent disasters from the past 24 hours"
```

### Change 4: Add Context About "Recent"
```python
# ADD:
"Time Window Guidance:
- PRIMARY: Disasters from the last 12 hours (highest priority)
- SECONDARY: Disasters from 12-24 hours ago that are still developing or have breaking updates
- INCLUDE: Ongoing disasters that started recently and are still active
- EXCLUDE: Disasters older than 24 hours unless there are significant new developments"
```

## Testing Recommendations

1. Test with the more flexible prompt
2. Monitor logs to see if Perplexity finds more disasters
3. Check if the results are still relevant and recent enough
4. Adjust the window based on results (maybe 18 hours is the sweet spot?)

## Expected Outcome

With these changes, we should:
- ✅ Find more disasters (expanding from 12 to 24 hours)
- ✅ Include ongoing/developing situations
- ✅ Still prioritize the most recent disasters
- ✅ Reduce empty result rate
