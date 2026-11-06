---
title: "0000 — Índice del curso Idearium"
aliases:
  - "0000 Indice"
  - "Índice del curso Idearium"
tags:
  - idearium
  - curso
  - indice
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0000 — Índice del curso Idearium

Este curso reconstruye **Idearium desde el concepto**, no desde el código. La pregunta que responde es:

> Si mañana no hubiera IA, ¿cómo volvería a construir esta herramienta y por qué tomaría las mismas decisiones?

No es documentación de API ni un manual de usuario. Es el razonamiento que hay detrás: qué problema se resolvía, qué alternativas existían, qué se sacrificó y qué se aprendió al implementarlo.

## Cómo está organizado

Las notas van de problema a operación:

1. **Problema y arquitectura** — qué se quiere lograr y cómo se descompone.
2. **Decisiones y fundamentos** — por qué Markdown, por qué vectorial, por qué local-first.
3. **Ingesta** — Telegram, voz, documentos y clasificación.
4. **Inteligencia** — LLM, JSON, router, embeddings.
5. **Conocimiento** — Obsidian, índice, RAG, palacios, quiz, clúster.
6. **Operación y reconstrucción** — cómo se despliega, se prueba y se repite.

Cada nota sigue una estructura común:

- **El problema**: qué dolía o qué faltaba.
- **La idea**: el concepto que lo resuelve.
- **La implementación**: cómo se materializó.
- **El porqué**: alternativas y trade-offs.
- **Errores y límites**: lo que se rompió o no se cubre.
- **Ejercicio**: una forma de comprobar que se entendió.

## Ruta de lectura

### Parte I — Pensar la herramienta

- [[0001 El problema y la vision]]
- [[0002 Arquitectura y flujo de datos]]
- [[0003 Decisiones de diseno y trade-offs]]
- [[0004 Fundamentos tecnicos y configuracion]]

### Parte II — Capturar

- [[0005 Telegram y captura sin friccion]]
- [[0006 Voz y reconocimiento de habla]]
- [[0007 Documentos y extraccion de texto]]
- [[0008 Clasificacion interactiva]]

### Parte III — Comprender

- [[0009 LLM prompts y JSON validado]]
- [[0010 Router local remoto y OpenRouter]]
- [[0011 Markdown Obsidian y escritura atomica]]

### Parte IV — Recordar y recuperar

- [[0012 Chunking y embeddings]]
- [[0013 LanceDB y el indice vectorial]]
- [[0014 RAG y busqueda semantica]]
- [[0015 Palacio de la memoria]]
- [[0016 Quiz y practica activa]]
- [[0017 Cluster agrupar ideas]]

### Parte V — Captura avanzada, operación y cierre

- [[0018 Captura por texto voz y documentos]]
- [[0019 Indexacion y watcher]]
- [[0020 Pruebas como saber que funciona]]
- [[0021 Glosario y referencias]]

## Convención de numeración

Estas notas son material de curso, no capturas del bot. Por eso usan numeración de curso (`00`, `01`, …) y viven en `Aprendizaje/Idearium/`.

La numeración global del proyecto (`0001-titulo-DDMMAA.md`, `note_number`, alias `0001`) se reserva para las notas que el usuario captura. Mezclar ambas haría que el curso consumiera números de captura y que `/notas` confundiera documentación con conocimiento personal.

La nota [[0015 Palacio de la memoria]] es **teoría**: explica la técnica, pero no contiene un palacio real. El sistema solo considera palacio una nota con la sección `## Palacio de la memoria` (o un archivo `type: palacio` en `Palacios/`); por eso esa nota no aparece en `/palacio`.

## Idea central

Idearium no es “un bot de Telegram que guarda notas”. Es un **sistema de captura y recuperación de conocimiento** con cuatro propiedades:

1. **Baja fricción**: hablar o escribir, nada más.
2. **Estructura**: la nota se convierte en Markdown con metadatos.
3. **Recuperación**: se puede buscar por significado, no solo por palabras.
4. **Trazabilidad**: cada respuesta debe poder volver a una nota concreta.

Todo lo demás —LLM, embeddings, colas, índices— existe para sostener esas cuatro propiedades.

## Ejercicio

Antes de seguir, escribe en una frase qué parte del sistema te parece más difícil de reconstruir. Al terminar el curso, vuelve a esa frase y compárala con lo que entendiste.
