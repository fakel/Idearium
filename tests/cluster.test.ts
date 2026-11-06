import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClusterService } from '../src/services/cluster.service.js';
import type { Embedder } from '../src/services/embedding.service.js';
import type { TextCompleter } from '../src/services/rag.service.js';
import type { VectorStore } from '../src/services/vector.service.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ClusterService', () => {
  it('no sobrescribe dos estudios del mismo tema y día', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'idearium-cluster-'));
    dirs.push(root);
    const notesDir = path.join(root, 'Estudios');

    const vector = {
      search: async () => [
        {
          id: 'x',
          notePath: '/vault/nota.md',
          chunkIndex: 0,
          title: 'Nota',
          tags: [],
          category: 'idea',
          text: 'Contenido de la nota.',
          updatedAt: '2026-01-01',
          distance: 0.1,
        },
      ],
    } as unknown as VectorStore;
    const embedder = { embed: async () => [[1, 0, 0, 0]] } as unknown as Embedder;
    const llm = {
      completeText: async () => ({ value: '# Estudio\n\nContenido.', provider: 'test', model: 'test' }),
    } as unknown as TextCompleter;

    const service = new ClusterService({ studiesDir: notesDir }, vector, embedder, llm);
    const first = await service.run('café');
    const second = await service.run('café');

    expect(second.path).not.toBe(first.path);
    expect(await readFile(first.path, 'utf8')).toContain('Contenido.');
    expect(await readFile(second.path, 'utf8')).toContain('Contenido.');
  });
});
