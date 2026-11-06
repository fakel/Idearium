import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Indexer } from '../src/services/indexer.service.js';
import { VectorService } from '../src/services/vector.service.js';
import type { Embedder } from '../src/services/embedding.service.js';

const dimension = 4;

class FakeEmbedder implements Embedder {
  calls = 0;

  async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    return texts.map((text) => {
      const seed = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      return [seed % 7, (seed + 1) % 5, (seed + 2) % 3, 1];
    });
  }
}

let root: string;
let vector: VectorService;
let indexer: Indexer;
let embedder: FakeEmbedder;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'idearium-indexer-'));
  await mkdir(path.join(root, 'Idearium'), { recursive: true });
  vector = new VectorService(path.join(root, 'lancedb'), dimension);
  await vector.open();
  embedder = new FakeEmbedder();
  indexer = new Indexer(
    {
      vaultPath: root,
      notesDir: path.join(root, 'Idearium'),
      stateFile: path.join(root, 'index-state.json'),
    },
    vector,
    embedder,
    pino({ level: 'silent' }),
  );
});

afterEach(async () => {
  await vector.close();
  await rm(root, { recursive: true, force: true });
});

async function writeNote(name: string, body: string): Promise<string> {
  const file = path.join(root, 'Idearium', name);
  await writeFile(
    file,
    `---\ntitle: ${name.replace('.md', '')}\ntags: [test, nota]\ncategory: idea\n---\n\n${body}\n`,
    'utf8',
  );
  return file;
}

describe('Indexer + LanceDB', () => {
  it('indexa una nota y la encuentra por similitud', async () => {
    const file = await writeNote('gato.md', '## Gato\n\nEl gato duerme en el sofá.\n\n## Comida\n\nCome pienso.');
    const result = await indexer.indexFile(file);

    expect(result.skipped).toBe(false);
    expect(result.chunks).toBeGreaterThan(0);
    expect(await vector.count()).toBeGreaterThan(0);

    const [query] = await embedder.embed(['gato duerme']);
    const hits = await vector.search(query!, 5);
    expect(hits.some((hit) => hit.notePath === path.resolve(file))).toBe(true);
    expect(hits[0]!.title).toBe('gato');
  });

  it('salta notas sin cambios y reindexa cuando cambian', async () => {
    const file = await writeNote('perro.md', '## Perro\n\nEl perro ladra.');
    const first = await indexer.indexFile(file);
    expect(first.chunks).toBe(1);

    const skipped = await indexer.indexFile(file);
    expect(skipped.skipped).toBe(true);

    await writeNote('perro.md', '## Perro\n\nEl perro ladra y corre.');
    const updated = await indexer.indexFile(file);
    expect(updated.skipped).toBe(false);
    expect(await vector.count()).toBe(1);
  });

  it('reindexa cuando cambia el modelo de embeddings', async () => {
    const file = await writeNote('modelo.md', '## Modelo\n\nContenido estable.');
    const first = new Indexer(
      {
        vaultPath: root,
        notesDir: path.join(root, 'Idearium'),
        stateFile: path.join(root, 'index-state.json'),
        embedding: 'ollama:bge-m3:4',
      },
      vector,
      embedder,
      pino({ level: 'silent' }),
    );
    await first.indexFile(file);
    expect((await first.indexFile(file)).skipped).toBe(true);

    const second = new Indexer(
      {
        vaultPath: root,
        notesDir: path.join(root, 'Idearium'),
        stateFile: path.join(root, 'index-state.json'),
        embedding: 'openrouter:baai/bge-m3:4',
      },
      vector,
      embedder,
      pino({ level: 'silent' }),
    );
    expect((await second.indexFile(file)).skipped).toBe(false);
  });

  it('guarda el estado completo con indexaciones concurrentes', async () => {
    const uno = await writeNote('uno.md', '## Uno\n\nPrimera nota.');
    const dos = await writeNote('dos.md', '## Dos\n\nSegunda nota.');
    await Promise.all([indexer.indexFile(uno), indexer.indexFile(dos)]);

    const state = JSON.parse(await readFile(path.join(root, 'index-state.json'), 'utf8')) as {
      files: Record<string, unknown>;
    };
    expect(state.files[path.resolve(uno)]).toBeDefined();
    expect(state.files[path.resolve(dos)]).toBeDefined();
  });

  it('reindexAll ignora .obsidian y elimina notas borradas', async () => {
    const kept = await writeNote('idea.md', '## Idea\n\nUna idea viva.');
    const removed = await writeNote('vieja.md', '## Vieja\n\nNota obsoleta.');
    await writeFile(path.join(root, '.obsidian', 'config.md'), 'no indexar', { flag: 'w' }).catch(async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path.join(root, '.obsidian'), { recursive: true });
      await writeFile(path.join(root, '.obsidian', 'config.md'), 'no indexar');
    });
    await indexer.reindexAll();

    await rm(removed);
    const result = await indexer.reindexAll();
    expect(result.removed).toBe(1);

    const hits = await vector.search([1, 1, 1, 1], 20);
    const paths = hits.map((hit) => hit.notePath);
    expect(paths).toContain(path.resolve(kept));
    expect(paths).not.toContain(path.resolve(removed));
  });
});
