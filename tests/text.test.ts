import { describe, expect, it } from 'vitest';
import { chunkMarkdown, slugify, truncate } from '../src/lib/text.js';

describe('slugify', () => {
  it('quita acentos y espacios', () => {
    expect(slugify('El niño que no dormía')).toBe('el-nino-que-no-dormia');
  });

  it('usa un fallback para títulos sin letras', () => {
    expect(slugify('###')).toBe('nota');
  });
});

describe('truncate', () => {
  it('no toca textos cortos y recorta los largos', () => {
    expect(truncate('hola', 10)).toBe('hola');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
});

describe('chunkMarkdown', () => {
  it('separa por secciones cuando no caben juntas', () => {
    const doc = `# Nota\n\n## Primera\n\n${'a'.repeat(80)}\n\n## Segunda\n\n${'b'.repeat(80)}`;
    const chunks = chunkMarkdown(doc, { maxChars: 100, overlapChars: 10 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('parte secciones largas con solape', () => {
    const paragraph = Array.from({ length: 30 }, (_, index) => `frase numero ${index}`).join('. ');
    const chunks = chunkMarkdown(`## Larga\n\n${paragraph}`, { maxChars: 120, overlapChars: 30 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]!.text.length).toBeLessThanOrEqual(120);
  });

  it('conserva el texto completo en un documento corto', () => {
    const doc = '# Título\n\nContenido corto con una idea.';
    const [chunk] = chunkMarkdown(doc);
    expect(chunk?.text).toContain('Contenido corto');
    expect(chunk?.index).toBe(0);
  });
});
