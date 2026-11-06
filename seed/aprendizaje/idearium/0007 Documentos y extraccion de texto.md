---
title: "0007 — Documentos y extracción de texto"
aliases:
  - "0007 Documentos y extraccion de texto"
  - "Documentos en Idearium"
tags:
  - idearium
  - curso
  - documentos
  - pdf
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0007 — Documentos y extracción de texto

## Por qué documentos

La voz y el texto cubren ideas espontáneas, pero gran parte del conocimiento llega en archivos:

- un PDF de una clase,
- un contrato,
- un `.docx` con apuntes,
- un `.md` exportado,
- un `.txt` de una conversación.

Idearium acepta esos archivos y los reduce al mismo formato que una nota de voz: **texto plano**, que luego pasa por el digest y la clasificación.

## Formatos soportados

| Extensión | Extractor | Notas |
|---|---|---|
| `.md` | `gray-matter` | se descarta el frontmatter |
| `.txt` | lectura directa | se quita BOM |
| `.pdf` | `unpdf` | solo PDF con capa de texto |
| `.docx` | `mammoth` | extrae texto crudo |
| `.doc` | `word-extractor` | formato binario antiguo |

El límite de Telegram para archivos es 20 MB. La app también limita el texto extraído con `DOCUMENT_MAX_CHARS` (200.000 por defecto).

## El flujo

```text
message.document
  → validar extensión y tamaño
  → descargar a data/documents/YYYY-MM-DD/<uuid>.<ext>
  → DocumentService.extract()
  → texto normalizado
  → prepareDocument()
  → digest LLM
  → clasificación
  → nota .md con document_file
```

El original se conserva. La nota guarda `document_file` en el frontmatter para poder volver a la fuente.

## Por qué no se indexa el archivo original

El índice vectorial trabaja con texto. Un PDF binario no aporta embeddings útiles. Se extrae el texto y se indexa la nota resultante; el archivo queda como adjunto.

Esto también evita duplicar: si el PDF y la nota se indexaran, la misma información aparecería dos veces.

## PDF con capa de texto vs PDF escaneado

Un PDF puede contener:

1. **texto real** (generado por Word/LaTeX): `unpdf` lo extrae;
2. **imágenes de texto** (escaneo o foto): no hay texto que extraer.

En el segundo caso hace falta OCR. Idearium no lo implementó en v0.1.0:

- OCR local con Tesseract/PaddleOCR añade dependencias y tiempo;
- OCR remoto con un modelo de visión añade coste y privacidad;
- la calidad varía mucho con la calidad de la imagen.

El sistema detecta texto vacío y avisa: “PDF escaneado sin capa de texto; requiere OCR”.

## DOCX con mammoth

`mammoth` convierte `.docx` a HTML o texto crudo. Se usa `extractRawText` porque:

- preserva párrafos,
- no necesita renderizar estilos,
- es rápido y sin binarios externos.

Se pierden tablas complejas y formato, pero el objetivo es el contenido semántico, no la maquetación.

## DOC con word-extractor

El `.doc` binario es un formato viejo y propietario. `word-extractor` lee el cuerpo del documento sin necesidad de LibreOffice.

Es una dependencia específica para un formato en declive, pero aparece en archivos antiguos y contratos.

## Limpieza del texto

Antes de mandar al LLM:

- se normalizan saltos de línea,
- se colapsan espacios repetidos,
- se eliminan caracteres de control,
- se recorta a `DOCUMENT_MAX_CHARS`,
- se añade un aviso si se truncó.

La limpieza no es cosmética: los PDFs suelen traer guiones de corte, encabezados repetidos y saltos extra que confunden al modelo.

## Por qué `DOCUMENT_MAX_CHARS`

Los modelos tienen ventana de contexto, pero también coste y latencia. Un contrato de 500 páginas no cabe ni conviene. El límite:

- protege el presupuesto,
- evita timeouts,
- obliga a decidir qué parte del documento importa.

En el futuro, la solución correcta es dividir y resumir por secciones, no subir el límite sin control.

## Errores comunes

### “No se pudo extraer texto”

- PDF escaneado,
- PDF protegido,
- documento corrupto,
- formato no soportado.

### El texto sale con saltos raros

Es normal en PDFs con columnas o tablas. Se puede mejorar con extracción por bloques, pero añade complejidad.

### El archivo se descarga pero la nota no se crea

Puede fallar el digest o la clasificación. El original queda en `data/documents`; se puede reintentar.

## Privacidad

- El archivo original se guarda localmente.
- El texto extraído se envía al LLM (local o remoto).
- Si el documento es sensible, usar un LLM local o revisar la política del proveedor remoto.

## Ejercicio

1. Toma un PDF con texto y otro escaneado. Extrae el texto de ambos y compara.
2. ¿Por qué se descarta el frontmatter de un `.md`?
3. ¿Qué pasa si el documento supera `DOCUMENT_MAX_CHARS`?
4. Diseña cómo añadirías OCR sin romper el flujo actual.

La última pregunta es la más importante: un buen diseño deja espacio para la siguiente pieza.
