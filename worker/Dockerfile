# ── Python worker image ───────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# System packages needed by Pillow and Tesseract OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Worker source files
COPY *.py ./

# -u = unbuffered stdout so logs appear immediately in docker compose logs
CMD ["python", "-u", "worker.py"]
