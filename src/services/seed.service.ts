import { constants } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../lib/logger.js';

export const courseSeedSubdir = path.join('Aprendizaje', 'Idearium');

export interface SeedOptions {
  vaultPath: string;
  seedDir?: string;
  logger?: Logger;
}

export interface SeedResult {
  copied: number;
  skipped: number;
  reason: 'seeded' | 'not-empty' | 'seed-missing' | 'seed-empty';
}

const defaultSeedDir = (): string => path.resolve('seed', 'aprendizaje', 'idearium');

async function listMarkdownFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter(
        (file) =>
          !file.includes(`${path.sep}.obsidian${path.sep}`) &&
          !file.includes(`${path.sep}.trash${path.sep}`),
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** True if the vault already has at least one Markdown note (course or capture). */
export async function vaultHasNotes(vaultPath: string): Promise<boolean> {
  return (await listMarkdownFiles(vaultPath)).length > 0;
}

/**
 * Copies the bundled course into <vault>/Aprendizaje/Idearium only when the
 * vault has no Markdown notes at all. Existing files are never overwritten.
 */
export async function seedCourseIfEmpty(options: SeedOptions): Promise<SeedResult> {
  const vaultPath = path.resolve(options.vaultPath);
  const seedDir = path.resolve(options.seedDir ?? defaultSeedDir());
  await mkdir(vaultPath, { recursive: true });

  if (await vaultHasNotes(vaultPath)) {
    return { copied: 0, skipped: 0, reason: 'not-empty' };
  }

  const seedFiles = await listMarkdownFiles(seedDir);
  if (seedFiles.length === 0) {
    options.logger?.warn({ seedDir }, 'seed.missing');
    return { copied: 0, skipped: 0, reason: 'seed-missing' };
  }

  const destinationRoot = path.join(vaultPath, courseSeedSubdir);
  let copied = 0;
  let skipped = 0;

  for (const source of seedFiles) {
    const relative = path.relative(seedDir, source);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;

    const destination = path.join(destinationRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      copied += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  options.logger?.info({ copied, skipped, destination: destinationRoot }, 'seed.copied');
  return { copied, skipped, reason: copied > 0 ? 'seeded' : 'seed-empty' };
}
