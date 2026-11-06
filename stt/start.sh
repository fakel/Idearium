#!/usr/bin/env bash
# Arranca el servidor local de transcripción con faster-whisper.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Carga .env para que WHISPER_* funcione también al lanzar el STT a mano.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

cd "$(dirname "$0")"

# CTranslate2 necesita las libs CUDA 12 de los wheels de nvidia-*.
NVIDIA_LIBS="$(uv run --no-sync python -c 'import nvidia.cublas.lib, nvidia.cudnn.lib; print(f"{nvidia.cublas.lib.__path__[0]}:{nvidia.cudnn.lib.__path__[0]}")' 2>/dev/null || true)"
if [[ -n "${NVIDIA_LIBS}" ]]; then
  export LD_LIBRARY_PATH="${NVIDIA_LIBS}:${LD_LIBRARY_PATH:-}"
fi

exec uv run --no-sync uvicorn server:app --host 127.0.0.1 --port "${WHISPER_PORT:-8000}"
