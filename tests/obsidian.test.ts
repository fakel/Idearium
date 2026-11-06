import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObsidianService } from '../src/services/obsidian.service.js';
import type { NoteDigest } from '../src/schemas/noteDigest.schema.js';

const digest: NoteDigest = {
  title: 'Repensar el índice',
  summary: 'La búsqueda debe priorizar notas recientes.',
  category: 'idea',
  tags: ['búsqueda', 'índice', 'diseño'],
  action_items: ['Probar top-k 8'],
  key_ideas: ['Los embeddings locales son suficientes'],
  language: 'es',
};

let vault: string;
let service: ObsidianService;

beforeEach(async () => {
  vault = await mkdtemp(path.join(os.tmpdir(), 'idearium-vault-'));
  service = new ObsidianService({ vaultPath: vault, notesDir: path.join(vault, 'Idearium') });
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('ObsidianService', () => {
  it('genera frontmatter y cuerpo con secciones', () => {
    const { content, frontmatter } = service.render({
      digest,
      source: 'cli_text',
      transcript: 'texto original',
      now: new Date('2026-01-02T03:04:05Z'),
    });
    const parsed = matter(content);

    expect(frontmatter.source).toBe('cli_text');
    expect(parsed.data.title).toBe(digest.title);
    expect(parsed.data.tags).toEqual(digest.tags);
    expect(parsed.content).toContain('## Resumen');
    expect(parsed.content).toContain('- [ ] Probar top-k 8');
    expect(parsed.content).toContain('texto original');
  });

  it('escribe archivos atómicos y evita colisiones', async () => {
    const now = new Date(2026, 0, 2, 12, 0, 0);
    const first = await service.write({ digest, source: 'cli_text', transcript: 'uno', now });
    const second = await service.write({ digest, source: 'cli_text', transcript: 'dos', now });

    expect(first.path).not.toBe(second.path);
    expect(path.basename(first.path)).toBe('0001-repensar-el-indice-020126.md');
    expect(path.basename(second.path)).toBe('0002-repensar-el-indice-020126.md');
    expect(first.noteNumber).toBe(1);
    expect(second.noteNumber).toBe(2);
    const parsed = matter(await readFile(first.path, 'utf8'));
    expect(parsed.data.note_number).toBe(1);
    expect(parsed.data.aliases).toEqual(['0001']);
    expect(await readFile(first.path, 'utf8')).toContain('uno');
  });

  it('cuenta los prefijos de dos dígitos de las notas del curso', async () => {
    await writeFile(path.join(vault, '00 Indice.md'), '# índice\n', 'utf8');
    await writeFile(path.join(vault, '21 Glosario.md'), '# glosario\n', 'utf8');

    const note = await service.write({
      digest,
      source: 'cli_text',
      transcript: 'nueva',
      now: new Date(2026, 10, 6, 12, 0, 0),
    });

    expect(note.noteNumber).toBe(22);
    expect(path.basename(note.path)).toBe('0022-repensar-el-indice-061126.md');
  });

  it('ignora las fechas antiguas al calcular el número', async () => {
    await writeFile(path.join(vault, '2026-01-02-nota-vieja.md'), '# vieja\n', 'utf8');
    const note = await service.write({ digest, source: 'cli_text', transcript: 'nueva' });
    expect(note.noteNumber).toBe(1);
    expect(path.basename(note.path)).toMatch(/^0001-/);
  });

  it('guarda en la subcarpeta elegida y lista carpetas/categorías', async () => {
    const first = await service.write({
      digest,
      source: 'cli_text',
      transcript: 'uno',
      subdir: 'Ideas/2026',
    });
    await service.write({
      digest: { ...digest, title: 'Otra nota', category: 'proyecto' },
      source: 'cli_text',
      transcript: 'dos',
      subdir: 'Proyectos',
    });

    expect(path.dirname(first.path)).toBe(path.join(vault, 'Ideas', '2026'));
    expect(await service.listFolders()).toEqual(
      expect.arrayContaining(['Idearium', 'Ideas/2026', 'Proyectos']),
    );
    expect(await service.listCategories()).toEqual(['idea', 'proyecto']);
  });

  it('rechaza rutas fuera del vault', async () => {
    await expect(
      service.write({ digest, source: 'cli_text', transcript: 'x', subdir: '../fuera' }),
    ).rejects.toThrow(/fuera del vault/);
  });

  it('usa un marcador cuando no hay acciones', async () => {
    const { content } = service.render({
      digest: { ...digest, action_items: [] },
      source: 'cli_text',
      transcript: 'sin acciones',
    });
    expect(content).toContain('_Sin acciones pendientes._');
  });
});
