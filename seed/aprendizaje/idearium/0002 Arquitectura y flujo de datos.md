---
title: "0002 — Arquitectura y flujo de datos"
aliases:
  - "0002 Arquitectura y flujo de datos"
  - "Arquitectura de Idearium"
tags:
  - idearium
  - curso
  - arquitectura
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0002 — Arquitectura y flujo de datos

## La arquitectura en una frase

Idearium es un pipeline con dos direcciones:

- **entrada**: captura → extracción → estructuración → Markdown → índice;
- **salida**: pregunta → embedding → búsqueda → contexto → respuesta citada.

Todo lo demás son adaptadores: Telegram, CLI, proveedores de LLM, STT, base vectorial y sistema de archivos.

## Vista de componentes

```text
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Telegram   │     │     CLI      │     │  Watcher    │
│  texto/voz  │     │ text/audio   │     │  (chokidar) │
│  documentos │     │ query/notes  │     │             │
└──────┬──────┘     └──────┬───────┘     └──────┬──────┘
       │                   │                    │
       └───────────┬───────┘                    │
                   ▼                            │
          ┌─────────────────┐                   │
          │ IngestController│◄──────────────────┘
          │ prepare / save  │
          └───────┬─────────┘
                  │
      ┌───────────┼────────────┬──────────────┐
      ▼           ▼            ▼              ▼
  Storage      Document      STT           LLM Router
  (audio/pdf)  extractor     (voz)         (chat JSON)
      │           │            │              │
      └───────────┴────────────┴──────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ ObsidianService │
                 │ Markdown atómico│
                 └────────┬────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       ┌─────────────┐         ┌─────────────┐
       │  Vault .md  │         │  Indexer    │
       │  (verdad)   │         │ hash+lotes  │
       └─────────────┘         └──────┬──────┘
                                      ▼
                              ┌─────────────┐
                              │  LanceDB    │
                              │  (índice)   │
                              └──────┬──────┘
                                     ▼
                              ┌─────────────┐
                              │     RAG     │
                              │ retrieval   │
                              └──────┬──────┘
                                     ▼
                              respuesta + [[fuentes]]
```

## Flujo de entrada: de un audio a una nota

1. **Telegram recibe** `message.voice` o `message.audio`.
2. **Allowlist**: si el `from.id` no está autorizado, se ignora.
3. **Storage** obtiene el archivo con `getFile` y lo descarga en streaming a `data/audio/YYYY-MM-DD/<uuid>.ogg`.
4. **STT** envía el archivo a `/v1/audio/transcriptions` y devuelve texto.
5. **IngestController.prepareAudio** transcribe y prepara el digest, pero **no escribe** todavía.
6. **Clasificación interactiva**: el bot muestra botones de carpeta y categoría.
7. **IngestController.save** escribe el `.md` con frontmatter y cuerpo.
8. **Indexer** calcula hash, divide en chunks, pide embeddings y hace upsert en LanceDB.
9. **Respuesta** al usuario con título, ruta, tags, modelo e índice.

La separación entre `prepare` y `save` es deliberada: permite preguntar sin perder el trabajo ya hecho (transcripción y digest) y evita escribir notas a medias.

## Flujo de salida: de una pregunta a una respuesta citada

1. **`/query`** recibe la pregunta.
2. **Embedding** de la pregunta con el mismo modelo usado para las notas.
3. **LanceDB** devuelve `topK` chunks con su distancia.
4. **Filtro de relevancia**:
   - se queda con los cercanos al mejor hit,
   - limita a 2 chunks por nota.
5. **Contexto numerado**: `[1] Título (ruta)` + texto.
6. **LLM** responde solo con ese contexto y cita `[[Título]]`.
7. **Fuentes**: se extraen los wikilinks de la respuesta y se cruzan con los hits. Solo se muestran las citadas.

## Flujo de indexación

Hay dos disparadores:

- **Explícito**: `/reindex` o `npm run cli -- reindex`.
- **Reactivo**: el watcher detecta cambios en el vault.

El watcher usa `chokidar` con `awaitWriteFinish` y debounce para no indexar archivos a medio escribir. El indexer guarda un hash SHA-256 por archivo; si no cambió, no vuelve a pedir embeddings.

Esto convierte la indexación en **idempotente**: se puede repetir sin duplicar ni gastar de más.

## Dónde vive cada cosa

| Dato | Ubicación | ¿Fuente de verdad? |
|---|---|---|
| Notas | `OBSIDIAN_VAULT_PATH` | Sí |
| Audio original | `AUDIO_DIR` | No, adjunto |
| Documento original | `DOCUMENT_DIR` | No, adjunto |
| Vectores | `LANCEDB_PATH` | No, índice |
| Hash de indexación | `data/index-state.json` | No, caché |
| Configuración | `.env` | Sí |
| Secretos | `.env` | Nunca en Git |

La regla es: **si borras todo menos el vault, puedes reconstruir el sistema**.

## Límites y fronteras de confianza

- **Telegram** es el canal de entrada; se confía solo en usuarios de la allowlist.
- **OpenRouter** recibe texto, audio o embeddings según configuración; es una frontera de privacidad explícita.
- **El LLM** no tiene acceso al vault ni al sistema de archivos. Solo ve el contexto que se le pasa.
- **El índice** no se edita a mano; se reconstruye.
- **La UI** (Telegram/CLI) no contiene lógica de negocio; llama a servicios.

## Manejo de fallos

El diseño asume que todo puede fallar:

- **STT caído** → error claro; el audio queda guardado.
- **LLM devuelve JSON inválido** → reintento con feedback; luego escalado.
- **Embeddings fallan** → la nota se escribe igual; se informa `indexingError`.
- **Watcher pierde un evento** → `/reindex` reconstruye.
- **LanceDB corrupta** → se borra y se reindexa; las notas siguen intactas.
- **Telegram duplicado** → la escritura atómica y nombres únicos evitan sobrescribir.

## Por qué no hay una base de datos relacional

Porque el conocimiento ya está en archivos. Añadir Postgres habría creado dos fuentes de verdad, migraciones y un punto de fallo más. LanceDB cubre la única necesidad que los archivos no cubren bien: búsqueda por similitud.

## Ejercicio

Dibuja el flujo de una nota de voz sin mirar el diagrama. Marca:

1. dónde se guarda el audio,
2. dónde se valida el JSON,
3. dónde se escribe el `.md`,
4. dónde se calcula el hash,
5. qué pasa si falla el embedding.

Si puedes explicar esos cinco puntos, entendiste la arquitectura.
