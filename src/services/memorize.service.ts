import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { slugify } from '../lib/text.js';
import type { Embedder } from './embedding.service.js';
import type { TextCompleter } from './rag.service.js';
import type { VectorStore } from './vector.service.js';
import type { Indexer } from './indexer.service.js';
import {
  NoteSelectorService,
  cleanSelectionExpression,
  type NoteContext,
  type NoteSelection,
} from './note-selector.service.js';

export interface MemorizeConfig {
  vaultPath: string;
  /** Defaults to <vault>/Palacios. */
  palacesDir?: string;
  maxNotes?: number;
  maxChars?: number;
}

export interface MemorizeResult {
  path: string;
  title: string;
  created: boolean;
  combined: boolean;
  noteCount: number;
  notes: string[];
}

export interface PalaceSection {
  path: string;
  title: string;
  section: string;
  combined: boolean;
}

export interface PalaceSummary {
  path: string;
  relativePath: string;
  title: string;
  combined: boolean;
}

export class MemorizeService {
  private readonly selector: NoteSelectorService;
  private readonly palacesDir: string;

  constructor(
    private readonly config: MemorizeConfig,
    private readonly vector: VectorStore,
    private readonly embedder: Embedder,
    private readonly llm: TextCompleter,
    private readonly indexer?: Indexer,
    selector?: NoteSelectorService,
  ) {
    this.selector =
      selector ??
      new NoteSelectorService(
        { vaultPath: config.vaultPath, maxNotes: config.maxNotes, maxChars: config.maxChars },
        vector,
        embedder,
      );
    this.palacesDir = config.palacesDir ?? path.join(config.vaultPath, 'Palacios');
  }

  async run(expression: string): Promise<MemorizeResult> {
    const trimmed = expression.trim();
    if (!trimmed) throw new Error('Indica una nota o un tema.');

    const selection = await this.selector.select(trimmed);
    if (selection.mode === 'explicit' && selection.unresolved.length > 0) {
      throw new Error(`No encontré estas notas: ${selection.unresolved.join(', ')}. Usa el título exacto o la ruta .md.`);
    }

    const contexts = await this.selector.load(selection.notes);
    if (contexts.length === 0) {
      throw new Error(
        selection.mode === 'topic'
          ? `No encontré notas relacionadas con "${selection.query}".`
          : `No encontré la nota "${selection.query}".`,
      );
    }

    if (contexts.length === 1) {
      return this.runSingle(contexts[0]!);
    }
    return this.runCombined(selection, contexts);
  }

  private async runSingle(note: NoteContext): Promise<MemorizeResult> {
    const original = await readFile(note.path, 'utf8');
    const completion = await this.llm.completeText({
      messages: [
        {
          role: 'system',
          content: [
            'Eres un experto en mnemotecnia y el método de loci (palacio de la memoria).',
            'Diseña un recorrido físico concreto y vívido para memorizar el contenido de la nota.',
            'Devuelve SOLO Markdown, en español, con esta estructura:',
            '### Ruta física',
            'Lista numerada de 5 a 10 lugares concretos con lo que se visualiza en cada uno.',
            '### Imágenes',
            'Asociaciones absurdas y memorables para cada idea clave.',
            '### Repaso',
            '3 preguntas de autoevaluación con su respuesta.',
            'No repitas la nota completa ni inventes datos que no estén en ella.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Nota: ${note.title}\n\n${note.content}`,
        },
      ],
      inputChars: note.content.length,
      temperature: 0.6,
    });

    const section = `## Palacio de la memoria\n\n${completion.value.trim()}\n`;
    const updatedContent = replaceSection(original, 'Palacio de la memoria', section);
    const tmp = `${note.path}.tmp-${randomUUID()}`;
    await writeFile(tmp, updatedContent, 'utf8');
    await rename(tmp, note.path);
    await this.indexer?.indexFile(note.path, { force: true }).catch(() => undefined);

    return {
      path: note.path,
      title: note.title,
      created: !original.includes('## Palacio de la memoria'),
      combined: false,
      noteCount: 1,
      notes: [note.title],
    };
  }

  private async runCombined(selection: NoteSelection, contexts: NoteContext[]): Promise<MemorizeResult> {
    const label = selectionLabel(selection).slice(0, 120);
    const title = `Palacio — ${label}`;
    const now = new Date();
    const truncated = contexts.some((context) => context.truncated);
    const sources = contexts
      .map((context) => `- [[${context.title}]] (${context.relativePath})`)
      .join('\n');

    const completion = await this.llm.completeText({
      messages: [
        {
          role: 'system',
          content: [
            'Eres un experto en mnemotecnia y el método de loci (palacio de la memoria).',
            'Debes diseñar UN solo recorrido físico coherente que integre varias notas relacionadas.',
            'Devuelve SOLO Markdown, en español, con esta estructura:',
            '### Ruta física',
            'Lista numerada de 7 a 12 lugares concretos; en cada uno indica qué idea de qué nota se visualiza y cita [[Título]].',
            '### Imágenes',
            'Asociaciones absurdas y memorables para conectar las ideas entre notas.',
            '### Repaso',
            '3 a 5 preguntas de autoevaluación con su respuesta.',
            'No inventes datos que no estén en las notas. Si falta información, dilo.',
            'Integra las notas en un recorrido único; no hagas un palacio separado por nota.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Objetivo: ${label}`,
            truncated ? 'Aviso: el contexto se recortó por límite de tamaño; usa solo lo disponible.' : '',
            '',
            'Notas fuente:',
            ...contexts.map(
              (context, index) =>
                `--- NOTA ${index + 1}: [[${context.title}]] (${context.relativePath}) ---\n${context.content}`,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      inputChars: contexts.reduce((total, context) => total + context.content.length, 0),
      temperature: 0.6,
    });

    await mkdir(this.palacesDir, { recursive: true });
    const day = now.toISOString().slice(0, 10);
    const target = await uniquePath(this.palacesDir, `${day}-palacio-${slugify(label)}`);
    const frontmatter = {
      id: randomUUID(),
      title,
      type: 'palacio',
      category: 'aprendizaje',
      tags: ['palacio', 'memoria'],
      created: now.toISOString(),
      updated: now.toISOString(),
      source_notes: contexts.map((context) => context.title),
    };
    const body = [
      `# ${title}`,
      '',
      '## Notas fuente',
      '',
      sources,
      '',
      ...(truncated
        ? ['> El contexto se recortó por el límite configurado; el palacio cubre solo el contenido disponible.', '']
        : []),
      '## Palacio de la memoria',
      '',
      completion.value.trim(),
      '',
    ].join('\n');

    const tmp = `${target}.tmp-${randomUUID()}`;
    await writeFile(tmp, matter.stringify(body, frontmatter), 'utf8');
    await rename(tmp, target);
    await this.indexer?.indexFile(target, { force: true }).catch(() => undefined);

    return {
      path: target,
      title,
      created: true,
      combined: true,
      noteCount: contexts.length,
      notes: contexts.map((context) => context.title),
    };
  }

  async readPalace(target: string): Promise<PalaceSection | null> {
    const trimmed = target.trim();
    if (!trimmed) throw new Error('Indica una nota o un tema.');

    const exact = await this.resolveExactTarget(trimmed);
    if (exact) {
      const found = await this.readPalaceFile(exact);
      if (found) return found;
    }

    const cleaned = cleanSelectionExpression(trimmed);
    const wanted = normalizeText(cleaned || trimmed);
    const palaces = await this.listPalaces();

    const byTitle = palaces.find(
      (palace) =>
        normalizeText(palace.title) === wanted ||
        normalizeText(palace.title).includes(wanted) ||
        wanted.includes(normalizeText(palace.title)),
    );
    if (byTitle) return this.readPalaceFile(byTitle.path);

    // Fallback: semantic search, preferring combined palaces.
    const [vector] = await this.embedder.embed([cleaned || trimmed]).catch(() => []);
    if (vector) {
      const hits = await this.vector.search(vector, 20).catch(() => []);
      const paths = new Set(palaces.map((palace) => palace.path));
      for (const hit of hits) {
        if (!paths.has(hit.notePath)) continue;
        const found = await this.readPalaceFile(hit.notePath);
        if (found) return found;
      }
    }

    return null;
  }

  private async resolveExactTarget(target: string): Promise<string | null> {
    if (target.endsWith('.md')) {
      const absolute = path.isAbsolute(target) ? target : path.resolve(this.config.vaultPath, target);
      return absolute;
    }
    const exact = await this.selector.resolveExplicit(target).catch(() => null);
    return exact?.path ?? null;
  }

  private async readPalaceFile(file: string): Promise<PalaceSection | null> {
    const original = await readFile(file, 'utf8').catch(() => null);
    if (!original) return null;
    const section = extractSection(original, 'Palacio de la memoria');
    if (!section) return null;
    const parsed = matter(original);
    const title =
      typeof parsed.data.title === 'string' ? parsed.data.title : path.basename(file, '.md');
    return {
      path: file,
      title,
      section,
      combined: parsed.data.type === 'palacio',
    };
  }

  async listPalaces(): Promise<PalaceSummary[]> {
    const files = await listMarkdownFiles(this.config.vaultPath);
    const palaces: PalaceSummary[] = [];

    for (const file of files) {
      try {
        const raw = await readFile(file, 'utf8');
        if (!extractSection(raw, 'Palacio de la memoria')) continue;
        const parsed = matter(raw);
        const title =
          typeof parsed.data.title === 'string' ? parsed.data.title : path.basename(file, '.md');
        palaces.push({
          path: file,
          relativePath: path.relative(this.config.vaultPath, file),
          title,
          combined: parsed.data.type === 'palacio',
        });
      } catch {
        // Un archivo ilegible no debe romper el listado.
      }
    }

    return palaces.sort((a, b) => a.title.localeCompare(b.title, 'es'));
  }
}

function selectionLabel(selection: NoteSelection): string {
  if (selection.mode === 'topic') return selection.query;
  const titles = selection.notes.map((note) => note.title);
  if (titles.length <= 3) return titles.join(', ');
  return `${titles.slice(0, 3).join(', ')} y ${titles.length - 3} más`;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function uniquePath(directory: string, base: string): Promise<string> {
  for (let index = 1; index <= 100; index += 1) {
    const candidate = path.join(directory, index === 1 ? `${base}.md` : `${base}-${index}.md`);
    try {
      await readFile(candidate, 'utf8');
    } catch {
      return candidate;
    }
  }
  throw new Error(`No se pudo encontrar un nombre libre para ${base}.md`);
}

/** Return an H2 section (heading + body) or null when it does not exist. */
export function extractSection(markdown: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, 'm').exec(markdown);
  if (!match) return null;

  const start = match.index;
  const after = markdown.slice(start + match[0].length);
  const nextHeading = after.search(/^##\s+/m);
  const end = nextHeading === -1 ? markdown.length : start + match[0].length + nextHeading;
  return markdown.slice(start, end).trim();
}

/** List Markdown files under the vault, ignoring Obsidian internals. */
async function listMarkdownFiles(root: string): Promise<string[]> {
  const absoluteRoot = path.resolve(root);
  const entries = await readdir(absoluteRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter(
      (file) =>
        !file.includes(`${path.sep}.obsidian${path.sep}`) &&
        !file.includes(`${path.sep}.trash${path.sep}`),
    );
}

/** Replace an H2 section (heading + body) or append it at the end. */
export function replaceSection(markdown: string, heading: string, section: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^##\\s+${escaped}\\s*$`, 'm');
  const match = pattern.exec(markdown);

  if (!match) {
    return `${markdown.trimEnd()}\n\n${section}`;
  }

  const start = match.index;
  const after = markdown.slice(start + match[0].length);
  const nextHeading = after.search(/^##\s+/m);
  const end = nextHeading === -1 ? markdown.length : start + match[0].length + nextHeading;
  return `${markdown.slice(0, start)}${section}\n${markdown.slice(end).trimStart()}`.trimEnd() + '\n';
}
