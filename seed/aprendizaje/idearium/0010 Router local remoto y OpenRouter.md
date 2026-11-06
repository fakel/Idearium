---
title: "0010 — Router local/remoto y OpenRouter"
aliases:
  - "0010 Router local remoto y OpenRouter"
  - "Proveedores y routing de LLM"
tags:
  - idearium
  - curso
  - llm
  - openrouter
  - router
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0010 — Router local/remoto y OpenRouter

## El problema del proveedor

Un sistema de IA necesita tres capacidades distintas:

1. **chat** para digerir y redactar,
2. **embeddings** para buscar por significado,
3. **STT** para convertir voz en texto.

No siempre vienen del mismo lugar:

- Ollama ofrece chat y embeddings locales, pero no STT.
- Faster-Whisper ofrece STT local, pero no chat.
- OpenRouter ofrece las tres, con una sola clave.
- DeepSeek ofrece chat, pero no embeddings ni STT.

El router existe para que el resto del sistema no sepa de dónde viene cada capacidad.

## La interfaz

```ts
interface ChatProvider {
  readonly name: 'ollama' | 'openrouter';
  readonly model: string;
  chatText(messages: ChatMessage[]): Promise<string>;
  chatJson(messages: ChatMessage[]): Promise<string>;
}
```

El resto del código pide `completeJson` o `completeText` al router. No construye URLs ni headers.

## Los cuatro modos

### `local_only`

Solo Ollama. Si no está, error. Útil para privacidad total o pruebas sin Internet.

### `local_first` (default histórico)

Intenta local. Escala a remoto si:

- el JSON no valida tras un reintento,
- se usa `--remote`,
- la captura supera `LLM_MAX_LOCAL_CHARS`.

Ventaja: coste cero en el caso normal. Desventaja: la primera llamada puede ser lenta y el modelo local puede ser peor.

### `remote_first`

Intenta remoto; si falla, cae a local. Útil cuando la calidad importa más que el coste, pero se quiere un respaldo.

### `remote_only`

Solo remoto. Es el modo recomendado para Docker y servidores sin GPU. Si falta la clave, el arranque falla.

## Escalado por validación

El caso más interesante es `local_first` con JSON inválido:

```text
1. local responde JSON inválido
2. se reintenta local con el error de Zod
3. si sigue inválido → remoto
4. remoto responde
5. se valida otra vez
```

¿Por qué no escalar directamente? Porque el reintento local es barato y resuelve muchos errores. ¿Por qué no quedarse solo en local? Porque un modelo pequeño puede no respetar el esquema y el usuario necesita la nota.

## Abstracción de proveedores

`OpenAICompatibleProvider` implementa el contrato de chat para cualquier API que hable `/chat/completions`:

- Ollama no usa exactamente ese formato; tiene su propio `/api/chat`.
- OpenRouter usa `/chat/completions` con `Authorization: Bearer`.
- Se puede añadir otro proveedor compatible sin tocar el router.

El proveedor se encarga de:

- construir la URL,
- añadir headers,
- serializar mensajes,
- pedir `response_format: json_object` cuando aplica,
- mapear errores HTTP a `ProviderError`,
- respetar timeout.

## OpenRouter

### Por qué OpenRouter

- Una clave para chat, embeddings y STT.
- Catálogo enorme de modelos.
- Permite comparar precios y calidades sin cambiar código.
- Tiene endpoints compatibles con OpenAI.

### Coste

OpenRouter cobra por tokens. Para este proyecto:

- digest de una nota: fracciones de centavo,
- embedding de una nota: aún menos,
- STT: por minuto de audio.

No es gratis, pero es barato comparado con el tiempo que ahorra.

### Modelos gratuitos

Los modelos `:free` tienen límites:

- peticiones por minuto,
- peticiones por día,
- capacidad compartida,
- disponibilidad variable.

Pueden servir para experimentar, pero no son una base confiable para un sistema que indexa y responde a diario. Además, los endpoints gratuitos pueden tener políticas de registro/entrenamiento distintas.

### `reasoning: none`

DeepSeek V4 razona por defecto. Para tareas de extracción, el razonamiento:

- añade latencia,
- consume tokens,
- no mejora el JSON.

Por eso se envía:

```json
{ "reasoning": { "effort": "none" } }
```

El resultado fue `reasoning_tokens: 0` y un coste mínimo.

## Embeddings remotos

OpenRouter expone `/api/v1/embeddings`. El cliente:

- envía `{ model, input: [...] }`,
- valida que devuelva un vector por texto,
- valida la dimensión,
- normaliza el resultado.

`baai/bge-m3` produce 1024 dimensiones. Si se cambia a un modelo de 4096, hay que:

1. cambiar `EMBEDDING_DIM`,
2. borrar la tabla,
3. reindexar.

No hay migración mágica: los vectores de distintas dimensiones no son comparables.

## STT remoto

El STT no usa `/chat/completions`, sino `/audio/transcriptions`. Por eso `WHISPER_API_URL` debe apuntar a la raíz del proveedor:

```env
WHISPER_API_URL=https://openrouter.ai/api
```

El cliente añade `/v1/audio/transcriptions`.

## Fallback y errores

El router distingue:

- **error de validación** (JSON no cumple): puede reintentar/escalar;
- **error de proveedor** (401, 429, timeout): puede probar otro proveedor;
- **error de configuración** (falta clave): falla al arrancar.

No se reintenta un 401: la clave no va a aparecer por insistir. Sí se puede reintentar un 429 con backoff.

## Privacidad

Cada capacidad tiene una frontera distinta:

- chat remoto: el texto de la captura/consulta sale;
- embeddings remotos: los textos de las notas salen;
- STT remoto: el audio sale.

El README debe decirlo explícitamente. El usuario decide qué combinación usa.

## Ejercicio

1. ¿Por qué `remote_only` falla al arrancar sin clave, pero `local_first` no?
2. ¿Qué diferencia hay entre un error de validación y un error de proveedor?
3. Si cambias de `bge-m3` a un modelo de 4096 dimensiones, ¿qué pasos sigues?
4. ¿Por qué el STT no usa el mismo endpoint que el chat?

El router es la pieza que convierte un sistema frágil de un solo proveedor en un sistema adaptable.
