FROM python:3.9-slim

# Install system dependencies (ffmpeg needed for yt-dlp sometimes)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port (railway provides PORT env var)
ENV PORT=8000

# Start command
CMD uvicorn main:app --host 0.0.0.0 --port $PORT
