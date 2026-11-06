import { logger, type Logger } from '../lib/logger.js';
import type { NoteDigest } from '../schemas/noteDigest.schema.js';
import { noteCategories, parseNoteDigest } from '../schemas/noteDigest.schema.js';
import type { ChatMessage } from '../services/llm.service.js';
import type { Completion, JsonCompletionRequest } from '../services/llm-router.service.js';
import type { Indexer } from '../services/indexer.service.js';
import type { NoteSource, ObsidianService, WrittenNote } from '../services/obsidian.service.js';
import type { SttService } from '../services/stt.service.js';
import type { DocumentService } from '../services/document.service.js';

export interface DigestCompleter {
  completeJson<T>(request: JsonCompletionRequest<T>): Promise<Completion<T>>;
}

export interface IngestDeps {
  router: DigestCompleter;
  obsidian: ObsidianService;
  stt?: SttService;
  documents?: DocumentService;
  indexer?: Indexer;
  logger?: Logger;
}

export interface IngestOptions {
  source: NoteSource;
  remote?: boolean;
  audioFile?: string;
  documentFile?: string;
  imageFile?: string;
}

export interface IngestResult {
  note: WrittenNote;
  digest: NoteDigest;
  transcript: string;
  provider: string;
  model: string;
  usedRemote: boolean;
  reason: string;
  indexed: boolean;
  indexingError?: string;
}

/** Captura ya transcrita y digerida, pendiente de elegir carpeta/categoría. */
export interface PreparedIngest {
  transcript: string;
  digest: NoteDigest;
  source: NoteSource;
  audioFile?: string;
  documentFile?: string;
  imageFile?: string;
  provider: string;
  model: string;
  usedRemote: boolean;
  reason: string;
}

export interface SaveIngestOptions {
  subdir?: string;
  category?: NoteDigest['category'];
}

const maxTranscriptChars = 20_000;

export class IngestController {
  private readonly log: Logger;

  constructor(private readonly deps: IngestDeps) {
    this.log = deps.logger ?? logger;
  }

  async prepareText(text: string, options: IngestOptions): Promise<PreparedIngest> {
    const transcript = text.trim();
    if (!transcript) throw new Error('La captura está vacía.');

    const digest = await this.digest(transcript, Boolean(options.remote));
    return {
      transcript,
      digest: digest.value,
      source: options.source,
      ...(options.audioFile ? { audioFile: options.audioFile } : {}),
      ...(options.documentFile ? { documentFile: options.documentFile } : {}),
      ...(options.imageFile ? { imageFile: options.imageFile } : {}),
      provider: digest.provider,
      model: digest.model,
      usedRemote: digest.usedRemote,
      reason: digest.reason,
    };
  }

  async prepareAudio(filePath: string, options: IngestOptions): Promise<PreparedIngest> {
    if (!this.deps.stt) throw new Error('El servicio de transcripción no está configurado.');
    const transcription = await this.deps.stt.transcribe(filePath);
    return this.prepareText(transcription.text, {
      ...options,
      source: options.source,
      audioFile: filePath,
    });
  }

  async prepareDocument(filePath: string, options: IngestOptions): Promise<PreparedIngest> {
    if (!this.deps.documents) throw new Error('El servicio de documentos no está configurado.');
    const extracted = await this.deps.documents.extract(filePath);
    return this.prepareText(extracted.text, {
      ...options,
      source: options.source,
      documentFile: filePath,
    });
  }

  async save(prepared: PreparedIngest, options: SaveIngestOptions = {}): Promise<IngestResult> {
    const digest: NoteDigest = options.category
      ? { ...prepared.digest, category: options.category }
      : prepared.digest;

    const note = await this.deps.obsidian.write({
      digest,
      source: prepared.source,
      transcript: prepared.transcript,
      audioFile: prepared.audioFile,
      documentFile: prepared.documentFile,
      imageFile: prepared.imageFile,
      subdir: options.subdir,
    });

    const { indexed, indexingError } = await this.tryIndex(note.path);

    return {
      note,
      digest,
      transcript: prepared.transcript,
      provider: prepared.provider,
      model: prepared.model,
      usedRemote: prepared.usedRemote,
      reason: prepared.reason,
      indexed,
      ...(indexingError ? { indexingError } : {}),
    };
  }

  async ingestText(text: string, options: IngestOptions): Promise<IngestResult> {
    return this.save(await this.prepareText(text, options));
  }

  async ingestAudio(filePath: string, options: IngestOptions): Promise<IngestResult> {
    return this.save(await this.prepareAudio(filePath, options));
  }

  async ingestDocument(filePath: string, options: IngestOptions): Promise<IngestResult> {
    return this.save(await this.prepareDocument(filePath, options));
  }

  private async digest(transcript: string, remote: boolean): Promise<Completion<NoteDigest>> {
    const clipped = transcript.slice(0, maxTranscriptChars);
    return this.deps.router.completeJson({
      messages: buildDigestMessages(clipped),
      parse: parseNoteDigest,
      explicitRemote: remote,
      inputChars: transcript.length,
      temperature: 0.2,
    });
  }

  private async tryIndex(notePath: string): Promise<{ indexed: boolean; indexingError?: string }> {
    if (!this.deps.indexer) return { indexed: false };
    try {
      await this.deps.indexer.indexFile(notePath);
      return { indexed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn({ path: notePath, error: message }, 'ingest.index_failed');
      return { indexed: false, indexingError: message };
    }
  }
}

export function buildDigestMessages(transcript: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'Eres un asistente que convierte capturas de voz o texto en notas estructuradas para Obsidian.',
        'Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin explicaciones ni bloques de código.',
        'Esquema exacto:',
        '{',
        '  "title": "título corto y descriptivo (3-120 caracteres)",',
        '  "summary": "resumen de 1-3 frases",',
        `  "category": "una de: ${noteCategories.join(', ')}",`,
        '  "tags": ["3 a 8 etiquetas cortas en minúsculas, sin #"],',
        '  "key_ideas": ["1 a 20 ideas clave"],',
        '  "action_items": ["0 a 20 acciones concretas"],',
        '  "language": "código ISO del idioma de la captura, por ejemplo es"',
        '}',
        'No inventes información que no esté en la captura. Mantén el idioma original del contenido.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Captura:\n"""\n${transcript}\n"""`,
    },
  ];
}
