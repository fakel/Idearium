---
title: "0012 — Chunking y embeddings"
aliases:
  - "0012 Chunking y embeddings"
  - "Fragmentación y vectores"
tags:
  - idearium
  - curso
  - embeddings
  - chunking
  - busqueda-semantica
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0012 — Chunking y embeddings

## El problema de buscar por significado

Buscar texto con `grep` encuentra palabras. Pero si preguntas “¿cómo era el plan para vender la casa?”, la nota puede decir “estrategia de venta del inmueble” sin usar la palabra “plan”.

La búsqueda semántica resuelve eso convirtiendo texto en vectores:

```text
"plan para vender la casa"     → [0.12, -0.03, ...]
"estrategia de venta inmueble" → [0.11, -0.02, ...]
```

Los vectores están cerca aunque las palabras sean distintas.

## Qué es un embedding

Un embedding es una lista de números que representa el significado de un texto en un espacio de alta dimensión.

- Textos con significado parecido → vectores cercanos.
- Textos no relacionados → vectores lejanos.

El modelo `bge-m3` produce 1024 números por texto. No son interpretables uno por uno; lo que importa es la distancia entre vectores.

## Por qué no embeber la nota completa

Una nota puede tener 10 000 caracteres. Si se embebe entera:

- el vector mezcla muchos temas,
- la búsqueda devuelve la nota pero no dice qué parte responde,
- el contexto que se envía al LLM es demasiado grande.

Por eso se divide en **chunks**.

## Chunking por secciones

El algoritmo:

1. Divide el Markdown por encabezados (`#`, `##`, `###`).
2. Cada sección es una unidad.
3. Si una sección supera `maxChars` (3600), se parte en trozos.
4. Los trozos se solapan `overlapChars` (500).

### Por qué por encabezados

Los encabezados ya expresan unidades de sentido escritas por el usuario. Respetarlos es mejor que cortar cada 1000 caracteres.

### Por qué solape

Si una idea cruza el límite entre dos trozos, el solape asegura que al menos uno la contenga completa.

```text
trozo 1: ...idea A ... idea B
trozo 2:        idea B ... idea C
```

Sin solape, una pregunta sobre B podría no encontrar ningún trozo con B completo.

### Por qué 3600 caracteres

Es un equilibrio:

- suficientemente grande para contener una idea,
- suficientemente pequeño para que el embedding sea específico,
- suficientemente pequeño para caber en el contexto del LLM.

No es una regla universal; se puede ajustar.

## Metadatos por chunk

Cada chunk guarda:

```text
id            hash-nota + índice
note_path     ruta relativa
chunk_index   posición
vector        1024 floats
text          contenido
title         título de la nota
tags          JSON string
category      enum
updated_at    fecha
```

Los metadatos permiten filtrar y mostrar la fuente.

## Embeddings por lotes

En vez de llamar al modelo una vez por chunk:

```ts
for (const batch of batches(chunks, 16)) {
  const vectors = await embedder.embed(batch.map(c => c.text));
  await vector.upsertNote(...);
}
```

Ventajas:

- menos llamadas,
- menos latencia total,
- menos probabilidad de rate limit.

El lote no debe ser tan grande que exceda el contexto del modelo de embeddings.

## Qué significa “distancia”

LanceDB devuelve `_distance`. Para vectores normalizados, la distancia L2 se relaciona con la similitud coseno:

```text
distancia pequeña  → vectores parecidos
distancia grande   → vectores distintos
```

No hay un umbral universal. Depende del modelo y del corpus. En Idearium se usa la distancia para ordenar y, en RAG, para cortar resultados poco relevantes.

## Indexación incremental

Cada nota tiene un hash SHA-256 de su contenido. El indexador guarda:

```json
{
  "Notas/0001-plan.md": "sha256..."
}
```

Si el hash no cambió, no se reindexa. Si cambió:

1. se borran los chunks viejos por `note_path`,
2. se generan los nuevos,
3. se actualiza el estado.

Esto evita pagar embeddings por notas que no cambiaron.

## Por qué borrar e insertar

LanceDB no tiene un `update` transaccional sencillo para este caso. Borrar todos los chunks de una nota e insertar los nuevos es:

- simple,
- consistente,
- idempotente.

El costo es aceptable porque la reindexación es incremental.

## Dimensiones

La dimensión debe coincidir entre:

- el modelo de embeddings,
- el esquema de la tabla,
- la consulta.

Si el modelo devuelve 1024 y la tabla espera 1024, todo funciona. Si cambias a 4096:

1. cambia `EMBEDDING_DIM`,
2. borra la tabla,
3. reindexa.

No se puede mezclar dimensiones en la misma tabla.

## Errores reales

### Chunks vacíos

Se descartan antes de embeber. Un vector de texto vacío no aporta.

### Nota sin encabezados

Se trata como una sola sección y se parte por tamaño.

### PDF con texto mal extraído

El chunking no arregla un PDF escaneado; para eso hace falta OCR.

### El índice quedó viejo

Si el bot estuvo apagado, `/reindex` reconstruye desde el vault.

## Ejercicio

1. Toma una nota larga y divídela mentalmente en secciones.
2. ¿Dónde pondrías los cortes?
3. ¿Qué pasa si el solape es 0?
4. ¿Por qué el hash evita reindexar?

El chunking es la traducción de “documento” a “unidad de significado”. Sin él, la búsqueda semántica no puede ser precisa.
