import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import WordExtractor from 'word-extractor';
import matter from 'gray-matter';
import { truncate } from '../lib/text.js';

export const supportedDocumentExtensions = ['.md', '.txt', '.pdf', '.doc', '.docx'] as const;
export type DocumentExtension = (typeof supportedDocumentExtensions)[number];

export interface DocumentServiceConfig {
  /** Maximum characters stored in the note before truncating. */
  maxChars?: number;
}

export interface ExtractedDocument {
  text: string;
  extension: DocumentExtension;
  truncated: boolean;
}

export class DocumentService {
  private readonly maxChars: number;

  constructor(config: DocumentServiceConfig = {}) {
    this.maxChars = Math.max(1_000, config.maxChars ?? 200_000);
  }

  async extract(filePath: string): Promise<ExtractedDocument> {
    const extension = path.extname(filePath).toLowerCase();
    if (!isSupportedDocumentExtension(extension)) {
      throw new Error(
        `Formato no soportado: ${extension || 'sin extensión'}. Formatos válidos: ${supportedDocumentExtensions.join(', ')}.`,
      );
    }

    let text: string;
    switch (extension) {
      case '.md':
        text = stripFrontmatter(await readFile(filePath, 'utf8'));
        break;
      case '.txt':
        text = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
        break;
      case '.pdf':
        text = await extractPdf(filePath);
        break;
      case '.docx':
        text = (await mammoth.extractRawText({ path: filePath })).value;
        break;
      case '.doc':
        text = (await new WordExtractor().extract(filePath)).getBody();
        break;
    }

    const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) {
      throw new Error(
        'El documento no contiene texto extraíble. Si es un PDF escaneado, necesitaría OCR (pendiente).',
      );
    }

    if (clean.length > this.maxChars) {
      return {
        text: `${truncate(clean, this.maxChars)}\n\n[Documento recortado: se conservaron los primeros ${this.maxChars} caracteres.]`,
        extension,
        truncated: true,
      };
    }
    return { text: clean, extension, truncated: false };
  }
}

export function isSupportedDocumentExtension(extension: string): extension is DocumentExtension {
  return (supportedDocumentExtensions as readonly string[]).includes(extension.toLowerCase());
}

function stripFrontmatter(raw: string): string {
  try {
    return matter(raw).content;
  } catch {
    return raw;
  }
}

async function extractPdf(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: true });
  return Array.isArray(result.text) ? result.text.join('\n\n') : result.text;
}
