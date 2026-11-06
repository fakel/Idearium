import { z } from 'zod';
import { noteCategories, noteSources } from './noteDigest.schema.js';

export const noteFrontmatterSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  note_number: z.number().int().positive().optional(),
  aliases: z.array(z.string()).optional(),
  summary: z.string().min(1),
  category: z.enum(noteCategories),
  tags: z.array(z.string()),
  created: z.string(),
  updated: z.string(),
  source: z.enum(noteSources),
  audio_file: z.string().optional(),
  document_file: z.string().optional(),
  image_file: z.string().optional(),
  language: z.string().optional(),
});

export type NoteFrontmatter = z.infer<typeof noteFrontmatterSchema>;
