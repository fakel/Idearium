import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seedCourseIfEmpty, vaultHasNotes } from '../src/services/seed.service.js';

const tempDirs: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('seedCourseIfEmpty', () => {
  it('copies the course into an empty vault', async () => {
    const vault = await makeTemp('idearium-seed-vault-');
    const seed = await makeTemp('idearium-seed-source-');
    await writeFile(path.join(seed, '0000 Indice.md'), '# Indice\n');
    await writeFile(path.join(seed, '0001 Nota.md'), '# Nota\n');

    const result = await seedCourseIfEmpty({ vaultPath: vault, seedDir: seed });

    expect(result).toMatchObject({ copied: 2, skipped: 0, reason: 'seeded' });
    expect(await readFile(path.join(vault, 'Aprendizaje', 'Idearium', '0000 Indice.md'), 'utf8')).toBe(
      '# Indice\n',
    );
    expect(await vaultHasNotes(vault)).toBe(true);
  });

  it('does not touch a vault that already has notes', async () => {
    const vault = await makeTemp('idearium-seed-full-');
    const seed = await makeTemp('idearium-seed-source-');
    await writeFile(path.join(vault, 'propia.md'), '# Propia\n');
    await writeFile(path.join(seed, '0000 Indice.md'), '# Indice\n');

    const result = await seedCourseIfEmpty({ vaultPath: vault, seedDir: seed });

    expect(result).toEqual({ copied: 0, skipped: 0, reason: 'not-empty' });
    expect(await readFile(path.join(vault, 'propia.md'), 'utf8')).toBe('# Propia\n');
  });

  it('ignores Obsidian internals when checking if the vault is empty', async () => {
    const vault = await makeTemp('idearium-seed-empty-');
    const seed = await makeTemp('idearium-seed-source-');
    await mkdir(path.join(vault, '.obsidian'), { recursive: true });
    await writeFile(path.join(vault, '.obsidian', 'workspace.json'), '{}');
    await writeFile(path.join(seed, '0000 Indice.md'), '# Indice\n');

    const result = await seedCourseIfEmpty({ vaultPath: vault, seedDir: seed });

    expect(result.copied).toBe(1);
  });
});
