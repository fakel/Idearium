import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObsidianService, isNumberedNoteName } from '../src/services/obsidian.service.js';

let vault: string;
let service: ObsidianService;

const fixedDate = new Date(2026, 0, 2, 12, 0, 0);

beforeEach(async () => {
  vault = await mkdtemp(path.join(os.tmpdir(), 'idearium-numbering-'));
  service = new ObsidianService({ vaultPath: vault, notesDir: path.join(vault, 'Idearium') });
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('normalizeNewNote', () => {
  it('renombra una nota manual y añade número, alias y título', async () => {
    const folder = path.join(vault, 'Inbox');
    await mkdir(folder, { recursive: true });
    const source = path.join(folder, 'mi nota rara.md');
    await writeFile(source, '# Hola\n\nCuerpo que no se debe perder.\n', 'utf8');
    await utimes(source, fixedDate, fixedDate);

    const target = await service.normalizeNewNote(source);

    expect(target).toBe(path.join(folder, '0001-mi-nota-rara-020126.md'));
    await expect(access(source)).rejects.toThrow();

    const parsed = matter(await readFile(target, 'utf8'));
    expect(parsed.data.title).toBe('mi nota rara');
    expect(parsed.data.note_number).toBe(1);
    expect(parsed.data.aliases).toEqual(['0001']);
    expect(parsed.content).toContain('Cuerpo que no se debe perder.');
  });

  it('respeta el título y los alias existentes y evita colisiones', async () => {
    await writeFile(path.join(vault, '0001-otra-020126.md'), '# Otra\n', 'utf8');
    const folder = path.join(vault, 'Inbox');
    await mkdir(folder, { recursive: true });
    const source = path.join(folder, 'borrador.md');
    await writeFile(
      source,
      '---\ntitle: Real\naliases: [vino]\n---\n\nContenido real.\n',
      'utf8',
    );
    await utimes(source, fixedDate, fixedDate);

    const target = await service.normalizeNewNote(source);

    expect(path.basename(target)).toBe('0002-real-020126.md');
    const parsed = matter(await readFile(target, 'utf8'));
    expect(parsed.data.title).toBe('Real');
    expect(parsed.data.note_number).toBe(2);
    expect(parsed.data.aliases).toEqual(['0002', 'vino']);
  });

  it('no toca notas ya numeradas ni carpetas gestionadas por Idearium', async () => {
    const numbered = path.join(vault, '0000 Indice.md');
    await writeFile(numbered, '# Índice\n', 'utf8');
    expect(await service.normalizeNewNote(numbered)).toBe(numbered);

    const palace = path.join(vault, 'Palacios', '2026-11-07-palacio-x.md');
    await mkdir(path.dirname(palace), { recursive: true });
    await writeFile(palace, '# Palacio\n', 'utf8');
    expect(await service.normalizeNewNote(palace)).toBe(palace);

    const study = path.join(vault, 'Estudios', '2026-11-07-cluster-x.md');
    await mkdir(path.dirname(study), { recursive: true });
    await writeFile(study, '# Estudio\n', 'utf8');
    expect(await service.normalizeNewNote(study)).toBe(study);

    // Una nota manual dentro de Estudios sí se numera.
    const manualStudy = path.join(vault, 'Estudios', 'apuntes sueltos.md');
    await writeFile(manualStudy, '# Apuntes\n', 'utf8');
    const renamedManual = await service.normalizeNewNote(manualStudy);
    expect(path.basename(renamedManual)).toMatch(/^\d{4}-apuntes-sueltos-\d{6}\.md$/);
  });

  it('migra todas las notas sin numerar en orden de antigüedad', async () => {
    await writeFile(path.join(vault, '0001-vieja-010126.md'), '# Vieja\n', 'utf8');
    const second = path.join(vault, 'segunda.md');
    await writeFile(second, '# Segunda\n', 'utf8');
    await utimes(second, new Date(2026, 0, 3, 12), new Date(2026, 0, 3, 12));
    const third = path.join(vault, 'tercera.md');
    await writeFile(third, '# Tercera\n', 'utf8');
    await utimes(third, new Date(2026, 0, 4, 12), new Date(2026, 0, 4, 12));

    expect(await service.normalizeAllNotesPreview()).toEqual(['segunda.md', 'tercera.md']);

    const result = await service.normalizeAllNotes();

    expect(result.failed).toEqual([]);
    expect(result.renamed.map((item) => path.basename(item.to))).toEqual([
      '0002-segunda-030126.md',
      '0003-tercera-040126.md',
    ]);
    expect(await service.normalizeAllNotesPreview()).toEqual([]);
  });

  it('reconoce los dos formatos de numeración existentes', () => {
    expect(isNumberedNoteName('0007-comprar-cafe-081126')).toBe(true);
    expect(isNumberedNoteName('0007-comprar-cafe-081126.md')).toBe(true);
    expect(isNumberedNoteName('0000 Indice')).toBe(true);
    expect(isNumberedNoteName('2026-11-07-palacio-x')).toBe(false);
    expect(isNumberedNoteName('mi nota')).toBe(false);
  });
});
