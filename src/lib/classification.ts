import { noteCategories } from '../schemas/noteDigest.schema.js';

export type NoteCategory = (typeof noteCategories)[number];

const categoryAliases: Record<string, NoteCategory> = {
  ideas: 'idea',
  tareas: 'tarea',
  aprendizajes: 'aprendizaje',
  referencias: 'referencia',
  proyectos: 'proyecto',
  personales: 'personal',
  otros: 'otro',
  otra: 'otro',
  otras: 'otro',
};

/** Normaliza una categoría escrita por el usuario al enum del digest. */
export function normalizeCategory(input: string): NoteCategory | null {
  const clean = input
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!clean) return null;
  if ((noteCategories as readonly string[]).includes(clean)) return clean as NoteCategory;
  return categoryAliases[clean] ?? null;
}

/** Devuelve una ruta relativa segura dentro del vault, o null si no es válida. */
export function normalizeFolder(input: string): string | null {
  const segments = input
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  if (segments.some((segment) => /[\u0000-\u001f]/.test(segment))) return null;

  const folder = segments.join('/');
  return folder.length > 120 ? null : folder;
}

/** Categorías para los botones: sugerida primero, luego las ya usadas. */
export function categoryOptions(
  suggested: string,
  existing: string[],
  max = 8,
): NoteCategory[] {
  const result: NoteCategory[] = [];
  const push = (value: string): void => {
    const category = normalizeCategory(value);
    if (category && !result.includes(category)) result.push(category);
  };

  push(suggested);
  for (const category of existing) push(category);
  return result.slice(0, max);
}
