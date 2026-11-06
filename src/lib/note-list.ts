import type { NoteRef } from '../services/note-selector.service.js';

export function formatNoteList(notes: NoteRef[]): string {
  const sorted = [...notes].sort((a, b) => {
    const left = a.noteNumber ?? Number.MAX_SAFE_INTEGER;
    const right = b.noteNumber ?? Number.MAX_SAFE_INTEGER;
    return left - right || a.title.localeCompare(b.title, 'es');
  });

  const lines = [`📚 ${sorted.length} ${sorted.length === 1 ? 'nota' : 'notas'}`, ''];
  for (const note of sorted) {
    if (note.noteNumber) {
      lines.push(`${String(note.noteNumber).padStart(4, '0')} — ${note.title}`);
    } else {
      lines.push(note.title);
    }
  }
  return lines.join('\n');
}
