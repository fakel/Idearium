# Plan de implementación — Idearium (local, RTX 3070)

## Contexto

`/home/magneto/idearium` es un repo **vacío de código**: solo `README.md`, un commit (`983fc83 first commit`), rama `main` y remoto `git@github.com:fakel/Idearium.git`. No hay `LICENSE` (aunque el README declara MIT), ni `package.json`, ni tests.

El objetivo es implementar la planificación original de GitHub: **17 issues abiertos (1–9 y 12–18)** repartidos en 7 milestones. No existen issues 10 ni 11. Nada está cerrado.

Cadena funcional objetivo (de los issues):

```
Telegram (voz/texto) → descarga .ogg → STT local → LLM local → JSON validado (Zod)
   → nota .md con frontmatter YAML en vault Obsidian → chokidar → embeddings → LanceDB
   → /query (RAG) → /cluster, /memorize, /quiz (memory palace, roadmap)
```

### Mapa issue → milestone (alcance confirmado)

| Issue | Título | Fase del plan |
|---|---|---|
| 1.1 | Docker Ollama + Faster-Whisper GPU | F0 (adaptado: servicios nativos) |
| 1.2 | Proyecto Node/TS + Zod + env | F0 |
| 2.1–2.3 | Bot Telegram, guardado de audio, STT | F1 |
| 3.1–3.3 | Ollama JSON, OpenRouter fallback, validación Zod | F1 |
| 4.1 | Generador Markdown Obsidian | F1 |
| 5.1–5.2 | LanceDB + chokidar sync | F2 |
| 6.1–6.2 | RAG + `/query` | F2 |
| 7.1–7.3 | `/cluster`, `/memorize`, `/quiz` | F3 (roadmap) |

## Decisiones confirmadas (2026-11-05)

- **Todo nativo, sin Docker** en esta entrega. El proyecto contempla modelos remotos cuando lo local no basta, con **preferencia configurable**.
- **Modelo de chat local:** `qwen2.5:7b-instruct` (se descarga con `ollama pull`).
- **Vault:** `~/Documents/IdeariumVault/Idearium/`.
- **Alcance de la primera entrega:** F0–F2 completas (issues 1.1–6.2). F3 (7.1–7.3) queda planificado para después.

## Hallazgos del entorno local (verificados)

- **GPU:** NVIDIA RTX 3070, 8 GB VRAM (7.4 GiB libres), driver 580.178.04, CUDA toolkit 13.4. Mejor que la GTX 1050 Ti del README.
- **Ollama:** 0.35.1 nativo, activo en `127.0.0.1:11434`, con CUDA funcionando (`library=CUDA ... RTX 3070`). Modelos: `qwen3-coder:30b-32k`, `qwen3.5:9b-16k`, `qwen2.5-coder:7b-32k`, `qwen3-coder:30b`, `qwen2.5-coder:7b`, `phi4-mini`, `phi4-mini-reasoning`. **No hay `bge-m3` ni modelo de embeddings.**
- **Docker:** 29.9.0 + Compose v5.6.0, pero **GPU rota**: `docker run --gpus all` → `failed to discover GPU vendor from CDI: no known GPU vendor found`. No está instalado `nvidia-container-toolkit` ni existen `/etc/cdi` o `/var/run/cdi`. El compose con GPU del README **no funcionaría tal cual**.
- **Whisper:** nada escuchando en `:8000`. No hay binarios `whisper`/`faster-whisper` en PATH.
- **Node:** v24.22.2, npm 11.19.1. **uv** 0.12.5 con Python 3.12 disponible (el sistema tiene 3.14, que no sirve para `ctranslate2`).
- **Hardware:** 12 cores, 30 GB RAM, 40 GB libres en `/`.
- **Vault:** no se encontró ningún vault Obsidian (`find -name .obsidian` sin resultados); `~/Documents` existe.
- **Secretos:** no hay `TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY` ni `WHISPER_*` en el entorno.

## Approach (recomendado)

Un único servicio Node.js/TypeScript ESM con pipeline por etapas, y un microservicio Python local para STT. **Todo nativo, sin Docker en esta entrega** (decidido 2026-11-05).

1. **Servicios nativos (F0).** Ollama ya corre nativo con CUDA (no levantar contenedor). STT con `faster-whisper` en un proceso Python 3.12 (uv) que carga el modelo una vez y expone `POST /v1/audio/transcriptions` compatible OpenAI. Docker queda **fuera de alcance**; el README documentará el compose original como alternativa portable no soportada en esta máquina (GPU Docker rota).
2. **STT:** `small` int8_float16 por defecto (~0.5 GB VRAM), `medium` seleccionable por env (~1.5 GB). Con 8 GB sobra espacio para Ollama.
3. **LLM local:** `qwen2.5:7b-instruct` (por traer, ~4.7 GB, JSON y español confiables, sin modo thinking) como default; `qwen3.5:9b-16k` como alternativa. Evitar los `qwen*-coder` (están afinados para código, no para digerir notas).
4. **Routing local/remoto configurable.** La preferencia se define por env y es cambiable sin tocar código:

   | Variable | Valores | Default |
   |---|---|---|
   | `LLM_PREFERENCE` | `local_only`, `local_first`, `remote_first`, `remote_only` | `local_first` |
   | `LLM_REMOTE_MODEL` | modelo OpenRouter | `openai/gpt-4o-mini` (configurable) |
   | `LLM_ESCALATE_ON` | lista: `validation_failure`, `explicit_flag`, `long_input` | `validation_failure,explicit_flag` |
   | `LLM_MAX_LOCAL_CHARS` | umbral para `long_input` | `12000` |
   | `OPENROUTER_API_KEY` | opcional; sin clave todo degrada a local | vacío |

   - `local_first`: intenta Ollama; escala a remoto solo si se cumple `LLM_ESCALATE_ON`.
   - `remote_first`: remoto si hay clave; si falla o no hay clave, cae a local.
   - `local_only` / `remote_only`: sin fallback cruzado (error explícito si el proveedor no está disponible).
   - Flag explícito por mensaje/CLI (`/remoto ...` en Telegram, `--remote` en CLI) solo actúa si hay clave y la preferencia no es `local_only`.
   - Embeddings se quedan locales (`bge-m3`), independientes de este routing.
5. **Embeddings:** `bge-m3` vía Ollama (`ollama pull bge-m3`, 1024 dims, multilingüe). Alternativa `nomic-embed-text` (768) pero peor en español.
6. **Validación:** Zod en los bordes (env al arrancar, JSON del LLM con 1 reintento + reparación, payload de Telegram), `format: "json"` de Ollama para forzar salida.
7. **Markdown:** `gray-matter` para frontmatter (title, id, created, updated, tags, category, summary, source, audio_file) + cuerpo con Resumen / Ideas clave / Acciones / Transcripción. Nombre `YYYY-MM-DD-slug.md` en `<vault>/Idearium/`.
8. **Indexado:** chunking por encabezados Markdown (~700–900 tokens con solape), una fila por chunk en LanceDB con `note_path` para borrar/actualizar por archivo. chokidar con debounce; `add`/`change` → reindexar, `unlink` → borrar filas.
9. **RAG:** embed de la consulta → top-k (8) → prompt con citas `[[nota]]` → LLM router → respuesta partida en trozos de <4096 chars para Telegram.
10. **Seguridad:** allowlist `TELEGRAM_ALLOWED_USER_IDS`; el bot ignora cualquier otro chat. **Polling por defecto** (simple en local); webhook opcional para servidor (ver F6).
11. **Testeabilidad sin Telegram:** CLI interna (`npm run cli -- text|audio|query`) que ejercita el mismo pipeline. Es la vía de verificación end-to-end.

## Archivos a crear/modificar

```
PLAN.md                      (este archivo)
package.json, tsconfig.json, .gitignore, .env.example, LICENSE
README.md                    reescribir Quick Start al camino nativo real
src/index.ts                 bootstrap: env → servicios → bot → watcher
src/config/env.ts            carga + validación Zod de .env
src/lib/logger.ts            logs con niveles (pino o console estructurado)
src/lib/text.ts              slug, chunking Markdown, truncado
src/lib/retry.ts             reintento con backoff para STT/LLM
src/schemas/noteDigest.schema.ts   Zod del JSON del LLM
src/schemas/note.schema.ts         Zod de nota/frontmatter
src/services/storage.service.ts    descarga y guardado de .ogg
src/services/stt.service.ts        cliente del microservicio Whisper
src/services/llm.service.ts        interfaz común de chat (messages → JSON)
src/services/llm-router.service.ts selección local/remoto según preferencia y escalado
src/services/providers/ollama.provider.ts
src/services/providers/openrouter.provider.ts
src/services/obsidian.service.ts   Markdown + frontmatter + escritura atómica
src/services/vector.service.ts     LanceDB: open, upsert, delete, search
src/services/rag.service.ts        retrieve + prompt + síntesis con citas
src/services/indexer.service.ts    parseo de .md, chunks, embeddings, sync
src/services/watcher.service.ts    chokidar sobre el vault
src/controllers/ingest.controller.ts  orquesta voz/texto → nota
src/bot/index.ts, src/bot/commands/*.ts  /start /query /reindex (+ F3: /cluster /memorize /quiz)
src/cli.ts                   ingesta y consulta por consola (tests manuales)
stt/pyproject.toml           faster-whisper + fastapi + uvicorn (Python 3.12)
stt/server.py                API OpenAI-compatible, modelo precargado
scripts/doctor.sh            health-check: Ollama, embed, STT, vault, token
scripts/smoke.sh             e2e: texto → nota → índice → query
tests/*.test.ts              vitest: schemas, chunking, markdown, indexer
```

## Reuse

- **Ollama nativo ya instalado** (`127.0.0.1:11434`, CUDA OK) → no levantar contenedor.
- **`uv` + Python 3.12 ya instalados** → venv para `faster-whisper` sin tocar el Python 3.14 del sistema.
- **Node 24 trae `fetch`, `FormData`, `Blob`, `fs/promises`** → no hace falta `axios` (el README lo lista; se omite).
- **`gray-matter`** en vez de escribir un parser YAML propio.
- **`fetch` nativo** también para OpenRouter (`/api/v1/chat/completions`), mismo contrato que Ollama (`format: json` ↔ `response_format`).
- **`zod`** ya previsto por los issues 1.2/3.3; mismo esquema para env y para el digest.
- Patrones ya usados en `/home/magneto/hackathon/medistudenthelper` (MCP local, `scripts/doctor.sh`, `smoke-test.sh`, `setup.sh`) como referencia de estilo de scripts.

## Steps

### F0 — Base e infraestructura (issues 1.1, 1.2) — [ ]
- [x] `npm init` + TypeScript ESM (`module: NodeNext`), scripts `dev` (tsx), `build`, `start`, `test`, `cli`.
- [x] Instalar: `grammy`, `zod`, `dotenv`, `chokidar`, `@lancedb/lancedb`, `gray-matter`, `pino`; dev: `typescript`, `tsx`, `vitest`, `@types/node`.
- [x] `src/config/env.ts`: schema Zod con `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `OLLAMA_API_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`, `WHISPER_API_URL`, `WHISPER_MODEL`, `OBSIDIAN_VAULT_PATH`, `LANCEDB_PATH`, `AUDIO_DIR` y el bloque de routing (`LLM_PREFERENCE`, `LLM_REMOTE_MODEL`, `LLM_ESCALATE_ON`, `LLM_MAX_LOCAL_CHARS`, `OPENROUTER_API_KEY` opcional). Fail-fast con mensaje claro; sin clave remota, `remote_*` degrada a local con warning.
- [x] `stt/pyproject.toml` + `stt/server.py` (Python 3.12): `faster-whisper` con `device=cuda`, `compute_type=int8_float16`, endpoint `/v1/audio/transcriptions`, `/health`.
- [x] Crear vault `~/Documents/IdeariumVault/Idearium/` y `data/{audio,lancedb}`; `doctor.sh` verifica que el vault sea escribible.
- [x] `scripts/doctor.sh`: comprueba Ollama, modelo de chat, `bge-m3`, STT, vault escribible, token, clave remota (opcional), LanceDB.
- [x] `ollama pull qwen2.5:7b-instruct` y `ollama pull bge-m3` documentados en el README (no descargar automáticamente).

### F1 — Captura y digest (issues 2.1–2.3, 3.1–3.3, 4.1) — [ ]
- [x] Bot grammY con polling y allowlist; detecta `message.voice` y `message.text`.
- [x] `storage.service.ts`: `getFile` + streaming a `data/audio/YYYY-MM-DD/<uuid>.ogg`, sin cargar el archivo completo en memoria.
- [x] `stt.service.ts`: multipart a `WHISPER_API_URL`, timeout, reintento 1 vez, devuelve texto.
- [x] `noteDigest.schema.ts`: `title`, `summary`, `category` (enum), `tags[]` (3–8), `action_items[]`, `key_ideas[]`, `language`.
- [x] `ollama.provider.ts`: `/api/chat` con `format: "json"`, `temperature 0.2`, `num_ctx` por env; prompt de sistema en español.
- [x] `openrouter.provider.ts`: `/api/v1/chat/completions` con `response_format: { type: "json_object" }`, timeout y mapeo de errores.
- [x] `llm-router.service.ts`: implementa la tabla de `LLM_PREFERENCE` y `LLM_ESCALATE_ON` (fallo de Zod, flag explícito, input largo), con log del proveedor/modelo usado y fallback solo en `local_first`/`remote_first`.
- [x] Reintento local con el error de Zod como feedback (1 intento) antes de escalar a remoto.
- [x] `obsidian.service.ts`: frontmatter + cuerpo, escritura atómica (tmp + rename), colisión de nombres, confirmación en Telegram con título/tags/ruta.
- [x] `cli.ts` con `text`, `audio` y flag `--remote` para probar sin bot.
- [x] Comando `/start` con ayuda de uso y estado del proveedor activo.

### F2 — Índice y RAG (issues 5.1–5.2, 6.1–6.2) — [ ]
- [x] `vector.service.ts`: tabla `notes` (`id`, `note_path`, `chunk_index`, `vector[1024]`, `text`, `title`, `tags`, `category`, `updated_at`), `openOrCreate`, `upsert`, `deleteByPath`, `search(vector, k)`.
- [x] `indexer.service.ts`: chunking por headings con solape; embeddings `bge-m3` por lotes; hash del contenido para no reindexar si no cambió.
- [x] `watcher.service.ts`: chokidar `**/*.md`, `awaitWriteFinish`, debounce 500 ms, ignora `.obsidian/`, `.trash/`.
- [x] `rag.service.ts`: top-k configurable, prompt con contexto numerado y rutas, respuesta con `[[wikilinks]]`; fallback "no encontré nada" sin inventar.
- [x] Comando `/query <texto>` + `/reindex` (reindexado completo del vault) usando el mismo LLM router.
- [x] `cli.ts query` y `scripts/smoke.sh`.

### F3 — Memory palace (issues 7.1–7.3) — fuera de esta entrega, planificado

> Decisión 2026-11-05: la primera entrega cierra en F2. F3 queda documentado para la siguiente iteración.
- [x] `/cluster <tema>`: búsqueda semántica amplia → LLM agrupa → guarda `Estudios/<tema>.md` → indexa.
- [x] `/memorize <nota|tema>`: prompt de loci con ruta física → añade sección `## Palacio de la memoria` a la nota → reindexa.
- [x] `/quiz <tema>`: máquina de estados por chat (pregunta → respuesta → feedback → siguiente) con puntaje y cierre.

### F4 — Cierre
- [x] Tests vitest de schemas, chunking, frontmatter, indexer (con LanceDB temporal) y RAG (LLM mockeado).
- [x] README reescrito con el setup real verificado; `.env.example` completo; `LICENSE` MIT.
- [x] `npm run doctor` y `npm run smoke` verdes.

### F5 — OCR de notas desde foto (nuevo, 2026-11-05)

> Hoy el bot solo acepta texto y voz. No existe handler `message:photo`, ni OCR, ni dependencia de visión.

- [ ] Añadir `IMAGE_DIR` (default `data/images`) a `src/config/env.ts` y `.env.example`.
- [ ] `storage.service.ts`: `saveTelegramPhoto(fileId)` con streaming a `data/images/YYYY-MM-DD/<uuid>.jpg`; elegir el tamaño mayor de `message.photo`, validar tamaño máximo y MIME.
- [ ] `ocr.service.ts`: interfaz `OcrEngine { extract(imagePath, opts?): Promise<{text, confidence?}> }`.
- [ ] OCR local por defecto: Tesseract (`tesseract.js` o binario del sistema) con `spa+eng`; preprocesado básico (escala, gris, contraste) y límite de píxeles.
- [ ] OCR remoto opcional vía OpenRouter Vision (`OPENROUTER_VISION_MODEL`, p. ej. un modelo multimodal del catálogo) para manuscritos o fotos difíciles; solo si hay `OPENROUTER_API_KEY`.
- [ ] `bot.on('message:photo')`: descargar → OCR → mostrar texto detectado y pasar por el flujo existente `prepareText` + clasificación carpeta/categoría; permitir editar/descartar antes de guardar si el OCR es dudoso.
- [ ] Guardar `image_file` en el frontmatter de la nota para conservar la foto original junto al texto.
- [ ] Tests: storage de foto, OCR mockeado, handler `message:photo`, fallback cuando no se detecta texto.
- [ ] README: uso de foto, límites (impreso vs manuscrito), privacidad (OCR local no sale de la máquina; visión remota sí) y `doctor.sh` comprueba el motor OCR elegido.

Criterios de aceptación: una foto de una nota impresa en español genera una nota Markdown con texto razonable; si el OCR no detecta nada, el bot lo dice y no crea una nota vacía; sin clave remota el OCR local sigue funcionando.

### F6 — Webhook opcional de Telegram (nuevo, 2026-11-05)

> Polling sigue siendo el default para laptop/local. Webhook solo tiene sentido con un servidor con HTTPS público.

- [ ] `TELEGRAM_MODE=polling|webhook` (default `polling`), `WEBHOOK_URL`, `WEBHOOK_SECRET`, `PORT` en `src/config/env.ts`.
- [ ] `src/index.ts`: en modo webhook, `bot.api.setWebhook(url, { secret_token })`, servidor HTTP nativo con `webhookCallback(bot, 'http')`, `GET /health` y cierre ordenado; en polling, `deleteWebhook` y `bot.start`.
- [ ] Validar `X-Telegram-Bot-Api-Secret-Token`; exigir HTTPS y ruta secreta; documentar Caddy/Nginx + Let's Encrypt o Cloudflare Tunnel.
- [ ] `doctor.sh`: comprobar `getWebhookInfo`, URL, último error y que el modo coincida.
- [ ] README: cuándo usar polling vs webhook, requisitos (dominio, 443, certificado), migración y vuelta atrás.
- [ ] Tests: selección de modo, cabecera secreta inválida y handler HTTP sin arrancar Telegram real.

Criterios de aceptación: con `TELEGRAM_MODE=webhook` el bot recibe updates por HTTPS y `/health` responde; con `TELEGRAM_MODE=polling` el comportamiento actual no cambia.

### F7 — Palacio y quiz multi-nota por lenguaje natural (nuevo, 2026-11-05)

> Hoy `/memorize` resuelve **una sola nota** (ruta o embedding top-1) y `/quiz` usa el texto sintetizado de RAG, no las notas completas. Objetivo: seleccionar varias notas por título explícito o por tema y generar un palacio/quiz que las cubra.

Ejemplos de entrada:

- `/memorize palacio de la memoria de las notas Cafetería, Presupuesto y Proveedores`
- `/memorize palacio de memoria de todos los pasos del procedimiento de compra`
- `/quiz sobre las notas Sprint 3, Retrospectiva y OKR del equipo`

#### F7.1 — Selector de notas (base compartida)
- [x] `src/services/note-selector.service.ts`: `select(expression)` → `{ mode: 'explicit'|'topic', notes: NoteRef[], unresolved: string[] }`.
- [x] Parser de lenguaje natural: quitar prefijos (`palacio de la memoria de`, `quiz sobre`, `notas`, `todos los pasos de`, `procedimiento`), aceptar `[[wikilinks]]`, comas, punto y coma y ` y `; conservar títulos con comas entre comillas.
- [x] Resolución explícita por título, basename, ruta relativa y slug; normalizar mayúsculas/acentos; si un título no existe, devolver `unresolved` y no inventar una nota.
- [x] Resolución por tema: embedding → `vector.search(topK)` → agrupar chunks por `notePath` → ranking por mejor distancia + cobertura → hasta `MEMORY_MAX_NOTES` notas.
- [x] `NoteRef {title,path,relativePath,tags,category}` y `NoteContext` con contenido completo recortado por nota y límite total (`MEMORY_MAX_CHARS`).
- [x] Config nueva en `src/config/env.ts` y `.env.example`: `MEMORY_MAX_NOTES` (default 5) y `MEMORY_MAX_CHARS` (default 24000); validar rangos.
- [x] Tests del parser: lista explícita, wikilinks, título con coma entre comillas, prefijo “todos los pasos de”, tema sin coincidencias, dedupe y límite de notas.

#### F7.2 — Palacio combinado
- [x] Compatibilidad: una sola nota sigue escribiendo `## Palacio de la memoria` dentro de esa nota (comportamiento actual).
- [x] Varias notas o tema: crear una nota nueva en `Palacios/YYYY-MM-DD-palacio-<slug>.md` con frontmatter `type: palacio`, `source_notes: [...]`, `tags: [...]` y cuerpo `# Palacio — <tema>`, `## Notas fuente`, `## Palacio de la memoria`.
- [x] Prompt multi-nota: un solo recorrido físico coherente que integre las ideas de todas las notas, citando `[[Título]]` por idea y sin inventar contenido ausente; indicar qué nota aporta cada estación.
- [x] Si hay demasiadas notas o el contexto se recorta, decirlo en la nota y priorizar las de mejor ranking.
- [x] `/palacio` debe poder abrir un palacio combinado por título/tema y listar tanto los individuales como los combinados (marcar `[combinado]`).
- [x] Tests: creación de nota combinada, frontmatter y fuentes, lectura por tema, listado mixto, una sola nota sin regresión, colisión de nombres.

#### F7.3 — Quiz multi-nota
- [x] `QuizService.start(chatId, expression)` usa el mismo selector; deja de depender solo de `rag.query` y recibe las notas seleccionadas completas (recortadas).
- [x] Prompt: repartir las preguntas entre las notas (mínimo una por nota cuando sea posible), exigir `source` igual a un título seleccionado y permitir preguntas de relación entre notas.
- [x] Validar que cada `source` exista entre las fuentes; si el LLM inventa una fuente, reasignar o descartar la pregunta.
- [x] Resumen final con aciertos por nota y enlaces `[[...]]`; mantener el estado por chat y `/quiz stop`.
- [x] Tests: reparto entre 2–3 notas, fuente inválida, tema con una sola nota, preguntas de relación y cierre con puntaje.

#### F7.4 — UX, documentación y verificación
- [x] Actualizar `/start`, README y ejemplos de `/memorize`, `/palacio` y `/quiz` con lenguaje natural y límites.
- [x] Mensajes claros para: nota no encontrada, tema sin resultados, demasiadas notas, contenido recortado y palacio inexistente.
- [x] Tests de integración con LLM/embedder mockeados; `npm test`, `npm run build` y `npm run smoke` verdes.
- [ ] Opcional: comando `/palacios` como alias de `/palacio` sin argumentos.

Criterios de aceptación: “palacio de la memoria de las notas A, B y C” genera un palacio combinado que cita las tres; “palacio de memoria de todos los pasos del procedimiento X” selecciona las notas relevantes por tema y no inventa pasos; `/quiz` sobre varias notas reparte preguntas y muestra la fuente correcta.

## Verificación

1. `bash scripts/doctor.sh` → Ollama, `qwen2.5:7b-instruct`, `bge-m3`, STT, vault y token OK.
2. Routing: con `LLM_PREFERENCE=local_only` y sin clave remota todo funciona; con `local_first` y clave inválida el digest escala y cae a local sin romper la ingesta.
3. STT aislado: `curl -F file=@muestra.ogg localhost:8000/v1/audio/transcriptions` devuelve texto.
4. `npm run cli -- text "idea de prueba"` → crea `.md` en `~/Documents/IdeariumVault/Idearium/` con frontmatter válido y lo indexa; segunda corrida no duplica filas.
5. Editar/borrar el `.md` a mano → el watcher actualiza/elimina filas en LanceDB.
6. `npm run cli -- query "¿de qué hablé sobre X?"` → respuesta con `[[wikilinks]]` a notas reales.
7. Telegram real: nota de voz → confirmación con ruta; `/query` responde; usuario no autorizado es rechazado; `/remoto` sin clave responde error claro.
8. `npm test` y `npm run build` sin errores.

## Riesgos y mitigaciones

- **Docker GPU roto** → Docker fuera de alcance en esta entrega; README documenta el camino nativo como único soportado.
- **Python 3.14 incompatible con `ctranslate2`** → venv fijado a 3.12 con uv.
- **`bge-m3` no instalado** → `ollama pull bge-m3` en F0 y verificación en `doctor.sh`.
- **Modelos coder instalados no sirven para digest** → `qwen2.5:7b-instruct` fijado por env, con `qwen3.5:9b-16k` como alternativa.
- **Dependencia de red para el remoto** → `local_first` por defecto; sin clave o sin red, el sistema sigue operativo en local.
- **8 GB VRAM compartidos** → Whisper `small` por defecto y `OLLAMA_KEEP_ALIVE` corto; no correr `qwen3-coder:30b` junto al pipeline.
- **Sin vault ni token** → se piden en la confirmación; sin token, F0/F1 se validan por CLI.
- **Pérdida de datos** → escritura atómica, `.trash` del vault, audio original conservado.
