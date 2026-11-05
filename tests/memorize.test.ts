import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemorizeService, extractSection } from '../src/services/memorize.service.js';
import type { Embedder } from '../src/services/embedding.service.js';
import type { TextCompleter } from '../src/services/rag.service.js';
import type { VectorStore } from '../src/services/vector.service.js';

const emptyVector = {
  search: async () => [],
  upsertNote: async () => undefined,
  deleteByPath: async () => undefined,
  count: async () => 0,
  clear: async () => undefined,
} as VectorStore;

const emptyEmbedder = { embed: async () => [] } as unknown as Embedder;

const dirs: string[] = [];

async function vault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'idearium-palace-'));
  dirs.push(dir);
  return dir;
}

function service(vaultPath: string): MemorizeService {
  return new MemorizeService(
    { vaultPath },
    emptyVector,
    emptyEmbedder,
    {} as TextCompleter,
  );
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('extractSection', () => {
  it('devuelve solo la sección pedida', () => {
    const markdown = '# Nota\n\n## Otra\ncontenido\n\n## Palacio de la memoria\n\n### Ruta física\n1. Puerta\n\n## Final\nnada';
    expect(extractSection(markdown, 'Palacio de la memoria')).toBe(
      '## Palacio de la memoria\n\n### Ruta física\n1. Puerta',
    );
  });

  it('devuelve null si no existe', () => {
    expect(extractSection('# Nota\n', 'Palacio de la memoria')).toBeNull();
  });
});

describe('MemorizeService.readPalace / listPalaces', () => {
  it('lee el palacio por ruta y lista solo las notas que lo tienen', async () => {
    const dir = await vault();
    await writeFile(
      path.join(dir, 'con-palacio.md'),
      '---\ntitle: Nota con palacio\n---\n\n# Nota\n\n## Palacio de la memoria\n\n### Ruta física\n1. Cocina\n\n## Otra\nx\n',
      'utf8',
    );
    await writeFile(path.join(dir, 'sin-palacio.md'), '# Sin palacio\n', 'utf8');

    const palaces = await service(dir).listPalaces();
    expect(palaces).toHaveLength(1);
    expect(palaces[0]).toMatchObject({ title: 'Nota con palacio', relativePath: 'con-palacio.md' });

    const found = await service(dir).readPalace('con-palacio.md');
    expect(found?.title).toBe('Nota con palacio');
    expect(found?.section).toContain('1. Cocina');
    expect(found?.section).not.toContain('## Otra');

    await expect(service(dir).readPalace('sin-palacio.md')).resolves.toBeNull();
  });
});

describe('MemorizeService.run multi-nota', () => {
  it('crea un palacio combinado en Palacios/ y lo lista como combinado', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'a.md'), '---\ntitle: Nota A\n---\n\n# Nota A\n\nIdea A.\n', 'utf8');
    await writeFile(path.join(dir, 'b.md'), '---\ntitle: Nota B\n---\n\n# Nota B\n\nIdea B.\n', 'utf8');

    const calls: string[] = [];
    const llm: TextCompleter = {
      completeText: async (request) => {
        calls.push(request.messages[1]?.content ?? '');
        return { value: '### Ruta física\n1. Puerta con [[Nota A]] y [[Nota B]]\n' };
      },
    };

    const memorize = new MemorizeService({ vaultPath: dir }, emptyVector, emptyEmbedder, llm);
    const result = await memorize.run('palacio de la memoria de las notas Nota A, Nota B');

    expect(result.combined).toBe(true);
    expect(result.noteCount).toBe(2);
    expect(result.path).toContain(path.join(dir, 'Palacios'));
    expect(calls[0]).toContain('NOTA 1: [[Nota A]]');
    expect(calls[0]).toContain('NOTA 2: [[Nota B]]');

    const raw = await readFile(result.path, 'utf8');
    const parsed = matter(raw);
    expect(parsed.data.type).toBe('palacio');
    expect(parsed.data.source_notes).toEqual(['Nota A', 'Nota B']);
    expect(parsed.content).toContain('## Notas fuente');
    expect(parsed.content).toContain('- [[Nota A]] (a.md)');
    expect(parsed.content).toContain('## Palacio de la memoria');

    const palaces = await memorize.listPalaces();
    expect(palaces.find((item) => item.path === result.path)?.combined).toBe(true);
    const found = await memorize.readPalace('Nota A, Nota B');
    expect(found?.combined).toBe(true);
    expect(found?.section).toContain('Puerta con [[Nota A]]');
  });

  it('no sobrescribe un palacio combinado existente', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'a.md'), '---\ntitle: Repetida\n---\n\n# Repetida\n', 'utf8');
    await writeFile(path.join(dir, 'b.md'), '---\ntitle: Otra\n---\n\n# Otra\n', 'utf8');

    const llm: TextCompleter = { completeText: async () => ({ value: '### Ruta física\n1. Puerta' }) };
    const memorize = new MemorizeService({ vaultPath: dir }, emptyVector, emptyEmbedder, llm);
    const first = await memorize.run('notas Repetida, Otra');
    const second = await memorize.run('notas Repetida, Otra');

    expect(second.path).not.toBe(first.path);
    expect(second.path).toContain('-2.md');
  });

  it('mantiene el palacio dentro de la nota cuando hay una sola', async () => {
    const dir = await vault();
    const file = path.join(dir, 'sola.md');
    await writeFile(file, '---\ntitle: Sola\n---\n\n# Sola\n\nContenido.\n', 'utf8');

    const llm: TextCompleter = { completeText: async () => ({ value: '### Ruta física\n1. Ventana' }) };
    const result = await new MemorizeService({ vaultPath: dir }, emptyVector, emptyEmbedder, llm).run('sola.md');

    expect(result.combined).toBe(false);
    expect(result.path).toBe(file);
    expect(await readFile(file, 'utf8')).toContain('## Palacio de la memoria');
    expect((await memorizeFiles(dir)).some((name) => name.startsWith('Palacios'))).toBe(false);
  });
});

async function memorizeFiles(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  return readdir(dir);
}
