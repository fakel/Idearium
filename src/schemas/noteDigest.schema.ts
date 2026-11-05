import { z } from 'zod';

export const noteCategories = [
  'idea',
  'tarea',
  'aprendizaje',
  'referencia',
  'proyecto',
  'personal',
  'otro',
] as const;

export const noteSources = [
  'telegram_text',
  'telegram_voice',
  'telegram_document',
  'cli_text',
  'cli_audio',
] as const;

const cleanString = z.string().trim();

const stringList = (itemMin: number, itemMax: number) =>
  z
    .array(cleanString.min(itemMin).max(itemMax))
    .transform((items) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))));

export const noteDigestSchema = z.object({
  title: cleanString.min(3).max(120),
  summary: cleanString.min(10).max(1_200),
  category: z.enum(noteCategories),
  tags: stringList(1, 40)
    .transform((items) =>
      Array.from(new Set(items.map((item) => item.toLowerCase().replace(/^#+/, '').trim()).filter(Boolean))),
    )
    .pipe(z.array(z.string()).min(3).max(8)),
  action_items: stringList(1, 300).pipe(z.array(z.string()).max(20)).default([]),
  key_ideas: stringList(1, 300).pipe(z.array(z.string()).min(1).max(20)),
  language: cleanString.min(2).max(10).default('es'),
});

export type NoteDigest = z.infer<typeof noteDigestSchema>;

/** Max characters accepted for the note body before escalating to a remote model. */
export function digestPromptChars(transcript: string): number {
  return transcript.length;
}

/**
 * Parse the raw LLM answer into a validated digest.
 * Tolerates fenced code blocks and leading/trailing prose around the JSON object.
 */
export function parseNoteDigest(raw: string): NoteDigest {
  const unfenced = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('La respuesta del LLM no contiene un objeto JSON.');
    }
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  }

  return noteDigestSchema.parse(parsed);
}

/** Human-readable Zod error used as feedback for the retry prompt. */
export function formatValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
