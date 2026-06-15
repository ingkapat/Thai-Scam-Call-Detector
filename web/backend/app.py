"""Thai Scam Call Detector — backend (two-stage streaming).

Mirrors the TA Parkinson pattern: a small FastAPI app loaded with the model,
served by uvicorn, called by the static frontend.

Pipeline (from notebook/experiment2 `predict_two_stage_streaming`):
  every 5s chunk -> Whisper-th ASR -> accumulate text -> PhayaThaiBERT classify
  -> prob_scam for the growing context.

Run:
  pip install -r requirements.txt
  # put the PhayaThaiBERT folder at  backend/models/phayathai_scam
  uvicorn app:app --host 0.0.0.0 --port 8000
"""
import io
import os
import time

import numpy as np
import librosa
import torch
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from transformers import (
    AutoProcessor, AutoModelForSpeechSeq2Seq,
    AutoTokenizer, AutoModelForSequenceClassification,
)

# ---- config ----------------------------------------------------------------
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SR = 16000
CHUNK_SEC = 5            # slide forward 5s / round
MAX_CONTEXT_SEC = 15     # bounded sliding window = 15s (matches training)
SCAM_THRESHOLD = 0.5

ASR_MODEL_ID = os.getenv("ASR_MODEL_ID", "biodatlab/whisper-th-medium-combined")
# download the `phayathai_scam` folder from Drive into backend/models/
TEXT_MODEL_DIR = os.getenv(
    "TEXT_MODEL_DIR",
    os.path.join(os.path.dirname(__file__), "models", "phayathai_scam"),
)

print(f"[init] device={DEVICE}")
print(f"[init] loading ASR: {ASR_MODEL_ID}")
asr_processor = AutoProcessor.from_pretrained(ASR_MODEL_ID)
asr_model = AutoModelForSpeechSeq2Seq.from_pretrained(
    ASR_MODEL_ID,
    dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
).to(DEVICE).eval()

print(f"[init] loading text classifier: {TEXT_MODEL_DIR}")
text_tok = AutoTokenizer.from_pretrained(TEXT_MODEL_DIR)
text_model = AutoModelForSequenceClassification.from_pretrained(TEXT_MODEL_DIR).to(DEVICE).eval()
print("[init] models ready")


@torch.no_grad()
def asr_transcribe(chunk):
    inputs = asr_processor(chunk, sampling_rate=SR, return_tensors="pt")
    inputs = {k: v.to(DEVICE, dtype=asr_model.dtype if v.dtype == torch.float32 else v.dtype)
              for k, v in inputs.items()}
    gen = asr_model.generate(**inputs, language="th", task="transcribe", max_new_tokens=128)
    return asr_processor.batch_decode(gen, skip_special_tokens=True)[0].strip()


@torch.no_grad()
def text_classify(text):
    enc = text_tok(text, truncation=True, max_length=256, return_tensors="pt").to(DEVICE)
    logits = text_model(**enc).logits
    return torch.softmax(logits, dim=-1).cpu().numpy()[0]


def predict_two_stage(wav):
    """Overlap sliding window (experiment2_2): ASR each new 5s chunk, keep the last
    3 chunks (=15s) of text, classify the bounded context.
    Windows: 0-5, 0-10, 0-15, 5-20, 10-25, 15-30, ...
    """
    duration = len(wav) / SR
    max_chunks = int(MAX_CONTEXT_SEC / CHUNK_SEC)   # 3
    text_history = []
    rounds = []
    for round_idx, start in enumerate(np.arange(0, duration - CHUNK_SEC + 0.1, CHUNK_SEC)):
        chunk = wav[int(start * SR):int((start + CHUNK_SEC) * SR)]
        t0 = time.time()
        new_text = asr_transcribe(chunk)
        text_history.append(new_text)
        if len(text_history) > max_chunks:
            text_history = text_history[-max_chunks:]
        context_text = " ".join(text_history).strip()
        prob = text_classify(context_text)
        n_active = len(text_history)
        w_start = (round_idx + 1 - n_active) * CHUNK_SEC
        w_end = (round_idx + 1) * CHUNK_SEC
        rounds.append({
            "window": f"{int(w_start)}-{int(w_end)}s",
            "window_start": float(w_start),
            "window_end": float(w_end),
            "prob": float(prob[1]),
            "transcript": new_text.strip(),       # the new 5s (live caption)
            "context_text": context_text[:300],   # full bounded-window text
            "latency": round(time.time() - t0, 3),
        })
    return rounds


app = FastAPI(title="Thai Scam Call Detector")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


@app.get("/")
def health():
    return {"status": "ok", "device": DEVICE, "asr": ASR_MODEL_ID, "chunk_sec": CHUNK_SEC}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        wav, _ = librosa.load(io.BytesIO(raw), sr=SR, mono=True)
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"could not decode audio: {e}"})

    rounds = predict_two_stage(wav)
    probs = [r["prob"] for r in rounds]
    max_prob = max(probs) if probs else 0.0
    ttfd = next((r["window_end"] for r in rounds if r["prob"] > 0.7), None)
    return {
        "duration": round(len(wav) / SR, 2),
        "max_prob": max_prob,
        "final_pred": int((rounds[-1]["prob"] > SCAM_THRESHOLD)) if rounds else 0,
        "ttfd": ttfd,
        "rounds": rounds,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
