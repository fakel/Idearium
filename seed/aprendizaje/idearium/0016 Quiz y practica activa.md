---
title: "0016 — Quiz y práctica activa"
aliases:
  - "0016 Quiz y practica activa"
  - "Preguntas y evaluación"
tags:
  - idearium
  - curso
  - quiz
  - aprendizaje
  - evaluacion
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0016 — Quiz y práctica activa

## Por qué preguntar

Leer una nota crea una sensación de comprensión que no siempre es real. Responder una pregunta obliga a recuperar la información.

La práctica activa es uno de los métodos de estudio con más evidencia. El quiz de Idearium existe para eso: convertir notas pasivas en preguntas.

## El flujo

```text
/quiz tema
  → seleccionar notas
  → cargar contexto
  → generar preguntas
  → mostrar pregunta 1
  → usuario responde
  → evaluar
  → feedback
  → siguiente
  → resumen final
```

## Máquina de estados

El estado vive por chat:

```ts
interface QuizState {
  chatId: number;
  notes: NoteContext[];
  questions: QuizQuestion[];
  index: number;
  score: number;
  perNote: Map<string, {correct: number; total: number}>;
  awaitingAnswer: boolean;
}
```

Estados posibles:

- `awaitingAnswer = true`: el siguiente texto es una respuesta.
- `false`: no hay pregunta activa.
- sin estado: no hay quiz.

`/quiz stop` elimina el estado.

## Generación de preguntas

Se piden 3–6 preguntas:

```json
{
  "questions": [
    {
      "question": "¿Qué ...?",
      "answer": "...",
      "source": "Título exacto de la nota"
    }
  ]
}
```

Reglas:

- `source` debe ser uno de los títulos seleccionados;
- si el modelo inventa una fuente, se descarta;
- si faltan preguntas de alguna nota, se reintenta una vez;
- se reparten las preguntas entre las notas.

## Por qué validar la fuente

Sin validación, el modelo puede citar una nota que no existe o mezclar dos. La fuente permite:

- dar feedback con `Fuente: [[Título]]`,
- calcular aciertos por nota,
- detectar preguntas sin respaldo.

## Evaluación

La respuesta del usuario se envía al LLM con:

- la pregunta,
- la respuesta esperada,
- la respuesta del usuario.

El LLM devuelve:

```json
{
  "correct": true,
  "feedback": "Correcto: ..."
}
```

No se compara con igualdad de texto: “70 mil” y “70.000” pueden ser la misma respuesta.

### Riesgo

El evaluador también puede equivocarse. Por eso:

- se le da la respuesta esperada,
- se pide feedback breve,
- el usuario puede corregir mentalmente.

## Puntaje

- 1 punto por respuesta correcta.
- Se guarda `perNote` para el resumen.
- Al final:

```text
Quiz completado: 4/5
Plan financiero: 3/3
Impuestos: 1/2
```

Esto muestra qué nota necesita repaso.

## Multi-nota

`/quiz notas X, Y y Z` usa el mismo selector que el palacio:

- resuelve títulos/rutas,
- si no encuentra, avisa,
- carga contexto combinado,
- genera preguntas repartidas.

Un quiz de una sola nota también funciona.

## Por qué 3–6 preguntas

- Menos de 3: no cubre la nota.
- Más de 6: cansa y se pierde atención.
- 3–6 permite una sesión corta y frecuente.

## Por qué no Anki

Anki es excelente para repetición espaciada, pero:

- requiere tarjetas creadas a mano,
- no entiende el contexto de una nota,
- no genera preguntas.

Idearium no reemplaza Anki; genera práctica a partir de notas existentes. Una integración futura podría exportar tarjetas.

## Errores reales

### El modelo devuelve texto en vez de JSON

Se parsea con `extractJsonObject`; si falla, se reintenta.

### Fuente inventada

Se descarta la pregunta y se reintenta una vez. Si persiste, se avisa.

### El usuario responde con otra pregunta

Se evalúa como respuesta; el feedback dirá que no es correcta. No hay detección de intención.

### El bot se reinicia

El estado en memoria se pierde. El quiz se cancela.

## Prompt de evaluación

Debe pedir:

- veredicto booleano,
- feedback breve,
- no cambiar la respuesta esperada,
- tener en cuenta sinónimos y unidades.

## Ejercicio

1. Crea un quiz de una nota con 4 ideas.
2. Responde una pregunta mal a propósito y observa el feedback.
3. ¿Qué nota tuvo más fallos?
4. Diseña una pregunta que no se pueda responder con la nota.

El quiz cierra el ciclo: capturar → organizar → recuperar → practicar.
