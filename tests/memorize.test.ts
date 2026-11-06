import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemorizeService, compactPalaceStory, extractSection } from '../src/services/memorize.service.js';
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

describe('compactPalaceStory', () => {
  it('quita encabezados y limita la historia', () => {
    const compact = compactPalaceStory('### Ruta física\n1. Puerta con café\n2. Ventana con sol', 40);
    expect(compact).not.toContain('###');
    expect(compact).toContain('1. Puerta');
    expect(compact.length).toBeLessThanOrEqual(41);
  });
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
    expect(found?.story).toContain('1. Cocina');
    expect(found?.story).not.toContain('## Palacio');
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
    expect(parsed.content).toContain('- [[a|Nota A]] (a.md)');
    expect(parsed.content).toContain('## Palacio de la memoria');

    const sourceA = await readFile(path.join(dir, 'a.md'), 'utf8');
    expect(sourceA).toContain('## Palacio de la memoria');
    expect(sourceA).toContain('[[Palacios/');
    expect(sourceA).not.toContain('1. Puerta');

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

  it('crea el palacio en Palacios/ y deja solo el enlace en la nota original', async () => {
    const dir = await vault();
    const file = path.join(dir, 'sola.md');
    await writeFile(file, '---\ntitle: Sola\n---\n\n# Sola\n\nContenido.\n', 'utf8');

    const llm: TextCompleter = { completeText: async () => ({ value: '### Ruta física\n1. Ventana' }) };
    const memorize = new MemorizeService({ vaultPath: dir }, emptyVector, emptyEmbedder, llm);
    const result = await memorize.run('sola.md');

    expect(result.combined).toBe(false);
    expect(result.path).toContain(path.join(dir, 'Palacios'));
    expect(result.path).not.toBe(file);

    const original = await readFile(file, 'utf8');
    expect(original).toContain('## Palacio de la memoria');
    expect(original).toContain('[[Palacios/');
    expect(original).not.toContain('1. Ventana');

    const palace = await readFile(result.path, 'utf8');
    expect(palace).toContain('1. Ventana');
    expect(matter(palace).data.type).toBe('palacio');
    expect(matter(palace).data.source_notes).toEqual(['Sola']);

    const palaces = await memorize.listPalaces();
    expect(palaces).toHaveLength(1);
    expect(palaces[0]?.path).toBe(result.path);

    const found = await memorize.readPalace('sola.md');
    expect(found?.path).toBe(result.path);
    expect(found?.story).toContain('1. Ventana');
  });

  it('borra el archivo del palacio y el enlace de la nota original', async () => {
    const dir = await vault();
    const file = path.join(dir, 'sola.md');
    await writeFile(file, '---\ntitle: Sola\n---\n\n# Sola\n\nContenido.\n', 'utf8');

    const llm: TextCompleter = { completeText: async () => ({ value: '1. Ventana' }) };
    const memorize = new MemorizeService({ vaultPath: dir }, emptyVector, emptyEmbedder, llm);
    const created = await memorize.run('sola.md');

    const deleted = await memorize.deletePalace('sola.md');
    expect(deleted).toMatchObject({ path: created.path, title: created.title, deletedFile: true });
    await expect(readFile(created.path, 'utf8')).rejects.toThrow();
    expect(await readFile(file, 'utf8')).not.toContain('Palacio de la memoria');
    expect(await memorize.listPalaces()).toHaveLength(0);
  });

  it('borra un palacio combinado y los enlaces de todas las notas fuente', async () => {
    const dir = await vault();
    const a = path.join(dir, 'a.md');
    const b = path.join(dir, 'b.md');
    await writeFile(a, '---\ntitle: Nota A\n---\n\n# Nota A\n', 'utf8');
    await writeFile(b, '---\ntitle: Nota B\n---\n\n# Nota B\n', 'utf8');

    const llm: TextCompleter = { completeText: async () => ({ value: '1. Puerta' }) };
    const memorize = new MemorizeService({ vaultPath: dir }, emptyVector, emptyEmbedder, llm);
    const created = await memorize.run('notas Nota A, Nota B');
    expect(await readFile(a, 'utf8')).toContain('[[Palacios/');

    const deleted = await memorize.deletePalace(created.path);
    expect(deleted.deletedFile).toBe(true);
    expect(deleted.references).toBe(2);
    expect(await readFile(a, 'utf8')).not.toContain('Palacio de la memoria');
    expect(await readFile(b, 'utf8')).not.toContain('Palacio de la memoria');
    await expect(readFile(created.path, 'utf8')).rejects.toThrow();
  });

  it('en un palacio antiguo dentro de una nota borra la sección, no la nota', async () => {
    const dir = await vault();
    const file = path.join(dir, 'antigua.md');
    await writeFile(
      file,
      '---\ntitle: Antigua\n---\n\n# Antigua\n\nTexto.\n\n## Palacio de la memoria\n\n1. Puerta\n',
      'utf8',
    );

    const deleted = await new MemorizeService(
      { vaultPath: dir },
      emptyVector,
      emptyEmbedder,
      {} as TextCompleter,
    ).deletePalace('antigua.md');

    expect(deleted.deletedFile).toBe(false);
    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('Texto.');
    expect(raw).not.toContain('## Palacio de la memoria');
  });

  it('candidates resuelve una nota exacta', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'sola.md'), '---\ntitle: Sola\n---\n\n# Sola\n', 'utf8');

    const candidates = await service(dir).candidates('sola.md');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('Sola');
  });

  it('candidates rechaza listas de varias notas', async () => {
    const dir = await vault();
    await expect(service(dir).candidates('Nota A, Nota B')).rejects.toThrow('una nota');
  });
});

describe('MemorizeService.deleteNote', () => {
  it('borra una nota por número', async () => {
    const dir = await vault();
    const file = path.join(dir, '0007-comprar-cafe-051125.md');
    await writeFile(
      file,
      '---\ntitle: Comprar café\nnote_number: 7\n---\n\n# Comprar café\n',
      'utf8',
    );

    const deleted = await service(dir).deleteNote('7');
    expect(deleted).toMatchObject({
      title: 'Comprar café',
      noteNumber: 7,
      relativePath: '0007-comprar-cafe-051125.md',
    });
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('conserva y actualiza un palacio si quedan otras notas fuente', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'a.md'), '---\ntitle: Nota A\n---\n\n# Nota A\n', 'utf8');
    await writeFile(path.join(dir, 'b.md'), '---\ntitle: Nota B\n---\n\n# Nota B\n', 'utf8');

    const llm: TextCompleter = {
      completeText: async () => ({ value: '### Ruta física\n1. Puerta con [[Nota A]]' }),
    };
    const memorize = new MemorizeService({ vaultPath: dir }, emptyVector, emptyEmbedder, llm);
    const created = await memorize.run('notas Nota A, Nota B');

    const deleted = await memorize.deleteNote('Nota A');
    expect(deleted.palaces).toHaveLength(1);
    expect(deleted.palaces[0]).toMatchObject({
      title: created.title,
      deleted: false,
      remainingNotes: ['Nota B'],
    });

    const palace = matter(await readFile(created.path, 'utf8'));
    expect(palace.data.source_notes).toEqual(['Nota B']);
    expect(palace.content).not.toContain('[[a|Nota A]]');
    expect(palace.content).toContain('[[b|Nota B]]');
  });

  it('borra el palacio si se borra su única nota fuente', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, 'sola.md'), '---\ntitle: Sola\n---\n\n# Sola\n', 'utf8');

    const llm: TextCompleter = { completeText: async () => ({ value: '### Ruta física\n1. Ventana' }) };
    const memorize = new MemorizeService({ vaultPath: dir }, emptyVector, emptyEmbedder, llm);
    const created = await memorize.run('sola.md');

    const deleted = await memorize.deleteNote('Sola');
    expect(deleted.palaces[0]).toMatchObject({
      title: created.title,
      deleted: true,
      remainingNotes: [],
    });
    await expect(readFile(created.path, 'utf8')).rejects.toThrow();
    expect(await memorize.listPalaces()).toHaveLength(0);
  });

  it('no borra palacios con /notas rm', async () => {
    const dir = await vault();
    await writeFile(
      path.join(dir, 'palacio.md'),
      '---\ntitle: Palacio\nnote_number: 3\ntype: palacio\n---\n\n# Palacio\n',
      'utf8',
    );

    await expect(service(dir).deleteNote('3')).rejects.toThrow(/palacio/i);
  });

  it('falla si el número no existe', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, '0001-uno-051125.md'), '# Uno\n', 'utf8');
    await expect(service(dir).deleteNote('9')).rejects.toThrow(/No encontré/);
  });
});

describe('MemorizeService.readNote', () => {
  it('devuelve el cuerpo sin frontmatter por número', async () => {
    const dir = await vault();
    await writeFile(
      path.join(dir, '0007-comprar-cafe-051125.md'),
      '---\ntitle: Comprar café\nnote_number: 7\n---\n\n# Comprar café\n\nComprar filtros.\n',
      'utf8',
    );

    const note = await service(dir).readNote('#0007');
    expect(note).toMatchObject({
      title: 'Comprar café',
      noteNumber: 7,
      relativePath: '0007-comprar-cafe-051125.md',
    });
    expect(note.content).toBe('# Comprar café\n\nComprar filtros.');
    expect(note.content).not.toContain('---');
  });

  it('falla si el número no existe', async () => {
    const dir = await vault();
    await writeFile(path.join(dir, '0001-uno-051125.md'), '# Uno\n', 'utf8');
    await expect(service(dir).readNote('#9')).rejects.toThrow(/No encontré/);
  });
});
