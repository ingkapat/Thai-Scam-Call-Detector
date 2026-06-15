# Web demo — Thai Scam Call Detector

Live: **https://thai-scam-web.vercel.app**

Upload an mp3 → the phone "answers" → the audio is transcribed and classified in an
overlap sliding window (0-5, 0-10, 0-15, 5-20, … = 15s context, hop 5s, from `experiment2_2`),
streaming a scam probability + transcript per window.

```
mp3 ─► [ frontend ] ──POST /analyze──► [ backend ]
        Vercel                          HF Space
        upload + display                Whisper-th (ASR) → PhayaThaiBERT (classify)
                ◄──── { rounds: [{window, prob, transcript}, …] } ◄────
```

## frontend/  (static → Vercel)
| file | role |
|------|------|
| `index.html` | INPUT (upload mp3) + DISPLAY (iPhone UI + result panel) |
| `app.js` | send file to backend, reveal predictions |
| `styles.css` | styling |
| `config.js` | backend URL (`window.API_URL`) |
| `vercel.json` | static deploy config |

## backend/  (FastAPI → Hugging Face Space, Docker)
| file | role |
|------|------|
| `app.py` | `POST /analyze`: ASR each 5s chunk → bounded 15s text → classify → return rounds |
| `requirements.txt` | torch, transformers, librosa, fastapi … |
| `Dockerfile` | HF Space (uvicorn on :7860) |

- ASR: `biodatlab/whisper-th-medium-combined` (Thonburian Whisper) — used as-is.
- Classifier: `Paam1/phayathai_scam` (PhayaThaiBERT fine-tuned) — on the HF Hub.
- The 1 GB model is **not** in this repo; the backend loads it from the Hub.

> Runs on a free CPU Space → slow (~15-30s per 5s window; Whisper ASR is the bottleneck).
> A GPU Space would be ~1s/round.
