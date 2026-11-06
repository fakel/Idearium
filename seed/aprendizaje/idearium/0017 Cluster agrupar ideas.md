---
title: "0017 — Cluster: agrupar ideas y detectar patrones"
aliases:
  - "0017 Cluster agrupar ideas"
  - "Clustering de notas"
tags:
  - idearium
  - curso
  - cluster
  - sintesis
  - busqueda-semantica
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0017 — Cluster: agrupar ideas y detectar patrones

## El problema

Con 20 notas puedes recordar qué contiene cada una. Con 500, no.

El cluster responde:

- ¿qué notas hablan de lo mismo?
- ¿qué patrones aparecen?
- ¿qué preguntas quedan abiertas?
- ¿qué conexiones no había visto?

## Qué hace `/cluster`

```text
/cluster sostenibilidad
```

1. Busca notas relacionadas con el tema.
2. Recupera chunks amplios.
3. Pide al LLM que agrupe y sintetice.
4. Guarda `Estudios/YYYY-MM-DD-cluster-<tema>.md`.
5. Indexa el resultado.

## Búsqueda amplia

No usa `RAG_TOP_K` (8), sino un `topK` mayor (40) y un contexto más grande (18 000 caracteres).

¿Por qué?

- El RAG responde una pregunta puntual.
- El cluster necesita ver el conjunto.
- Con pocos chunks, la síntesis sería parcial.

El límite evita enviar 200 notas y pagar una fortuna.

## El prompt

Pide:

```markdown
# Título
## Resumen
## Temas principales
## Conexiones
## Preguntas abiertas
```

Reglas:

- citar notas con `[[Título]]`,
- no inventar,
- agrupar por afinidad,
- señalar contradicciones,
- distinguir lo que está en las notas de lo que es inferencia.

## Por qué una nota nueva

El cluster no modifica las notas originales. Crea un documento de síntesis.

Ventajas:

- no destruye evidencia,
- se puede revisar,
- se puede borrar sin afectar el resto,
- se indexa y aparece en futuras búsquedas.

Desventaja:

- puede quedar desactualizado,
- duplica parte del contenido,
- hay que regenerarlo si cambian las fuentes.

## Frontmatter

```yaml
type: cluster
topic: sostenibilidad
tags:
  - sostenibilidad
  - síntesis
notes_used: 12
```

`notes_used` ayuda a saber cuántas notas alimentaron la síntesis.

## Diferencia con RAG

| RAG | Cluster |
|---|---|
| responde una pregunta | sintetiza un tema |
| top-k pequeño | top-k amplio |
| salida breve | documento largo |
| cita fuentes usadas | cita muchas notas |
| no escribe archivo | escribe archivo |

## Diferencia con palacio

| Palacio | Cluster |
|---|---|
| memoria visual | síntesis conceptual |
| historia | prosa estructurada |
| para recordar | para entender |
| una o varias notas | tema amplio |

## Límites

- Si hay pocas notas, el cluster es pobre.
- Si el tema es ambiguo, mezcla cosas.
- El LLM puede agrupar por palabras y no por conceptos.
- No reemplaza una revisión sistemática.

## Errores reales

### “No hay notas suficientes”

El tema no aparece en el índice. Solución: capturar más o reformular.

### El cluster repite las notas

El prompt no pidió síntesis. Solución: pedir conexiones y preguntas, no resumen.

### Cita notas que no usó

Se validan las fuentes o se revisa el resultado.

### Archivo duplicado

Se usa fecha + slug; si se repite el mismo día, se añade sufijo.

## Ejercicio

1. Elige un tema con al menos 5 notas.
2. Ejecuta `/cluster`.
3. ¿Qué conexión no habías visto?
4. ¿Qué pregunta abierta te resulta más útil?

El cluster convierte notas dispersas en una vista de conjunto.
