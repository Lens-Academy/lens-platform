# Python backend + static frontend (served by Python)
FROM python:3.12-slim
WORKDIR /app

# Install system dependencies including Node.js for frontend build
RUN apt-get update && apt-get install -y libpq5 git nodejs npm && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Build frontend
WORKDIR /app/web_frontend
RUN npm ci && npm run build

# Back to app root
WORKDIR /app

# Run migrations and start the application (use PORT env var from Railway, default to 8000)
CMD ["sh", "-c", "alembic upgrade head && python main.py --port ${PORT:-8000}"]
