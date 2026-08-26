# Local Development Guide

## Quick Start

### 1. Kill Existing Processes on Port 5001

If you need to stop the application or if port 5001 is already in use:

```bash
# Kill all processes on port 5001
lsof -ti:5001 | xargs kill -9

# Alternative method (if the above doesn't work)
sudo lsof -ti:5001 | xargs sudo kill -9

# Verify port is free
lsof -i:5001
```

### 2. Start the Application

```bash
# Navigate to project directory
cd /Users/jeancalmerekubwayo/Documents/divineBridge

# Activate virtual environment
source venv/bin/activate

# Start the Flask application
python app.py
```

### 3. Verify Application is Running

```bash
# Check if process is running
ps aux | grep -E "(python|app\.py)" | grep -v grep

# Check if port 5001 is in use
lsof -i:5001

# Test HTTP response
curl -s -o /dev/null -w "%{http_code}" http://localhost:5001
# Expected: 302 (redirect response)
```

## Detailed Steps

### Prerequisites

1. **Python 3.13+** installed
2. **Virtual environment** created and activated
3. **Dependencies** installed from `requirements.txt`

### Step-by-Step Startup Process

#### 1. Environment Setup

```bash
# Navigate to project root
cd /Users/jeancalmerekubwayo/Documents/divineBridge

# Activate virtual environment
source venv/bin/activate

# Verify Python version
python --version
# Expected: Python 3.13.x
```

#### 2. Dependency Check

```bash
# Install/update dependencies
pip install -r requirements.txt

# Verify key packages are installed
pip list | grep -E "(Flask|firebase-admin|flask-limiter)"
```

#### 3. Application Startup

```bash
# Start the application
python app.py
```

**Expected startup output:**
```
2025-10-29 15:44:47,959 - config - INFO - Successfully initialized Secret Manager client
2025-10-29 15:44:47,959 - config - INFO - GOOGLE_CLOUD_PROJECT not in environment, trying Secret Manager
...
INFO:__main__:Application initialized successfully
INFO:__main__:Environment: production
INFO:__main__:Debug mode: False
INFO:werkzeug:WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.
 * Running on http://127.0.0.1:5001
INFO:werkzeug:Press CTRL+C to quit
```

#### 4. Verification

```bash
# In a new terminal window, verify the application is running:

# Check process
ps aux | grep python | grep app.py

# Check port
lsof -i:5001
# Expected output:
# COMMAND   PID               USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
# Python  37392 jeancalmerekubwayo   16u  IPv4 0xc1abf4a696e49515      0t0  TCP localhost:commplex-link (LISTEN)

# Test HTTP response
curl -I http://localhost:5001
# Expected: HTTP/1.1 302 FOUND
```

## Troubleshooting

### Common Issues

#### 1. Port 5001 Already in Use

**Error:** `Address already in use`

**Solution:**
```bash
# Kill processes on port 5001
lsof -ti:5001 | xargs kill -9

# Wait a moment, then try again
sleep 2
python app.py
```

#### 2. Module Not Found Error

**Error:** `ModuleNotFoundError: No module named 'flask'`

**Solution:**
```bash
# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Try again
python app.py
```

#### 3. Permission Denied

**Error:** `Permission denied` when killing processes

**Solution:**
```bash
# Use sudo for killing processes
sudo lsof -ti:5001 | xargs sudo kill -9

# Or find the process and kill it manually
ps aux | grep python | grep app.py
kill -9 <PID>
```

#### 4. Application Not Responding

**Symptoms:** Process is running but no HTTP response

**Diagnosis:**
```bash
# Check if process is actually running
ps aux | grep python | grep app.py

# Check port binding
lsof -i:5001

# Check for error logs in the terminal where you started the app
# Look for ERROR or CRITICAL messages
```

**Solution:**
```bash
# Kill and restart
lsof -ti:5001 | xargs kill -9
source venv/bin/activate
python app.py
```

### Health Check Commands

#### Quick Health Check
```bash
# One-liner to check if app is running and responding
curl -s -o /dev/null -w "%{http_code}" http://localhost:5001 && echo " - App is running" || echo " - App is not responding"
```

#### Detailed Health Check
```bash
# Check process
echo "=== Process Check ==="
ps aux | grep -E "(python|app\.py)" | grep -v grep

# Check port
echo "=== Port Check ==="
lsof -i:5001

# Check HTTP response
echo "=== HTTP Response Check ==="
curl -I http://localhost:5001

# Check logs (if running in background)
echo "=== Recent Logs ==="
tail -n 20 app.log 2>/dev/null || echo "No log file found"
```

## Development Workflow

### Starting Development Session

1. **Kill any existing processes:**
   ```bash
   lsof -ti:5001 | xargs kill -9
   ```

2. **Activate environment and start:**
   ```bash
   source venv/bin/activate
   python app.py
   ```

3. **Verify in browser:**
   - Open `http://localhost:5001`
   - Should redirect to login or main page

### Stopping Development Session

1. **Graceful stop:** Press `Ctrl+C` in the terminal running the app
2. **Force stop:** Use the kill commands above

### Restarting After Changes

1. **Stop the app:** `Ctrl+C` or kill process
2. **Start again:** `python app.py`

## Environment Variables

The application uses Google Cloud Secret Manager for configuration. No local environment variables are required for basic operation.

## Logs

- **Console logs:** Displayed in the terminal where you run `python app.py`
- **File logs:** Check `app.log` for persistent logging
- **Error logs:** Check `auth.log` for authentication-related issues

## Security Features Active

When running locally, the following security features are active:
- ✅ Rate limiting on API endpoints
- ✅ Input validation and sanitization
- ✅ Session security
- ✅ CORS protection
- ✅ Request size limits

## Next Steps

Once the application is running:
1. Open `http://localhost:5001` in your browser
2. Test core functionality:
   - User registration/login
   - Prayer room creation
   - Chat functionality
   - WebRTC voice features
3. Monitor logs for any errors
4. Test with multiple browser windows for multi-user scenarios

---

**Note:** This is a development server. For production deployment, use a production WSGI server like Gunicorn as indicated in the startup logs.
