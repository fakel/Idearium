import { describe, expect, it } from 'vitest';
import { categoryOptions, normalizeCategory, normalizeFolder } from '../src/lib/classification.js';

describe('normalizeCategory', () => {
  it('acepta el enum, plurales y #', () => {
    expect(normalizeCategory('idea')).toBe('idea');
    expect(normalizeCategory('#Ideas')).toBe('idea');
    expect(normalizeCategory('aprendizajes')).toBe('aprendizaje');
    expect(normalizeCategory('OTROS')).toBe('otro');
  });

  it('rechaza valores desconocidos', () => {
    expect(normalizeCategory('inventada')).toBeNull();
    expect(normalizeCategory('   ')).toBeNull();
  });
});

describe('normalizeFolder', () => {
  it('normaliza separadores y espacios', () => {
    expect(normalizeFolder(' Ideas / 2026 ')).toBe('Ideas/2026');
    expect(normalizeFolder('Proyectos\\Idearium')).toBe('Proyectos/Idearium');
  });

  it('rechaza rutas inseguras o vacías', () => {
    expect(normalizeFolder('..')).toBeNull();
    expect(normalizeFolder('Ideas/../Secreto')).toBeNull();
    expect(normalizeFolder('   ')).toBeNull();
  });
});

describe('categoryOptions', () => {
  it('pone la sugerida primero y deduplica', () => {
    expect(categoryOptions('idea', ['proyecto', 'idea', 'personal'])).toEqual([
      'idea',
      'proyecto',
      'personal',
    ]);
  });
});
