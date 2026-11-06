import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { slugify } from '../lib/text.js';
import { assertInsideVault } from '../lib/vault-path.js';
import { uniquePath } from '../lib/unique-path.js';
import type { Embedder } from './embedding.service.js';
import type { TextCompleter } from './rag.service.js';
import type { VectorStore } from './vector.service.js';
import type { Indexer } from './indexer.service.js';
import {
  NoteSelectorService,
  cleanSelectionExpression,
  parseSelectionExpression,
  type NoteContext,
  type NoteRef,
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
  /** Sección completa, por compatibilidad. */
  section: string;
  /** Solo la historia, sin encabezados ni contenido de la nota. */
  story: string;
  combined: boolean;
}

export interface PalaceSummary {
  path: string;
  relativePath: string;
  title: string;
  combined: boolean;
}

export interface NoteContent {
  path: string;
  relativePath: string;
  title: string;
  noteNumber?: number;
  content: string;
}

export interface AffectedPalace {
  path: string;
  title: string;
  /** true si el palacio se borró porque no quedaban notas fuente. */
  deleted: boolean;
  /** Notas fuente que siguen existiendo (solo si no se borró). */
  remainingNotes: string[];
}

export interface NoteDeleteResult {
  path: string;
  relativePath: string;
  title: string;
  noteNumber?: number;
  /** Palacios que apuntaban a la nota borrada. */
  palaces: AffectedPalace[];
}

export interface PalaceDeleteResult {
  path: string;
  title: string;
  /** Notas a las que se les quitó el enlace. */
  references: number;
  /** false si el palacio era una sección dentro de una nota antigua. */
  deletedFile: boolean;
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

  /**
   * Resuelve la expresión a las notas que podrían recibir un palacio.
   * El bot solo permite elegir una; si hay varias, las muestra para que el
   * usuario decida en vez de generar un palacio combinado poco preciso.
   */
  /** Notas normales del vault, sin palacios (esos se listan con /palacio). */
  async listNotes(): Promise<NoteRef[]> {
    const notes = await this.selector.listNotes();
    return notes.filter((note) => note.type !== 'palacio');
  }

  /** Devuelve el cuerpo Markdown de una nota, sin frontmatter. */
  async readNote(target: string): Promise<NoteContent> {
    const ref = await this.selector.resolveExplicit(target);
    if (!ref) {
      throw new Error(
        `No encontré la nota "${target}". Usa su número, el título exacto o la ruta .md.`,
      );
    }

    const root = path.resolve(this.config.vaultPath);
    const resolved = path.resolve(ref.path);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('La nota está fuera del vault.');
    }

    const parsed = matter(await readFile(resolved, 'utf8'));
    return {
      path: resolved,
      relativePath: path.relative(root, resolved),
      title: ref.title,
      noteNumber: ref.noteNumber,
      content: parsed.content.trim(),
    };
  }

  /** Borra una nota normal por número, título exacto o ruta. No borra palacios. */
  async deleteNote(target: string): Promise<NoteDeleteResult> {
    const ref = await this.selector.resolveExplicit(target);
    if (!ref) {
      throw new Error(
        `No encontré la nota "${target}". Usa su número, el título exacto o la ruta .md.`,
      );
    }
    if (ref.type === 'palacio') {
      throw new Error('Eso es un palacio. Bórralo con /palacio rm <número|nota|tema>.');
    }

    const root = path.resolve(this.config.vaultPath);
    const resolved = path.resolve(ref.path);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('La nota está fuera del vault.');
    }

    await unlink(resolved);
    await this.indexer?.removeFile(resolved).catch(() => undefined);
    const palaces = await this.cleanupPalacesAfterNoteDelete(resolved, ref.title);
    return {
      path: resolved,
      relativePath: path.relative(root, resolved),
      title: ref.title,
      noteNumber: ref.noteNumber,
      palaces,
    };
  }

  /**
   * Al borrar una nota, limpia los palacios que la usaban como fuente.
   * Si no quedan fuentes, borra el palacio; si quedan, actualiza su
   * frontmatter y elimina el enlace a la nota borrada.
   */
  private async cleanupPalacesAfterNoteDelete(
    deletedPath: string,
    deletedTitle: string,
  ): Promise<AffectedPalace[]> {
    const root = path.resolve(this.config.vaultPath);
    const relative = path
      .relative(root, deletedPath)
      .replace(/\.md$/i, '')
      .split(path.sep)
      .join('/');
    const basename = path.basename(deletedPath, '.md');
    const notes = await this.listNotes();
    const files = await listMarkdownFiles(root);
    const reports: AffectedPalace[] = [];

    for (const file of files) {
      const raw = await readFile(file, 'utf8').catch(() => null);
      if (!raw) continue;
      const parsed = matter(raw);
      if (parsed.data.type !== 'palacio') continue;

      const sourceTitles = asStringArray(parsed.data.source_notes);
      if (sourceTitles.length === 0) continue;
      if (!sourceTitles.some((title) => normalizeText(title) === normalizeText(deletedTitle))) {
        continue;
      }

      const remainingNotes = sourceTitles.filter((title) =>
        notes.some((note) => normalizeText(note.title) === normalizeText(title)),
      );

      const title =
        typeof parsed.data.title === 'string' ? parsed.data.title : path.basename(file, '.md');

      if (remainingNotes.length === 0) {
        await this.removePalaceReferences(file);
        await unlink(file);
        await this.indexer?.removeFile(file).catch(() => undefined);
        reports.push({ path: file, title, deleted: true, remainingNotes: [] });
        continue;
      }

      const content = removeSourceNoteLines(parsed.content, relative, basename, deletedTitle);
      const updated = matter.stringify(content, {
        ...parsed.data,
        source_notes: remainingNotes,
        updated: new Date().toISOString(),
      });
      await this.writeAtomic(file, updated);
      await this.indexer?.indexFile(file, { force: true }).catch(() => undefined);
      reports.push({ path: file, title, deleted: false, remainingNotes });
    }

    return reports;
  }

  async candidates(expression: string): Promise<NoteRef[]> {
    const trimmed = expression.trim();
    if (!trimmed) throw new Error('Indica una nota o un tema.');
    const parsed = parseSelectionExpression(trimmed);
    if (parsed.parts.length > 1) {
      throw new Error(
        'Solo puedo crear un palacio de una nota a la vez. Escribe una sola nota o elige una de la lista.',
      );
    }

    const selection = await this.selector.select(trimmed);
    if (selection.unresolved.length > 0) {
      throw new Error(
        `No encontré estas notas: ${selection.unresolved.join(', ')}. Usa el título exacto, el número de nota o la ruta .md.`,
      );
    }
    return selection.notes.filter((note) => note.type !== 'palacio');
  }

  async run(expression: string): Promise<MemorizeResult> {
    const trimmed = expression.trim();
    if (!trimmed) throw new Error('Indica una nota o un tema.');

    const selection = await this.selector.select(trimmed);
    if (selection.mode === 'explicit' && selection.unresolved.length > 0) {
      throw new Error(`No encontré estas notas: ${selection.unresolved.join(', ')}. Usa el título exacto, el número de nota o la ruta .md.`);
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
    const completion = await this.llm.completeText({
      messages: [
        {
          role: 'system',
          content: [
            'Eres un experto en mnemotecnia y el método de loci (palacio de la memoria).',
            'Crea un palacio mínimo, directo y fácil de recorrer para esta nota.',
            'Devuelve SOLO la historia, en español, sin títulos, secciones ni listas de imágenes.',
            'Formato: 4 a 6 escenas numeradas. Cada escena debe tener un lugar concreto, la idea esencial que se guarda allí y una imagen absurda que la fije; máximo 2 frases por escena.',
            'No repitas ni resumas la nota completa: destila solo lo que hay que recordar.',
            'No inventes datos que no estén en la nota.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Nota: ${note.title}\n\n${note.content}`,
        },
      ],
      inputChars: note.content.length,
      temperature: 0.4,
    });

    const story = compactPalaceStory(completion.value);
    if (!story) throw new Error('El modelo no devolvió una historia para el palacio. Inténtalo de nuevo.');

    const title = `Palacio — ${note.title}`;
    const target = await this.writePalaceNote(title, story, [note], note.truncated, new Date());
    await this.addPalaceLink(note.path, target, title);

    return {
      path: target,
      title,
      created: true,
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

    const completion = await this.llm.completeText({
      messages: [
        {
          role: 'system',
          content: [
            'Eres un experto en mnemotecnia y el método de loci (palacio de la memoria).',
            'Crea UN único recorrido mínimo para recordar varias notas relacionadas.',
            'Devuelve SOLO la historia, en español, sin títulos, secciones ni listas de imágenes.',
            'Formato: 5 a 7 escenas numeradas. Cada escena debe tener un lugar concreto, la idea esencial y una imagen absurda que la fije; máximo 2 frases por escena.',
            'Puedes citar [[Título]] al final de una escena, pero no repitas el contenido de las notas ni copies párrafos.',
            'Integra las ideas en un solo recorrido; no hagas un palacio separado por nota.',
            'No inventes datos que no estén en las notas. Si falta información, dilo en una sola frase.',
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
      temperature: 0.4,
    });

    const story = compactPalaceStory(completion.value);
    if (!story) throw new Error('El modelo no devolvió una historia para el palacio. Inténtalo de nuevo.');

    const target = await this.writePalaceNote(title, story, contexts, truncated, now);
    await Promise.all(contexts.map((context) => this.addPalaceLink(context.path, target, title)));

    return {
      path: target,
      title,
      created: true,
      combined: true,
      noteCount: contexts.length,
      notes: contexts.map((context) => context.title),
    };
  }

  private async writePalaceNote(
    title: string,
    story: string,
    contexts: NoteContext[],
    truncated: boolean,
    now: Date,
  ): Promise<string> {
    await mkdir(this.palacesDir, { recursive: true });
    const day = now.toISOString().slice(0, 10);
    const label = title.replace(/^Palacio — /, '');
    const target = await uniquePath(this.palacesDir, `${day}-palacio-${slugify(label)}`);
    const sources = contexts
      .map((context) => `- ${this.wikilink(context.path, context.title)} (${context.relativePath})`)
      .join('\n');
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
      story,
      '',
    ].join('\n');

    await this.writeAtomic(target, matter.stringify(body, frontmatter));
    await this.indexer?.indexFile(target, { force: true }).catch(() => undefined);
    return target;
  }

  /** En la nota original solo queda un enlace al palacio, nunca el texto completo. */
  private async addPalaceLink(notePath: string, palacePath: string, title: string): Promise<void> {
    const raw = await readFile(notePath, 'utf8').catch(() => null);
    if (!raw) return;

    const link = this.wikilink(palacePath, title);
    const existing = extractSection(raw, 'Palacio de la memoria');
    const body = existing ? existing.split('\n').slice(1).join('\n').trim() : '';
    const links = isLinkOnly(body)
      ? body.split('\n').map((line) => line.trim()).filter(Boolean)
      : [];
    if (links.some((line) => line.includes(link))) return;

    links.push(link);
    const section = `## Palacio de la memoria\n\n${links.join('\n')}\n`;
    const updated = replaceSection(raw, 'Palacio de la memoria', section);
    if (updated === raw) return;

    await this.writeAtomic(notePath, updated);
    await this.indexer?.indexFile(notePath, { force: true }).catch(() => undefined);
  }

  private wikilink(file: string, label: string): string {
    const relative = path
      .relative(this.config.vaultPath, file)
      .replace(/\.md$/i, '')
      .split(path.sep)
      .join('/');
    return `[[${relative}|${label.replace(/[|\]]/g, '')}]]`;
  }

  private async writeAtomic(file: string, content: string): Promise<void> {
    await assertInsideVault(this.config.vaultPath, file);
    const tmp = `${file}.tmp-${randomUUID()}`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
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
      return assertInsideVault(this.config.vaultPath, absolute);
    }
    const exact = await this.selector.resolveExplicit(target).catch(() => null);
    return exact?.path ?? null;
  }

  private async readPalaceFile(file: string, depth = 0): Promise<PalaceSection | null> {
    const safeFile = await assertInsideVault(this.config.vaultPath, file);
    const original = await readFile(safeFile, 'utf8').catch(() => null);
    if (!original) return null;
    const section = extractSection(original, 'Palacio de la memoria');
    if (!section) return null;

    const body = section.split('\n').slice(1).join('\n').trim();
    if (isLinkOnly(body) && depth < 2) {
      const linked = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(body)?.[1];
      if (linked) {
        const linkPath = linked.replace(/\.md$/i, '').trim();
        const absolute = path.isAbsolute(linkPath)
          ? linkPath
          : path.resolve(this.config.vaultPath, linkPath);
        const target = `${absolute}.md`;
        if (target !== safeFile) {
          const followed = await this.readPalaceFile(target, depth + 1);
          if (followed) return followed;
        }
      }
    }

    const parsed = matter(original);
    const title =
      typeof parsed.data.title === 'string' ? parsed.data.title : path.basename(safeFile, '.md');
    return {
      path: safeFile,
      title,
      section,
      story: compactPalaceStory(body),
      combined: parsed.data.type === 'palacio',
    };
  }

  async listPalaces(): Promise<PalaceSummary[]> {
    const files = await listMarkdownFiles(this.config.vaultPath);
    const palaces: PalaceSummary[] = [];

    for (const file of files) {
      try {
        const raw = await readFile(file, 'utf8');
        const section = extractSection(raw, 'Palacio de la memoria');
        if (!section) continue;
        const parsed = matter(raw);
        const body = section.split('\n').slice(1).join('\n').trim();
        if (parsed.data.type !== 'palacio' && isLinkOnly(body)) continue;
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

  async deletePalace(target: string): Promise<PalaceDeleteResult> {
    const palace = await this.readPalace(target);
    if (!palace) throw new Error(`No encontré el palacio "${target}".`);

    const inPalaces = path
      .resolve(palace.path)
      .startsWith(`${path.resolve(this.palacesDir)}${path.sep}`);
    if (!inPalaces) {
      const raw = await readFile(palace.path, 'utf8');
      const section = extractSection(raw, 'Palacio de la memoria');
      if (!section) throw new Error(`No encontré el palacio "${target}".`);
      await this.writeAtomic(palace.path, removeSection(raw, 'Palacio de la memoria'));
      await this.indexer?.indexFile(palace.path, { force: true }).catch(() => undefined);
      return { path: palace.path, title: palace.title, references: 0, deletedFile: false };
    }

    const references = await this.removePalaceReferences(palace.path);
    await unlink(palace.path);
    await this.indexer?.removeFile(palace.path).catch(() => undefined);
    return { path: palace.path, title: palace.title, references, deletedFile: true };
  }

  private async removePalaceReferences(palacePath: string): Promise<number> {
    const relative = path
      .relative(this.config.vaultPath, palacePath)
      .replace(/\.md$/i, '')
      .split(path.sep)
      .join('/');
    const basename = path.basename(palacePath, '.md');
    const files = await listMarkdownFiles(this.config.vaultPath);
    let changed = 0;

    for (const file of files) {
      if (path.resolve(file) === path.resolve(palacePath)) continue;
      const raw = await readFile(file, 'utf8').catch(() => null);
      if (!raw) continue;
      const section = extractSection(raw, 'Palacio de la memoria');
      if (!section) continue;

      const lines = section.split('\n').slice(1);
      const kept = lines.filter((line) => !lineTargetsPalace(line, relative, basename));
      if (kept.length === lines.length) continue;

      const body = kept.join('\n').trim();
      const updated = body
        ? replaceSection(raw, 'Palacio de la memoria', `## Palacio de la memoria\n\n${body}\n`)
        : removeSection(raw, 'Palacio de la memoria');
      await this.writeAtomic(file, updated);
      await this.indexer?.indexFile(file, { force: true }).catch(() => undefined);
      changed += 1;
    }

    return changed;
  }
}

function removeSourceNoteLines(
  markdown: string,
  relative: string,
  basename: string,
  title: string,
): string {
  const section = extractSection(markdown, 'Notas fuente');
  if (!section) return markdown;
  const lines = section.split('\n');
  const kept = lines.filter(
    (line, index) => index === 0 || !lineTargetsNote(line, relative, basename, title),
  );
  if (kept.length === lines.length) return markdown;
  return replaceSection(markdown, 'Notas fuente', kept.join('\n').trimEnd());
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function lineTargetsNote(
  line: string,
  relative: string,
  basename: string,
  title: string,
): boolean {
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  for (const match of line.matchAll(pattern)) {
    const target = match[1]!.trim().replace(/\.md$/i, '');
    const label = match[2]?.trim();
    if (target === relative || target === basename || target.endsWith(`/${basename}`)) return true;
    if (label && normalizeText(label) === normalizeText(title)) return true;
  }
  return false;
}

function lineTargetsPalace(line: string, relative: string, basename: string): boolean {
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  for (const match of line.matchAll(pattern)) {
    const target = match[1]!.trim().replace(/\.md$/i, '');
    if (target === relative || target === basename || target.endsWith(`/${basename}`)) return true;
  }
  return false;
}

function removeSection(markdown: string, heading: string): string {
  const section = extractSection(markdown, heading);
  if (!section) return markdown;
  return `${markdown.replace(section, '').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function isLinkOnly(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^(?:[-*]\s*)?\[\[[^\]]+\]\]$/.test(line));
}

function selectionLabel(selection: NoteSelection): string {
  if (selection.mode === 'topic') return selection.query;
  const titles = selection.notes.map((note) => note.title);
  if (titles.length <= 3) return titles.join(', ');
  return `${titles.slice(0, 3).join(', ')} y ${titles.length - 3} más`;
}

/** Recorta el palacio a una historia breve: sin encabezados ni volcado de la nota. */
export function compactPalaceStory(value: string, maxChars = 1800): string {
  const text = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*#{1,6}\s+/.test(line) && !/^\s*```/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length <= maxChars) return text;

  const cut = text.slice(0, maxChars);
  const lastBreak = Math.max(
    cut.lastIndexOf('\n'),
    cut.lastIndexOf('. '),
    cut.lastIndexOf('; '),
  );
  const end = lastBreak >= Math.floor(maxChars * 0.6) ? lastBreak + 1 : maxChars;
  return `${cut.slice(0, end).trimEnd()}…`;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
