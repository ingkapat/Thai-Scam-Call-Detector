FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# HF Spaces runs as uid 1000 — keep caches in writable dirs
ENV HF_HOME=/tmp/hf \
    TRANSFORMERS_CACHE=/tmp/hf \
    TEXT_MODEL_DIR=Paam1/phayathai_scam \
    ASR_MODEL_ID=biodatlab/whisper-th-medium-combined

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
