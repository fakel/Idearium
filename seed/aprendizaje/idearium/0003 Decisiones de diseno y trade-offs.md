---
title: "0003 — Decisiones de diseño y trade-offs"
aliases:
  - "0003 Decisiones de diseno y trade-offs"
  - "Decisiones de diseño de Idearium"
tags:
  - idearium
  - curso
  - arquitectura
  - decisiones
created: 2026-11-06
updated: 2026-11-06
category: aprendizaje
type: curso
curso: Idearium
---

# 0003 — Decisiones de diseño y trade-offs

Una decisión de diseño no es “la opción correcta”. Es la opción que mejor encaja con un conjunto de restricciones. Esta nota recoge las decisiones importantes, la alternativa que se descartó y el coste de haber elegido así.

## 1. Markdown como fuente de verdad

**Decisión:** las notas son archivos `.md`; la base vectorial es solo un índice.

**Alternativa:** guardar todo en una base de datos y exportar Markdown.

**Por qué:** el usuario ya usa Obsidian; los archivos son legibles, portables, versionables y sobreviven a cualquier herramienta. Si LanceDB desaparece, el conocimiento sigue ahí.

**Coste:** hay que resolver escritura atómica, colisiones de nombres y sincronización del índice. No hay transacciones entre archivo e índice.

**Regla derivada:** si hay conflicto, manda el archivo. El índice se reconstruye.

## 2. Un índice vectorial, no una base relacional

**Decisión:** LanceDB embebido, tabla `notes`, vectores + metadatos.

**Alternativa:** Postgres + pgvector, SQLite + extensión, Elasticsearch.

**Por qué:** cero servidores, cero credenciales, funciona en una laptop y en un contenedor. La búsqueda que se necesita es por similitud, no por joins.

**Coste:** menos herramientas de inspección, dependencia del formato Lance, y el esquema se recrea si cambia la dimensión del embedding.

**Lección:** cambiar de modelo de embeddings obliga a borrar y reindexar. La dimensión es parte del contrato.

## 3. Router configurable local/remoto

**Decisión:** `LLM_PREFERENCE` con cuatro modos y escalado por fallo.

**Alternativa:** usar siempre la nube, o siempre local.

**Por qué:** el hardware cambia. Una GPU pequeña no puede con un 7B, embeddings y STT a la vez; un servidor sin GPU no puede con nada local. El mismo código debe servir en ambos.

**Coste:** más configuración y más caminos que probar. El modo `remote_only` debe funcionar sin Ollama instalado.

**Lección:** “local-first” no significa “local obligatorio”. Significa que el sistema no depende de la nube para existir.

## 4. OpenRouter como proveedor remoto único

**Decisión:** una sola clave para chat, embeddings y STT.

**Alternativa:** DeepSeek para chat, OpenAI para embeddings, Groq para STT.

**Por qué:** menos cuentas, menos claves, menos facturas y un solo lugar donde cambiar modelos. OpenRouter además permite comparar modelos sin reescribir el cliente.

**Coste:** dependencia de un agregador; si OpenRouter cae, cae todo el modo remoto. El catálogo cambia y los modelos gratuitos tienen límites.

**Matiz:** DeepSeek solo cubre chat; no ofrece embeddings ni STT. Por eso “solo DeepSeek” no alcanza para Idearium.

## 5. Polling de Telegram por defecto

**Decisión:** el bot usa long polling; el webhook queda como opción futura.

**Alternativa:** webhook desde el primer día.

**Por qué:** polling no requiere IP pública, dominio, HTTPS ni abrir puertos. Funciona detrás de NAT y en una laptop. Para un usuario personal, la latencia es irrelevante.

**Coste:** el proceso debe estar siempre corriendo; Telegram limita la concurrencia; no hay verificación de secreto de webhook.

**Cuándo cambiar:** servidor público, necesidad de escalar o de recibir eventos con baja latencia.

## 6. Clasificación interactiva, no automática total

**Decisión:** el LLM sugiere; el usuario elige carpeta y categoría con botones.

**Alternativa:** dejar que el LLM decida carpeta y categoría sin preguntar.

**Por qué:** una carpeta mal elegida es difícil de encontrar después. Preguntar una vez, con opciones ya existentes, enseña al usuario su propia taxonomía y evita notas huérfanas.

**Coste:** un paso extra y estado pendiente por chat. Hay que manejar TTL, cancelación y que el usuario no mezcle una captura con un quiz.

**Lección:** la automatización total no siempre es la mejor UX. A veces conviene automatizar la parte difícil y dejar la decisión barata al humano.

## 7. Numeración global de capturas

**Decisión:** `NNNN-titulo-DDMMAA.md`, `note_number` y alias `NNNN`.

**Alternativa:** solo título o fecha.

**Por qué:** un número corto es fácil de decir, escribir y enlazar (`[[0007]]`). El título puede cambiar; el número no. La fecha en el nombre ordena y da contexto.

**Coste:** hay que recorrer el vault para calcular el siguiente número; las notas antiguas no tienen número y conviven con las nuevas.

**Regla:** las notas de curso no consumen esta numeración; usan `00`, `01`, etc.

## 8. Escritura atómica

**Decisión:** escribir en un archivo temporal y renombrar.

**Alternativa:** escribir directamente sobre el destino.

**Por qué:** si el proceso muere a mitad, no queda una nota corrupta. El rename es atómico en el mismo sistema de archivos.

**Coste:** hay que asegurar que el temporal está en la misma partición y limpiar restos si falla.

## 9. Palacios en archivos separados

**Decisión:** cada palacio vive en `Palacios/`; la nota original solo guarda un enlace.

**Alternativa:** guardar la historia dentro de la nota original.

**Por qué:** el palacio es una pieza de estudio, no parte del contenido original. Separarlo permite listarlo, borrarlo y regenerarlo sin tocar la nota fuente. También evita duplicar texto.

**Coste:** más archivos y enlaces que mantener. Si se borra el palacio, hay que limpiar los enlaces.

## 10. RAG con filtro de distancia

**Decisión:** no usar todos los `topK`; filtrar por cercanía al mejor hit y limitar chunks por nota.

**Alternativa:** devolver siempre 8 chunks.

**Por qué:** LanceDB siempre devuelve `topK`, aunque no haya 8 resultados relevantes. Sin filtro, el contexto se llena de ruido y la UI muestra fuentes que el modelo no usó.

**Coste:** un umbral relativo puede descartar un segundo resultado útil si la distancia está muy cerca del corte. Se mitiga con un margen mínimo y revisando casos reales.

**Lección:** el retrieval no termina cuando la base devuelve resultados; termina cuando se decide qué es relevante.

## 11. Mostrar solo fuentes citadas

**Decisión:** extraer los `[[wikilinks]]` de la respuesta y cruzarlos con los hits.

**Alternativa:** listar todos los hits recuperados.

**Por qué:** “fuente recuperada” no es lo mismo que “fuente usada”. Mostrar todas confunde y hace parecer que la respuesta se apoya en notas que no leyó.

**Coste:** si el modelo no cita, no se muestra ninguna fuente. Es preferible a mostrar ruido.

## 12. Docker sin GPU

**Decisión:** la imagen Docker usa solo OpenRouter: sin Ollama, Whisper, CUDA ni GPU.

**Alternativa:** imagen con CUDA y passthrough de GPU.

**Por qué:** el passthrough en Proxmox/LXC fue frágil; una GTX 1050 Ti de 4 GB no alcanza para el stack completo; la imagen con CUDA pesa gigabytes y depende del driver del host.

**Coste:** el modo Docker requiere Internet y una clave de OpenRouter. No es 100 % local.

**Lección:** la portabilidad se logra quitando dependencias, no añadiendo capas.

## 13. Una sola imagen, varios modos

**Decisión:** el mismo código corre en local, Docker, systemd y CLI.

**Alternativa:** versiones separadas para cada entorno.

**Por qué:** menos divergencia y menos bugs. La configuración decide el modo; el código no se duplica.

**Coste:** hay que probar la matriz de modos (local/remoto, GPU/CPU, polling/CLI).

## Cómo se documenta una decisión

Una buena decisión debe responder:

1. **Contexto:** qué restricción existía.
2. **Decisión:** qué se eligió.
3. **Alternativas:** qué se descartó.
4. **Consecuencias:** qué se gana y qué se pierde.
5. **Reversibilidad:** ¿es fácil cambiar de opinión?

Si no puedes nombrar la alternativa, no fue una decisión: fue una costumbre.

## Ejercicio

Elige tres decisiones de esta lista y responde:

- ¿Qué pasaría si eligieras la alternativa?
- ¿Qué habría que cambiar en el código?
- ¿Qué se volvería más fácil y qué más difícil?

Ese ejercicio es la base de un buen diseño: no defender la solución, sino entender el espacio de soluciones.
