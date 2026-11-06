---
title: "0006 — Voz y reconocimiento de habla"
aliases:
  - "0006 Voz y reconocimiento de habla"
  - "Audio y STT en Idearium"
tags:
  - idearium
  - curso
  - audio
  - stt
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0006 — Voz y reconocimiento de habla

## Por qué voz

Escribir una idea mientras caminas, cocinas o conduces es incómodo. Hablar es el canal natural para capturar pensamiento en bruto.

El sistema no intenta transcribir una reunión de dos horas ni hacer diarización. Su caso es:

> una nota corta, en español, con ruido ambiental moderado, que debe convertirse en texto en segundos.

## El pipeline de audio

```text
Telegram voice
  → file_id
  → getFile
  → descarga HTTP en streaming
  → data/audio/YYYY-MM-DD/<uuid>.ogg
  → POST /v1/audio/transcriptions
  → texto
  → digest LLM
  → clasificación
  → nota Markdown
```

El audio original se conserva como adjunto. Si la transcripción fue mala, se puede volver a procesar.

## Descarga en streaming

Telegram devuelve un `file_id`, no el archivo. Hay que:

1. llamar a `getFile`,
2. obtener la ruta temporal,
3. descargar desde `https://api.telegram.org/file/bot<TOKEN>/<path>`.

El código usa `Readable.fromWeb` y `pipeline` para escribir el cuerpo de la respuesta directamente al disco. Nunca carga el `.ogg` completo en memoria.

### Por qué importa

Un audio de 10 minutos puede pesar decenas de MB. Cargarlo en memoria funciona en una laptop, pero falla en un contenedor con poca RAM o con varios audios simultáneos. El streaming mantiene el uso de memoria constante.

Además, el nombre se genera con UUID y fecha:

```text
data/audio/2026-11-06/076a68c5-6503-497f-84f5-9578317dc4b9.ogg
```

Así no hay colisiones y se puede auditar el origen.

## Formatos

Telegram entrega las notas de voz como OGG/Opus. Faster-Whisper y la mayoría de APIs aceptan OGG, MP3, WAV, M4A y FLAC. La app no convierte por defecto: si el proveedor acepta el formato, se envía tal cual.

Convertir siempre con `ffmpeg` añadiría una dependencia y una copia extra. Solo se justifica si el proveedor no acepta Opus.

## STT local con Faster-Whisper

El servidor `stt/server.py` expone una API compatible con OpenAI:

```text
GET  /health
POST /v1/audio/transcriptions
```

Parámetros relevantes:

- `device=cuda` o `cpu`,
- `compute_type=int8_float16` en GPU moderna,
- `vad_filter=True` para recortar silencios,
- `beam_size=5`,
- `language=es` cuando se conoce.

### Por qué Faster-Whisper y no Whisper original

Faster-Whisper usa CTranslate2, que:

- cuantiza el modelo,
- reduce memoria,
- acelera la inferencia en CPU y GPU,
- mantiene una API sencilla.

El modelo original de OpenAI es más pesado y lento para el mismo resultado práctico.

### Elección de modelo

| Modelo | VRAM aproximada | Uso |
|---|---:|---|
| `tiny` | <1 GB | pruebas rápidas, calidad baja |
| `base` | ~1 GB | GPU muy pequeña |
| `small` | ~1–2 GB | equilibrio recomendado |
| `medium` | ~4–5 GB | más calidad, poco margen |
| `large-v3` | >8 GB | no cabe en GPU de 4 GB |

La regla: **el modelo más grande que quepa con margen**, no el más grande a secas.

### El caso Pascal / GTX 1050 Ti

En GPUs Pascal, `int8_float16` no siempre tiene kernels eficientes. CTranslate2 puede fallar o hacer fallback a CPU. Alternativas:

- `float16` si hay soporte,
- `float32` en CPU,
- `int8` en CPU.

El fallback no es un error fatal: es una degradación de rendimiento. Hay que mirar `/health` para saber qué dispositivo y compute type quedaron activos.

### VRAM compartida

Whisper, el LLM y los embeddings compiten por la misma GPU. En 4 GB no caben:

- un 7B cuantizado (~4,7 GB),
- `bge-m3` (~1,2 GB),
- Whisper `small` (~1 GB).

Por eso el diseño permite **mover cada pieza a un proveedor distinto**: STT local, chat remoto, embeddings remotos, o al revés.

## STT remoto

La misma interfaz sirve para un servidor local o uno remoto. Basta cambiar:

```env
WHISPER_API_URL=https://openrouter.ai/api
WHISPER_MODEL=openai/whisper-large-v3-turbo
```

El cliente envía `multipart/form-data` con:

- `file`,
- `model`,
- `language` opcional.

Y añade `Authorization: Bearer` si hay `WHISPER_API_KEY` o si la URL es de OpenRouter.

### Por qué una API compatible con OpenAI

Porque permite cambiar de proveedor sin cambiar el código. Faster-Whisper, OpenRouter, Groq y OpenAI comparten el mismo contrato básico.

## Coste y latencia

El STT remoto se cobra por minuto o por token de audio. Un audio de 3 minutos puede costar menos de un centavo con `whisper-large-v3-turbo`.

La latencia depende de:

- duración del audio,
- carga del proveedor,
- tamaño del modelo,
- si hay VAD.

Para notas cortas, la latencia es aceptable. Para audios largos, conviene dividir o usar un proveedor con procesamiento asíncrono.

## Errores y recuperación

### El audio no tiene voz

El VAD puede devolver texto vacío. El sistema debe responder “no se detectó voz”, no crear una nota vacía.

### Timeout

El cliente tiene timeout configurable. Si se agota, se reintenta una vez (el reintento no aplica a errores 4xx).

### Modelo no descargado

La primera llamada a Faster-Whisper descarga el modelo desde HuggingFace. Parece un cuelgue, pero es una descarga. En producción conviene predescargarlo en la imagen o en el volumen.

### Formato no soportado

Si el proveedor rechaza OGG, hay que convertir a WAV/MP3 con `ffmpeg`. Es una decisión de compatibilidad, no de calidad.

## Transcripción y privacidad

- **Local:** el audio no sale de la máquina.
- **Remoto:** el audio se envía al proveedor; hay que aceptar su política.

Idearium no envía el audio al LLM. Primero transcribe, luego el texto sigue el flujo normal. Esto reduce el coste y evita que el modelo de chat “escuche” innecesariamente.

## Ejercicio

1. ¿Por qué se descarga el audio a disco antes de transcribir?
2. ¿Qué diferencia hay entre `int8_float16` y `float32`?
3. Si la GPU tiene 4 GB, ¿qué combinación de modelos elegirías?
4. ¿Qué ventaja tiene una API compatible con OpenAI para el STT?

Si puedes responder, entendiste el desacoplamiento entre captura, transcripción y comprensión.
