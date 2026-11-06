import { describe, expect, it } from 'vitest';
import { formatNoteList } from '../src/lib/note-list.js';
import type { NoteRef } from '../src/services/note-selector.service.js';

function ref(title: string, noteNumber?: number): NoteRef {
  return {
    title,
    path: `/vault/${title}.md`,
    relativePath: `${title}.md`,
    tags: [],
    category: 'idea',
    noteNumber,
  };
}

describe('formatNoteList', () => {
  it('ordena por número y deja las notas antiguas al final', () => {
    const text = formatNoteList([ref('Vieja'), ref('Dos', 2), ref('Uno', 1)]);
    const lines = text.split('\n');

    expect(lines[0]).toBe('📚 3 notas');
    expect(lines[2]).toBe('0001 — Uno');
    expect(lines[3]).toBe('0002 — Dos');
    expect(lines[4]).toBe('Vieja');
  });

  it('usa singular con una sola nota', () => {
    expect(formatNoteList([ref('Única', 1)]).split('\n')[0]).toBe('📚 1 nota');
  });
});
