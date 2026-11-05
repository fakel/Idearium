import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { slugify } from '../lib/text.js';
import type { NoteDigest } from '../schemas/noteDigest.schema.js';
import type { NoteFrontmatter } from '../schemas/note.schema.js';

export type NoteSource = NoteFrontmatter['source'];

export interface WriteNoteInput {
  digest: NoteDigest;
  source: NoteSource;
  transcript: string;
  audioFile?: string;
  documentFile?: string;
  /** Carpeta destino relativa al vault. Si se omite, usa notesDir. */
  subdir?: string;
  now?: Date;
}

export interface WrittenNote {
  id: string;
  path: string;
  relativePath: string;
  fileName: string;
  title: string;
  tags: string[];
  created: string;
}

export interface ObsidianConfig {
  vaultPath: string;
  notesDir: string;
}

export class ObsidianService {
  constructor(private readonly config: ObsidianConfig) {}

  render(input: WriteNoteInput): { content: string; frontmatter: NoteFrontmatter; body: string } {
    const now = input.now ?? new Date();
    const created = now.toISOString();
    const frontmatter: NoteFrontmatter = {
      id: randomUUID(),
      title: input.digest.title,
      summary: input.digest.summary,
      category: input.digest.category,
      tags: input.digest.tags,
      created,
      updated: created,
      source: input.source,
      language: input.digest.language,
      ...(input.audioFile ? { audio_file: input.audioFile } : {}),
      ...(input.documentFile ? { document_file: input.documentFile } : {}),
    };

    const ideas = input.digest.key_ideas.map((idea) => `- ${idea}`).join('\n');
    const actions = input.digest.action_items.map((item) => `- [ ] ${item}`).join('\n');

    const body = [
      `# ${input.digest.title}`,
      '',
      '## Resumen',
      '',
      input.digest.summary,
      '',
      '## Ideas clave',
      '',
      ideas,
      '',
      '## Acciones',
      '',
      actions || '_Sin acciones pendientes._',
      '',
      '## Transcripción',
      '',
      input.transcript.trim(),
      '',
    ].join('\n');

    return { content: matter.stringify(body, frontmatter), frontmatter, body };
  }

  async write(input: WriteNoteInput): Promise<WrittenNote> {
    const { content, frontmatter } = this.render(input);
    const destination = this.resolveDestination(input.subdir);
    await mkdir(destination, { recursive: true });

    const day = (input.now ?? new Date()).toISOString().slice(0, 10);
    const base = `${day}-${slugify(input.digest.title)}`;
    const target = await this.uniquePath(destination, base);

    const tmp = `${target}.tmp-${randomUUID()}`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, target);

    return {
      id: frontmatter.id,
      path: target,
      relativePath: path.relative(this.config.vaultPath, target),
      fileName: path.basename(target),
      title: frontmatter.title,
      tags: frontmatter.tags,
      created: frontmatter.created,
    };
  }

  /** Carpetas del vault que contienen notas, en rutas relativas. */
  async listFolders(): Promise<string[]> {
    const files = await this.listMarkdownFiles();
    const defaultFolder = path.relative(this.config.vaultPath, this.config.notesDir);
    const folders = new Set<string>([defaultFolder]);

    for (const file of files) {
      const relative = path.relative(this.config.vaultPath, path.dirname(file));
      if (relative && relative !== '.') folders.add(relative);
    }
    return [...folders].sort((a, b) => a.localeCompare(b, 'es'));
  }

  /** Categorías ya usadas en el vault, ordenadas por frecuencia. */
  async listCategories(): Promise<string[]> {
    const counts = new Map<string, number>();
    for (const file of await this.listMarkdownFiles()) {
      try {
        const parsed = matter(await readFile(file, 'utf8'));
        const category = parsed.data.category;
        if (typeof category === 'string' && category.trim()) {
          const key = category.trim().toLowerCase();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      } catch {
        // Ignora notas ilegibles.
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
      .map(([category]) => category);
  }

  private resolveDestination(subdir?: string): string {
    const relative = (subdir ?? path.relative(this.config.vaultPath, this.config.notesDir))
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .trim();

    const destination = path.resolve(this.config.vaultPath, relative || '.');
    const root = path.resolve(this.config.vaultPath);
    if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
      throw new Error(`La carpeta "${subdir}" está fuera del vault.`);
    }
    return destination;
  }

  private async listMarkdownFiles(): Promise<string[]> {
    const entries = await readdir(this.config.vaultPath, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter(
        (file) =>
          !file.includes(`${path.sep}.obsidian${path.sep}`) &&
          !file.includes(`${path.sep}.trash${path.sep}`),
      );
  }

  private async uniquePath(directory: string, base: string): Promise<string> {
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const suffix = attempt === 1 ? '' : `-${attempt}`;
      const candidate = path.join(directory, `${base}${suffix}.md`);
      try {
        await access(candidate);
      } catch {
        return candidate;
      }
    }
    throw new Error(`No se pudo encontrar un nombre libre para la nota "${base}".`);
  }
}
