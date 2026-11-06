import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('resuelve una nota por su número, con o sin relleno', async () => {
    const dir = await vault();
    await writeFile(
      path.join(dir, '0007-comprar-filtros-051126.md'),
      note('Comprar filtros').replace('category: idea', 'category: idea\nnote_number: 7'),
      'utf8',
    );

    const selector = new NoteSelectorService({ vaultPath: dir }, fakeVector([]), fakeEmbedder());
    const byNumber = await selector.select('quiz sobre 7');
    const byPadded = await selector.select('#0007');

    expect(byNumber.notes).toHaveLength(1);
    expect(byNumber.notes[0]?.title).toBe('Comprar filtros');
    expect(byNumber.notes[0]?.noteNumber).toBe(7);
    expect(byPadded.notes[0]?.title).toBe('Comprar filtros');
  });

  it('resuelve notas del curso por prefijo NNNN', async () => {
    const dir = await vault();
    const courseDir = path.join(dir, 'Aprendizaje', 'Idearium');
    await mkdir(courseDir, { recursive: true });
    await writeFile(path.join(courseDir, '0000 Indice.md'), note('Índice del curso'), 'utf8');
    await writeFile(
      path.join(dir, '0001-captura-061126.md'),
      note('Captura').replace('category: idea', 'category: idea\nnote_number: 1'),
      'utf8',
    );

    const selector = new NoteSelectorService({ vaultPath: dir }, fakeVector([]), fakeEmbedder());
    const course = await selector.select('0000');
    const capture = await selector.select('0001');

    expect(course.notes[0]?.title).toBe('Índice del curso');
    expect(capture.notes[0]?.title).toBe('Captura');
  });

  it('lee el número del nombre si falta en el frontmatter', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, '0012-otra-nota-051126.md'), note('Otra nota'), 'utf8');

    const selector = new NoteSelectorService({ vaultPath: dir }, fakeVector([]), fakeEmbedder());
    const selection = await selector.select('0012');

    expect(selection.notes[0]?.noteNumber).toBe(12);
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

  it('no deja que los palacios desplacen notas normales', async () => {
    const dir = await vault();
    const palaceDir = path.join(dir, 'Palacios');
    await mkdir(palaceDir, { recursive: true });
    const palace1 = path.join(palaceDir, 'p1.md');
    const palace2 = path.join(palaceDir, 'p2.md');
    const real = path.join(dir, 'real.md');
    await writeFile(palace1, note('Palacio 1').replace('category: idea', 'category: idea\ntype: palacio'), 'utf8');
    await writeFile(palace2, note('Palacio 2').replace('category: idea', 'category: idea\ntype: palacio'), 'utf8');
    await writeFile(real, note('Nota real'), 'utf8');

    const selector = new NoteSelectorService(
      { vaultPath: dir, maxNotes: 1 },
      fakeVector([
        { notePath: palace1, distance: 0.01 },
        { notePath: palace2, distance: 0.02 },
        { notePath: real, distance: 0.3 },
      ]),
      fakeEmbedder(),
    );
    const selection = await selector.select('tema sin título exacto');

    expect(selection.notes.map((item) => item.title)).toEqual(['Nota real']);
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
