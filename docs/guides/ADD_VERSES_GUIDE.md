# Guide: Adding Verses to Daily Verse Collection

## Current Format

Verses are stored in `static/bible_verses.json` with the following structure:

```json
{
    "verses": [
        {
            "text": "Do you not know that you are God's temple and that God's Spirit dwells in you?",
            "reference": "1 Corinthians 3:16"
        },
        {
            "text": "For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.",
            "reference": "John 3:16"
        }
    ]
}
```

## Required Fields

Each verse object must have:
- **`text`** (string): The verse text/content
- **`reference`** (string): The Bible reference (e.g., "John 3:16", "Psalm 23:1-2")

## Format Requirements

1. **JSON Structure:**
   - Top-level object with `"verses"` key
   - `"verses"` is an array of verse objects
   - Each verse object has `"text"` and `"reference"` fields

2. **Text Field:**
   - Plain text (no HTML)
   - Can include punctuation
   - Should be the complete verse text

3. **Reference Field:**
   - Format: "Book Chapter:Verse" or "Book Chapter:Verse-Verse"
   - Examples:
     - "John 3:16"
     - "Psalm 23:1-2"
     - "1 Corinthians 3:16"
     - "Isaiah 41:10"

## How to Add Your 370 Verses

### Option 1: Provide the List (Recommended)

Provide your 370 verses in any format (CSV, text, etc.), and I can convert them to the correct JSON format.

**Example formats I can work with:**
- CSV: `"text","reference"`
- Text: One verse per line with text and reference separated by a delimiter
- JSON: Already in the correct format
- List: Simple list format

### Option 2: Manual JSON Format

If you want to format them yourself, use this template:

```json
{
    "verses": [
        {
            "text": "Your verse text here",
            "reference": "Book Chapter:Verse"
        },
        {
            "text": "Another verse text",
            "reference": "Another Book 1:1"
        }
    ]
}
```

## Current Status

- **File Location:** `static/bible_verses.json`
- **Current Count:** Check with: `python -c "import json; print(len(json.load(open('static/bible_verses.json'))['verses']))"`
- **Selection Method:** Verses are selected by day of year (1-366), cycling through the list

## After Adding Verses

1. The verses will be automatically loaded when the app starts
2. The verse generator will cycle through all verses based on day of year
3. With 370+ verses, you'll have enough for a full year plus extras

## Validation

Before adding, make sure:
- ✅ All verses have both `text` and `reference` fields
- ✅ JSON is valid (no syntax errors)
- ✅ Text is properly escaped (quotes, newlines, etc.)
- ✅ References follow the format "Book Chapter:Verse"

## Need Help?

If you provide your 370 verses in any format, I can:
1. Convert them to the correct JSON format
2. Merge them with existing verses
3. Validate the format
4. Add them to the file

Just share your verses list and I'll handle the formatting!

