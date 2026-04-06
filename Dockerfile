# Use Python 3.11 slim image (3.9 has SSL session reuse bugs causing
# SSLZeroReturnError on long-lived gRPC/Firestore connections)
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies and fonts
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    && fc-cache -f -v \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create necessary directories
RUN mkdir -p logs prayers flask_session

# Create non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Set environment variables
ENV PORT=8080
ENV PYTHONUNBUFFERED=1
ENV FLASK_ENV=production
ENV FLASK_APP=app.py

# Expose the port
EXPOSE 8080

# Run the application with Gunicorn
# 4 workers (2x CPU) with 4 threads each = 16 concurrent handlers
# Matches containerConcurrency=16 in cloud-run-config.yaml
CMD exec gunicorn --bind :$PORT --workers 4 --threads 4 --timeout 120 --worker-class gthread app:app 