---
title: "0020 — Pruebas: cómo saber que funciona"
aliases:
  - "0020 Pruebas como saber que funciona"
  - "Testing y calidad"
tags:
  - idearium
  - curso
  - testing
  - vitest
  - calidad
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0020 — Pruebas: cómo saber que funciona

## Por qué probar un sistema con IA

La IA es probabilística; el software que la rodea no debería serlo. Los tests verifican las partes deterministas:

- validación de esquemas,
- chunking,
- frontmatter,
- indexación,
- filtrado de RAG,
- selección de notas,
- formato de listas.

No se prueba “¿el LLM responde bonito?”. Se prueba “¿el sistema maneja bien lo que el LLM devuelve?”.

## Vitest

Se usa Vitest porque:

- funciona con TypeScript/ESM sin configuración pesada,
- es rápido,
- tiene mocks y snapshots,
- se integra con `npm test`.

Comando:

```bash
npm test
```

## Tests unitarios

### Esquemas

Se valida:

- un digest correcto,
- tags con `#`,
- tags duplicados,
- categoría inválida,
- campos faltantes.

### Chunking

Se verifica:

- división por encabezados,
- solape,
- secciones largas,
- texto vacío.

### Frontmatter

Se verifica:

- YAML válido,
- campos obligatorios,
- colisiones de nombres,
- subcarpetas.

### Selección

Se verifica:

- lista explícita,
- título con comas,
- número de nota,
- tema por embedding,
- unresolved.

## Tests de integración

### Indexer + LanceDB temporal

Se crea una base en un directorio temporal y un `FakeEmbedder` que devuelve vectores deterministas.

```ts
class FakeEmbedder {
  async embed(texts: string[]) {
    return texts.map((_, i) => [i, 0, 0, 0]);
  }
}
```

Ventajas:

- no se llama a OpenRouter,
- no se paga,
- el resultado es reproducible.

Se prueba:

- indexar una nota,
- saltar si el hash no cambió,
- reindexar,
- borrar huérfanos,
- ignorar `.obsidian`.

### RAG con LLM mockeado

Se simula el proveedor:

```ts
const llm = {
  completeText: async () => 'Respuesta con [[Nota A]]',
};
```

Se verifica:

- se pasa contexto numerado,
- se filtran fuentes por distancia,
- se citan solo las usadas,
- sin hits no se llama al LLM.

### Bot

Se prueban funciones puras:

- `splitMessage`,
- teclados,
- parseo de argumentos.

No se prueba Telegram real en unit tests.

## Qué no se prueba

- calidad de la respuesta del LLM,
- latencia real de OpenRouter,
- interfaz de Telegram,
- OCR (no implementado),
- comportamiento exacto de modelos.

Eso se cubre con smoke tests y pruebas manuales.

## Smoke tests

`npm run smoke`:

1. crea un vault temporal,
2. indexa una nota,
3. consulta,
4. reindexa,
5. limpia.

Verifica el pipeline real con el proveedor configurado. No reemplaza los unit tests; los complementa.

## Doctor

`npm run doctor` verifica el entorno:

- Node,
- dependencias,
- Ollama (si aplica),
- STT,
- vault escribible,
- token de Telegram,
- OpenRouter,
- LanceDB.

Es la primera parada cuando algo falla.

## Errores reales que los tests atraparon

- tags con `#`,
- colisión de nombres,
- ruta fuera del vault,
- fuente inventada en quiz,
- chunks duplicados,
- `extractSection` con encabezados,
- RAG citando notas no usadas.

## Cobertura

No se persigue el 100 %. Se prioriza:

- lógica de negocio,
- validaciones,
- rutas de error,
- parsing.

Un test que solo copia la implementación no aporta.

## Ejercicio

1. Ejecuta `npm test` y lee un test de indexer.
2. Añade un caso de tag duplicado.
3. ¿Qué probarías con un LLM que devuelve `null`?
4. ¿Qué diferencia hay entre test y smoke?

Los tests no garantizan que la IA sea buena, pero garantizan que el sistema no se rompa cuando la IA falla.
