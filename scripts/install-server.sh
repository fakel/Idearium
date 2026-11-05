#!/usr/bin/env bash
# Instalación idempotente de Idearium en un servidor Ubuntu/Debian.
#
# Instala Node, Ollama y modelos, dependencias npm, STT local (si hay GPU)
# y crea servicios systemd. Si no hay GPU, configura un STT externo
# compatible con OpenAI mediante .env.
#
# Uso:
#   sudo bash scripts/install-server.sh [opciones]
#
# Opciones:
#   --user=NAME          Usuario que ejecutará los servicios (default: $SUDO_USER)
#   --stt=auto|cuda|cpu|external
#   --no-system          No instalar paquetes del sistema ni Node/Ollama
#   --no-models          No descargar modelos de Ollama
#   --no-service         No crear ni arrancar servicios systemd
#   --yes                No hacer preguntas interactivas
#   --help               Mostrar esta ayuda
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
RUNTIME_ROOT="${IDEARIUM_RUNTIME_ROOT:-/var/lib/idearium}"
DEFAULT_VAULT="${IDEARIUM_VAULT_PATH:-/srv/idearium/vault}"
NODE_MAJOR="${NODE_MAJOR:-22}"
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-idearium}}"
STT_MODE="${STT_MODE:-auto}"
INSTALL_SYSTEM="${INSTALL_SYSTEM:-1}"
INSTALL_MODELS="${INSTALL_MODELS:-1}"
INSTALL_SERVICE="${INSTALL_SERVICE:-1}"
ASSUME_YES=0
NEW_ENV=0

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { printf "${BLUE}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$*"; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

usage() {
  cat <<'HELP'
Instalación idempotente de Idearium en un servidor Ubuntu/Debian.

Uso:
  sudo bash scripts/install-server.sh [opciones]

Opciones:
  --user=NAME          Usuario que ejecutará los servicios (default: $SUDO_USER)
  --stt=auto|cuda|cpu|external
  --no-system          No instalar paquetes del sistema ni Node/Ollama
  --no-models          No descargar modelos de Ollama
  --no-service         No crear ni arrancar servicios systemd
  --yes                No hacer preguntas interactivas
  --help               Mostrar esta ayuda
HELP
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  exec sudo -E bash "$PROJECT_DIR/scripts/install-server.sh" "$@"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user=*) SERVICE_USER="${1#*=}" ;;
    --user) shift; SERVICE_USER="${1:-}" ;;
    --stt=*) STT_MODE="${1#*=}" ;;
    --stt) shift; STT_MODE="${1:-}" ;;
    --no-system) INSTALL_SYSTEM=0 ;;
    --no-models) INSTALL_MODELS=0 ;;
    --no-service) INSTALL_SERVICE=0 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opción desconocida: $1 (usa --help)" ;;
  esac
  shift
done

case "$STT_MODE" in
  auto|cuda|cpu|external) ;;
  *) die "--stt debe ser auto, cuda, cpu o external" ;;
esac

# ── Comprobaciones iniciales ────────────────────────────────────────────────
[[ -f "$PROJECT_DIR/package.json" ]] || die "No encuentro package.json en $PROJECT_DIR"
[[ "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "Usuario inválido: $SERVICE_USER"
[[ "$SERVICE_USER" != "root" ]] || die "No uses root como usuario de servicio; usa --user=<usuario>"

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-} ${ID_LIKE:-}" in
    *ubuntu*|*debian*) ;;
    *) die "Este script soporta Ubuntu/Debian (detectado: ${PRETTY_NAME:-desconocido})" ;;
  esac
fi

command -v curl >/dev/null 2>&1 || {
  [[ $INSTALL_SYSTEM -eq 1 ]] || die "Falta curl y --no-system está activo"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates
}
command -v systemctl >/dev/null 2>&1 || [[ $INSTALL_SERVICE -eq 0 ]] || die "systemd no está disponible"

# ── Usuario de servicio ─────────────────────────────────────────────────────
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "Creando usuario de servicio $SERVICE_USER"
  useradd --system --create-home --home-dir "$RUNTIME_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$RUNTIME_ROOT"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$DEFAULT_VAULT"

# ── .env ────────────────────────────────────────────────────────────────────
get_env() {
  local key="$1" default="${2:-}" value
  value="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value:-$default}"
}

set_env() {
  local key="$1" value="$2" escaped
  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  escaped="${escaped//|/\\|}"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

ensure_env() {
  local key="$1" value="$2"
  if [[ -z "$(get_env "$key")" ]]; then set_env "$key" "$value"; fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
  NEW_ENV=1
  log "Creado .env a partir de .env.example"
fi

if [[ $NEW_ENV -eq 1 ]]; then
  set_env OBSIDIAN_VAULT_PATH "$DEFAULT_VAULT"
  set_env NOTE_SUBDIR "Idearium"
  set_env LANCEDB_PATH "$RUNTIME_ROOT/lancedb"
  set_env AUDIO_DIR "$RUNTIME_ROOT/audio"
else
  ensure_env OBSIDIAN_VAULT_PATH "$DEFAULT_VAULT"
  ensure_env NOTE_SUBDIR "Idearium"
  ensure_env LANCEDB_PATH "$RUNTIME_ROOT/lancedb"
  ensure_env AUDIO_DIR "$RUNTIME_ROOT/audio"
fi

chmod 600 "$ENV_FILE"
chown "$SERVICE_USER:$SERVICE_GROUP" "$ENV_FILE"

# Credenciales de Telegram (solo si hay terminal interactiva).
if [[ $ASSUME_YES -eq 0 && -t 0 ]]; then
  if [[ -z "$(get_env TELEGRAM_BOT_TOKEN)" ]]; then
    read -rsp "Token del bot de Telegram (Enter para configurarlo luego): " TOKEN || true
    echo
    if [[ -n "${TOKEN:-}" ]]; then set_env TELEGRAM_BOT_TOKEN "$TOKEN"; fi
  fi
  if [[ -z "$(get_env TELEGRAM_ALLOWED_USER_IDS)" ]]; then
    read -rp "IDs de Telegram autorizados, separados por comas: " ALLOWED_IDS || true
    if [[ -n "${ALLOWED_IDS:-}" ]]; then set_env TELEGRAM_ALLOWED_USER_IDS "$ALLOWED_IDS"; fi
  fi
fi

chmod 600 "$ENV_FILE"
chown "$SERVICE_USER:$SERVICE_GROUP" "$ENV_FILE"

# ── Dependencias del sistema ────────────────────────────────────────────────
if [[ $INSTALL_SYSTEM -eq 1 ]]; then
  log "Instalando paquetes base"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl gnupg git jq ffmpeg build-essential

  NODE_OK=0
  if command -v node >/dev/null 2>&1; then
    CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
    if (( CURRENT_MAJOR >= 20 )); then NODE_OK=1; fi
  fi
  if [[ $NODE_OK -eq 0 ]]; then
    log "Instalando Node.js ${NODE_MAJOR}.x (NodeSource)"
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    chmod a+r /etc/apt/keyrings/nodesource.gpg
    printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "$NODE_MAJOR" \
      >/etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  fi

  if ! command -v ollama >/dev/null 2>&1; then
    log "Instalando Ollama"
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  systemctl enable --now ollama >/dev/null 2>&1 || true
else
  command -v node >/dev/null 2>&1 || die "Node no está instalado y --no-system está activo"
  command -v ollama >/dev/null 2>&1 || die "Ollama no está instalado y --no-system está activo"
fi

command -v node >/dev/null 2>&1 || die "Node no quedó instalado"
command -v npm >/dev/null 2>&1 || die "npm no quedó instalado"

# ── Dependencias de Node y build ────────────────────────────────────────────
log "Instalando dependencias npm"
cd "$PROJECT_DIR"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

if ! runuser -u "$SERVICE_USER" -- test -r "$PROJECT_DIR/dist/index.js"; then
  die "El usuario $SERVICE_USER no puede leer $PROJECT_DIR. Mueve el repo a /opt/idearium o usa --user con un usuario con acceso."
fi

# ── Ollama: arranque y modelos ──────────────────────────────────────────────
OLLAMA_API_URL="$(get_env OLLAMA_API_URL "http://127.0.0.1:11434")"
log "Esperando a Ollama en $OLLAMA_API_URL"
OLLAMA_READY=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "${OLLAMA_API_URL}/api/tags" >/dev/null 2>&1; then
    OLLAMA_READY=1
    break
  fi
  sleep 2
done
[[ $OLLAMA_READY -eq 1 ]] || die "Ollama no responde. Revisa: systemctl status ollama"

if [[ $INSTALL_MODELS -eq 1 ]]; then
  CHAT_MODEL="$(get_env OLLAMA_MODEL "qwen2.5:7b-instruct")"
  EMBED_MODEL="$(get_env OLLAMA_EMBED_MODEL "bge-m3")"
  log "Descargando modelos (puede tardar): $CHAT_MODEL y $EMBED_MODEL"
  ollama pull "$CHAT_MODEL"
  ollama pull "$EMBED_MODEL"
else
  warn "Modelos omitidos (--no-models). Recuerda: ollama pull <modelo>"
fi

# ── STT local o externo ─────────────────────────────────────────────────────
GPU_AVAILABLE=0
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L 2>/dev/null | grep -q '^GPU'; then
  GPU_AVAILABLE=1
fi

if [[ "$STT_MODE" == "auto" ]]; then
  if [[ $GPU_AVAILABLE -eq 1 ]]; then STT_MODE="cuda"; else STT_MODE="external"; fi
fi

LOCAL_STT=0
case "$STT_MODE" in
  cuda)
    [[ $GPU_AVAILABLE -eq 1 ]] || die "--stt=cuda pero no se detecta una GPU NVIDIA con nvidia-smi"
    LOCAL_STT=1
    ;;
  cpu) LOCAL_STT=1 ;;
  external) LOCAL_STT=0 ;;
esac

if [[ $LOCAL_STT -eq 1 ]]; then
  log "Instalando STT local ($STT_MODE)"
  if ! command -v uv >/dev/null 2>&1; then
    log "Instalando uv"
    curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
    if [[ ! -x /usr/local/bin/uv && -x "$HOME/.local/bin/uv" ]]; then
      ln -sf "$HOME/.local/bin/uv" /usr/local/bin/uv
    fi
  fi
  command -v uv >/dev/null 2>&1 || die "No se pudo instalar uv"

  # Crear el venv como el usuario de servicio: si lo creara root, el
  # intérprete de uv quedaría bajo /root y systemd no podría ejecutarlo.
  VENV_DIR="$PROJECT_DIR/stt/.venv"
  if [[ -d "$VENV_DIR" ]]; then
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$VENV_DIR" 2>/dev/null || true
    if ! runuser -u "$SERVICE_USER" -- test -x "$VENV_DIR/bin/python"; then
      log "El venv existente no es accesible para $SERVICE_USER; recreándolo"
      rm -rf "$VENV_DIR"
    fi
  fi
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" \
    "$RUNTIME_ROOT/.cache/uv" "$RUNTIME_ROOT/.uv/python" "$VENV_DIR"

  UV_ENV=(env "HOME=$RUNTIME_ROOT" "PATH=/usr/local/bin:/usr/bin:/bin" \
    "UV_CACHE_DIR=$RUNTIME_ROOT/.cache/uv" "UV_PYTHON_INSTALL_DIR=$RUNTIME_ROOT/.uv/python")
  if [[ "$STT_MODE" == "cuda" ]]; then
    runuser -u "$SERVICE_USER" -- "${UV_ENV[@]}" \
      bash -c "cd '$PROJECT_DIR' && uv sync --project stt --frozen"
  else
    runuser -u "$SERVICE_USER" -- "${UV_ENV[@]}" \
      bash -c "cd '$PROJECT_DIR' && uv sync --project stt --frozen --no-install-package nvidia-cublas-cu12 --no-install-package nvidia-cudnn-cu12"
  fi

  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$VENV_DIR"
  chmod -R u+rwX,go+rX "$VENV_DIR"
  chmod +x "$PROJECT_DIR/stt/start.sh"
  set_env WHISPER_API_URL "http://127.0.0.1:8000"
  set_env WHISPER_MODEL "$(get_env WHISPER_MODEL small)"
  set_env WHISPER_API_KEY ""
  if [[ "$STT_MODE" == "cuda" ]]; then
    set_env WHISPER_DEVICE cuda
    set_env WHISPER_COMPUTE_TYPE int8_float16
  else
    set_env WHISPER_DEVICE cpu
    set_env WHISPER_COMPUTE_TYPE int8
  fi
else
  log "Sin STT local: configurando proveedor externo compatible con OpenAI"
  CURRENT_STT_URL="$(get_env WHISPER_API_URL "http://127.0.0.1:8000")"
  CURRENT_STT_MODEL="$(get_env WHISPER_MODEL "small")"
  if [[ "$CURRENT_STT_URL" == http://127.0.0.1* || "$CURRENT_STT_URL" == http://localhost* ]]; then
    set_env WHISPER_API_URL "${EXTERNAL_STT_URL:-https://api.openai.com}"
    set_env WHISPER_MODEL "${EXTERNAL_STT_MODEL:-whisper-1}"
    CURRENT_STT_URL="$(get_env WHISPER_API_URL)"
    CURRENT_STT_MODEL="$(get_env WHISPER_MODEL)"
  fi
  ensure_env WHISPER_TIMEOUT_MS "180000"

  if [[ $ASSUME_YES -eq 0 && -t 0 && -z "$(get_env WHISPER_API_KEY)" ]]; then
    read -rsp "API key del STT externo ($CURRENT_STT_URL, modelo $CURRENT_STT_MODEL): " STT_KEY || true
    echo
    if [[ -n "${STT_KEY:-}" ]]; then set_env WHISPER_API_KEY "$STT_KEY"; fi
  fi
  if [[ -z "$(get_env WHISPER_API_KEY)" ]]; then
    warn "WHISPER_API_KEY vacío: edita $ENV_FILE antes de enviar audios"
  fi
fi

# ── Carpetas de datos ───────────────────────────────────────────────────────
resolve_runtime_path() {
  local value="$1"
  if [[ "$value" = /* ]]; then printf '%s' "$value"; else printf '%s' "$PROJECT_DIR/${value#./}"; fi
}

# sed -i recrea el archivo como root; el bot debe poder leer su .env.
chmod 600 "$ENV_FILE"
chown "$SERVICE_USER:$SERVICE_GROUP" "$ENV_FILE"

VAULT="$(resolve_runtime_path "$(get_env OBSIDIAN_VAULT_PATH "$DEFAULT_VAULT")")"
NOTE_SUBDIR="$(get_env NOTE_SUBDIR "Idearium")"
LANCEDB="$(resolve_runtime_path "$(get_env LANCEDB_PATH "$RUNTIME_ROOT/lancedb")")"
AUDIO="$(resolve_runtime_path "$(get_env AUDIO_DIR "$RUNTIME_ROOT/audio")")"

install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$VAULT/$NOTE_SUBDIR" "$LANCEDB" "$AUDIO"

PERM_FAILED=0
for path in "$VAULT/$NOTE_SUBDIR" "$LANCEDB" "$AUDIO"; do
  if ! runuser -u "$SERVICE_USER" -- test -w "$path"; then
    warn "El usuario $SERVICE_USER no puede escribir en $path"
    PERM_FAILED=1
  fi
done
if [[ $PERM_FAILED -eq 1 ]]; then
  die "Corrige los permisos o usa --user con el dueño del vault; el bot no podría guardar notas."
fi

# ── Servicios systemd ───────────────────────────────────────────────────────
if [[ $INSTALL_SERVICE -eq 1 ]]; then
  NODE_BIN="$(command -v node)"
  log "Creando servicios systemd"

  cat >/etc/systemd/system/idearium.service <<UNIT
[Unit]
Description=Idearium Telegram bot
After=network-online.target ollama.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=$NODE_BIN $PROJECT_DIR/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
UNIT

  if [[ $LOCAL_STT -eq 1 ]]; then
    cat >/etc/systemd/system/idearium-stt.service <<UNIT
[Unit]
Description=Idearium local STT (faster-whisper)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$PROJECT_DIR/stt
EnvironmentFile=$ENV_FILE
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=HOME=$RUNTIME_ROOT
Environment=UV_CACHE_DIR=$RUNTIME_ROOT/.cache/uv
Environment=UV_PYTHON_INSTALL_DIR=$RUNTIME_ROOT/.uv/python
Environment=UV_NO_SYNC=1
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/bin/bash $PROJECT_DIR/stt/start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
    install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$RUNTIME_ROOT/.cache/uv"
    systemctl enable idearium-stt.service
  else
    systemctl disable --now idearium-stt.service >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/idearium-stt.service
  fi

  systemctl daemon-reload
  systemctl enable idearium.service

  if [[ $LOCAL_STT -eq 1 ]]; then
    log "Arrancando STT local"
    systemctl restart idearium-stt.service
    STT_READY=0
    for _ in $(seq 1 60); do
      if curl -fsS --max-time 2 "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
        STT_READY=1
        break
      fi
      sleep 2
    done
    if [[ $STT_READY -eq 1 ]]; then
      ok "STT local listo"
    else
      warn "El STT no respondió todavía. Revisa: journalctl -u idearium-stt -n 80 --no-pager"
    fi
  fi

  TOKEN="$(get_env TELEGRAM_BOT_TOKEN)"
  ALLOWED="$(get_env TELEGRAM_ALLOWED_USER_IDS)"
  if [[ -n "$TOKEN" && -n "$ALLOWED" ]]; then
    systemctl restart idearium.service
    ok "Bot arrancado"
  else
    warn "Bot no arrancado: completa TELEGRAM_BOT_TOKEN y TELEGRAM_ALLOWED_USER_IDS en $ENV_FILE"
    warn "Luego: sudo systemctl restart idearium"
  fi
fi

# ── Diagnóstico final ───────────────────────────────────────────────────────
if [[ -x "$PROJECT_DIR/scripts/doctor.sh" ]]; then
  log "Ejecutando diagnóstico"
  (cd "$PROJECT_DIR" && runuser -u "$SERVICE_USER" -- env \
    HOME="$RUNTIME_ROOT" PATH="/usr/local/bin:/usr/bin:/bin" \
    bash scripts/doctor.sh) || true
fi

if [[ $LOCAL_STT -eq 1 ]]; then
  STT_DESCRIPTION="local ($STT_MODE)"
else
  STT_DESCRIPTION="externo ($(get_env WHISPER_API_URL))"
fi
SERVICE_HINT=""
if [[ $INSTALL_SERVICE -eq 1 ]]; then
  SERVICE_HINT="  Servicios:     systemctl status idearium idearium-stt
  Logs:          journalctl -u idearium -f
  Reiniciar:     sudo systemctl restart idearium"
fi

cat <<SUMMARY

$(ok "Instalación terminada")
  Proyecto:      $PROJECT_DIR
  Usuario:       $SERVICE_USER
  Vault:         $VAULT/$NOTE_SUBDIR
  Datos:         $LANCEDB
  STT:           $STT_DESCRIPTION
  Env:           $ENV_FILE
$SERVICE_HINT
SUMMARY
