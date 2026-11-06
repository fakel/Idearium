---
title: "0001 — El problema y la visión"
aliases:
  - "0001 El problema y la vision"
  - "Problema y visión de Idearium"
tags:
  - idearium
  - curso
  - producto
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0001 — El problema y la visión

## El problema real

El problema no era “no tener dónde guardar notas”. Había Obsidian, Notion, correo, mensajes guardados y carpetas. El problema era más concreto:

1. **Capturar cuesta demasiado.** Abrir una app, elegir carpeta, escribir un título, etiquetar y ordenar rompe el momento de la idea.
2. **Lo capturado no se recupera.** Una nota enterrada no sirve si no puedes preguntarle al sistema “¿qué pensé sobre esto?”.
3. **La estructura llega tarde o nunca.** Las notas rápidas quedan como texto plano; sin estructura no hay búsqueda útil.
4. **La nube impone confianza.** Guardar ideas personales en un servicio opaco obliga a confiar en su política, su disponibilidad y su precio.

La visión fue:

> Capturar en segundos, estructurar automáticamente y recuperar por significado, manteniendo la propiedad del conocimiento en archivos que el usuario controla.

## Las cuatro propiedades

### 1. Baja fricción

El usuario ya está en Telegram. No hay que instalar otra app ni abrir un formulario. Un mensaje de voz o de texto debería bastar.

Esto descarta de entrada un flujo con muchos pasos obligatorios. La clasificación existe, pero llega **después** de capturar y con botones, no como un formulario previo.

### 2. Estructura automática

La nota debe salir con:

- título,
- resumen,
- categoría,
- etiquetas,
- ideas clave,
- acciones,
- idioma.

Esa estructura no es decorativa: hace que la nota sea legible para humanos y recuperable para el sistema. El LLM propone; Zod valida; el usuario decide carpeta y categoría.

### 3. Recuperación semántica

Buscar por palabras clave falla cuando la nota dice “cabañas al aire libre” y la pregunta dice “inversión inmobiliaria”. Los embeddings convierten textos en vectores y permiten buscar por cercanía de significado.

La recuperación no es “magia”: es un ranking. Y todo ranking puede equivocarse, así que hace falta medir la distancia, filtrar y citar la fuente.

### 4. Trazabilidad

Cada respuesta de RAG debe citar notas concretas. Si el modelo inventa, el sistema falla. La regla es:

> Sin fuente, no hay respuesta.

Esto obliga a diseñar el prompt, el contexto y la presentación de fuentes con la misma seriedad que la generación.

## Qué no es Idearium

Delimitar el alcance evita sobreingeniería:

- **No es un chatbot general.** Responde sobre el vault, no sobre Internet.
- **No es un gestor de tareas.** Extrae acciones, pero no reemplaza a Todoist.
- **No es un sistema multiusuario.** La allowlist protege el bot; el diseño es personal.
- **No es un motor de búsqueda web.** La web puede entrar como captura o documento, no como fuente automática.
- **No es un OCR completo.** Los PDF escaneados y las fotos quedaron fuera de la primera versión.
- **No es un servicio SaaS.** Se despliega en una máquina propia o en un servidor pequeño.

## Usuario y escenarios

El usuario objetivo es una persona que piensa mejor hablando y quiere un “segundo cerebro” sin mantener una taxonomía perfecta.

Escenarios típicos:

- “Estoy manejando y se me ocurre una idea; mando un audio.”
- “Voy a una reunión y quiero guardar tres decisiones; mando un texto.”
- “Recibo un PDF y quiero que quede resumido en mi vault.”
- “Semanas después pregunto: ¿qué había decidido sobre el presupuesto?”
- “Quiero repasar un tema sin releer todas las notas; pido un palacio o un quiz.”

## Principios de diseño

### Local-first, remoto cuando haga falta

El primer diseño priorizaba modelos locales (Ollama, Faster-Whisper). La realidad del hardware —una GPU pequeña o compartida— mostró que el local no siempre alcanza.

La solución no fue elegir un bando, sino **hacer configurable el router**:

- local primero y remoto como escalada,
- remoto primero y local como respaldo,
- solo local,
- solo remoto.

Así el sistema funciona en una laptop sin GPU y en un servidor sin GPU, cambiando variables, no código.

### Markdown como formato de verdad

La base de datos no es la fuente de verdad. Los `.md` lo son. LanceDB es un índice reconstruible.

Esto da:

- portabilidad,
- legibilidad,
- control de versiones,
- compatibilidad con Obsidian,
- posibilidad de borrar el índice sin perder conocimiento.

### La estructura se valida, no se confía

Los LLM producen JSON casi siempre, pero “casi” no basta. El esquema Zod es el contrato. Si falla:

1. se reintenta localmente con el error como feedback,
2. si sigue fallando y hay remoto, se escala,
3. si nada funciona, se devuelve un error claro.

### La recuperación se mide

No se acepta “el modelo respondió bonito”. Se exige:

- distancia del mejor resultado,
- filtro de resultados lejanos,
- máximo de fragmentos por nota,
- fuentes citadas, no todas las recuperadas.

## El nombre

“Idearium” sugiere un lugar donde las ideas se depositan y se cultivan. No es un almacén pasivo: el sistema las estructura, las relaciona y las devuelve cuando hacen falta.

## Errores de visión que se evitaron

- **Construir primero la interfaz perfecta.** Se empezó por el pipeline y el CLI; el bot llegó después.
- **Indexar todo sin control.** Se aprendió que un índice con notas irrelevantes contamina las respuestas; de ahí el filtro por distancia.
- **Depender de un solo proveedor.** OpenRouter concentró chat, embeddings y STT, pero el router y los proveedores quedaron detrás de interfaces.
- **Confundir documentación con conocimiento personal.** El curso vive en `Aprendizaje/Idearium` y no consume la numeración de capturas.

## Ejercicio

Escribe tres ideas que hayas perdido por no capturarlas a tiempo. Para cada una, indica:

1. dónde estabas,
2. qué herramienta tenías a mano,
3. qué paso extra te hizo abandonar.

Ese paso extra es el enemigo que Idearium intenta eliminar.
