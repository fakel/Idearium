---
title: "0005 — Telegram y captura sin fricción"
aliases:
  - "0005 Telegram y captura sin friccion"
  - "Bot de Telegram de Idearium"
tags:
  - idearium
  - curso
  - telegram
  - captura
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0005 — Telegram y captura sin fricción

## Por qué Telegram

Telegram resuelve tres problemas de golpe:

1. **Está en el bolsillo.** No hay que abrir una app nueva ni iniciar sesión en un servidor.
2. **Tiene voz, texto y archivos** en el mismo canal.
3. **Tiene una API de bots** sencilla, con long polling y sin necesidad de dominio.

La alternativa era una PWA propia. Habría dado más control, pero también autenticación, notificaciones, subida de archivos y mantenimiento. Para un sistema personal, Telegram es infraestructura prestada que ya funciona.

## El costo de elegir Telegram

- El contenido pasa por los servidores de Telegram.
- El bot depende de la red.
- La interfaz es limitada: botones inline, texto y archivos, nada más.
- Los mensajes tienen límites de tamaño y formato.

Estas limitaciones se aceptan a cambio de velocidad de desarrollo y ubicuidad.

## Seguridad: allowlist

El bot no es público. En `TELEGRAM_ALLOWED_USER_IDS` se listan los IDs autorizados, separados por comas.

```ts
const allowed = new Set(env.allowedUserIds);
if (!allowed.has(ctx.from.id)) return;
```

Esto no es autenticación fuerte: si alguien conoce el token y el ID, puede actuar. Pero para un bot personal reduce el ruido y el acceso accidental.

El token se obtiene con BotFather y **nunca** se commitea. En producción vive en `.env` o en el gestor de secretos del servidor.

## Polling

En modo polling, el proceso pregunta a Telegram “¿hay mensajes nuevos?” y los procesa. No hay puerto abierto ni URL pública.

Ventajas:

- funciona detrás de NAT,
- no requiere HTTPS,
- es fácil de depurar en local.

Desventajas:

- el proceso debe estar siempre activo,
- hay latencia de polling,
- no hay verificación criptográfica de origen como en webhook.

El modo webhook queda como evolución: útil en un servidor público, innecesario para uso personal.

## El flujo de un mensaje

### Texto

```text
message.text
  → prepareText()
  → digest LLM (todavía no escribe)
  → botones de carpeta
  → botones de categoría
  → save()
  → .md + índice
```

### Voz

```text
message.voice
  → getFile + descarga streaming
  → STT
  → prepareAudio()
  → digest
  → clasificación
  → save()
```

### Documento

```text
message.document
  → validar extensión y tamaño
  → descarga
  → extracción de texto
  → prepareDocument()
  → digest
  → clasificación
  → save()
```

La diferencia importante es que **la clasificación siempre ocurre antes de escribir**. Si el usuario cancela, no queda una nota a medias; solo queda el audio o el documento original, que puede borrarse aparte.

## El estado pendiente

`PendingCaptureStore` guarda, por chat:

- la captura preparada (digest, transcripción, archivo),
- las carpetas sugeridas,
- la categoría sugerida,
- la carpeta elegida,
- la lista de categorías,
- la marca de tiempo.

Tiene un TTL de 30 minutos. Si el usuario no responde, se descarta.

### Por qué un TTL

Sin TTL, un mensaje viejo podría completarse con una clasificación elegida media hora después, fuera de contexto. El TTL mantiene la intención fresca y evita estados zombis.

### Por qué estado en memoria

Porque el bot es de un solo proceso y un solo usuario. Persistir el estado añadiría una base de datos para una ventana de 30 minutos. Si el bot se reinicia, se pierde la captura pendiente; es un coste aceptable.

## Clasificación con botones

El bot muestra:

1. **Carpeta** — las carpetas existentes del vault, con la carpeta por defecto primero.
2. **Categoría** — las categorías ya usadas, ordenadas por frecuencia, con la sugerida primero.

Los callbacks tienen prefijos:

- `pf:<índice>` para elegir carpeta,
- `pf:new` para escribir una carpeta nueva,
- `pc:<índice>` para elegir categoría,
- `pc:new` para escribir una categoría nueva.

### Por qué botones y no solo texto libre

Los botones reducen errores de tipeo y hacen visible la taxonomía existente. El texto libre sigue disponible para casos nuevos.

### Por qué preguntar dos veces

Se podría pedir “carpeta/categoría” en un solo paso, pero la mayoría de usuarios piensa primero “dónde va” y luego “qué es”. Dos decisiones pequeñas son más claras que una compuesta.

Además, la categoría puede depender de la carpeta: una nota en `Proyectos` suele ser `proyecto`, una en `Aprendizaje` suele ser `aprendizaje`.

## Normalización

El texto libre se normaliza antes de validar:

- se recorta,
- se pasa a minúsculas,
- se quitan acentos para comparar,
- se aceptan plurales,
- se rechazan rutas con `..` o fuera del vault.

Esto evita duplicados como `Ideas`, `ideas` e `idea`.

## Guardas contra mezclas

El bot tiene estados que no deben cruzarse:

- una captura pendiente no debe interpretarse como respuesta de quiz;
- un quiz activo no debe interpretarse como texto para una nota;
- `/cancelar` debe limpiar ambos.

La regla es: **cada mensaje debe tener un contexto claro**. Si hay ambigüedad, se pregunta o se rechaza, no se adivina.

## Formato de respuesta

Cuando la nota se guarda, el bot responde con:

- título,
- ruta relativa,
- tags,
- modelo usado,
- si se indexó o hubo error de índice.

Esto no es decoración: permite verificar que el sistema hizo lo que se esperaba sin abrir el vault.

## Errores comunes

### `409 Conflict`

Dos procesos están usando el mismo token. Solución: un solo bot corriendo, o `deleteWebhook` si quedó un webhook viejo.

### El bot no responde

- token inválido,
- allowlist vacía o ID equivocado,
- proceso caído,
- red bloqueada.

### El usuario no autorizado no recibe respuesta

Es intencional: no se revela que el bot existe.

### La nota se guarda en la carpeta equivocada

Se normalizó mal la ruta o el usuario eligió una carpeta nueva con un nombre parecido. La respuesta muestra la ruta para detectarlo.

## Ejercicio

1. Dibuja el estado de una captura desde que llega hasta que se guarda.
2. ¿Qué pasa si el usuario elige carpeta y luego cierra Telegram?
3. ¿Por qué el audio se guarda antes de la clasificación?
4. ¿Qué ventaja tiene el TTL de 30 minutos?

Si puedes responder sin mirar el código, entendiste el flujo de captura.
