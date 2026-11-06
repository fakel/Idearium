import { access } from 'node:fs/promises';
import path from 'node:path';

/** Devuelve `<directory>/<base>.md`, o `base-2.md`, `base-3.md`… si ya existe. */
export async function uniquePath(directory: string, base: string): Promise<string> {
  for (let index = 1; index <= 100; index += 1) {
    const candidate = path.join(directory, index === 1 ? `${base}.md` : `${base}-${index}.md`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`No se pudo encontrar un nombre libre para ${base}.md`);
}
