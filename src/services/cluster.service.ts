import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { slugify } from '../lib/text.js';
import { uniquePath } from '../lib/unique-path.js';
import type { Embedder } from './embedding.service.js';
import type { TextCompleter } from './rag.service.js';
import type { VectorStore } from './vector.service.js';
import type { Indexer } from './indexer.service.js';

export interface ClusterConfig {
  studiesDir: string;
  topK?: number;
  maxChars?: number;
}

export interface ClusterResult {
  path: string;
  title: string;
  noteCount: number;
  content: string;
}

export class ClusterService {
  constructor(
    private readonly config: ClusterConfig,
    private readonly vector: VectorStore,
    private readonly embedder: Embedder,
    private readonly llm: TextCompleter,
    private readonly indexer?: Indexer,
  ) {}

  async run(topic: string): Promise<ClusterResult> {
    const trimmed = topic.trim();
    if (!trimmed) throw new Error('Indica un tema para agrupar.');

    const [vector] = await this.embedder.embed([trimmed]);
    if (!vector) throw new Error('No se pudo generar el embedding del tema.');

    const hits = await this.vector.search(vector, this.config.topK ?? 40);
    if (hits.length === 0) {
      throw new Error(`No hay notas relacionadas con "${trimmed}" en el índice.`);
    }

    const context = buildContext(hits, this.config.maxChars ?? 18_000);
    const completion = await this.llm.completeText({
      messages: [
        {
          role: 'system',
          content: [
            'Eres un investigador que sintetiza notas personales en Obsidian.',
            'Devuelve Markdown en español, sin frontmatter ni bloques de código.',
            'Estructura exacta:',
            '# <Título del estudio>',
            '## Resumen',
            '## Temas principales',
            '## Conexiones',
            '## Preguntas abiertas',
            'Cita las notas originales con wikilinks [[Título]].',
            'No inventes información que no esté en las notas.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Tema solicitado: ${trimmed}\n\nNotas disponibles:\n${context}`,
        },
      ],
      inputChars: trimmed.length,
      temperature: 0.3,
    });

    const title = extractTitle(completion.value) ?? `Estudio: ${trimmed}`;
    const day = new Date().toISOString().slice(0, 10);
    await mkdir(this.config.studiesDir, { recursive: true });
    const target = await uniquePath(this.config.studiesDir, `${day}-cluster-${slugify(trimmed)}`);

    const content = matter.stringify(`${completion.value.trim()}\n`, {
      title,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      source: 'cluster',
      tags: ['cluster', slugify(trimmed)],
      topic: trimmed,
      notes_used: dedupePaths(hits),
    });

    const tmp = `${target}.tmp-${randomUUID()}`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, target);
    await this.indexer?.indexFile(target).catch(() => undefined);

    return { path: target, title, noteCount: dedupePaths(hits).length, content: completion.value.trim() };
  }
}

function buildContext(hits: { title: string; notePath: string; text: string }[], maxChars: number): string {
  const parts: string[] = [];
  let used = 0;
  hits.forEach((hit, index) => {
    const block = `[${index + 1}] ${hit.title} (${hit.notePath})\n${hit.text}`;
    if (used + block.length > maxChars) return;
    parts.push(block);
    used += block.length + 2;
  });
  return parts.join('\n\n');
}

function dedupePaths(hits: { notePath: string }[]): string[] {
  return [...new Set(hits.map((hit) => hit.notePath))];
}

function extractTitle(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}
