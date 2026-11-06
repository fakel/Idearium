import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { slugify, truncate } from '../lib/text.js';
import type { Embedder } from './embedding.service.js';
import type { VectorStore } from './vector.service.js';

export interface NoteSelectorConfig {
  vaultPath: string;
  /** Maximum number of notes selected for a topic. */
  maxNotes?: number;
  /** Maximum characters of note body loaded for the LLM. */
  maxChars?: number;
}

export type SelectionMode = 'explicit' | 'topic';

export interface NoteRef {
  title: string;
  path: string;
  relativePath: string;
  tags: string[];
  category: string;
  type?: string;
  noteNumber?: number;
}

export interface NoteContext extends NoteRef {
  content: string;
  truncated: boolean;
}

export interface NoteSelection {
  mode: SelectionMode;
  /** Notes in the order they should be presented. */
  notes: NoteRef[];
  /** Exact titles/paths that could not be resolved (explicit mode only). */
  unresolved: string[];
  /** Cleaned expression used for display and semantic search. */
  query: string;
}

export interface ParsedSelection {
  query: string;
  parts: string[];
  explicit: boolean;
}

const prefixPatterns = [
  /^palacio\s+de\s+(?:la\s+)?memoria\s*(?:de\s+|del\s+|para\s+)?/i,
  /^palacio\s+de\s+memoria\s*(?:de\s+|del\s+|para\s+)?/i,
  /^quiz\s*(?:sobre|acerca\s+de|de|del)\s*/i,
  /^quiz\s+/i,
  /^(?:sobre|acerca\s+de)\s+/i,
];

const notesPrefixPattern = /^(?:las?\s+)?notas?\s*(?:de\s+|del\s+|sobre\s+)?/i;
const procedurePrefixPattern = /^(?:todos?\s+los?\s+)?pasos?\s+(?:de\s+|del\s+)?/i;

/**
 * Remove command-like wording from a natural-language request.
 * Keeps the meaningful topic/title text.
 */
export function cleanSelectionExpression(input: string): string {
  let value = input.trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of prefixPatterns) {
      const next = value.replace(pattern, '').trim();
      if (next !== value) {
        value = next;
        changed = true;
      }
    }
    const withoutNotes = value.replace(notesPrefixPattern, '').trim();
    if (withoutNotes !== value) {
      value = withoutNotes;
      changed = true;
    }
    const withoutProcedure = value.replace(procedurePrefixPattern, '').trim();
    if (withoutProcedure !== value) {
      value = withoutProcedure;
      changed = true;
    }
  }

  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Split an explicit note list ("A, B y C") while keeping quoted titles intact.
 * `explicit` is false when there is no list separator, so the expression can be
 * treated as a semantic topic.
 */
export function parseSelectionExpression(input: string): ParsedSelection {
  const query = cleanSelectionExpression(input);
  const quotes: string[] = [];
  const protectedQuery = query.replace(/["“”']([^"“”']+)["“”']/g, (_, inner: string) => {
    quotes.push(inner.trim());
    return `\u0000${quotes.length - 1}\u0000`;
  });

  const pieces = protectedQuery
    .split(/\s*(?:,|;|\s+y\s+|\s+e\s+)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\u0000(\d+)\u0000/g, (_, index: string) => quotes[Number(index)] ?? ''));

  const explicit = pieces.length > 1 || quotes.length > 0;
  return { query, parts: pieces.length > 0 ? pieces : [query], explicit };
}

function normalizeLookup(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\[\[|\]\]/g, '')
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class NoteSelectorService {
  private readonly maxNotes: number;
  private readonly maxChars: number;

  constructor(
    private readonly config: NoteSelectorConfig,
    private readonly vector: VectorStore,
    private readonly embedder: Embedder,
  ) {
    this.maxNotes = Math.max(1, config.maxNotes ?? 5);
    this.maxChars = Math.max(1_000, config.maxChars ?? 24_000);
  }

  async select(expression: string): Promise<NoteSelection> {
    const parsed = parseSelectionExpression(expression);
    if (!parsed.query) {
      throw new Error('Indica una nota o un tema.');
    }

    if (parsed.explicit) {
      const notes: NoteRef[] = [];
      const unresolved: string[] = [];
      for (const part of parsed.parts) {
        const ref = await this.resolveExplicit(part);
        if (ref) notes.push(ref);
        else unresolved.push(part);
      }
      return { mode: 'explicit', notes: dedupeNotes(notes), unresolved, query: parsed.query };
    }

    const exact = await this.resolveExplicit(parsed.query);
    if (exact) {
      return { mode: 'explicit', notes: [exact], unresolved: [], query: parsed.query };
    }

    // Un número que no existe no es un tema: evita que el quiz empiece con
    // notas arbitrarias por una búsqueda semántica de "7".
    if (/^#?\d{1,9}$/.test(parsed.query)) {
      return { mode: 'explicit', notes: [], unresolved: [parsed.query], query: parsed.query };
    }

    return this.selectByTopic(parsed.query);
  }

  /** Load note bodies with a per-note and total character budget. */
  async load(notes: NoteRef[]): Promise<NoteContext[]> {
    if (notes.length === 0) return [];

    const perNote = Math.max(500, Math.floor(this.maxChars / notes.length));
    const contexts: NoteContext[] = [];

    for (const note of notes) {
      try {
        const raw = await readFile(note.path, 'utf8');
        const body = matter(raw).content.trim();
        const content = truncate(body, perNote);
        contexts.push({ ...note, content, truncated: body.length > perNote });
      } catch {
        // A file deleted between selection and loading should not abort the rest.
      }
    }

    return contexts;
  }

  async selectAndLoad(expression: string): Promise<{ selection: NoteSelection; contexts: NoteContext[] }> {
    const selection = await this.select(expression);
    const contexts = await this.load(selection.notes);
    return { selection, contexts };
  }

  /** Exact match by title, filename, relative path or slug. */
  async resolveExplicit(target: string): Promise<NoteRef | null> {
    const trimmed = target.trim();
    if (!trimmed) return null;

    const numeric = /^#?(\d{1,9})$/.exec(trimmed);
    if (numeric) {
      const wanted = Number(numeric[1]);
      const notes = await this.listNotes();
      return notes.find((note) => note.noteNumber === wanted) ?? null;
    }

    if (trimmed.endsWith('.md')) {
      const absolute = path.isAbsolute(trimmed) ? trimmed : path.resolve(this.config.vaultPath, trimmed);
      return this.readRef(absolute).catch(() => null);
    }

    const wanted = normalizeLookup(trimmed);
    if (!wanted) return null;

    const notes = await this.listNotes();
    const candidates = [
      (note: NoteRef) => normalizeLookup(note.title),
      (note: NoteRef) => normalizeLookup(path.basename(note.path, '.md')),
      (note: NoteRef) => normalizeLookup(note.relativePath),
      (note: NoteRef) => normalizeLookup(slugify(note.title)),
    ];

    for (const candidate of candidates) {
      const found = notes.find((note) => candidate(note) === wanted);
      if (found) return found;
    }

    return null;
  }

  private async selectByTopic(topic: string): Promise<NoteSelection> {
    const [vector] = await this.embedder.embed([topic]);
    if (!vector) throw new Error('No se pudo generar el embedding de la búsqueda.');

    const hits = await this.vector.search(vector, Math.max(12, this.maxNotes * 4));
    if (hits.length === 0) {
      return { mode: 'topic', notes: [], unresolved: [], query: topic };
    }

    const grouped = new Map<string, { bestDistance: number; chunks: number; title: string; tags: string[]; category: string }>();
    for (const hit of hits) {
      const current = grouped.get(hit.notePath);
      if (!current) {
        grouped.set(hit.notePath, {
          bestDistance: hit.distance,
          chunks: 1,
          title: hit.title,
          tags: hit.tags,
          category: hit.category,
        });
      } else {
        current.bestDistance = Math.min(current.bestDistance, hit.distance);
        current.chunks += 1;
      }
    }

    const ranked = [...grouped.entries()]
      .sort((a, b) => a[1].bestDistance - b[1].bestDistance || b[1].chunks - a[1].chunks)
      .slice(0, this.maxNotes);

    const notes: NoteRef[] = [];
    for (const [notePath, meta] of ranked) {
      const ref = await this.readRef(notePath).catch(() => null);
      if (!ref || ref.type === 'palacio') continue;
      notes.push({ ...ref, title: ref.title || meta.title, tags: ref.tags.length ? ref.tags : meta.tags, category: ref.category || meta.category });
    }

    return { mode: 'topic', notes, unresolved: [], query: topic };
  }

  async listNotes(): Promise<NoteRef[]> {
    const root = path.resolve(this.config.vaultPath);
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter(
        (file) =>
          !file.includes(`${path.sep}.obsidian${path.sep}`) &&
          !file.includes(`${path.sep}.trash${path.sep}`),
      );

    const notes: NoteRef[] = [];
    for (const file of files) {
      const ref = await this.readRef(file).catch(() => null);
      if (ref) notes.push(ref);
    }
    return notes;
  }

  private async readRef(file: string): Promise<NoteRef> {
    const raw = await readFile(file, 'utf8');
    const parsed = matter(raw);
    const relativePath = path.relative(this.config.vaultPath, file);
    const title =
      typeof parsed.data.title === 'string' && parsed.data.title.trim()
        ? parsed.data.title.trim()
        : path.basename(file, '.md');
    const fromData = Number(parsed.data.note_number);
    const fromName = /^(\d{4,})-.+-\d{6}$/.exec(path.basename(file, '.md'));
    const noteNumber =
      Number.isSafeInteger(fromData) && fromData > 0
        ? fromData
        : fromName
          ? Number(fromName[1])
          : undefined;

    return {
      title,
      path: file,
      relativePath,
      tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
      category: typeof parsed.data.category === 'string' ? parsed.data.category : 'otro',
      type: typeof parsed.data.type === 'string' ? parsed.data.type : undefined,
      noteNumber,
    };
  }
}

function dedupeNotes(notes: NoteRef[]): NoteRef[] {
  const seen = new Set<string>();
  return notes.filter((note) => {
    if (seen.has(note.path)) return false;
    seen.add(note.path);
    return true;
  });
}
