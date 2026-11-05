import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NoteSelectorService,
  cleanSelectionExpression,
  parseSelectionExpression,
} from '../src/services/note-selector.service.js';
import type { Embedder } from '../src/services/embedding.service.js';
import type { SearchHit, VectorStore } from '../src/services/vector.service.js';

const dirs: string[] = [];

async function vault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'idearium-selector-'));
  dirs.push(dir);
  return dir;
}

function note(title: string, body = ''): string {
  return `---\ntitle: ${title}\ntags: [prueba]\ncategory: idea\n---\n\n# ${title}\n\n${body}\n`;
}

function fakeEmbedder(): Embedder {
  return { embed: async (texts) => texts.map(() => [1, 0, 0, 0]) };
}

function fakeVector(hits: Array<Partial<SearchHit> & { notePath: string }>): VectorStore {
  return {
    search: async () =>
      hits.map((hit, index) => ({
        id: String(index),
        notePath: hit.notePath,
        chunkIndex: hit.chunkIndex ?? 0,
        title: hit.title ?? path.basename(hit.notePath, '.md'),
        tags: hit.tags ?? [],
        category: hit.category ?? 'idea',
        text: hit.text ?? '',
        updatedAt: hit.updatedAt ?? '2026-11-05',
        distance: hit.distance ?? index / 10,
      })),
    upsertNote: async () => undefined,
    deleteByPath: async () => undefined,
    count: async () => hits.length,
    clear: async () => undefined,
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('parseSelectionExpression', () => {
  it('limpia prefijos y separa listas explícitas', () => {
    expect(parseSelectionExpression('palacio de la memoria de las notas Cafetería, Presupuesto y Proveedores')).toEqual({
      query: 'Cafetería, Presupuesto y Proveedores',
      parts: ['Cafetería', 'Presupuesto', 'Proveedores'],
      explicit: true,
    });
  });

  it('conserva títulos entre comillas con comas', () => {
    const parsed = parseSelectionExpression('notas "Compras, ventas y stock", Presupuesto');
    expect(parsed.parts).toEqual(['Compras, ventas y stock', 'Presupuesto']);
  });

  it('trata “todos los pasos de X procedimiento” como tema', () => {
    expect(parseSelectionExpression('palacio de memoria de todos los pasos del procedimiento de compra')).toEqual({
      query: 'procedimiento de compra',
      parts: ['procedimiento de compra'],
      explicit: false,
    });
  });

  it('quita prefijos de quiz', () => {
    expect(cleanSelectionExpression('quiz sobre las notas Sprint 3, Retrospectiva y OKR')).toBe(
      'Sprint 3, Retrospectiva y OKR',
    );
    expect(cleanSelectionExpression('sobre las notas Sprint 3, Retrospectiva y OKR')).toBe(
      'Sprint 3, Retrospectiva y OKR',
    );
  });
});

describe('NoteSelectorService', () => {
  it('resuelve una lista explícita por título, basename y ruta', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'cafeteria.md'), note('Cafetería'), 'utf8');
    await writeFile(path.join(dir, 'presupuesto.md'), note('Presupuesto'), 'utf8');
    await writeFile(path.join(dir, 'proveedores.md'), note('Proveedores'), 'utf8');

    const selector = new NoteSelectorService({ vaultPath: dir }, fakeVector([]), fakeEmbedder());
    const selection = await selector.select('palacio de la memoria de las notas Cafetería, presupuesto y proveedores.md');

    expect(selection.mode).toBe('explicit');
    expect(selection.unresolved).toEqual([]);
    expect(selection.notes.map((item) => item.title)).toEqual(['Cafetería', 'Presupuesto', 'Proveedores']);
  });

  it('acepta wikilinks y deduplica notas repetidas', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'a.md'), note('A'), 'utf8');
    await writeFile(path.join(dir, 'b.md'), note('B'), 'utf8');

    const selector = new NoteSelectorService({ vaultPath: dir }, fakeVector([]), fakeEmbedder());
    const selection = await selector.select('notas [[A]], [[A]], [[B]]');

    expect(selection.notes.map((item) => item.title)).toEqual(['A', 'B']);
  });

  it('devuelve una selección vacía si el tema no tiene coincidencias', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'a.md'), note('A'), 'utf8');

    const selector = new NoteSelectorService({ vaultPath: dir }, fakeVector([]), fakeEmbedder());
    const selection = await selector.select('un tema que no existe');

    expect(selection.mode).toBe('topic');
    expect(selection.notes).toEqual([]);
  });

  it('devuelve unresolved sin inventar notas', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'a.md'), note('A'), 'utf8');

    const selector = new NoteSelectorService({ vaultPath: dir }, fakeVector([]), fakeEmbedder());
    const selection = await selector.select('notas A, No existe');

    expect(selection.notes.map((item) => item.title)).toEqual(['A']);
    expect(selection.unresolved).toEqual(['No existe']);
  });

  it('agrupa chunks por nota y respeta MEMORY_MAX_NOTES', async () => {
    const dir = await vault();
    const a = path.join(dir, 'a.md');
    const b = path.join(dir, 'b.md');
    const c = path.join(dir, 'c.md');
    await writeFile(a, note('A'), 'utf8');
    await writeFile(b, note('B'), 'utf8');
    await writeFile(c, note('C'), 'utf8');

    const selector = new NoteSelectorService(
      { vaultPath: dir, maxNotes: 2 },
      fakeVector([
        { notePath: b, distance: 0.2 },
        { notePath: a, distance: 0.1 },
        { notePath: a, distance: 0.15 },
        { notePath: c, distance: 0.3 },
      ]),
      fakeEmbedder(),
    );
    const selection = await selector.select('tema sin título exacto');

    expect(selection.mode).toBe('topic');
    expect(selection.notes.map((item) => item.title)).toEqual(['A', 'B']);
  });

  it('carga contenido con recorte por nota', async () => {
    const dir = await vault();
    const file = path.join(dir, 'larga.md');
    await writeFile(file, note('Larga', 'x'.repeat(2_000)), 'utf8');

    const selector = new NoteSelectorService({ vaultPath: dir, maxChars: 1_000 }, fakeVector([]), fakeEmbedder());
    const [context] = await selector.load([
      { title: 'Larga', path: file, relativePath: 'larga.md', tags: [], category: 'idea' },
    ]);

    expect(context?.truncated).toBe(true);
    expect(context?.content.length).toBeLessThanOrEqual(1_000);
  });
});
