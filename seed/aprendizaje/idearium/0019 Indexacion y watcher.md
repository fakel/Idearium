---
title: "0019 — Indexación y watcher"
aliases:
  - "0019 Indexacion y watcher"
  - "Sincronización del índice"
tags:
  - idearium
  - curso
  - indexacion
  - watcher
  - chokidar
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0019 — Indexación y watcher

## El problema

El vault cambia:

- el bot crea notas,
- el usuario edita en Obsidian,
- se borran archivos,
- se renombran.

El índice vectorial debe reflejar esos cambios. Si no, RAG busca en notas viejas o inexistentes.

## Dos caminos

1. **Indexación explícita**: al guardar una nota, se indexa.
2. **Watcher**: observa el vault y reindexa cambios externos.

Ambos usan el mismo `Indexer`.

## Hash de contenido

Antes de indexar:

```ts
const hash = sha256(markdown);
if (state[relativePath] === hash) return { skipped: true };
```

Ventajas:

- no se paga embedding dos veces,
- no se reescribe la tabla,
- el arranque es rápido.

El hash es del contenido completo, no del nombre. Renombrar cambia la ruta, pero no necesariamente el contenido; el indexador debe manejar ambos casos.

## Estado

`data/index-state.json`:

```json
{
  "Proyectos/Casas/0001-plan.md": "abc123...",
  "Notas/0002-idea.md": "def456..."
}
```

Se escribe de forma atómica (tmp + rename). Si se corrompe, se puede borrar y reindexar.

¿Por qué no guardar el hash en la nota?

- ensuciaría el frontmatter,
- el usuario podría editarlo,
- el índice es un artefacto, no parte del conocimiento.

## Indexación de un archivo

```text
leer archivo
  → hash
  → si no cambió: skip
  → gray-matter
  → chunkMarkdown
  → embeddings por lotes
  → upsert en LanceDB
  → guardar estado
```

Si falla el embedding:

- no se actualiza el estado,
- se puede reintentar,
- la nota sigue en el vault.

## Borrado

Si se elimina un `.md`:

1. se borran sus chunks por `note_path`,
2. se elimina la entrada del estado.

Si el bot estaba apagado, los chunks quedan huérfanos hasta `/reindex`.

## Reindexación completa

`/reindex`:

1. recorre el vault,
2. indexa cada `.md`,
3. compara el estado,
4. elimina entradas de archivos que ya no existen.

Es la operación de recuperación. Puede tardar y costar embeddings, pero es idempotente.

## El watcher

`chokidar` observa `OBSIDIAN_VAULT_PATH/**/*.md`.

Configuración:

```ts
{
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  ignored: ['**/.obsidian/**', '**/.trash/**']
}
```

### `ignoreInitial`

No indexa todo al arrancar; para eso está `/reindex` o la indexación al guardar. Evita una tormenta de embeddings al iniciar.

### `awaitWriteFinish`

Espera a que el archivo deje de cambiar. Sin esto, se indexaría un archivo a medio escribir (Obsidian guarda de forma no atómica en algunos casos).

### Ignorados

`.obsidian` contiene configuración, no conocimiento. `.trash` contiene notas borradas.

## Debounce

Si el usuario guarda varias veces en pocos segundos, se agrupa:

```ts
debounce(path, 500ms);
```

Sin debounce, se indexaría 5 veces la misma nota.

## Errores y concurrencia

- El watcher puede disparar mientras el bot indexa. El `Indexer` debe tolerar archivos que ya no existen.
- Un archivo puede cambiar entre la lectura y el hash. Se lee una vez y se usa ese contenido.
- Si el embedding falla, se registra y se reintenta en la próxima modificación.

## Por qué no indexar todo en cada arranque

- coste,
- latencia,
- rate limits,
- archivos que no cambiaron.

El hash es la optimización clave.

## Qué no se indexa

- imágenes,
- PDFs binarios (se extrae el texto al capturarlos),
- adjuntos de audio,
- configuración de Obsidian.

Solo Markdown.

## Ejercicio

1. Edita una nota en Obsidian y observa el log.
2. Borra una nota y ejecuta `/reindex`.
3. ¿Qué pasa si borras `index-state.json`?
4. ¿Por qué se ignora `.trash`?

El indexado es lo que mantiene la promesa de “pregunta y encuentra”. Sin él, RAG trabaja sobre una foto vieja.
