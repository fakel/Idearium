import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    const first = await service.write({ digest, source: 'cli_text', transcript: 'uno' });
    const second = await service.write({ digest, source: 'cli_text', transcript: 'dos' });

    expect(first.path).not.toBe(second.path);
    expect(path.basename(first.path)).toMatch(/^\d{4}-\d{2}-\d{2}-repensar-el-indice\.md$/);
    expect(path.basename(second.path)).toContain('-2.md');
    expect(await readFile(first.path, 'utf8')).toContain('uno');
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
