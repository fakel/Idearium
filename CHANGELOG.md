# Changelog

Todos los cambios relevantes de Idearium se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado semántico.

## [Unreleased]

### Añadido

- OCR de fotos con `message:photo`, modelo multimodal de OpenRouter (`OPENROUTER_VISION_MODEL`; vacío usa `OPENROUTER_MODEL`), confirmación del texto detectado (usar, corregir o cancelar) antes de resumir, `image_file` en el frontmatter y `IMAGES_DIR`.

### Corregido

- Las notas del curso con prefijo de dos dígitos (`00`–`21`) se pueden consultar con `/notas 00`, sin asignarles `note_number` ni chocar con la numeración global de capturas.
- La numeración global cuenta los prefijos de dos dígitos del curso: con las notas `00`–`21`, la siguiente captura recibe `0022` en lugar de reiniciar en `0001`.

## [0.1.0] - 2026-11-06

### Añadido

- Imagen Docker solo OpenRouter (sin Ollama, Whisper, CUDA ni GPU): chat, embeddings y STT remotos, con vault y datos en volúmenes.
- Script `scripts/local.sh` y comandos `npm run local:*` para arrancar/parar bot, STT y Ollama en local.
- Notas nuevas con nombre `NNNN-titulo-DDMMAA.md`, `note_number` y alias `NNNN` para referencias directas por número; `/quiz 7` y `/memorize 7` aceptan ese número.
- Comando `/notas [texto]` y `npm run cli -- notes [texto]` para listar notas con su número, con filtro opcional.
- Comando `/notas rm <número|título|ruta>` para borrar una nota, su índice y su entrada de estado.
- `/notas <número>` y `/notas #<número>` muestran el contenido completo de una nota, sin frontmatter.

### Cambiado

- Palacios de memoria más breves (4–7 escenas, máximo 1800 caracteres); `/palacio` muestra solo la historia, no la sección completa ni el texto de la nota.
- `/palacio` sin argumentos muestra una lista numerada y `/palacio <número>` lee el palacio correspondiente.
- El mensaje de `/memorize` indica el número asignado al palacio creado; si la búsqueda devuelve varias notas, el bot muestra una lista de opciones.
- Todos los palacios se guardan en `Palacios/`; la nota original solo conserva un enlace al palacio, sin la historia completa.
- `/palacio rm <número|nota|tema>` borra el palacio y sus enlaces.
- `/query` filtra los chunks por cercanía al mejor resultado y limita los fragmentos por nota, en lugar de usar siempre todo el `topK`.
- `/query` lista solo las fuentes citadas en la respuesta, no todos los resultados recuperados.

### Corregido

- RAG podía mostrar notas del curso sin relación con la consulta cuando el mejor resultado tenía una distancia mucho menor que el resto.

## [0.0.1] - 2026-11-05

Primera versión funcional: captura por Telegram/CLI, notas en Obsidian, índice vectorial, RAG, palacios de memoria, quizzes y soporte de documentos.

### Añadido

- **Captura de texto y voz**
  - Bot de Telegram con polling, allowlist de usuarios y comandos.
  - Notas de voz descargadas en streaming y transcritas con faster-whisper (GPU CUDA o CPU).
  - STT local compatible con la API de OpenAI (`/v1/audio/transcriptions`) o STT remoto con `WHISPER_API_KEY`.
  - CLI para `text`, `audio`, `query` y `reindex`, con flag `--remote`.

- **Estructuración con LLM y validación**
  - Esquema Zod para título, resumen, categoría, tags, ideas clave y acciones.
  - Router local/remoto con `LLM_PREFERENCE` (`local_only`, `local_first`, `remote_first`, `remote_only`) y escalado por fallo de validación, flag explícito o captura larga.
  - Reintento local con el error de Zod como feedback antes de escalar.
  - Proveedores Ollama y OpenRouter; OpenRouter cubre chat, embeddings y STT con una sola clave.

- **Notas en Obsidian**
  - Frontmatter YAML, cuerpo Markdown y escritura atómica (tmp + rename).
  - Resolución de colisiones de nombres (`-2`, `-3`, …).
  - Clasificación interactiva por carpeta y categoría con botones inline y texto libre; recomendaciones basadas en las carpetas/categorías existentes del vault.
  - Selección de carpeta con validación anti-path-traversal.

- **Documentos**
  - Recepción de `.md`, `.txt`, `.pdf`, `.doc` y `.docx` desde Telegram.
  - Extracción con `unpdf`, `mammoth` y `word-extractor`; Markdown sin frontmatter.
  - Original guardado en `DOCUMENT_DIR`, ruta registrada como `document_file` en la nota.
  - Límite de 20 MB de Telegram y recorte configurable con `DOCUMENT_MAX_CHARS`.

- **Índice vectorial y búsqueda**
  - LanceDB con tabla `notes`, chunking por headings con solape y embeddings `bge-m3` (1024 dims).
  - Embeddings locales con Ollama o remotos con OpenRouter.
  - Hashes por archivo en `data/index-state.json` para evitar reindexados innecesarios.
  - Watcher con chokidar y debounce para ediciones manuales del vault.
  - `/query` y CLI `query` con top-k configurable, contexto numerado y respuestas que citan `[[wikilinks]]`; fallback explícito si no hay resultados.
  - `/reindex` y `cli reindex` con limpieza de notas huérfanas.

- **Conocimiento y estudio**
  - `/cluster <tema>`: agrupa notas relacionadas en un estudio Markdown dentro de `Estudios/`.
  - `/memorize <ruta|tema>`: genera un palacio de la memoria con ruta física, imágenes y repaso.
  - Palacios: se crean en `Palacios/` con `type: palacio` y `source_notes`; `/memorize` trabaja con una sola nota y, si hay ambigüedad, muestra una lista para elegir.
  - `/palacio [ruta|tema]`: lista todos los palacios (incluidos los combinados) o muestra uno completo.
  - `/quiz <tema>` y `/quiz notas A, B y C`: quiz interactivo con puntaje, feedback y fuentes por nota; `/quiz stop` para terminar.

- **Operación**
  - `scripts/doctor.sh`: comprueba Node, dependencias, Ollama/modelos, STT, vault, Telegram, OpenRouter y LanceDB.
  - `scripts/smoke.sh`: prueba de extremo a extremo con vault e índice temporales.
  - `scripts/install-server.sh`: instalación en Ubuntu/Debian con usuario de servicio, systemd, detección de GPU y modo 100 % remoto si no hay GPU.
  - Servidor STT en Python 3.12 con `uv`, fallback automático a CPU y variables `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE`.
  - Documentación completa en `README.md` y `.env.example`.

### Cambiado

- El proyecto pasa de la planificación inicial a una implementación funcional en TypeScript ESM (Node.js ≥ 20).
- El proveedor remoto se simplifica a **OpenRouter** (se retiró el soporte específico de DeepSeek; DeepSeek puede usarse como modelo servido por OpenRouter).
- El escalado remoto admite varios proveedores y modelos en orden de preferencia.
- La versión del paquete pasa a `0.0.1` como primera release consolidada.

### Corregido

- Compatibilidad de faster-whisper con `av` moderno: se fija `av>=11,<16` para evitar el error `open() got an unexpected keyword argument 'metadata_errors'`.
- Re-ejecución del instalador con `sudo` conservando flags.
- Permisos y propietario del `.env`, vault y directorios de datos para el usuario del servicio.
- Uso de `uv run --no-sync` en systemd para no reinstalar dependencias CUDA en modo CPU.
- Respuestas largas de Telegram divididas en mensajes de hasta 4000 caracteres.
- Normalización y deduplicación de tags antes de validar el esquema.

### Limitaciones conocidas

- Los PDF escaneados sin capa de texto no se leen todavía; requieren OCR (F5 del plan).
- El modo webhook de Telegram está planificado pero no implementado; se usa polling (F6).
- No hay comando `/delete`; las notas se borran desde Obsidian o el sistema de archivos y el watcher/reindex limpia el índice.
- No hay pruebas automáticas de llamadas reales a OpenRouter por falta de clave en el entorno de desarrollo.

[0.1.0]: https://github.com/fakel/Idearium/releases/tag/v0.1.0
[0.0.1]: https://github.com/fakel/Idearium/releases/tag/v0.0.1
