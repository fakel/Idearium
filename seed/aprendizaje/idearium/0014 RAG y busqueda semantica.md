---
title: "0014 — RAG y búsqueda semántica"
aliases:
  - "0014 RAG y busqueda semantica"
  - "Recuperación aumentada"
tags:
  - idearium
  - curso
  - rag
  - busqueda-semantica
  - llm
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0014 — RAG y búsqueda semántica

## Qué es RAG

RAG significa *Retrieval-Augmented Generation*:

1. **Retrieval**: buscar fragmentos relevantes.
2. **Augmented**: añadirlos al prompt.
3. **Generation**: el LLM responde usando ese contexto.

No es entrenar al modelo con tus notas. Es darle los fragmentos correctos en el momento de responder.

## El flujo

```text
pregunta
  → embedding de la pregunta
  → búsqueda vectorial top-k
  → filtrado por distancia
  → contexto numerado
  → LLM responde y cita
```

## Por qué no meter todas las notas

- no caben en el contexto,
- cuesta más,
- el modelo se distrae,
- aumenta la probabilidad de inventar.

RAG reduce el problema a “¿qué fragmentos necesito para responder esto?”.

## Top-k

`RAG_TOP_K` (default 8) es cuántos chunks se recuperan.

- Muy bajo: se pierden respuestas.
- Muy alto: ruido y coste.

El valor correcto depende del tamaño de las notas y del modelo. 8 es un punto de partida.

## Filtrado por distancia

No todos los chunks recuperados son relevantes. En Idearium:

```ts
const best = hits[0].distance;
const cutoff = best + Math.max(0.08, best * 0.12);
const kept = hits.filter(h => h.distance <= cutoff);
```

La idea:

- se conserva un margen relativo al mejor resultado,
- se descartan los que están mucho más lejos,
- se limita a 2 chunks por nota para no repetir la misma fuente.

Sin este filtro, una pregunta específica puede citar 6 notas que solo comparten el tema general.

## Contexto numerado

El prompt recibe:

```text
[1] Título de la nota (ruta)
texto del chunk...

[2] Otro título (ruta)
texto...
```

Ventajas:

- el modelo puede citar `[1]`, `[2]`,
- el usuario ve de dónde sale,
- se evita mezclar fuentes.

## El prompt RAG

Reglas típicas:

- responde solo con el contexto,
- si no está, dilo,
- cita las notas usadas con `[[Título]]`,
- no inventes,
- sé breve.

La instrucción “si no lo sabes, dilo” es clave. Sin ella, el modelo completa con conocimiento general y el usuario cree que está en sus notas.

## Fuentes y citas

Después de responder, la app extrae los wikilinks `[[...]]` de la respuesta y busca esos títulos entre los chunks recuperados.

- Solo se muestran fuentes citadas.
- No se enumeran todas las notas recuperadas.
- Si el modelo no cita, se puede mostrar una lista vacía o un aviso.

Esto evita el problema de “fuentes decorativas”: notas que aparecen al final pero no se usaron.

## Fallback sin resultados

Si no hay hits:

```text
No encontré notas relacionadas con esa consulta en tu vault.
```

No se llama al LLM. Es mejor un mensaje honesto que una respuesta inventada.

## Alucinación

El RAG reduce la alucinación, no la elimina. Un modelo puede:

- citar una nota que no usó,
- mezclar dos notas,
- inventar un detalle que “suena” al contexto.

Defensas:

- prompt estricto,
- temperatura baja,
- citas verificables,
- mostrar rutas,
- permitir que el usuario abra la nota.

## Evaluación

No basta con “la respuesta se ve bien”. Se puede evaluar:

1. **Retrieval**: ¿el chunk correcto está en el top-k?
2. **Answer**: ¿la respuesta usa ese chunk?
3. **Citation**: ¿la cita corresponde?
4. **Abstention**: ¿dice “no sé” cuando no hay contexto?

En este proyecto se hicieron pruebas manuales con preguntas concretas y se corrigió el filtro cuando aparecían fuentes irrelevantes.

## Errores reales

### Fuentes irrelevantes

Causa: top-k alto sin filtro de distancia. Solución: cutoff + máximo por nota.

### Respuesta correcta pero sin cita

Causa: el modelo no siguió el formato. Solución: prompt más explícito o validación de citas.

### Contexto demasiado largo

Causa: chunks grandes o muchos hits. Solución: recortar, limitar `k`, dividir mejor.

### El embedding de la pregunta no coincide

Puede pasar con preguntas muy cortas o ambiguas. Reformular ayuda.

## RAG no es un buscador

Un buscador devuelve documentos. RAG devuelve una respuesta sintetizada. El usuario puede querer ambas cosas; por eso se muestran fuentes y se puede abrir la nota.

## Ejercicio

1. Haz una pregunta cuya respuesta esté en dos notas.
2. ¿El sistema cita ambas?
3. ¿Qué pasa si preguntas algo que no está?
4. Ajusta el cutoff y observa cómo cambian las fuentes.

RAG es la unión de recuperación y generación. La calidad depende tanto del índice como del prompt.
