# Python backend only (frontend deployed separately via Vercel)
FROM python:3.12-slim
WORKDIR /app

# Install system dependencies (libpq5 for psycopg2, git for pip git dependencies)
RUN apt-get update && apt-get install -y libpq5 git && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Run the application (use PORT env var from Railway, default to 8000)
CMD ["sh", "-c", "python main.py --port ${PORT:-8000}"]
