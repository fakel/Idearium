---
title: "0008 — Clasificación interactiva"
aliases:
  - "0008 Clasificacion interactiva"
  - "Clasificación de capturas"
tags:
  - idearium
  - curso
  - clasificacion
  - ux
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0008 — Clasificación interactiva

## El problema de la carpeta

Cuando capturas una idea, el sistema ya puede generar un título, un resumen y etiquetas. Pero hay una decisión que el modelo no puede tomar bien: **dónde guardarla**.

La carpeta depende de la taxonomía personal, del proyecto activo y del contexto que no está en el texto. Un LLM puede acertar el 80 % de las veces, pero el 20 % restante crea notas difíciles de encontrar.

La solución fue:

> El LLM prepara y sugiere; el usuario elige carpeta y categoría con botones.

## Las dos dimensiones

### Carpeta

Es la ubicación física en el vault:

```text
Proyectos/Casas/
Aprendizaje/Electrónica/
Personal/
```

Determina el contexto y la navegación en Obsidian. Es una decisión del usuario.

### Categoría

Es el tipo de contenido:

```text
idea | tarea | aprendizaje | referencia | proyecto | personal | otro
```

Determina cómo se trata la nota y permite filtrar. Es más estable que la carpeta y se puede inferir mejor.

## El estado pendiente

`PendingCaptureStore` guarda por chat una captura preparada:

```ts
interface PreparedCapture {
  prepared: PreparedIngest;
  folders: string[];
  suggestedCategory: NoteCategory;
  folder?: string;
  categories: string[];
  createdAt: number;
}
```

El flujo es una pequeña máquina de estados:

```text
PREPARADO
  ├─ elegir carpeta → ESPERANDO_CATEGORIA
  │     ├─ elegir categoría → GUARDAR
  │     └─ escribir categoría → GUARDAR
  ├─ escribir carpeta → ESPERANDO_CATEGORIA
  └─ cancelar → DEScartar
```

El TTL de 30 minutos evita que una captura vieja se complete con una decisión tomada en otro contexto.

## Preparar no es guardar

`IngestController` separa dos operaciones:

- **`prepareText` / `prepareAudio` / `prepareDocument`**: transcriben, extraen y generan el digest. No escriben la nota.
- **`save`**: recibe la captura preparada y la carpeta/categoría elegidas; escribe y indexa.

Esta separación tiene tres ventajas:

1. si el usuario cancela, no hay nota a medias;
2. si el LLM falla, el audio/documento sigue disponible;
3. la clasificación no tiene que repetir trabajo costoso.

## Sugerencias

### Carpetas

Se listan las carpetas existentes que contienen notas, ignorando `.obsidian` y `.trash`. La carpeta por defecto (`NOTE_SUBDIR`) aparece primero.

Si no hay carpetas, se ofrece la carpeta por defecto y la opción de escribir una nueva.

### Categorías

Se leen las categorías usadas en el frontmatter de las notas existentes y se ordenan por frecuencia. La categoría sugerida por el LLM se coloca primero.

Esto produce un efecto interesante: **el sistema aprende la taxonomía del usuario** sin entrenar nada. Solo observa lo que ya existe.

## Normalización

El texto libre se normaliza:

```text
"Ideas"     → idea
"proyectos" → proyecto
"#Aprendizaje" → aprendizaje
"tareas"    → tarea
```

Se eliminan acentos para comparar, se aceptan plurales y se ignoran mayúsculas. La nota se guarda con la categoría canónica del enum, no con el texto original.

Para carpetas:

- se normalizan separadores,
- se rechazan `..`, `.`, rutas absolutas y nombres vacíos,
- se valida que el destino quede dentro del vault.

La validación anti-path-traversal no es paranoia: un usuario podría escribir `../../etc` y el bot escribiría fuera del vault.

## Por qué botones inline

Los botones:

- muestran las opciones reales,
- evitan errores de tipeo,
- permiten elegir con un toque,
- dejan claro que hay una taxonomía.

El texto libre sigue disponible para crear una carpeta o categoría nueva. La interfaz no obliga a usar solo lo existente.

## Por qué no clasificar automáticamente

Se podría dejar que el LLM eligiera carpeta y categoría y guardar sin preguntar. Sería más rápido, pero:

- una carpeta equivocada es difícil de detectar después;
- el usuario no ve la taxonomía y no la corrige;
- se pierde la oportunidad de enseñar al sistema.

Preguntar una vez es un coste pequeño comparado con una nota perdida.

## Errores y casos límite

### El usuario elige una carpeta nueva

Se valida y se crea al guardar. Si el nombre es inválido, se pide de nuevo.

### El usuario escribe una categoría desconocida

Se normaliza; si no coincide con el enum, se rechaza con las opciones válidas.

### Llega otro mensaje mientras hay una captura pendiente

El bot avisa y pide terminar o `/cancelar`. No mezcla capturas.

### El usuario está en un quiz

El texto se interpreta como respuesta del quiz, no como captura. Las guardas de estado evitan ambigüedad.

### El bot se reinicia

El estado en memoria se pierde. La captura pendiente se descarta; el audio/documento queda en disco.

## La respuesta final

Al guardar, el bot muestra:

```text
✅ Nota creada
Título: ...
Ruta: Proyectos/Casas/0001-...
Tags: ...
Modelo: openrouter/...
Índice: 1 chunk
```

Esto cierra el ciclo: el usuario sabe qué se guardó, dónde y con qué motor.

## Ejercicio

1. Diseña una taxonomía de carpetas para tu vault.
2. ¿Qué categorías usarías y cuáles serían ambiguas?
3. ¿Qué pasa si el LLM sugiere una categoría que no existe?
4. ¿Por qué la carpeta se elige antes que la categoría?

La clasificación es el punto donde el sistema deja de ser automático y se vuelve colaborativo. Ese equilibrio es intencional.
