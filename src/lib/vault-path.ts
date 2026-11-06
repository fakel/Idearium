import { realpath } from 'node:fs/promises';
import path from 'node:path';

function isInside(root: string, file: string): boolean {
  return file === root || file.startsWith(`${root}${path.sep}`);
}

/**
 * Resuelve una ruta relativa al vault y rechaza las que quedan fuera.
 * También comprueba el destino real cuando existe, para no seguir symlinks.
 */
export async function assertInsideVault(vaultPath: string, file: string): Promise<string> {
  const root = path.resolve(vaultPath);
  const absolute = path.resolve(file);
  if (!isInside(root, absolute)) {
    throw new Error('La ruta está fuera del vault.');
  }

  const realRoot = await realpath(root).catch(() => root);
  const realFile = await realpath(absolute).catch(async () => {
    const parent = await realpath(path.dirname(absolute)).catch(() => path.dirname(absolute));
    return path.join(parent, path.basename(absolute));
  });

  if (!isInside(realRoot, realFile)) {
    throw new Error('La ruta está fuera del vault.');
  }
  return absolute;
}
