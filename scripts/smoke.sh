#!/usr/bin/env bash
# Smoke test end-to-end: guarda una nota en un vault temporal, la indexa y consulta.
set -euo pipefail
cd "$(dirname "$0")/.."

# Carga .env para que el smoke use la misma configuración que el bot.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

export OBSIDIAN_VAULT_PATH="${TMP}/vault"
export NOTE_SUBDIR="Idearium"
export LANCEDB_PATH="${TMP}/lancedb"
export AUDIO_DIR="${TMP}/audio"
export DOCUMENT_DIR="${TMP}/documents"
export IMAGES_DIR="${TMP}/images"
export USAGE_FILE="${TMP}/usage.json"
export LOG_LEVEL="warn"

OLLAMA_API_URL="${OLLAMA_API_URL:-http://127.0.0.1:11434}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-bge-m3}"
EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-ollama}"

echo "== Comprobando proveedor de embeddings (${EMBEDDING_PROVIDER}) =="
if [[ "${EMBEDDING_PROVIDER}" == "openrouter" ]]; then
  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    echo "✗ EMBEDDING_PROVIDER=openrouter sin OPENROUTER_API_KEY" >&2
    exit 1
  fi
elif ! curl -fsS --max-time 3 "${OLLAMA_API_URL}/api/tags" >/dev/null; then
  echo "✗ Ollama no responde en ${OLLAMA_API_URL}" >&2
  exit 1
elif ! curl -fsS --max-time 3 "${OLLAMA_API_URL}/api/tags" | grep -q "\"${OLLAMA_EMBED_MODEL}"; then
  echo "✗ Falta el modelo ${OLLAMA_EMBED_MODEL} (ollama pull ${OLLAMA_EMBED_MODEL})" >&2
  exit 1
fi

echo "== Creando nota de prueba =="
npm run --silent cli -- text "Idea de smoke test: recordar comprar filtros de café y revisar la planificación del proyecto Idearium el lunes."

NOTE="$(find "${TMP}/vault" -name '*.md' -print -quit)"
if [[ -z "${NOTE}" ]]; then
  echo "✗ No se creó ninguna nota" >&2
  exit 1
fi
echo "  nota: ${NOTE}"

echo "== Consultando el índice =="
OUTPUT="$(npm run --silent cli -- query '¿Qué hay que comprar en el smoke test?' | head -c 2000)"
if [[ -z "${OUTPUT}" ]]; then
  echo "✗ La consulta no devolvió respuesta" >&2
  exit 1
fi
echo "  respuesta: ${OUTPUT:0:200}…"

echo "== Reindexando =="
npm run --silent cli -- reindex

echo "✓ Smoke test OK"
