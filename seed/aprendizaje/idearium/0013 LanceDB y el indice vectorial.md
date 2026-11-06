---
title: "0013 — LanceDB y el índice vectorial"
aliases:
  - "0013 LanceDB y el indice vectorial"
  - "Base de datos vectorial"
tags:
  - idearium
  - curso
  - lancedb
  - vectores
  - base-de-datos
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0013 — LanceDB y el índice vectorial

## Por qué una base vectorial

Una base de datos normal busca por igualdad o por texto. Para “encuentra notas parecidas a esta pregunta” hace falta comparar vectores.

LanceDB:

- es embebida (no necesita servidor),
- guarda en disco,
- usa Arrow para el esquema,
- permite búsqueda vectorial,
- funciona bien en un proyecto pequeño.

No se necesita PostgreSQL con pgvector ni un servicio externo. La base vive en `data/lancedb`.

## El esquema

```ts
const schema = new Schema([
  new Field('id', new Utf8()),
  new Field('note_path', new Utf8()),
  new Field('chunk_index', new Int32()),
  new Field('vector', new FixedSizeList(dim, new Field('item', new Float32()))),
  new Field('text', new Utf8()),
  new Field('title', new Utf8()),
  new Field('tags', new Utf8()),      // JSON string
  new Field('category', new Utf8()),
  new Field('updated_at', new Utf8()),
]);
```

### Por qué `tags` es string

Arrow no tiene un tipo “array de strings” simple para este caso. Se guarda JSON:

```json
["inversión","finanzas"]
```

Se parsea al leer. Es una decisión pragmática: el índice no necesita filtrar por tag en SQL, solo mostrar metadatos.

### Por qué `vector` es `FixedSizeList`

LanceDB necesita una dimensión fija para indexar. `FixedSizeList(1024, Float32)` dice que cada vector tiene exactamente 1024 números.

## Abrir o crear

```ts
async open() {
  this.db = await lancedb.connect(this.dbPath);
  const names = await this.db.tableNames();
  if (names.includes('notes')) {
    this.table = await this.db.openTable('notes');
  } else {
    this.table = await this.db.createEmptyTable('notes', schema);
  }
}
```

El orden importa:

1. conectar,
2. listar tablas,
3. abrir si existe,
4. crear si no.

Si se crea sin comprobar, se pierde el índice existente. Si se abre sin crear, la primera ejecución falla.

## Búsqueda

```ts
const rows = await this.table
  .vectorSearch(vector)
  .limit(k)
  .toArray();
```

Cada fila trae `_distance`. Se mapea a `SearchHit`:

```ts
{
  id, notePath, chunkIndex, title, tags,
  category, text, updatedAt,
  distance: row._distance
}
```

### Por qué no se filtra en la consulta

Se pide un `k` amplio y se filtra en la app. Filtrar por metadatos en LanceDB es posible, pero el filtro principal aquí es la distancia. Mantenerlo simple facilita cambiar de motor.

## Upsert

No hay un `upsert` mágico. El patrón es:

```ts
await this.table.delete(`note_path = '${escapeSql(notePath)}'`);
await this.table.add(rows);
```

### Por qué borrar todo el archivo

Una nota puede tener 3 chunks antes y 5 después. Borrar por `note_path` elimina los viejos y evita duplicados.

### Escapado SQL

La ruta puede contener comillas simples. `escapeSql` duplica `'`:

```ts
path.replace(/'/g, "''")
```

Sin esto, una nota llamada `O'Brien.md` rompería la consulta.

## Contar y limpiar

```ts
count(): Promise<number>
clear(): Promise<void>  // dropTable + recreate
```

`clear` se usa en pruebas y en reindexación completa. No se debe usar en producción sin querer.

## El estado de indexación

El estado no vive en LanceDB, sino en `data/index-state.json`:

```json
{
  "relative/path.md": "sha256..."
}
```

Se escribe de forma atómica. Si se pierde:

- se reindexa todo,
- no se pierden notas,
- solo se gasta tiempo/dinero.

## Errores reales

### Dimensión incorrecta

Si la tabla se creó con 1024 y el modelo devuelve 768:

```text
Error: vector dimension mismatch
```

Solución: borrar tabla, ajustar `EMBEDDING_DIM`, reindexar.

### Tabla bloqueada

Dos procesos escribiendo a la vez pueden bloquear. En este proyecto hay un solo bot; el CLI debe usarse con el bot detenido o aceptar la contención.

### `createEmptyTable` y Arrow

LanceDB 0.41 no re-exporta todos los tipos de Arrow. Se importan de `apache-arrow`. Es un detalle de versión, no de diseño.

### Ruta con caracteres raros

El escapado de comillas resuelve el caso común. Para una solución más robusta se usarían parámetros, pero la API de delete de LanceDB recibe un string.

## Por qué no usar SQLite + vectores en JSON

Se podría guardar el vector como blob y calcular distancias en JS. Para 100 notas funcionaría; para 10 000 sería lento y habría que escribir el índice a mano. LanceDB ya resuelve eso.

## Ejercicio

1. ¿Qué pasa si se crea la tabla dos veces?
2. ¿Por qué se borra por `note_path` y no por `id`?
3. ¿Qué información se pierde si se borra `index-state.json`?
4. ¿Por qué `tags` se guarda como string?

LanceDB es el almacén; la lógica de qué indexar vive en el indexador. Separar ambas cosas permite cambiar el motor sin reescribir el flujo.
