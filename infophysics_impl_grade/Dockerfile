FROM python:3.11-slim

WORKDIR /app

# Install libpq for psycopg3 binary
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" pydantic "psycopg[binary,pool]" python-dotenv "anthropic>=0.25" "bcrypt>=4.0" "python-multipart>=0.0.6"

# Copy application code
COPY api/ ./api/
COPY migrations/ ./migrations/

# Copy startup script and strip any CRLF line endings
COPY start.sh ./
RUN sed -i 's/\r//' start.sh && chmod +x start.sh

# Run migrations then start server
CMD ["sh", "start.sh"]
