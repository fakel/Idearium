import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertInsideVault } from '../src/lib/vault-path.js';
import { MemorizeService } from '../src/services/memorize.service.js';
import type { Embedder } from '../src/services/embedding.service.js';
import type { TextCompleter } from '../src/services/rag.service.js';
import type { VectorStore } from '../src/services/vector.service.js';

const dirs: string[] = [];

async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'idearium-vault-path-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('assertInsideVault', () => {
  it('acepta un archivo dentro del vault', async () => {
    const vault = await temp();
    const file = path.join(vault, 'nota.md');
    await writeFile(file, '# Nota\n');
    await expect(assertInsideVault(vault, file)).resolves.toBe(file);
  });

  it('rechaza una ruta fuera del vault', async () => {
    const vault = await temp();
    const outside = await temp();
    await expect(assertInsideVault(vault, path.join(outside, 'nota.md'))).rejects.toThrow(
      'fuera del vault',
    );
  });

  it('rechaza un symlink que sale del vault', async () => {
    const vault = await temp();
    const outside = await temp();
    const outsideFile = path.join(outside, 'secreto.md');
    await writeFile(outsideFile, 'secreto');
    const link = path.join(vault, 'enlace.md');
    await symlink(outsideFile, link);
    await expect(assertInsideVault(vault, link)).rejects.toThrow('fuera del vault');
  });
});

describe('MemorizeService path safety', () => {
  it('no lee un palacio fuera del vault', async () => {
    const vault = await temp();
    const outside = await temp();
    const file = path.join(outside, 'externo.md');
    await writeFile(file, '## Palacio de la memoria\n\n- Historia externa\n');
    const service = new MemorizeService(
      { vaultPath: vault },
      {} as VectorStore,
      {} as Embedder,
      {} as TextCompleter,
    );
    await expect(service.readPalace(file)).rejects.toThrow('fuera del vault');
  });

  it('no escribe un palacio en una nota externa', async () => {
    const vault = await temp();
    const outside = await temp();
    const file = path.join(outside, 'externo.md');
    await writeFile(file, '# Externa\n');
    const service = new MemorizeService(
      { vaultPath: vault },
      {} as VectorStore,
      {} as Embedder,
      {} as TextCompleter,
    );
    await expect(
      (service as unknown as { writeAtomic: (file: string, text: string) => Promise<void> }).writeAtomic(
        file,
        'x',
      ),
    ).rejects.toThrow('fuera del vault');
  });
});
