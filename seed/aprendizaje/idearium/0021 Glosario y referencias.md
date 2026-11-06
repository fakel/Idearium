---
title: "0021 — Glosario y referencias"
aliases:
  - "0021 Glosario y referencias"
  - "Glosario Idearium"
tags:
  - idearium
  - curso
  - glosario
  - referencia
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0021 — Glosario y referencias

## Glosario

**Bot**: proceso Node que escucha Telegram y ejecuta el flujo.

**Captura**: texto, voz o documento que el usuario envía.

**Chunk**: fragmento de una nota que se indexa y se embebe.

**Digest**: JSON estructurado que resume una captura (título, resumen, tags, acciones).

**Embedding**: vector que representa el significado de un texto.

**Escalado**: cambio de proveedor local a remoto cuando falla o no alcanza.

**Frontmatter**: bloque YAML al inicio de una nota.

**Índice**: tabla de chunks y vectores en LanceDB.

**LanceDB**: base de datos vectorial embebida.

**LLM**: modelo de lenguaje que genera texto/JSON.

**Palacio**: recorrido mnemónico generado a partir de una o varias notas.

**Prompt**: instrucción enviada al LLM.

**RAG**: recuperar fragmentos y usarlos como contexto para responder.

**Router**: componente que elige proveedor y modelo.

**STT**: *speech-to-text*, transcripción de audio.

**Token**: unidad de texto que cobra el proveedor.

**Vault**: carpeta de Obsidian con las notas.

**Watcher**: proceso que observa cambios en el vault.

## Comandos del bot

```text
/start
/query <pregunta>
/reindex
/cluster <tema>
/memorize <nota|tema|número>
/palacio [número|nota|tema]
/palacio rm <número|nota|tema>
/notas [texto]
/notas <número>
/notas rm <número|nota|ruta>
/quiz <tema|nota|número>
/quiz stop
/remoto <texto>
/cancelar
```

## Archivos clave

```text
src/index.ts                    arranque
src/bootstrap.ts                composición de dependencias
src/bot/index.ts                comandos y handlers
src/config/env.ts               variables y validación
src/controllers/ingest.controller.ts  preparar/guardar
src/services/llm-router.service.ts    local/remoto
src/services/embedding.service.ts     embeddings
src/services/vector.service.ts        LanceDB
src/services/indexer.service.ts       indexado
src/services/obsidian.service.ts      escritura de notas
src/services/memorize.service.ts      palacios
src/services/quiz.service.ts          quiz
src/services/rag.service.ts           consultas
src/services/document.service.ts      extracción
src/services/stt.service.ts           transcripción
src/services/watcher.service.ts       cambios del vault
```

## Variables importantes

```env
TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWED_USER_IDS
OBSIDIAN_VAULT_PATH
NOTE_SUBDIR
LANCEDB_PATH
LLM_PREFERENCE
OPENROUTER_API_KEY
OPENROUTER_MODEL
OPENROUTER_REASONING_EFFORT
EMBEDDING_PROVIDER
OPENROUTER_EMBED_MODEL
EMBEDDING_DIM
WHISPER_API_URL
WHISPER_MODEL
MEMORY_MAX_NOTES
MEMORY_MAX_CHARS
RAG_TOP_K
```

## Referencias conceptuales

- **RAG**: Lewis et al., *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks*.
- **Embeddings**: Mikolov et al., *word2vec*; Reimers & Gurevych, *Sentence-BERT*.
- **Palacio de la memoria**: técnica clásica de mnemotecnia; ver *method of loci*.
- **Práctica activa**: Roediger & Karpicke, *Test-Enhanced Learning*.
- **Obsidian**: documentación oficial de Markdown y wikilinks.
- **LanceDB**: documentación de esquemas Arrow y búsqueda vectorial.
- **OpenRouter**: documentación de chat, embeddings y audio.
- **Telegram Bot API**: documentación de mensajes, voz y documentos.

## Decisiones de diseño resumidas

1. Markdown como fuente de verdad.
2. Telegram como interfaz de captura.
3. LLM para transformar, no para decidir la taxonomía.
4. Validación Zod de toda salida estructurada.
5. Router de proveedores para no atarse a uno.
6. Chunking por secciones con solape.
7. LanceDB embebida para no operar un servidor.
8. RAG con citas y fallback honesto.
9. Escritura atómica y numeración legible.
10. Pruebas de la lógica, no de la creatividad del modelo.

## Para reconstruirlo desde cero

1. Define el problema y el flujo.
2. Crea el proyecto TypeScript ESM.
3. Valida configuración con Zod.
4. Conecta Telegram con allowlist.
5. Añade STT y extracción de documentos.
6. Define el esquema del digest.
7. Implementa proveedores y router.
8. Escribe notas Markdown atómicas.
9. Indexa con embeddings y LanceDB.
10. Añade RAG, palacios, quiz y cluster.
11. Prueba, documenta y despliega.

## Cierre

Idearium no es un chatbot. Es un sistema de captura, organización y recuperación de conocimiento personal.

La IA es una pieza: transforma y redacta. La arquitectura, la validación y las decisiones de diseño son lo que lo hacen confiable.

Si mañana no hubiera IA, la lógica seguiría siendo clara: capturar, estructurar, guardar, indexar, recuperar. Solo cambiaría quién hace las transformaciones.
