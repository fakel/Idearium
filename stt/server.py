"""Local Faster-Whisper server with an OpenAI-compatible transcription endpoint."""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("idearium-stt")

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8_float16")

model: WhisperModel | None = None
loaded_device: str | None = None
loaded_compute_type: str | None = None


def load_model() -> WhisperModel:
    global loaded_device, loaded_compute_type
    try:
        instance = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)
        loaded_device, loaded_compute_type = DEVICE, COMPUTE_TYPE
        log.info("Modelo %s cargado en %s (%s)", MODEL_NAME, DEVICE, COMPUTE_TYPE)
        return instance
    except Exception as error:  # noqa: BLE001 - queremos degradar a CPU con cualquier fallo de GPU
        if DEVICE == "cpu":
            raise
        log.warning("No se pudo cargar en %s (%s); usando CPU/int8", DEVICE, error)
        instance = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
        loaded_device, loaded_compute_type = "cpu", "int8"
        return instance


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global model
    model = load_model()
    yield


app = FastAPI(title="Idearium STT", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str | None]:
    return {
        "status": "ok" if model is not None else "loading",
        "model": MODEL_NAME,
        "device": loaded_device,
        "compute_type": loaded_compute_type,
    }


@app.post("/v1/audio/transcriptions")
def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    model_name: str | None = Form(default=None, alias="model"),
) -> dict[str, str | float | None]:
    if model is None:
        raise HTTPException(status_code=503, detail="El modelo de transcripción aún no está cargado.")

    suffix = Path(file.filename or "audio.ogg").suffix or ".ogg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        segments, info = model.transcribe(
            str(tmp_path),
            language=language,
            vad_filter=True,
            beam_size=5,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        if not text:
            raise HTTPException(status_code=422, detail="No se detectó voz en el audio.")
        return {
            "text": text,
            "language": info.language,
            "duration": float(info.duration),
            "model": model_name or MODEL_NAME,
        }
    finally:
        tmp_path.unlink(missing_ok=True)
