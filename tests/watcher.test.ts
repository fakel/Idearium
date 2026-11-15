import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Indexer } from '../src/services/indexer.service.js';
import { ObsidianService } from '../src/services/obsidian.service.js';
import { WatcherService } from '../src/services/watcher.service.js';

let vault: string;
let watcher: WatcherService | undefined;

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

beforeEach(async () => {
  vault = await mkdtemp(path.join(os.tmpdir(), 'idearium-watcher-'));
});

afterEach(async () => {
  await watcher?.stop();
  watcher = undefined;
  await rm(vault, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, timeoutMs = 4_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('tiempo de espera agotado');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('WatcherService', () => {
  it('numera una nota nueva antes de indexarla', async () => {
    const indexed: string[] = [];
    const indexer = {
      indexFile: async (filePath: string) => {
        indexed.push(filePath);
      },
      removeFile: async () => undefined,
    } as unknown as Indexer;
    const obsidian = new ObsidianService({ vaultPath: vault, notesDir: path.join(vault, 'Idearium') });

    watcher = new WatcherService(
      { notesDir: vault, debounceMs: 20, normalizer: obsidian },
      indexer,
      silent,
    );
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const source = path.join(vault, 'nota suelta.md');
    await writeFile(source, '# Suelta\n\nContenido.\n', 'utf8');

    await waitFor(() => indexed.some((file) => path.basename(file).startsWith('0001-nota-suelta-')));

    const target = indexed.find((file) => path.basename(file).startsWith('0001-nota-suelta-'));
    expect(target).toBeDefined();
    expect(path.dirname(target!)).toBe(vault);
  });
});
