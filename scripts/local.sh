#!/usr/bin/env bash
# Arranca/para todo Idearium en local: Ollama, STT y bot.
#
#   npm run local:start
#   npm run local:stop
#   npm run local:restart
#   npm run local:status
#   npm run local:logs [bot|stt|ollama]
#
# Los procesos se lanzan en segundo plano con setsid y se guardan sus PID en
# .run/. Los logs van a logs/. Ollama solo se para si lo arrancó este script;
# si ya corría como servicio del sistema, se deja intacto.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_DIR="$ROOT/.run"
LOG_DIR="$ROOT/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

# Carga .env para que STT y las comprobaciones usen la misma configuración.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

OLLAMA_API_URL="${OLLAMA_API_URL:-http://127.0.0.1:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-bge-m3}"
WHISPER_API_URL="${WHISPER_API_URL:-http://127.0.0.1:8000}"
WHISPER_DEVICE="${WHISPER_DEVICE:-cpu}"
WHISPER_COMPUTE_TYPE="${WHISPER_COMPUTE_TYPE:-int8}"

# En modo 100 % remoto no hace falta Ollama.
NEED_OLLAMA=1
if [[ "${LLM_PREFERENCE:-}" == "remote_only" && "${EMBEDDING_PROVIDER:-ollama}" != "ollama" ]]; then
  NEED_OLLAMA=0
fi

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

pid_of() {
  local file="$RUN_DIR/$1.pid"
  [[ -f "$file" ]] && cat "$file" || true
}

is_running() {
  local pid
  pid="$(pid_of "$1")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

wait_http() {
  local url="$1" timeout="${2:-60}" i
  for ((i = 0; i < timeout; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_one() {
  local name="$1"
  shift
  if is_running "$name"; then
    log "$name: ya estaba corriendo (pid $(pid_of "$name"))"
    return 0
  fi
  rm -f "$RUN_DIR/$name.pid"
  setsid "$@" >>"$LOG_DIR/$name.log" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" >"$RUN_DIR/$name.pid"
  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    log "$name: no arrancó. Últimas líneas de $LOG_DIR/$name.log:"
    tail -n 25 "$LOG_DIR/$name.log" || true
    rm -f "$RUN_DIR/$name.pid"
    return 1
  fi
  log "$name: corriendo (pid $pid, log $LOG_DIR/$name.log)"
}

stop_one() {
  local name="$1" pid i
  pid="$(pid_of "$name")"
  if [[ -z "$pid" ]]; then
    log "$name: no estaba corriendo"
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for ((i = 0; i < 15; i++)); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    log "$name: detenido"
  else
    log "$name: PID obsoleto, limpiado"
  fi
  rm -f "$RUN_DIR/$name.pid"
}

ollama_ready() {
  curl -fsS --max-time 2 "$OLLAMA_API_URL/api/tags" >/dev/null 2>&1
}

ensure_ollama() {
  if ollama_ready; then
    log "ollama: ya disponible en $OLLAMA_API_URL"
    return 0
  fi
  command -v ollama >/dev/null 2>&1 || die "ollama no está instalado o no está en PATH"
  start_one ollama ollama serve
  touch "$RUN_DIR/ollama.managed"
  wait_http "$OLLAMA_API_URL/api/tags" 30 || die "Ollama no respondió en 30 s; revisa $LOG_DIR/ollama.log"
  log "ollama: listo"
}

model_present() {
  local want="$1"
  ollama list 2>/dev/null | awk 'NR > 1 { print $1 }' | grep -qx "$want" \
    || ollama list 2>/dev/null | awk 'NR > 1 { print $1 }' | grep -qx "${want}:latest"
}

ensure_models() {
  local missing=0
  if ! model_present "$OLLAMA_MODEL"; then
    log "falta el modelo de chat '$OLLAMA_MODEL'. Ejecuta: ollama pull $OLLAMA_MODEL"
    missing=1
  fi
  if ! model_present "$OLLAMA_EMBED_MODEL"; then
    log "falta el modelo de embeddings '$OLLAMA_EMBED_MODEL'. Ejecuta: ollama pull $OLLAMA_EMBED_MODEL"
    missing=1
  fi
  [[ "$missing" -eq 0 ]] || die "descarga los modelos que faltan y vuelve a ejecutar"
}

stt_is_local() {
  case "$WHISPER_API_URL" in
    http://127.0.0.1:* | http://localhost:*) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_stt() {
  if curl -fsS --max-time 2 "$WHISPER_API_URL/health" >/dev/null 2>&1; then
    log "stt: ya disponible en $WHISPER_API_URL"
    return 0
  fi
  if ! stt_is_local; then
    log "stt: remoto configurado en $WHISPER_API_URL"
    return 0
  fi
  [[ -x "$ROOT/stt/.venv/bin/python" ]] || die "falta stt/.venv. Ejecuta: uv sync --project stt"
  export WHISPER_DEVICE WHISPER_COMPUTE_TYPE
  start_one stt bash "$ROOT/stt/start.sh"
  if ! wait_http "$WHISPER_API_URL/health" 180; then
    log "stt: no respondió en 180 s (puede estar descargando el modelo)."
    log "     El bot arrancará igualmente; revisa $LOG_DIR/stt.log"
  else
    log "stt: listo"
  fi
}

start_bot() {
  if is_running bot; then
    log "bot: ya estaba corriendo (pid $(pid_of bot))"
    return 0
  fi
  log "compilando TypeScript..."
  npm run build >/dev/null
  start_one bot node "$ROOT/dist/index.js"
  sleep 2
  if ! is_running bot; then
    log "bot: terminó inesperadamente. Últimas líneas de $LOG_DIR/bot.log:"
    tail -n 30 "$LOG_DIR/bot.log" || true
    exit 1
  fi
}

cmd="${1:-start}"

case "$cmd" in
  start)
    if (( NEED_OLLAMA )); then
      ensure_ollama
      ensure_models
    else
      log "ollama: no necesario (chat y embeddings remotos)"
    fi
    ensure_stt
    start_bot
    log ""
    log "Idearium está corriendo. Estado: npm run local:status"
    log "Logs: npm run local:logs     Detener: npm run local:stop"
    ;;
  stop)
    stop_one bot
    stop_one stt
    if [[ -f "$RUN_DIR/ollama.managed" ]]; then
      stop_one ollama
      rm -f "$RUN_DIR/ollama.managed"
    else
      log "ollama: no lo arrancó este script; se deja como está"
    fi
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    if is_running ollama; then
      printf '%-8s running   pid %s\n' ollama "$(pid_of ollama)"
    elif ollama_ready; then
      printf '%-8s external  %s\n' ollama "$OLLAMA_API_URL"
    else
      printf '%-8s stopped\n' ollama
    fi

    if is_running stt; then
      printf '%-8s running   pid %s\n' stt "$(pid_of stt)"
    elif ! stt_is_local; then
      printf '%-8s remote    %s\n' stt "$WHISPER_API_URL"
    elif curl -fsS --max-time 2 "$WHISPER_API_URL/health" >/dev/null 2>&1; then
      printf '%-8s external  %s\n' stt "$WHISPER_API_URL"
    else
      printf '%-8s stopped\n' stt
    fi

    if is_running bot; then
      printf '%-8s running   pid %s\n' bot "$(pid_of bot)"
    else
      printf '%-8s stopped\n' bot
    fi
    ;;
  logs)
    target="${2:-bot}"
    case "$target" in
      bot | stt | ollama) exec tail -n 200 -f "$LOG_DIR/$target.log" ;;
      *) die "uso: npm run local:logs -- [bot|stt|ollama]" ;;
    esac
    ;;
  *)
    echo "uso: $0 {start|stop|restart|status|logs [bot|stt|ollama]}"
    exit 1
    ;;
esac
