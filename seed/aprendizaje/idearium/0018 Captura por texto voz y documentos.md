---
title: "0018 — Captura por texto, voz y documentos"
aliases:
  - "0018 Captura por texto voz y documentos"
  - "Canales de entrada"
tags:
  - idearium
  - curso
  - captura
  - telegram
  - documentos
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0018 — Captura por texto, voz y documentos

## Principio: cero fricción

La mejor captura es la que no interrumpe. Por eso Idearium acepta:

- texto,
- voz,
- documentos.

El usuario no elige un formulario; envía lo que tiene.

## Texto

Flujo:

```text
mensaje de texto
  → prepareText
  → digest
  → clasificación
  → nota
```

Ventajas: rápido, preciso, barato. Desventaja: requiere escribir.

## Voz

Flujo:

```text
mensaje de voz
  → descargar .ogg
  → STT
  → prepareText (con transcripción)
  → clasificación
  → nota
```

Ventajas: manos libres, captura ideas al vuelo. Desventajas:

- el STT puede fallar con ruido,
- nombres propios,
- acentos,
- audio largo.

Por eso la transcripción se guarda en la nota: el usuario puede corregir después.

## Documentos

Formatos:

```text
.md .txt .pdf .doc .docx
```

Flujo:

```text
documento
  → descargar
  → extraer texto
  → prepareText
  → clasificación
  → nota con document_file
```

### Por qué no indexar el binario

El índice vectorial necesita texto. El PDF/DOCX se guarda como adjunto, pero el conocimiento se extrae a Markdown.

### Límites

- 20 MB por archivo (límite de Telegram para bots).
- `DOCUMENT_MAX_CHARS` (200 000) para no explotar el contexto.
- PDF escaneado no tiene texto: requiere OCR (F5, pendiente).

## Preparar vs guardar

En los tres canales, la captura primero se **prepara**:

- se descarga,
- se transcribe/extrae,
- se genera el digest.

Luego el usuario elige carpeta y categoría. Solo entonces se **guarda**.

Esto evita notas a medias y permite cancelar.

## Adjuntos

La nota guarda la ruta del original:

```yaml
audio_file: data/audio/2026-11-06/....ogg
document_file: data/documents/2026-11-06/....pdf
```

¿Por qué guardar el original?

- auditoría,
- posibilidad de reprocesar,
- el usuario puede escuchar/leer la fuente.

¿Por qué no borrarlo automáticamente?

- el usuario puede quererlo,
- el STT puede necesitar reintento.

El coste es disco; se puede limpiar manualmente.

## Clasificación

Los tres canales pasan por la misma clasificación interactiva:

- carpeta,
- categoría.

La diferencia es el `source`:

```text
telegram_text
telegram_voice
telegram_document
cli_text
cli_audio
```

`source` permite saber de dónde vino la nota y filtrar.

## Errores reales

### Audio sin voz

El STT devuelve vacío. Se rechaza con un mensaje claro.

### PDF escaneado

No hay texto extraíble. Se avisa y se sugiere OCR.

### Documento enorme

Se recorta a `DOCUMENT_MAX_CHARS` y se avisa en la nota.

### Extensión no soportada

Se rechaza antes de descargar.

### Archivo duplicado

Se guarda con UUID; no se sobrescribe.

## Por qué Telegram

- está en el móvil,
- permite voz,
- permite archivos,
- tiene bot API,
- no requiere app propia.

La fricción de instalar otra app habría matado el hábito.

## Ejercicio

1. Captura la misma idea por texto y por voz.
2. Compara la transcripción con lo que querías decir.
3. Envía un PDF y revisa `document_file`.
4. ¿Qué canal usas más y por qué?

La captura es la puerta de entrada. Si es incómoda, el resto del sistema no se usa.
