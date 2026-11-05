import { describe, expect, it } from 'vitest';
import { noteDigestSchema, parseNoteDigest } from '../src/schemas/noteDigest.schema.js';

const valid = {
  title: 'Ideas para el proyecto',
  summary: 'Una captura breve con ideas sueltas sobre el proyecto.',
  category: 'proyecto',
  tags: ['proyecto', 'ideas', 'planificación'],
  action_items: ['Escribir el plan'],
  key_ideas: ['Empezar por el índice'],
  language: 'es',
};

describe('parseNoteDigest', () => {
  it('acepta JSON válido', () => {
    const digest = parseNoteDigest(JSON.stringify(valid));
    expect(digest.title).toBe(valid.title);
    expect(digest.tags).toHaveLength(3);
  });

  it('tolera bloques de código y prosa alrededor', () => {
    const raw = `Aquí está tu nota:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\nEspero que sirva.`;
    expect(parseNoteDigest(raw).category).toBe('proyecto');
  });

  it('aplica defaults de language y action_items', () => {
    const { language, action_items, ...rest } = valid;
    void language;
    void action_items;
    const digest = parseNoteDigest(JSON.stringify(rest));
    expect(digest.language).toBe('es');
    expect(digest.action_items).toEqual([]);
  });

  it('rechaza categorías desconocidas y pocos tags', () => {
    expect(() => parseNoteDigest(JSON.stringify({ ...valid, category: 'inventada' }))).toThrow();
    expect(() => parseNoteDigest(JSON.stringify({ ...valid, tags: ['uno'] }))).toThrow();
  });

  it('normaliza tags duplicados y con #', () => {
    const digest = parseNoteDigest(JSON.stringify({ ...valid, tags: ['#Idea', 'idea', 'Otra', 'Tercera'] }));
    expect(digest.tags).toEqual(['idea', 'otra', 'tercera']);
  });
});

describe('noteDigestSchema', () => {
  it('no acepta resumen vacío', () => {
    expect(noteDigestSchema.safeParse({ ...valid, summary: '' }).success).toBe(false);
  });
});
