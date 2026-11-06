---
title: "0004 — Fundamentos técnicos y configuración"
aliases:
  - "0004 Fundamentos tecnicos y configuracion"
  - "TypeScript, Zod y configuración"
tags:
  - idearium
  - curso
  - typescript
  - configuracion
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0004 — Fundamentos técnicos y configuración

## Por qué TypeScript

El sistema tiene muchos bordes: Telegram, HTTP, archivos, JSON de LLM, vectores. TypeScript no elimina los errores de datos, pero obliga a declarar la forma de las interfaces entre módulos.

La regla fue:

> Tipar los bordes, no decorar el interior.

Los tipos importantes son los que cruzan una frontera:

- `NoteDigest`: lo que devuelve el LLM.
- `NoteFrontmatter`: lo que se escribe en el `.md`.
- `SearchHit`: lo que devuelve LanceDB.
- `RagAnswer`: lo que consume el bot.
- `Env`: lo que viene de `.env`.

## ESM y NodeNext

El proyecto usa `"type": "module"` y `module: NodeNext`. Consecuencias:

- los imports llevan extensión `.js` aunque el archivo sea `.ts`;
- `__dirname` no existe; se usa `import.meta.url` o rutas configuradas;
- algunas dependencias CommonJS requieren `createRequire` o imports por defecto.

Esto no es un capricho: Node moderno y las dependencias actuales asumen ESM. El coste es que los ejemplos copiados de blogs viejos no siempre funcionan.

## Estructura del proyecto

```text
src/
  config/env.ts              validación de entorno
  lib/                       utilidades puras (texto, reintentos, notas)
  schemas/                   contratos Zod
  services/
    llm.service.ts           interfaces de proveedor
    llm-router.service.ts    política local/remoto
    providers/               Ollama, OpenAI-compatible/OpenRouter
    embedding.service.ts     Ollama y remoto
    vector.service.ts        LanceDB
    indexer.service.ts       chunking + embeddings + estado
    rag.service.ts           retrieval + prompt + fuentes
    obsidian.service.ts      Markdown atómico
    storage.service.ts       descargas de Telegram
    stt.service.ts           transcripción
    document.service.ts      extracción PDF/DOCX/DOC
    watcher.service.ts       chokidar
    memorize.service.ts      palacios
    quiz.service.ts          estado del quiz
    cluster.service.ts       síntesis
    note-selector.service.ts selección por número/tema
  controllers/ingest.controller.ts
  bot/index.ts               grammY
  bootstrap.ts               composición de dependencias
  index.ts                   arranque
  cli.ts                     interfaz de línea de comandos
```

La dirección de dependencias importa:

```text
bot/cli → controllers → services → interfaces
```

Los servicios no conocen Telegram. Los controladores no conocen LanceDB. El bootstrap es el único que sabe cómo se conecta todo.

## Configuración con Zod

`src/config/env.ts` hace tres cosas:

1. Lee `process.env`.
2. Valida y transforma con Zod.
3. Falla rápido con un mensaje claro.

Ejemplo conceptual:

```ts
const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  OBSIDIAN_VAULT_PATH: z.string().default('~/Documents/IdeariumVault'),
  RAG_TOP_K: z.coerce.number().int().min(1).max(50).default(8),
  LLM_PREFERENCE: z.enum(['local_only', 'local_first', 'remote_first', 'remote_only']).default('local_first'),
});
```

### Por qué validar el entorno

Sin validación, un error de configuración aparece tarde y disfrazado:

- `undefined` en una URL,
- un número como string,
- una ruta relativa cuando se esperaba absoluta,
- una preferencia remota sin clave.

El fail-fast convierte ese caos en un mensaje:

```text
OPENROUTER_API_KEY es obligatoria cuando LLM_PREFERENCE=remote_only
```

### Defaults que enseñan

Los defaults no son solo comodidad; documentan la intención:

- `RAG_TOP_K=8`: candidatos, no fuentes finales.
- `LLM_MAX_LOCAL_CHARS=12000`: a partir de aquí se escala.
- `MEMORY_MAX_NOTES=5`, `MEMORY_MAX_CHARS=24000`: límites de contexto.
- `OPENROUTER_REASONING_EFFORT=none`: las tareas son extracción, no razonamiento profundo.

### Degradación controlada

Si `LLM_PREFERENCE=remote_only` pero no hay clave, el sistema **no arranca**. Si la preferencia es `local_first` y no hay remoto, sigue funcionando en local con un warning.

La diferencia es intencional:

- una configuración imposible debe fallar;
- una capacidad opcional puede degradarse.

## Rutas y `~`

Node no expande `~`. El código normaliza rutas con `os.homedir()` y `path.resolve`. Esto evita un bug clásico: funciona en la terminal del usuario, falla en systemd porque el servicio no tiene el mismo `HOME`.

## Logging

Se usa `pino`. La regla:

- `info` para eventos de negocio (nota creada, índice actualizado, proveedor usado);
- `warn` para degradaciones;
- `error` para fallos que el usuario debe saber;
- `debug` para detalles de diagnóstico, apagado por defecto.

Nunca se loguean claves ni tokens. El logger no debe convertirse en una fuga de secretos.

## Errores

Los errores se dividen en dos familias:

1. **Errores esperables de usuario**: falta la ruta, el archivo no existe, el PDF está escaneado. Se muestran con un mensaje accionable.
2. **Errores de sistema**: proveedor caído, timeout, JSON inválido. Se registran y se traducen a un mensaje comprensible.

Un buen error responde:

- ¿qué falló?
- ¿dónde?
- ¿qué puede hacer el usuario?

“Error 500” no es un mensaje; es una excusa.

## Dependencias y justificación

| Dependencia | Para qué | Por qué no otra |
|---|---|---|
| `grammy` | Bot de Telegram | API moderna, middleware simple, buen tipado |
| `zod` | Validación | Un solo esquema valida y documenta |
| `@lancedb/lancedb` | Vector DB | Embebida, sin servidor |
| `apache-arrow` | Esquema de tabla | LanceDB usa Arrow; se declara explícito |
| `gray-matter` | Frontmatter | Estándar de facto en Markdown |
| `chokidar` | Watcher | Maneja eventos duplicados y `awaitWriteFinish` |
| `pino` | Logs | Rápido, estructurado, sin configuración pesada |
| `unpdf` | PDF | Extracción de texto sin binarios externos |
| `mammoth` | DOCX | Convierte a texto preservando estructura básica |
| `word-extractor` | DOC | Soporte para el formato viejo de Word |

## Variables importantes

| Variable | Concepto |
|---|---|
| `OBSIDIAN_VAULT_PATH` | Raíz del vault; todo lo demás cuelga de aquí |
| `NOTE_SUBDIR` | Carpeta por defecto de capturas |
| `LANCEDB_PATH` | Índice reconstruible |
| `EMBEDDING_PROVIDER` | `ollama` u `openrouter` |
| `EMBEDDING_DIM` | Debe coincidir con el modelo; cambiarlo exige reindexar |
| `LLM_PREFERENCE` | Política del router |
| `RAG_TOP_K` | Candidatos de retrieval |
| `MEMORY_MAX_NOTES/CHARS` | Límites de palacio/quiz |

## Ejercicio

1. Añade una variable nueva `RAG_MIN_SCORE` al esquema y comprueba que el arranque falla si su valor no es numérico.
2. Rompe a propósito `OBSIDIAN_VAULT_PATH` y observa el mensaje.
3. Explica por qué `RAG_TOP_K=8` no significa “8 fuentes”.

Si puedes hacer esos tres puntos, entendiste la diferencia entre configuración, contrato y presentación.
