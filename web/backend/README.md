# Backend — Thai Scam Call Detector (two-stage streaming)

FastAPI service that mirrors the TA Parkinson pattern: load the model, serve with
uvicorn, let the static frontend call it.

## 1. Get the model

Download the **`phayathai_scam`** folder from Google Drive
(`MyDrive/ThaiScamCall/models/phayathai_scam`) and place it here:

```
backend/models/phayathai_scam/
  config.json
  model.safetensors
  tokenizer.json   (+ the other tokenizer files)
```

The ASR model (`biodatlab/whisper-th-medium-combined`, ~1.6 GB) downloads
automatically from HuggingFace on first run.

## 2. Install + run

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows  (use: source .venv/bin/activate on mac/linux)
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

First run downloads the ASR model (one time). When you see `[init] models ready`
it is serving on http://127.0.0.1:8000

> mp3 decoding needs ffmpeg available on PATH. If `librosa.load` fails on mp3,
> install ffmpeg (`winget install Gyan.FFmpeg` on Windows) and restart.

## 3. Point the frontend at it

Edit `../config.js`:

```js
window.API_URL = "http://127.0.0.1:8000";
```

Reload the page, upload an mp3 — the phone rings and the real predictions stream in.

## API

`POST /analyze`  (multipart form, field `file` = audio)

```json
{
  "duration": 95.2,
  "max_prob": 0.99,
  "final_pred": 1,
  "ttfd": 80.0,
  "rounds": [
    { "window": "0-5s", "context_sec": 5.0, "prob": 0.14, "transcript": "...", "latency": 1.2 }
  ]
}
```
