import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { chunkMarkdown } from '../lib/text.js';
import { logger, type Logger } from '../lib/logger.js';
import type { Embedder } from './embedding.service.js';
import type { VectorRow, VectorStore } from './vector.service.js';

export interface IndexerConfig {
  vaultPath: string;
  notesDir: string;
  stateFile: string;
  /** Identidad del modelo de embeddings; si cambia, se reindexa. */
  embedding?: string;
  embeddingBatchSize?: number;
  maxChunkChars?: number;
  overlapChars?: number;
}

export interface IndexResult {
  path: string;
  chunks: number;
  skipped: boolean;
}

export interface ReindexResult {
  indexed: number;
  skipped: number;
  removed: number;
  failed: number;
}

interface StateEntry {
  hash: string;
  mtimeMs: number;
  chunks: number;
}

interface IndexState {
  embedding?: string;
  files: Record<string, StateEntry>;
}

export class Indexer {
  private state?: IndexState;
  private statePromise?: Promise<IndexState>;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: IndexerConfig,
    private readonly vector: VectorStore,
    private readonly embedder: Embedder,
    private readonly log: Logger = logger,
  ) {}

  async indexFile(filePath: string, options: { force?: boolean } = {}): Promise<IndexResult> {
    const absolute = path.resolve(filePath);
    const content = await readFile(absolute, 'utf8');
    const hash = createHash('sha256').update(content).digest('hex');
    const state = await this.loadState();
    const previous = state.files[absolute];
    const embeddingChanged = this.config.embedding !== undefined && state.embedding !== this.config.embedding;

    if (!options.force && !embeddingChanged && previous?.hash === hash) {
      return { path: absolute, chunks: previous.chunks, skipped: true };
    }

    const parsed = matter(content);
    const title = typeof parsed.data.title === 'string' ? parsed.data.title : path.basename(absolute, '.md');
    const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
    const category = typeof parsed.data.category === 'string' ? parsed.data.category : 'otro';
    const updatedAt =
      typeof parsed.data.updated === 'string' ? parsed.data.updated : new Date().toISOString();

    const chunks = chunkMarkdown(parsed.content, {
      maxChars: this.config.maxChunkChars,
      overlapChars: this.config.overlapChars,
    });

    const rows: VectorRow[] = [];
    const batchSize = this.config.embeddingBatchSize ?? 16;
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      const vectors = await this.embedder.embed(batch.map((chunk) => chunk.text));
      batch.forEach((chunk, offset) => {
        const vector = vectors[offset];
        if (!vector) throw new Error(`Faltó el embedding para el chunk ${chunk.index} de ${absolute}.`);
        rows.push({
          id: `${hash}-${chunk.index}`,
          note_path: absolute,
          chunk_index: chunk.index,
          vector,
          text: chunk.text,
          title,
          tags: JSON.stringify(tags),
          category,
          updated_at: updatedAt,
        });
      });
    }

    await this.vector.upsertNote(absolute, rows);
    state.files[absolute] = {
      hash,
      mtimeMs: Date.now(),
      chunks: rows.length,
    };
    if (this.config.embedding !== undefined) state.embedding = this.config.embedding;
    await this.saveState(state);
    this.log.info({ path: absolute, chunks: rows.length }, 'indexer.indexed');
    return { path: absolute, chunks: rows.length, skipped: false };
  }

  async removeFile(filePath: string): Promise<void> {
    const absolute = path.resolve(filePath);
    await this.vector.deleteByPath(absolute);
    const state = await this.loadState();
    delete state.files[absolute];
    await this.saveState(state);
    this.log.info({ path: absolute }, 'indexer.removed');
  }

  async reindexAll(): Promise<ReindexResult> {
    const files = await this.listMarkdownFiles(this.config.vaultPath);
    const result: ReindexResult = { indexed: 0, skipped: 0, removed: 0, failed: 0 };
    const seen = new Set<string>();
    const stateBefore = await this.loadState();
    const embeddingChanged =
      this.config.embedding !== undefined && stateBefore.embedding !== this.config.embedding;

    for (const file of files) {
      seen.add(path.resolve(file));
      try {
        const indexed = await this.indexFile(file, { force: embeddingChanged });
        if (indexed.skipped) result.skipped += 1;
        else result.indexed += 1;
      } catch (error) {
        result.failed += 1;
        this.log.error(
          { path: file, error: error instanceof Error ? error.message : String(error) },
          'indexer.failed',
        );
      }
    }

    const state = await this.loadState();
    for (const known of Object.keys(state.files)) {
      if (!seen.has(known)) {
        await this.removeFile(known);
        result.removed += 1;
      }
    }

    return result;
  }

  async listMarkdownFiles(root: string): Promise<string[]> {
    const absoluteRoot = path.resolve(root);
    const entries = await readdir(absoluteRoot, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((file) => !file.includes(`${path.sep}.obsidian${path.sep}`) && !file.includes(`${path.sep}.trash${path.sep}`));
  }

  private async loadState(): Promise<IndexState> {
    if (this.state) return this.state;
    if (!this.statePromise) {
      this.statePromise = (async () => {
        try {
          const parsed = JSON.parse(await readFile(this.config.stateFile, 'utf8')) as Record<
            string,
            unknown
          >;
          if (parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)) {
            this.state = {
              ...(typeof parsed.embedding === 'string' ? { embedding: parsed.embedding } : {}),
              files: parsed.files as Record<string, StateEntry>,
            };
          } else {
            this.state = { files: parsed as Record<string, StateEntry> };
          }
        } catch {
          this.state = { files: {} };
        }
        return this.state;
      })();
    }
    return this.statePromise;
  }

  private async saveState(state: IndexState): Promise<void> {
    // La instantánea se toma ahora; las escrituras se serializan para que dos
    // indexaciones concurrentes no compartan el mismo temporal.
    const data = JSON.stringify(state, null, 2);
    const write = this.saveQueue.then(async () => {
      await mkdir(path.dirname(this.config.stateFile), { recursive: true });
      const tmp = `${this.config.stateFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, data, 'utf8');
        await rename(tmp, this.config.stateFile);
      } finally {
        await unlink(tmp).catch(() => undefined);
      }
    });
    this.saveQueue = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }
}
