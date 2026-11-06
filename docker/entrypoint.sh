#!/bin/sh
# Entrada de la imagen solo OpenRouter.
# Fuerza el routing remoto y el STT de OpenRouter; falla si falta la clave.
set -eu

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "error: OPENROUTER_API_KEY es obligatoria en la imagen solo OpenRouter" >&2
  exit 1
fi

# Nada de Ollama ni Whisper local: todo pasa por OpenRouter.
export LLM_PREFERENCE=remote_only
export EMBEDDING_PROVIDER=openrouter
export WHISPER_API_URL="https://openrouter.ai/api"

# El nombre local (small/base/tiny/...) no existe en OpenRouter.
# Si no se indicó un id con proveedor (p. ej. openai/whisper-1), usa el default.
if [ -z "${WHISPER_MODEL:-}" ] || [ "${WHISPER_MODEL#*/}" = "${WHISPER_MODEL}" ]; then
  export WHISPER_MODEL="openai/whisper-large-v3-turbo"
fi

export OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-/vault}"
export LANCEDB_PATH="${LANCEDB_PATH:-/data/lancedb}"
export AUDIO_DIR="${AUDIO_DIR:-/data/audio}"
export DOCUMENT_DIR="${DOCUMENT_DIR:-/data/documents}"
export IMAGES_DIR="${IMAGES_DIR:-/data/images}"
export NOTE_SUBDIR="${NOTE_SUBDIR:-Idearium}"

echo "idearium: OpenRouter only (chat + embeddings + STT); sin modelos locales ni GPU" >&2

exec node /app/dist/index.js
