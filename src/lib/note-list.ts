import type { NoteRef } from '../services/note-selector.service.js';

export function formatNoteList(notes: NoteRef[]): string {
  const sorted = [...notes].sort((a, b) => {
    const left = a.noteNumber ?? Number.MAX_SAFE_INTEGER;
    const right = b.noteNumber ?? Number.MAX_SAFE_INTEGER;
    return left - right || a.title.localeCompare(b.title, 'es');
  });

  const lines = [`📚 ${sorted.length} ${sorted.length === 1 ? 'nota' : 'notas'}`, ''];
  for (const note of sorted) {
    if (note.noteNumber !== undefined) {
      // Las notas del curso ya llevan el número en el título.
      const title = note.title.replace(/^\d{4,}\s*—\s*/, '');
      lines.push(`${String(note.noteNumber).padStart(4, '0')} — ${title}`);
    } else {
      lines.push(note.title);
    }
  }
  return lines.join('\n');
}
