---
title: "0011 — Markdown, Obsidian y escritura atómica"
aliases:
  - "0011 Markdown Obsidian y escritura atomica"
  - "Notas y formato Obsidian"
tags:
  - idearium
  - curso
  - obsidian
  - markdown
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0011 — Markdown, Obsidian y escritura atómica

## Por qué Markdown

Markdown es el formato de verdad de Idearium porque:

- es texto plano,
- es legible sin herramientas,
- Obsidian lo entiende de forma nativa,
- se puede versionar con Git,
- no depende de una base de datos propietaria.

La nota no es una fila en una tabla; es un archivo que el usuario puede abrir, editar y llevar consigo.

## Anatomía de una nota

```markdown
---
id: 5f0c...
title: "Plan financiero para venta de casa"
summary: "..."
category: proyecto
tags:
  - inversión
  - bienes raíces
  - finanzas
created: 2026-11-06T13:38:00.000Z
updated: 2026-11-06T13:38:00.000Z
source: telegram_voice
note_number: 1
aliases:
  - "0001"
audio_file: data/audio/2026-11-06/....ogg
---

# Plan financiero para venta de casa

## Resumen

...

## Ideas clave

- ...

## Acciones

- [ ] ...

## Transcripción

...
```

### Frontmatter

El frontmatter es el contrato con Obsidian y con el indexador:

- `title`: título legible.
- `summary`: resumen corto.
- `category`: enum.
- `tags`: lista YAML.
- `created` / `updated`: ISO.
- `source`: `telegram_text`, `telegram_voice`, `telegram_document`, `cli_text`, `cli_audio`.
- `note_number`: número global (capturas nuevas).
- `aliases`: permite `[[0001]]`.
- `audio_file` / `document_file`: adjunto original.

### Cuerpo

El cuerpo sigue una estructura estable:

1. `# Título`
2. `## Resumen`
3. `## Ideas clave`
4. `## Acciones`
5. `## Transcripción` (solo voz)

La estructura hace que la nota sea predecible para humanos y para el parser.

## Escritura atómica

El proceso es:

```text
1. escribir en <destino>.tmp-<uuid>
2. fsync (si aplica)
3. rename(<tmp>, <destino>)
```

`rename` dentro del mismo sistema de archivos es atómico: el archivo aparece completo o no aparece.

### Por qué no escribir directo

Si el proceso muere a mitad:

- un archivo directo queda truncado,
- Obsidian puede indexar basura,
- el watcher puede indexar una nota incompleta.

La escritura atómica evita ese estado intermedio.

### Colisiones

Si el destino existe, se prueba:

```text
nombre.md
nombre-2.md
nombre-3.md
...
```

El número se calcula antes de escribir. En un sistema multiusuario habría una carrera; aquí hay un solo bot, pero la comprobación se mantiene por seguridad.

## Nombres y numeración

### Capturas

Formato:

```text
NNNN-titulo-slug-DDMMAA.md
```

Ejemplo:

```text
0001-plan-financiero-para-venta-de-casa-e-inversion-061126.md
```

- `NNNN`: número global, 4+ dígitos.
- `titulo-slug`: minúsculas, sin acentos, guiones.
- `DDMMAA`: fecha local.

El número se calcula recorriendo el vault y buscando el patrón. No se usa un contador en base de datos porque el vault es la fuente de verdad.

### Por qué número + título + fecha

- el número permite referencias cortas (`[[0007]]`);
- el título permite leer el nombre;
- la fecha ordena y contextualiza.

### Notas de curso

Las notas de `Aprendizaje/Idearium` usan `00`, `01`, … No consumen números de captura y no tienen `note_number`. Son documentación, no conocimiento personal capturado.

## Enlaces

Obsidian usa wikilinks:

```markdown
[[Título de la nota]]
[[0007]]
[[0007|alias legible]]
[[Palacios/2026-11-06-palacio-tema|Palacio — Tema]]
```

El indexador y RAG leen el texto, no resuelven enlaces; los enlaces son para el usuario.

## Tags

Reglas:

- 3–8 por nota,
- minúsculas,
- sin `#`,
- sin duplicados,
- conceptos, no frases largas.

Los tags son una taxonomía libre; las categorías son un enum cerrado. Esa dualidad permite flexibilidad sin perder consistencia.

## Actualización

Cuando se actualiza una nota:

- `updated` cambia,
- `created` se conserva,
- el `id` se conserva,
- el índice se actualiza por hash.

Nunca se reescribe una nota con un `id` nuevo: eso rompería referencias.

## El watcher y los archivos externos

El usuario puede editar notas en Obsidian. El watcher detecta el cambio y reindexa. Por eso:

- no hay que “importar” notas manualmente;
- el índice se mantiene sincronizado;
- si el bot estaba apagado, `/reindex` reconstruye.

## Errores reales

### YAML inválido

Un `:` o un `#` sin comillas puede romper el frontmatter. Se valida al leer y se escribe con `gray-matter`.

### Tags duplicados

Se normalizan y deduplican antes de validar.

### Nombres con acentos

El slug elimina acentos para evitar problemas en sistemas de archivos y enlaces.

### Nota vacía

Si el digest no produce contenido, se rechaza antes de escribir.

## Ejercicio

1. Abre una nota y enumera cada campo del frontmatter.
2. ¿Qué pasaría si dos notas tuvieran el mismo `note_number`?
3. ¿Por qué el nombre incluye la fecha?
4. ¿Qué ventaja tiene `aliases` para un usuario de Obsidian?

El formato no es un detalle: es la interfaz entre el bot, el usuario y el índice.
