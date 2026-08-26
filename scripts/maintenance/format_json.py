import json
import os
import sys

def format_json_string(s):
    # Remove any BOM markers
    s = s.encode('utf-8').decode('utf-8-sig')
    
    # Replace literal \n with actual newlines
    s = s.replace('\\n', '\n')
    
    # Remove any carriage returns
    s = s.replace('\r', '')
    
    # Handle escaped quotes
    s = s.replace('\\"', '"')
    
    # Try to parse as JSON
    try:
        data = json.loads(s)
        return json.dumps(data, indent=2)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}", file=sys.stderr)
        # Try cleaning the string further
        s = ''.join(c for c in s if c.isprintable() or c in '\n\t')
        try:
            data = json.loads(s)
            return json.dumps(data, indent=2)
        except json.JSONDecodeError as e2:
            print(f"Error parsing cleaned JSON: {e2}", file=sys.stderr)
            return None

if __name__ == '__main__':
    # Read input from stdin
    input_json = sys.stdin.read()
    formatted_json = format_json_string(input_json)
    if formatted_json:
        print(formatted_json)
    else:
        sys.exit(1) 