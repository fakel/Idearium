#!/usr/bin/env bash
# Diagnóstico de Idearium: comprueba dependencias, modelos, vault y servicios.
set -uo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
FAILS=0
WARNS=0

pass() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; WARNS=$((WARNS + 1)); }
fail() { printf "${RED}✗${NC} %s\n" "$1"; FAILS=$((FAILS + 1)); }
info() { printf "  %s\n" "$1"; }

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  pass ".env encontrado"
else
  fail ".env no existe — copia .env.example a .env y complétalo"
fi

OLLAMA_API_URL="${OLLAMA_API_URL:-http://127.0.0.1:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b-instruct}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-bge-m3}"
WHISPER_API_URL="${WHISPER_API_URL:-http://127.0.0.1:8000}"
EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-ollama}"
LLM_PREFERENCE="${LLM_PREFERENCE:-local_first}"
VAULT="${OBSIDIAN_VAULT_PATH:-$HOME/Documents/IdeariumVault}"
NOTE_SUBDIR="${NOTE_SUBDIR:-Idearium}"
LANCEDB_PATH="${LANCEDB_PATH:-./data/lancedb}"
IMAGES_DIR="${IMAGES_DIR:-./data/images}"

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if (( NODE_MAJOR >= 24 )); then pass "Node $(node -p 'process.versions.node')"; else fail "Node >= 24 requerido (actual $(node -p 'process.versions.node'))"; fi
else
  fail "Node no está instalado"
fi

if command -v npm >/dev/null 2>&1; then pass "npm $(npm -v)"; else fail "npm no está instalado"; fi

if [[ -d node_modules ]]; then
  pass "Dependencias de Node instaladas"
  if node --input-type=module -e "import('@lancedb/lancedb')" >/dev/null 2>&1; then
    pass "LanceDB importable"
  else
    fail "No se pudo importar @lancedb/lancedb — ejecuta npm install"
  fi
else
  fail "Falta node_modules — ejecuta npm install"
fi

NEED_OLLAMA=1
[[ "${LLM_PREFERENCE}" == "remote_only" && "${EMBEDDING_PROVIDER}" != "ollama" ]] && NEED_OLLAMA=0

if (( NEED_OLLAMA )); then
  if curl -fsS --max-time 3 "${OLLAMA_API_URL}/api/tags" >/dev/null 2>&1; then
    pass "Ollama responde en ${OLLAMA_API_URL}"
    TAGS="$(curl -fsS --max-time 5 "${OLLAMA_API_URL}/api/tags" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).models.map(m=>m.name).join("\n"))}catch{}})' 2>/dev/null)"
    if [[ "${LLM_PREFERENCE}" != "remote_only" ]]; then
      if grep -qx "${OLLAMA_MODEL}" <<<"${TAGS}" || grep -qx "${OLLAMA_MODEL}:latest" <<<"${TAGS}"; then
        pass "Modelo de chat ${OLLAMA_MODEL} disponible"
      else
        fail "Falta el modelo de chat — ejecuta: ollama pull ${OLLAMA_MODEL}"
      fi
    fi
    if [[ "${EMBEDDING_PROVIDER}" == "ollama" ]]; then
      if grep -qx "${OLLAMA_EMBED_MODEL}" <<<"${TAGS}" || grep -qx "${OLLAMA_EMBED_MODEL}:latest" <<<"${TAGS}"; then
        pass "Modelo de embeddings ${OLLAMA_EMBED_MODEL} disponible"
      else
        fail "Falta el modelo de embeddings — ejecuta: ollama pull ${OLLAMA_EMBED_MODEL}"
      fi
    fi
  else
    fail "Ollama no responde en ${OLLAMA_API_URL} — arráncalo con: ollama serve"
  fi
else
  info "Ollama no es necesario (chat y embeddings remotos)"
fi

WHISPER_IS_LOCAL=1
case "${WHISPER_API_URL}" in
  http://127.0.0.1*|http://localhost*) ;;
  *) WHISPER_IS_LOCAL=0 ;;
esac

if (( WHISPER_IS_LOCAL )); then
  if curl -fsS --max-time 3 "${WHISPER_API_URL}/health" >/dev/null 2>&1; then
    HEALTH="$(curl -fsS --max-time 3 "${WHISPER_API_URL}/health")"
    pass "STT local responde: ${HEALTH}"
    if grep -q '"device":"cpu"' <<<"${HEALTH}"; then
      warn "STT está en CPU; para GPU revisa las libs CUDA o WHISPER_DEVICE"
    fi
  else
    warn "STT local no responde en ${WHISPER_API_URL} — arráncalo con: ./stt/start.sh"
  fi
else
  if [[ -n "${WHISPER_API_KEY:-}" ]] || [[ "${WHISPER_API_URL}" == *openrouter.ai* && -n "${OPENROUTER_API_KEY:-}" ]]; then
    pass "STT externo configurado: ${WHISPER_API_URL} (modelo ${WHISPER_MODEL})"
  else
    warn "STT externo sin WHISPER_API_KEY; si el proveedor requiere token, la transcripción fallará"
  fi
fi

if mkdir -p "${VAULT}/${NOTE_SUBDIR}" "${IMAGES_DIR}" && touch "${VAULT}/${NOTE_SUBDIR}/.write-test" "${IMAGES_DIR}/.write-test" 2>/dev/null; then
  rm -f "${VAULT}/${NOTE_SUBDIR}/.write-test" "${IMAGES_DIR}/.write-test"
  pass "Vault escribible: ${VAULT}/${NOTE_SUBDIR}"
  pass "Fotos escribibles: ${IMAGES_DIR}"
else
  fail "El vault o IMAGES_DIR no son escribibles: ${VAULT}/${NOTE_SUBDIR}, ${IMAGES_DIR}"
fi

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  ME="$(curl -fsS --max-time 5 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" 2>/dev/null)"
  if grep -q '"ok":true' <<<"${ME}"; then
    pass "Token de Telegram válido"
  else
    fail "TELEGRAM_BOT_TOKEN inválido o sin red"
  fi
else
  warn "TELEGRAM_BOT_TOKEN vacío: el bot no arrancará (el CLI sí funciona)"
fi

if [[ -z "${TELEGRAM_ALLOWED_USER_IDS:-}" ]]; then
  warn "TELEGRAM_ALLOWED_USER_IDS vacío: el bot no arrancará"
else
  pass "Allowlist configurada: ${TELEGRAM_ALLOWED_USER_IDS}"
fi

HAS_REMOTE=0
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  pass "OPENROUTER_API_KEY configurada"
  HAS_REMOTE=1
fi

if [[ "${EMBEDDING_PROVIDER}" == "openrouter" ]]; then
  if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
    pass "Embeddings remotos vía OpenRouter (${OPENROUTER_EMBED_MODEL:-baai/bge-m3})"
  else
    fail "EMBEDDING_PROVIDER=openrouter sin OPENROUTER_API_KEY"
  fi
fi

if [[ "${LLM_PREFERENCE}" == remote_* && $HAS_REMOTE -eq 0 ]]; then
  fail "LLM_PREFERENCE=${LLM_PREFERENCE} sin claves remotas; la app degradará a local"
fi

if (( HAS_REMOTE )); then
  info "Proveedor remoto disponible: OpenRouter (${OPENROUTER_MODEL:-${LLM_REMOTE_MODEL:-openai/gpt-4o-mini}})"
  info "OCR de fotos: ${OPENROUTER_VISION_MODEL:-${OPENROUTER_MODEL:-${LLM_REMOTE_MODEL:-openai/gpt-4o-mini}}} (debe aceptar imágenes)"
else
  info "Sin OPENROUTER_API_KEY: modo 100% local"
fi

if [[ -d "${LANCEDB_PATH}" ]]; then
  pass "Índice LanceDB en ${LANCEDB_PATH}"
else
  warn "LanceDB aún no existe en ${LANCEDB_PATH} — se creará al indexar"
fi

echo
if (( FAILS > 0 )); then
  printf "${RED}%d error(es), %d advertencia(s).${NC}\n" "${FAILS}" "${WARNS}"
  exit 1
fi
printf "${GREEN}Todo listo (%d advertencia(s)).${NC}\n" "${WARNS}"
