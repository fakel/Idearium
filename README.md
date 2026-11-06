# 💡 Idearium

**Versión 0.1.0** · [Changelog](CHANGELOG.md) · [Licencia BSL 1.1](LICENSE)

> Captura por voz, texto, foto o documento → notas Markdown estructuradas en Obsidian → búsqueda semántica y RAG, todo local.

Idearium es una capa de memoria personal _local-first_. Le mandas una nota de voz, un texto, una foto con texto o un documento por Telegram (o usas el CLI), y el sistema:

1. transcribe el audio con **faster-whisper** en tu GPU (o con OpenRouter),
2. extrae el texto de una foto con un modelo multimodal,
3. estructura la captura con un LLM local (**Ollama**) o remoto validado con **Zod**,
4. escribe una nota Markdown con frontmatter en tu **vault de Obsidian**,
5. la indexa en **LanceDB** con embeddings (`bge-m3`, local o remoto),
6. te deja consultarla por RAG, agruparla en estudios, generar palacios de memoria y hacer quizzes.

Todo el contenido y los vectores viven en tu máquina por defecto. Si no tienes GPU suficiente, puedes usar **OpenRouter** para chat, embeddings y transcripción con una sola clave.

---

## Arquitectura

```text
Telegram (voz/texto/foto/doc) ──┐
CLI (texto/audio)     ──┴──► IngestController
                                │
                                ├─ STT local (faster-whisper, GPU) u OpenRouter   [solo voz]
                                ├─ OCR multimodal vía OpenRouter                  [solo foto]
                                ├─ LLM Router ── Ollama (local)
                                │             └─ OpenRouter (remoto)
                                ├─ Zod valida el JSON y reintenta
                                ├─ ObsidianService → <vault>/Idearium/*.md
                                └─ Indexer → embeddings bge-m3 (Ollama u OpenRouter) → LanceDB
                                                    ▲
Watcher chokidar (ediciones manuales del vault) ────┘

Consultas: /query + RagService (top-k + contexto citado)
Estudio:   /cluster, /memorize, /quiz
```

## Requisitos

- **Node.js ≥ 24** y npm.
- **Ollama** nativo en `127.0.0.1:11434` (solo si usas chat o embeddings locales).
- **GPU NVIDIA** recomendada para STT (funciona en CPU, más lento). Sin GPU, usa STT remoto.
- **uv** y **Python 3.12** para el servidor de transcripción local.
- Un vault de Obsidian (se crea la carpeta si no existe).
- Opcional: token de bot de Telegram y API key de OpenRouter.

Probado en Linux con RTX 3070 (8 GB), driver 580, CUDA 13.4, Node 24 y Ollama 0.35.

## Instalación

```bash
git clone git@github.com:fakel/Idearium.git
cd Idearium
npm install
cp .env.example .env
```

Edita `.env` como mínimo con `OBSIDIAN_VAULT_PATH` y, si vas a usar el bot, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_ALLOWED_USER_IDS`.

### Instalación automática en un servidor (Ubuntu/Debian)

Para un servidor dedicado hay un instalador idempotente que deja todo listo y arrancado con systemd:

```bash
git clone git@github.com:fakel/Idearium.git /opt/idearium
cd /opt/idearium
sudo bash scripts/install-server.sh
```

Qué hace:

- Instala paquetes base, **Node.js 24** (si hace falta), **Ollama** y descarga `qwen2.5:7b-instruct` + `bge-m3`.
- Instala dependencias npm y compila (`npm ci && npm run build`).
- Detecta GPU con `nvidia-smi`:
  - **Con GPU**: instala el STT local (`uv sync` con wheels CUDA) y crea `idearium-stt.service`.
  - **Sin GPU**: configura un STT externo compatible con OpenAI en `.env` y **no** instala CUDA.
- Crea `.env` desde `.env.example` si no existe, con vault en `/srv/idearium/vault` y datos en `/var/lib/idearium`. Pregunta el token de Telegram y la allowlist (salvo `--yes`).
- Crea `idearium.service` (bot + watcher) y `idearium-stt.service` (solo STT local), con reinicio automático.

Opciones útiles:

```bash
sudo bash scripts/install-server.sh --stt=external   # forzar STT externo
sudo bash scripts/install-server.sh --stt=cpu        # STT local sin CUDA (lento)
sudo bash scripts/install-server.sh --user=miusuario # usuario que ejecuta los servicios
sudo bash scripts/install-server.sh --no-models      # no descargar modelos
sudo bash scripts/install-server.sh --no-service     # solo instalar, sin systemd
```

Para STT externo, edita `.env`:

```dotenv
WHISPER_API_URL=https://api.openai.com
WHISPER_API_KEY=sk-...
WHISPER_MODEL=whisper-1
# OpenRouter (misma clave que el chat):
# WHISPER_API_URL=https://openrouter.ai/api
# WHISPER_MODEL=openai/whisper-1
# Alternativa Groq:
# WHISPER_API_URL=https://api.groq.com/openai
# WHISPER_MODEL=whisper-large-v3
```

El endpoint debe aceptar `POST /v1/audio/transcriptions` con `multipart/form-data`. El instalador solo configura OpenAI por defecto; para otro proveedor cambia URL, modelo y clave.

Si el servidor no tiene GPU y quieres evitar Ollama por completo, tras instalar edita `.env` con el bloque de [modo 100 % OpenRouter](#21-servidor-sin-gpu-modo-100--openrouter) y ejecuta `npm run doctor` + `sudo systemctl restart idearium`.

Operación:

```bash
sudo systemctl status idearium idearium-stt
sudo journalctl -u idearium -f
sudo systemctl restart idearium
```

### Docker (solo OpenRouter)

Para un servidor sin GPU, la imagen Docker no instala Ollama, Whisper ni CUDA: chat, embeddings y STT se hacen contra OpenRouter. El vault y LanceDB se montan desde el host.

```bash
cp .env.docker.example .env   # completa OPENROUTER_API_KEY y Telegram
mkdir -p vault data
docker compose up -d --build
docker compose logs -f idearium
```

El contenedor no expone puertos (usa polling). Para montar tu vault real, define `IDEARIUM_VAULT_DIR` y `IDEARIUM_DATA_DIR` en `.env`. Guía completa, modelos, costes y diagnóstico: **[DOCKER.md](DOCKER.md)**.

### 1. Modelos de Ollama

No se descargan solos; ejecútalos una vez:

```bash
ollama pull qwen2.5:7b-instruct   # chat y estructuración (~4.7 GB)
ollama pull bge-m3                # embeddings 1024 dims (~1.2 GB)
```

> Con 8 GB de VRAM, `qwen2.5:7b-instruct` en Q4 entra junto a `bge-m3` si no mantienes otros modelos cargados. Si prefieres algo más liviano, cambia `OLLAMA_MODEL` (por ejemplo `qwen2.5:3b-instruct`).

### 2. Servidor de transcripción (opcional si solo usarás texto)

```bash
cd stt
uv sync          # instala faster-whisper + libs CUDA 12 (cuBLAS/cuDNN)
./start.sh       # http://127.0.0.1:8000
```

`stt/start.sh` añade al `LD_LIBRARY_PATH` las libs de los wheels `nvidia-*`, necesarias para CTranslate2. Si la GPU falla, el servidor cae automáticamente a CPU/int8 y lo registra en el log. Variables: `WHISPER_MODEL` (default `small`), `WHISPER_DEVICE` (default `cuda`), `WHISPER_COMPUTE_TYPE` (default `int8_float16`).

Si no quieres ejecutar Whisper localmente, apunta `WHISPER_API_URL` a un proveedor externo compatible con OpenAI y define `WHISPER_API_KEY`; el bot usa el mismo endpoint `/v1/audio/transcriptions`. OpenRouter también sirve: `WHISPER_API_URL=https://openrouter.ai/api` y `WHISPER_MODEL=openai/whisper-large-v3-turbo` (si dejas `WHISPER_API_KEY` vacía, se reutiliza `OPENROUTER_API_KEY`).

### 2.1 Servidor sin GPU: modo 100 % OpenRouter

OpenRouter cubre las tres piezas: chat, embeddings y transcripción. Una sola `OPENROUTER_API_KEY` basta para no instalar Ollama ni Whisper.

Por defecto `OPENROUTER_REASONING_EFFORT=none`: las tareas del bot (digest, clasificación, RAG, quiz, palacio) son extracción/síntesis sobre contexto ya dado y no necesitan cadena de pensamiento. `deepseek/deepseek-v4.1-flash` razona por defecto, así que `none` evita latencia y tokens de salida extra. Súbelo a `low` solo si `/cluster` o la corrección del quiz empeora.

```dotenv
LLM_PREFERENCE=remote_only
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash
OPENROUTER_REASONING_EFFORT=none

EMBEDDING_PROVIDER=openrouter
OPENROUTER_EMBED_MODEL=baai/bge-m3
EMBEDDING_DIM=1024

WHISPER_API_URL=https://openrouter.ai/api
WHISPER_MODEL=openai/whisper-large-v3-turbo
WHISPER_API_KEY=                # vacío = reutiliza OPENROUTER_API_KEY
WHISPER_TIMEOUT_MS=180000
```

### 2.2 Modelos recomendados en OpenRouter

| Tarea | Gratis (`:free`) | Pago recomendado | Por qué |
| --- | --- | --- | --- |
| Captura → JSON (título, resumen, tags) | `google/gemma-4-31b-it:free` | `openai/gpt-4o-mini` · `deepseek/deepseek-v4-flash` (vía OpenRouter) | JSON fiable y barato; el segundo tiene 1M de contexto |
| `/query` y RAG | `nvidia/nemotron-3.5-super-vl:free` | `google/gemini-3.1-flash-lite` | Contexto largo (1M) a bajo coste |
| `/cluster`, `/memorize`, `/quiz` | `dots-studio/dots-3-note-preview:free` | `anthropic/claude-sonnet-4.6` · `openai/gpt-5.4-mini` | Mejor redacción y razonamiento |
| Embeddings | `nvidia/nemotron-3.5-embed-8b:free` | `baai/bge-m3` | bge-m3 es 1024 dims, multilingüe y el mismo que en local |
| Audio (STT) | **no hay** | `openai/whisper-large-v3-turbo` · `openai/gpt-4o-transcribe` · `elevenlabs/scribe-v2` | Turbo es el más barato; GPT-4o Transcribe aguanta mejor ruido/acentos; Scribe v2 destaca en multilingüe |

Precios de referencia (por 1M de tokens, salvo audio):

| Modelo | Entrada | Salida |
| --- | --- | --- |
| `deepseek/deepseek-v4-flash` | $0.09 | $0.18 |
| `openai/gpt-4o-mini` | $0.15 | $0.60 |
| `google/gemini-3.1-flash-lite` | $0.25 | $1.50 |
| `openai/gpt-5.4-mini` | $0.75 | $4.50 |
| `anthropic/claude-sonnet-4.6` | $3.00 | $15.00 |
| `baai/bge-m3` (embeddings) | $0.01 | — |
| `openai/whisper-large-v3-turbo` | ~$0.0002/minuto | — |
| `elevenlabs/scribe-v2` | ~$0.0037/minuto | — |
| `openai/whisper-1` | ~$0.006/minuto | — |

#### Gratis vs pago

- Los modelos `:free` están limitados a **20 peticiones/minuto y 50 peticiones/día**; el límite diario sube a 1.000 si alguna vez compraste $10 de créditos. Fallan con `429` cuando la capacidad compartida está ocupada, pueden desaparecer o cambiar sin aviso y varios no soportan `response_format` (los de la tabla sí).
- En pago no existe ese cupo diario gratuito: pagas por token y tienes versiones estables, más throughput y opciones de enrutado/privacidad. Para este proyecto el coste es bajo: una captura típica cuesta fracciones de centavo.
- **No hay STT gratuito en OpenRouter**: la transcripción siempre se cobra por segundo de audio.
- Los embeddings gratuitos existen, pero su dimensión puede no ser 1024; si la cambias debes ajustar `EMBEDDING_DIM` y reindexar todo. Por eso el modo remoto recomendado usa `baai/bge-m3` de pago (seguís usando 1024 dims).
- Si cambias de modelo de embeddings, reindexa desde cero (`rm -rf data/lancedb data/index-state.json && npm run cli -- reindex`).


### 3. Bot de Telegram (opcional)

El bot usa **long polling**: no necesitas dominio, webhook ni abrir puertos.

#### 3.1 Crear el bot y obtener el token

1. Abre Telegram y busca **[@BotFather](https://t.me/BotFather)** (el oficial, con el check azul).
2. Envía `/newbot`.
3. Elige un **nombre visible** (por ejemplo `Mi Idearium`).
4. Elige un **username** que termine en `bot` y que esté libre (por ejemplo `mi_idearium_bot`).
5. BotFather responderá con algo así:

   ```text
   Use this token to access the HTTP API:
   123456789:AAH8xQ2exampleTokenNoReal_9fGh3kLm
   ```

   Ese es tu `TELEGRAM_BOT_TOKEN`. **No lo compartas ni lo subas al repo.**
6. Opcional: envía `/setdescription` y `/setuserpic` a BotFather para personalizar el bot.
7. El bot solo responde en **chats privados**; no hace falta configurar la privacidad para grupos.

> Si el token se filtra: `/revoke` en BotFather genera uno nuevo y anula el anterior. Actualiza `.env` después.

#### 3.2 Obtener tu ID de usuario

El bot solo atiende a los IDs de la allowlist.

1. Abre **[@userinfobot](https://t.me/userinfobot)** y envía `/start`.
2. Copia el número de la línea `Id:` (por ejemplo `123456789`).
3. Si quieres autorizar a más personas, repite con cada una. También puedes usar **[@RawDataBot](https://t.me/RawDataBot)** y leer `"from":{"id":...}`.

#### 3.3 Configurar `.env`

Edita `.env` en la raíz del proyecto:

```bash
TELEGRAM_BOT_TOKEN=123456789:AAH8xQ2exampleTokenNoReal_9fGh3kLm
TELEGRAM_ALLOWED_USER_IDS=123456789
```

Varios usuarios van separados por comas, sin espacios:

```bash
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321
```

Notas:

- El token va **sin comillas** y sin espacios alrededor del `=`.
- Usa tu ID **positivo** de usuario. El bot rechaza grupos y canales por privacidad, aunque el ID esté en la allowlist.
- El bot **se niega a arrancar** si el token o la allowlist están vacíos: es intencional para no dejar un bot abierto.
- `.env` está en `.gitignore`; no lo comitees.

Verifica el token sin arrancar el bot:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

Debe devolver `"ok":true` y el username del bot. Si devuelve `401 Unauthorized`, el token está mal copiado.

#### 3.4 Arrancar y probar

```bash
npm run dev      # desarrollo (tsx watch, reinicia al guardar)
# o
npm run build && npm start   # producción
```

En la consola debe aparecer el arranque del bot y del watcher. Luego, desde **tu** cuenta de Telegram:

1. Abre el chat con tu bot (búscalo por su username) y pulsa **Start** o envía `/start`.
   - Debe responder con la ayuda y el proveedor LLM activo.
2. Envía un texto: `probar mi primer idea sobre el proyecto`.
   - El bot muestra el título, el resumen y la categoría sugerida, y pregunta **en qué carpeta** guardarla con botones de las carpetas existentes.
   - Elige una carpeta y luego una categoría; recién entonces responde con la ruta del `.md`, los tags y si quedó indexada.
3. Envía una **nota de voz**.
   - Se descarga el `.ogg`, se transcribe y pasa por la misma elección de carpeta y categoría.
4. Prueba `/query ¿qué ideas tengo?`.
5. Prueba desde otra cuenta no autorizada: debe responder "No estás autorizado".

Si el bot no responde:

- Revisa que el proceso siga vivo y sin errores en la consola.
- `npm run doctor` valida token, allowlist y el resto del entorno.
- Confirma que escribiste tu ID real (no el username) en `TELEGRAM_ALLOWED_USER_IDS`.
- Si hay otra instancia del bot corriendo con el mismo token, Telegram devuelve `409 Conflict`: cierra la otra (`Ctrl+C` o `pkill -f "tsx.*src/index.ts"`).
- El bot solo funciona con el proceso encendido; no es un servicio en la nube.

#### 3.5 Todo con un solo comando

Para no abrir tres terminales, el script `scripts/local.sh` arranca y para Ollama, el STT y el bot juntos. Los procesos quedan en segundo plano (`setsid`), con PID en `.run/` y logs en `logs/`.

```bash
npm run local:start      # arranca todo
npm run local:status     # comprueba procesos y /health
npm run local:logs       # sigue el log del bot (Ctrl+C para salir)
npm run local:stop       # detiene todo
npm run local:restart    # reinicia todo
```

`npm run local:logs -- stt` y `npm run local:logs -- ollama` muestran los otros logs. Si Ollama ya corría como servicio del sistema, `local:start` lo reutiliza y `local:stop` **no** lo detiene.

En una GTX 1050 Ti el script arranca el STT en CPU (`WHISPER_DEVICE=cpu`, `int8`) para evitar los fallos de CUDA; se puede sobreescribir con esas variables en `.env`.

Antes del primer arranque, descarga los modelos una sola vez:

```bash
ollama pull qwen2.5:3b
ollama pull bge-m3
```

### 4. Verificación

```bash
npm run doctor   # dependencias, modelos, STT, vault, token, LanceDB
npm test         # 125 tests (schemas, selector multi-nota, chunking, frontmatter, clasificación, palacios, indexer, RAG, bot, STT)
npm run smoke    # E2E en vault temporal: crea, indexa y consulta una nota
```

## Uso

### Telegram

Al abrir el chat con `/start` (o con `/menu`) aparece un **teclado fijo** con las acciones habituales: `🔍 Consultar`, `📚 Notas`, `🏛️ Palacios`, `🧠 Memorizar`, `🎯 Quiz`, `🔄 Reindexar` y `❓ Ayuda`. No hace falta escribir `/query` ni recordar la sintaxis:

- **Consultar** → escribe la pregunta en el siguiente mensaje.
- **Memorizar** → escribe el número, título o tema de la nota.
- **Quiz** → escribe el número, título o tema de las notas.
- **Notas**, **Palacios** y **Reindexar** se ejecutan al pulsar.
- **Ayuda** vuelve a mostrar el menú y el estado.

Los comandos de la tabla siguen funcionando para quien prefiera escribirlos, y el menú nativo de Telegram (`/`) incluye todos con su descripción.

| Acción | Cómo |
| --- | --- |
| Guardar una idea | Envía texto libre, una nota de voz, una foto con texto o un documento; elige carpeta y categoría |
| Descartar una captura pendiente | `/cancelar` |
| Preguntar al vault | `/query ¿qué anoté sobre el presupuesto?` |
| Listar notas y números | `/notas` o `/notas presupuesto` |
| Leer una nota | `/notas 7`, `/notas #0007` o `/notas 0000` (curso) |
| Borrar una nota | `/notas rm 7` |
| Reindexar tras cambios masivos | `/reindex` |
| Forzar proveedor remoto | `/remoto <texto>` |
| Crear un estudio que agrupa notas | `/cluster hardware local` |
| Crear/actualizar un palacio | `/memorize ruta/o/tema` (una sola nota) |
| Ver un palacio o listar todos | `/palacio [número|ruta/o/tema]` |
| Borrar un palacio | `/palacio rm <número|ruta/o/tema>` |
| Quiz interactivo | `/quiz tema`, `/quiz 7` o `/quiz notas A, B y C` · `/quiz stop` |
| Ayuda + estado | `/start` |
| Mostrar el teclado de acciones | `/menu` |

El bot responde con título, ruta, tags y proveedor usado. Si el audio, la foto o el documento no se puede procesar, no se crea nota y se informa el error.

`/notas` muestra todas las notas con su número (`0001 — Título`); `/notas texto` filtra por título o ruta. Las notas antiguas sin número aparecen por su título. `/notas 7` (o `/notas #0007`) muestra el contenido completo de esa nota, sin frontmatter.

Las notas del curso usan prefijo de cuatro dígitos (`0000`–`0021`) y no tienen `note_number` en el frontmatter: `/notas 0000` las lee por el nombre del archivo. Esos prefijos **sí cuentan** para la numeración global, así que la primera captura después del curso será `0022`.

`/notas rm <número|título|ruta>` borra el archivo `.md`, sus chunks del índice y la entrada de `index-state.json`. Solo resuelve coincidencias exactas: número, título o ruta; no borra por tema. Los palacios se borran con `/palacio rm`. No borra el audio ni el documento original, y los enlaces existentes a la nota pueden quedar rotos.

#### Nombres de nota

Cada nota capturada se guarda como:

```text
NNNN-titulo-DDMMAA.md
```

Ejemplo: `0007-comprar-filtros-de-cafe-061126.md`.

- `NNNN`: número global del vault, con relleno a 4 dígitos. Se calcula como el mayor número existente + 1, mirando todas las carpetas y también los prefijos `NNNN` de las notas del curso (`0000`–`0021`).
- `titulo`: slug del título (sin acentos, minúsculas, guiones).
- `DDMMAA`: fecha local de creación.

El frontmatter incluye `note_number: 7` y `aliases: ["0007"]`, así puedes referenciar la nota desde cualquier otra con `[[0007]]` además de `[[0007-comprar-filtros-de-cafe-061126]]`. También puedes usar el número directamente en el bot: `/quiz 7`, `/memorize 7` o `/palacio 7` (este último busca en la lista de palacios, no en el número de nota).

Las notas antiguas conservan su nombre actual; la numeración se aplica a las nuevas.

#### Clasificación interactiva (carpeta y categoría)

Cada texto, nota de voz, foto o documento se detiene antes de guardarse para que elijas dónde va:

1. **Carpeta**: botones con las carpetas del vault que ya contienen notas (incluida `Idearium`), más `➕ Otra carpeta`. También puedes escribir un nombre relativo, por ejemplo `Proyectos/Idearium`; la carpeta se crea si no existe.
2. **Categoría**: botones con las categorías ya usadas en el vault (ordenadas por frecuencia), empezando por la que sugirió el LLM, más `➕ Otra categoría`. También puedes escribir una: `#idea`, `#tarea`, `#aprendizaje`, `#referencia`, `#proyecto`, `#personal` u `#otro` (se aceptan plurales).

La captura preparada vive en memoria hasta 30 minutos. Si el bot se reinicia o pasa ese tiempo, hay que volver a enviarla. `/cancelar` la descarta sin escribir nada; el audio, la foto o el documento descargado puede quedar en `data/audio/`, `data/images/` o `data/documents/` para limpieza manual.

#### Documentos

Puedes enviar como archivo `.md`, `.txt`, `.pdf`, `.doc` o `.docx`. El bot:

1. Descarga el original en `DOCUMENT_DIR` (20 MB máximo, límite de Telegram).
2. Extrae el texto: Markdown sin frontmatter, texto plano, PDF con capa de texto, DOCX con `mammoth` y DOC con `word-extractor`.
3. Lo pasa por el mismo flujo de clasificación (carpeta y categoría) y guarda el `.md` con `document_file` en el frontmatter.

Límites: los PDF escaneados sin capa de texto no se pueden leer sin OCR; el texto extraído se recorta a `DOCUMENT_MAX_CHARS`. El original no se borra automáticamente.

#### Fotos (OCR)

Puedes enviar una foto como foto normal de Telegram (no como archivo). El bot:

1. Elige la resolución más grande que envió Telegram y la descarga en `IMAGES_DIR` (20 MB máximo).
2. La envía al modelo multimodal configurado en `OPENROUTER_VISION_MODEL` (`google/gemma-4-31b-it` por defecto) con un prompt que pide Markdown y conserva tablas, columnas, filas y notas.
3. Si el modelo principal falla, reintenta automáticamente con `OPENROUTER_VISION_FALLBACK_MODEL` (`qwen/qwen3-vl-30b-a3b-instruct`).
4. Muestra el texto detectado, el modelo usado y pide confirmación con **Usar este texto**, **Corregir** o **Cancelar**. Si el texto salió mal, **Reintentar con alternativa** vuelve a procesar la misma foto con Qwen.
5. Solo si confirmas, genera el resumen y sigue el flujo normal de carpeta/categoría.
6. Guarda la nota con `image_file` en el frontmatter.

Gemma 4 31B es ~2,5× más barato que Qwen3-VL 30B y leyó igual de bien las pruebas con tablas; Qwen usa más resolución de imagen y queda como red de seguridad para documentos densos o letra pequeña.

Límites: el OCR funciona bien con texto impreso y capturas; para manuscritos o fotos muy torcidas la calidad depende del modelo. Si no detecta texto, responde `No se detectó texto legible` y no crea una nota vacía. La foto sale hacia OpenRouter; no se usa OCR local.

Cada respuesta de `/query` cita las notas con `[[wikilinks]]` y lista **solo las fuentes citadas**. RAG descarta los chunks lejanos al mejor resultado y limita los fragmentos por nota, así que `RAG_TOP_K` es el número de candidatos, no de fuentes finales. Si no hay resultados, responde explícitamente que no encontró nada (no inventa).

#### Palacios de la memoria

- `/palacio` sin argumentos lista todos los palacios numerados, individuales y combinados (`[combinado]`).
- `/palacio 2` devuelve el palacio número 2 de esa lista.
- `/palacio ruta/o/nota.md` o `/palacio tema` siguen funcionando para consultar por ruta, título o búsqueda semántica.
- La respuesta es solo la historia del palacio (texto destilado), sin ruta ni encabezados; si supera el límite de Telegram se parte en varios mensajes.
- Si la nota no tiene palacio, el bot sugiere crearlo con `/memorize <nota>`.
- `/palacio rm <número|nota|tema>` borra el archivo de `Palacios/` y quita su enlace de las notas fuente; si era un palacio antiguo dentro de una nota, borra solo esa sección.

#### Quiz multi-nota

`/quiz` acepta un número de nota, listas de notas o un tema:

```text
/quiz 7
/quiz sobre las notas Sprint 3, Retrospectiva y OKR del equipo
/quiz procedimiento de compra
```

- Selecciona las notas por título explícito o por tema y reparte entre 3 y 6 preguntas (al menos una por nota cuando el modelo lo permite).
- El `source` de cada pregunta se valida contra las notas seleccionadas; si el LLM inventa una fuente, la pregunta se descarta.
- El feedback cita `[[Título]]` y el resumen final muestra aciertos por nota.
- Si no hay notas para el tema, no empieza el quiz y lo dice.

#### Palacios de la memoria

`/memorize` crea el palacio de **una sola nota**. Si la expresión coincide con varias notas, no elige una al azar: muestra una lista de botones para que elijas.

```text
/memorize Filtro de café
/memorize procedimiento de compra
```

- Si hay una sola coincidencia, crea o actualiza el palacio directamente.
- Si hay varias, muestra hasta 5 candidatas con botones; al pulsar una se genera el palacio de esa nota.
- Una lista explícita (`/memorize Nota A, Nota B`) se rechaza: el palacio multi-nota dejó de exponerse en el bot porque elegía notas poco precisas.
- Al terminar, el mensaje indica el número del palacio y cómo leerlo con `/palacio <número>`.
- El palacio se crea como nota nueva en `Palacios/YYYY-MM-DD-palacio-<tema>.md` con `type: palacio` y `source_notes`.
- En la nota original solo queda un enlace `[[Palacios/...|Palacio — Título]]` dentro de `## Palacio de la memoria`; no se copia la historia.
- La historia tiene 4–6 escenas con lugar, idea e imagen absurda; no copia párrafos de la nota.
- `/palacio` muestra esa historia directamente, sin encabezados ni el texto completo del vault.
- El contexto se limita con `MEMORY_MAX_CHARS` (24.000 por defecto); si se recorta, la nota lo indica.

El listado sirve para copiar la ruta y consultarla directamente; solo se leen archivos `.md` del vault, ignorando `.obsidian/` y `.trash/`.

### CLI

```bash
npm run cli -- text "Idea capturada desde terminal" [--remote]
npm run cli -- audio ./nota.ogg [--remote]
npm run cli -- query "¿qué ideas tengo sobre X?"
npm run cli -- notes [texto]
npm run cli -- reindex
```

`--remote` fuerza OpenRouter (falla si no hay `OPENROUTER_API_KEY`).

## Estructura de una nota

```markdown
---
id: 3f1c…
title: Repensar el índice
note_number: 7
aliases: ["0007"]
summary: La búsqueda debe priorizar notas recientes.
category: idea
tags:
  - busqueda
  - indice
created: 2026-11-05T15:00:00.000Z
updated: 2026-11-05T15:00:00.000Z
source: telegram_voice
language: es
audio_file: /…/data/audio/2026-11-05/….ogg
---

# Repensar el índice

## Resumen
…
## Ideas clave
- …
## Acciones
- [ ] …
## Transcripción
…
```

| Categoría | Uso |
| --- | --- |
| `idea`, `tarea`, `aprendizaje`, `referencia`, `proyecto`, `personal`, `otro` | Clasificación de la captura |

## Configuración (`.env`)

| Variable | Default | Descripción |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | vacío | Token de BotFather; sin él no hay bot |
| `TELEGRAM_ALLOWED_USER_IDS` | vacío | IDs separados por comas; obligatorio |
| `OLLAMA_API_URL` | `http://127.0.0.1:11434` | Ollama local |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | Modelo de chat/estructuración |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | Embeddings (1024 dims) |
| `OLLAMA_NUM_CTX` | `8192` | Contexto del modelo local |
| `WHISPER_API_URL` | `http://127.0.0.1:8000` | STT local o externo compatible con OpenAI |
| `WHISPER_API_KEY` | vacío | Token Bearer para STT externo |
| `WHISPER_MODEL` | `small` | Modelo faster-whisper o del proveedor |
| `WHISPER_TIMEOUT_MS` | `120000` | Timeout de transcripción |
| `OBSIDIAN_VAULT_PATH` | `~/Documents/IdeariumVault` | Raíz del vault |
| `NOTE_SUBDIR` | `Idearium` | Subcarpeta de notas |
| `LANCEDB_PATH` | `./data/lancedb` | Índice vectorial |
| `AUDIO_DIR` | `./data/audio` | Audios descargados |
| `DOCUMENT_DIR` | `./data/documents` | Documentos originales descargados |
| `DOCUMENT_MAX_CHARS` | `200000` | Máximo de texto extraído de un documento |
| `IMAGES_DIR` | `./data/images` | Fotos originales para OCR |
| `EMBEDDING_DIM` | `1024` | Debe coincidir con el modelo de embeddings |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` o `openrouter` |
| `OPENROUTER_EMBED_MODEL` | `baai/bge-m3` | Modelo de embeddings remoto (1024 dims) |
| `LLM_PREFERENCE` | `local_first` | `local_only`, `local_first`, `remote_first`, `remote_only` |
| `LLM_ESCALATE_ON` | `validation_failure,explicit_flag` | Disparadores de escalado |
| `LLM_MAX_LOCAL_CHARS` | `12000` | Umbral de `long_input` |
| `LLM_TIMEOUT_MS` | `120000` | Timeout por llamada |
| `OPENROUTER_API_KEY` | vacío | Activa OpenRouter (chat, embeddings y STT) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Endpoint de chat/embeddings |
| `OPENROUTER_MODEL` | vacío → `openai/gpt-4o-mini` | Modelo de chat de OpenRouter |
| `OPENROUTER_VISION_MODEL` | `google/gemma-4-31b-it` | Modelo multimodal para OCR de fotos |
| `OPENROUTER_VISION_FALLBACK_MODEL` | `qwen/qwen3-vl-30b-a3b-instruct` | Alternativa automática o bajo demanda para OCR |
| `OPENROUTER_REASONING_EFFORT` | `none` | `none`, `minimal`, `low`, `medium`, `high`; `none` evita tokens de razonamiento |
| `LLM_REMOTE_MODEL` | vacío | Alias histórico para el modelo de OpenRouter |
| `RAG_TOP_K` | `8` | Candidatos recuperados; se filtran por distancia antes de responder |
| `MEMORY_MAX_NOTES` | `5` | Máximo de candidatas del quiz multi-nota y de la lista de `/memorize` |
| `MEMORY_MAX_CHARS` | `24000` | Máximo de caracteres de contexto para palacio/quiz |
| `LOG_LEVEL` | `info` | Nivel de pino |

### Enrutado local/remoto

- `local_first` (default): usa Ollama. Escala a OpenRouter si el JSON no valida (tras un reintento local con el error de Zod como feedback), si usas `--remote`, o si la captura supera `LLM_MAX_LOCAL_CHARS`.
- `remote_first`: intenta OpenRouter y cae a local.
- `local_only` / `remote_only`: un único modo. `remote_only` usa OpenRouter, sin Ollama.
- Sin `OPENROUTER_API_KEY`, las preferencias `remote_*` se degradan a `local_first` con un warning.
- Los embeddings son locales por defecto (`bge-m3`). Con `EMBEDDING_PROVIDER=openrouter` se usa `baai/bge-m3` remoto (misma dimensión 1024).
- No hay otros proveedores remotos: DeepSeek fue retirado del proyecto porque no ofrece embeddings ni STT.

## Comandos npm

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Bot + watcher con recarga |
| `npm run local:start` | Ollama + STT + bot en segundo plano |
| `npm run local:stop` | Detiene todo lo arrancado por `local:start` |
| `npm run local:status` | Estado de procesos y healthchecks |
| `npm run local:logs` | Sigue los logs (`-- stt` / `-- ollama`) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Ejecuta `dist/index.js` |
| `npm test` | Vitest |
| `npm run cli -- <cmd>` | CLI |
| `npm run doctor` | Diagnóstico accionable |
| `npm run smoke` | Prueba E2E en vault temporal |
| `npm run install:server` | Instalador para Ubuntu/Debian (requiere sudo) |

## Cómo funciona el índice

- `chunkMarkdown` divide por encabezados y parte secciones largas con solape.
- Cada chunk se embebe con `bge-m3` por lotes y se guarda en la tabla `notes` de LanceDB (`note_path`, `chunk_index`, `vector`, `text`, `title`, `tags`, `category`, `updated_at`).
- Se guarda un hash por archivo en `data/index-state.json`; si no cambió, no se reindexa.
- El watcher (`chokidar`, debounce 500 ms) sincroniza ediciones manuales del vault, ignorando `.obsidian/` y `.trash/`.

## Solución de problemas

**Ollama no responde** → `ollama serve` y comprueba `curl 127.0.0.1:11434/api/tags`.

**Falta un modelo** → el doctor te dice cuál; `ollama pull <modelo>`.

**El STT está en CPU** → revisa `/health`; si no hay GPU, el servidor cae a CPU a propósito. Para forzar: `WHISPER_DEVICE=cpu ./stt/start.sh`. En GPU, verifica `nvidia-smi` y que `uv sync` instaló `nvidia-cudnn-cu12`.

**"No se pudo conectar con Ollama para embeddings"** → falta `bge-m3` o Ollama está caído; el índice no se actualiza pero la nota ya quedó guardada.

**Docker con GPU** → no se usa en este proyecto. Si ves `failed to discover GPU vendor from CDI`, es el setup de Docker, no Idearium; el STT corre nativo.

**Cambié de modelo de embeddings** → actualiza `EMBEDDING_DIM` y borra `data/lancedb` + `data/index-state.json`; luego `/reindex`.

## Privacidad

- Audio, transcripciones, notas y vectores se quedan en tu disco.
- Solo sale de tu máquina lo que envíes a Telegram (que es inevitable) y, si activas OpenRouter, el texto de la captura/consulta, los fragmentos usados por RAG, los embeddings y/o el audio enviados a OpenRouter.
- Con `EMBEDDING_PROVIDER=openrouter`, los textos de tus notas también salen hacia OpenRouter para calcular vectores.
- Con STT remoto, el audio sale hacia el proveedor configurado en `WHISPER_API_URL`.
- Con OCR remoto, la foto sale hacia OpenRouter; el texto detectado se guarda en la nota.
- Los audios se guardan en `data/audio/`; bórralos cuando quieras.
- El bot solo funciona en chats privados: en grupos o canales se niega a responder para no exponer tus notas a terceros.

## Estado y roadmap

**La versión actual en `main`** (v0.1.0 más los cambios en `Unreleased`) incluye captura de texto, voz, fotos con OCR y documentos; clasificación interactiva; menú fijo de Telegram; notas con `/notas` para listar, leer y borrar; notas en Obsidian; índice LanceDB; RAG; estudios; palacios de memoria; quizzes; CLI; instalador de servidor y modo 100 % OpenRouter.

Pendiente:

- OCR para PDF escaneados (las fotos ya usan OCR multimodal).
- Webhook opcional de Telegram para despliegues con HTTPS (F6).
- Búsqueda híbrida BM25, resúmenes periódicos, multi-vault e integración móvil fuera de Telegram.

## Licencia

BSL 1.1 — ver [LICENSE](LICENSE).
