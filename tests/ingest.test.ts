import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IngestController, type DigestCompleter } from '../src/controllers/ingest.controller.js';
import { ObsidianService } from '../src/services/obsidian.service.js';
import { DocumentService } from '../src/services/document.service.js';
import type { NoteDigest } from '../src/schemas/noteDigest.schema.js';
import type { Completion } from '../src/services/llm-router.service.js';
import { withUsageSession } from '../src/services/usage.service.js';

const digest: NoteDigest = {
  title: 'Idea pendiente',
  summary: 'Resumen de prueba.',
  category: 'idea',
  tags: ['prueba', 'carpeta', 'categoría'],
  action_items: [],
  key_ideas: ['Una idea'],
  language: 'es',
};

const completer: DigestCompleter = {
  async completeJson<T>(): Promise<Completion<T>> {
    return {
      value: digest as unknown as T,
      raw: JSON.stringify(digest),
      provider: 'fake',
      model: 'fake',
      usedRemote: false,
      reason: 'test',
    };
  },
};

let vault: string;
let controller: IngestController;

beforeEach(async () => {
  vault = await mkdtemp(path.join(os.tmpdir(), 'idearium-ingest-'));
  controller = new IngestController({
    router: completer,
    obsidian: new ObsidianService({ vaultPath: vault, notesDir: path.join(vault, 'Idearium') }),
    documents: new DocumentService(),
  });
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('IngestController', () => {
  it('prepara un documento y guarda su archivo original en el frontmatter', async () => {
    const file = path.join(vault, 'entrada.md');
    await writeFile(file, '# Documento\n\nContenido importado.', 'utf8');

    const prepared = await controller.prepareDocument(file, { source: 'telegram_document' });
    expect(prepared.transcript).toContain('Contenido importado');
    expect(prepared.documentFile).toBe(file);

    const result = await controller.save(prepared);
    expect(matter(await readFile(result.note.path, 'utf8')).data.document_file).toBe(file);
    expect(result.note.path).toContain(path.join(vault, 'Idearium'));
  });

  it('suma el coste de una fase anterior al preparar la captura', async () => {
    const prepared = await withUsageSession(() =>
      controller.prepareText('texto', {
        source: 'telegram_photo',
        extraUsage: {
          requests: 1,
          promptTokens: 10,
          completionTokens: 2,
          totalTokens: 12,
          costUsd: 0.0004,
        },
      }),
    );
    expect(prepared.usage).toEqual({
      requests: 1,
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      costUsd: 0.0004,
    });
  });

  it('prepara sin escribir y guarda con carpeta y categoría elegidas', async () => {
    const prepared = await controller.prepareText('texto', { source: 'telegram_text' });
    expect(await readdir(vault)).toEqual([]);
    expect(prepared.digest.category).toBe('idea');

    const result = await controller.save(prepared, {
      subdir: 'Proyectos/Idearium',
      category: 'proyecto',
    });

    expect(path.dirname(result.note.path)).toBe(path.join(vault, 'Proyectos', 'Idearium'));
    expect(result.digest.category).toBe('proyecto');
    expect(matter(await readFile(result.note.path, 'utf8')).data.category).toBe('proyecto');
  });
});
