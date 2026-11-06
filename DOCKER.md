# Docker: imagen solo OpenRouter

Esta imagen no instala Ollama, Whisper, CUDA ni drivers NVIDIA. Todo el trabajo de IA se hace contra [OpenRouter](https://openrouter.ai):

- **Chat**: modelo configurado en `OPENROUTER_MODEL`.
- **Embeddings**: `OPENROUTER_EMBED_MODEL` (por defecto `baai/bge-m3`, 1024 dimensiones).
- **STT**: `POST https://openrouter.ai/api/v1/audio/transcriptions` con `WHISPER_MODEL` (por defecto `openai/whisper-large-v3-turbo`).
- **OCR de fotos**: `OPENROUTER_VISION_MODEL` (Gemma 4 31B por defecto) con `OPENROUTER_VISION_FALLBACK_MODEL` (Qwen3-VL 30B) como reintento.

El vault y la base LanceDB quedan en volúmenes locales del host. No se usa Obsidian Sync.

## Requisitos

- Docker Engine 24+ y Docker Compose v2.
- Una `OPENROUTER_API_KEY` con saldo o modelos gratuitos disponibles.
- Token de Telegram y allowlist si vas a usar el bot.

No hace falta GPU, Ollama, Python ni `uv`.

## 1. Configurar

```bash
cd /home/magneto/idearium
cp .env.docker.example .env
```

Edita `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=123456789

OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_VISION_MODEL=google/gemma-4-31b-it
OPENROUTER_VISION_FALLBACK_MODEL=qwen/qwen3-vl-30b-a3b-instruct
OPENROUTER_EMBED_MODEL=baai/bge-m3
EMBEDDING_DIM=1024
WHISPER_MODEL=openai/whisper-large-v3-turbo
```

Para probar sin gastar, puedes usar un chat gratuito:

```dotenv
OPENROUTER_MODEL=google/gemma-4-31b-it:free
```

Los modelos gratuitos tienen límites (20 rpm / 50 rpd) y pueden devolver `429`. El STT de OpenRouter no tiene opción gratuita.

## 2. Construir la imagen

```bash
docker build -t idearium:openrouter .
```

La imagen resultante no contiene `ollama`, `whisper`, CUDA ni modelos de IA. Solo incluye Node, el bot y las dependencias JavaScript.

## 3. Arrancar con Compose

```bash
mkdir -p vault data
sudo chown -R 1000:1000 vault data

docker compose up -d --build
docker compose logs -f idearium
```

El contenedor escribe en:

- `/vault`: tu vault de Obsidian (notas `.md`).
- `/data`: LanceDB, audios temporales, documentos, fotos y estado del índice.

Por defecto se montan `./vault` y `./data`. Para usar tu vault real, crea un `.env` con:

```dotenv
IDEARIUM_VAULT_DIR=/home/magneto/Documents/IdeariumVault
IDEARIUM_DATA_DIR=/home/magneto/idearium/data
```

También puedes exportarlas en la terminal antes de `docker compose up`.

### Sin Compose

```bash
docker run -d \
  --name idearium-openrouter \
  --env-file .env \
  -e OBSIDIAN_VAULT_PATH=/vault \
  -e LANCEDB_PATH=/data/lancedb \
  -e AUDIO_DIR=/data/audio \
  -e DOCUMENT_DIR=/data/documents \
  -e IMAGES_DIR=/data/images \
  -v /home/magneto/Documents/IdeariumVault:/vault \
  -v /home/magneto/idearium/data:/data \
  --restart unless-stopped \
  idearium:openrouter
```

Los directorios del host deben pertenecer al UID `1000` (el usuario `node` de la imagen):

```bash
sudo chown -R 1000:1000 /home/magneto/Documents/IdeariumVault /home/magneto/idearium/data
```

## 4. Verificar

```bash
docker compose ps
docker compose logs -f idearium
```

En Telegram, envía `/start`, luego una nota de texto y una nota de voz. La respuesta debe indicar el proveedor `openrouter`.

Si el contenedor se detiene al arrancar:

```bash
docker compose logs idearium
```

- `OPENROUTER_API_KEY es obligatoria` → falta la clave en `.env`.
- `TELEGRAM_BOT_TOKEN` vacío → el bot se niega a arrancar por diseño.
- `401` de OpenRouter → clave inválida.
- `402` → falta saldo en OpenRouter.
- `429` → límite de modelos gratuitos; espera o usa un modelo de pago.

## 5. Parar y actualizar

```bash
docker compose down          # detiene el contenedor; conserva vault y data
docker compose up -d --build # reconstruye tras cambiar código
```

## Modelos y coste

| Tarea | Modelo por defecto | Alternativas |
| --- | --- | --- |
| Chat | `openai/gpt-4o-mini` | `google/gemma-4-31b-it:free`, `deepseek/deepseek-v4-flash` |
| Embeddings | `baai/bge-m3` (1024) | `openai/text-embedding-3-small` (1536; cambia `EMBEDDING_DIM` y reindexa) |
| STT | `openai/whisper-large-v3-turbo` | `openai/whisper-1`, `elevenlabs/scribe-v2` |

Si cambias el modelo de embeddings por otro con distinta dimensión:

```bash
docker compose down
sudo rm -rf data/lancedb data/index-state.json
docker compose up -d
```

Después envía `/reindex` por Telegram para reconstruir el índice. El bot **no** reindexa solo las notas que ya existían al arrancar; el watcher solo indexa cambios nuevos.

## Privacidad

El vault y LanceDB se quedan en el host, pero **el texto de las notas, las consultas y los audios se envían a OpenRouter** para el chat, los embeddings y la transcripción. Si eso no es aceptable, esta imagen no es la adecuada.

## Notas

- La entrada de la imagen fuerza `LLM_PREFERENCE=remote_only`, `EMBEDDING_PROVIDER=openrouter` y `WHISPER_API_URL=https://openrouter.ai/api`; aunque tu `.env` tenga valores locales, no se usan.
- `WHISPER_MODEL` debe ser un id de OpenRouter con proveedor (`openai/...`). Si pones `small` o `base`, la entrada lo cambia al modelo por defecto de OpenRouter.
- No hay puertos expuestos: el bot usa polling de Telegram.
- Para el vault remoto/local se monta una carpeta; esta imagen no implementa Obsidian Sync.
