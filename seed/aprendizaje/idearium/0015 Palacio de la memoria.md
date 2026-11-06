---
title: "0015 — Palacio de la memoria"
aliases:
  - "0015 Palacio de la memoria"
  - "Memoria y palacios"
tags:
  - idearium
  - curso
  - memoria
  - palacio
  - aprendizaje
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0015 — Palacio de la memoria

> Esta nota es teoría del curso. No contiene un palacio real; la sección reservada del sistema se llama exactamente `## Palacio de la memoria` y solo aparece en notas donde se ejecutó `/memorize`.

## La idea

El palacio de la memoria es una técnica mnemónica:

1. imaginas un lugar que conoces,
2. colocas información en puntos concretos,
3. recorres el lugar para recordar.

Funciona porque el cerebro recuerda espacios e imágenes mejor que listas abstractas.

En Idearium, el LLM convierte una nota en un recorrido visual por sus ideas.

## Qué genera el sistema

No genera un resumen. Genera una **historia**:

```markdown
## La técnica del palacio

Entras a la casa y en el recibidor hay una caja fuerte abierta...
Subes al segundo piso y en el dormitorio hay un contrato...
```

Cada escena asocia:

- un lugar físico,
- una imagen concreta,
- una idea de la nota.

## Por qué una historia y no una lista

Una lista de “puntos clave” es fácil de leer y fácil de olvidar. Una historia:

- crea una secuencia,
- usa imágenes,
- activa memoria episódica,
- se puede recorrer mentalmente.

El objetivo no es documentar; es recordar.

## Evolución del diseño

### Versión 1: secciones

Se pedían secciones:

```text
### Ruta física
### Imágenes
### Repaso
```

Ventaja: estructura clara. Desventaja: se lee como formulario, no como recorrido.

### Versión 2: historia

Se pidió una historia de 4–6 escenas (una nota) o 5–7 (varias), sin encabezados internos.

Ventaja: más fácil de imaginar. Desventaja: puede ser demasiado larga.

### Versión 3: límite de 1800 caracteres

`compactPalaceStory`:

- elimina encabezados,
- normaliza espacios,
- corta a 1800 caracteres.

Suficiente para 4–5 escenas, no tanto como para saturar.

## Una nota vs varias

### Una nota

El palacio se guarda en el mismo archivo, dentro de la sección reservada del sistema (`Palacio de la memoria`), que no debe confundirse con esta nota de teoría.

Ventaja: la memoria vive junto a la nota.

### Varias notas o un tema

Se crea una nota nueva en `Palacios/`:

```text
Palacios/2026-11-06-palacio-plan-financiero.md
```

Con frontmatter:

```yaml
type: palacio
source_notes:
  - Proyectos/Casas/0001-...
  - Finanzas/0002-...
```

Ventaja: un solo recorrido para varias fuentes, sin duplicar contenido.

## Por qué no duplicar el contenido

Un palacio combinado no copia las notas enteras. Solo:

- referencia las fuentes,
- crea el recorrido.

Si la nota original cambia, el palacio puede quedar desactualizado. Es una limitación consciente: regenerarlo es barato.

## El selector

Para “palacio de la memoria de las notas X, Y y Z”:

1. se limpia el prefijo,
2. se separan títulos por comas/“y”,
3. se resuelven por título, ruta, slug o número,
4. si algo no se encuentra, se avisa.

Para “palacio de todos los pasos de X”:

1. se interpreta como tema,
2. se buscan chunks,
3. se seleccionan las notas más relevantes,
4. se limita a `MEMORY_MAX_NOTES` (5) y `MEMORY_MAX_CHARS` (24 000).

## Por qué no dejar que el LLM elija las notas

El LLM podría inventar títulos o elegir notas inexistentes. El selector determinista:

- garantiza que las notas existen,
- permite mostrar errores claros,
- deja al LLM solo la redacción.

## Lectura y lista

`/palacio` sin argumentos muestra una lista numerada:

```text
🏛️ Palacios de la memoria (3)

1. Plan financiero [combinado]
2. Conservación de la energía
3. Procedimiento de soldadura
```

`/palacio 2` lee ese palacio.

El número es una referencia de interfaz, no un identificador permanente. Si se borra uno, los números cambian.

## Borrado

`/palacio rm 2`:

1. resuelve el palacio,
2. borra el archivo de `Palacios/`,
3. elimina los enlaces de las notas fuente,
4. reindexa.

Si es un palacio antiguo dentro de una nota, borra solo la sección.

## Límites

- El palacio es tan bueno como la nota.
- Un texto vago produce imágenes vagas.
- No reemplaza el estudio; es una ayuda.
- Puede contener imprecisiones del LLM.
- No se actualiza automáticamente si cambia la nota fuente.

## Errores reales

### El LLM devuelve secciones en vez de historia

Se cambió el prompt y se añadió `compactPalaceStory`.

### El palacio es demasiado largo

Se limitó a 1800 caracteres y se pidió un número fijo de escenas.

### Se duplicó la nota original

Se separó el palacio en `Palacios/` y se dejó solo un enlace.

### El enlace no se actualiza al renombrar

Obsidian puede actualizar enlaces, pero el índice no. Reindexar resuelve.

## Ejercicio

1. Elige una nota con 4 ideas y crea un recorrido por tu casa.
2. ¿Qué imagen usarías para cada idea?
3. Prueba `/palacio` y luego `/palacio N`.
4. Borra el palacio y comprueba que la nota original queda intacta.

El palacio no es almacenamiento: es una transformación de la información para que el cerebro la pueda recorrer.
