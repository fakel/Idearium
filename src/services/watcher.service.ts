import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { logger, type Logger } from '../lib/logger.js';
import type { Indexer } from './indexer.service.js';

export interface NoteNormalizer {
  normalizeNewNote(filePath: string): Promise<string>;
}

export interface WatcherConfig {
  notesDir: string;
  debounceMs?: number;
  normalizer?: NoteNormalizer;
}

export class WatcherService {
  private watcher?: FSWatcher;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pendingNormalize = new Set<string>();
  private readonly log: Logger;

  constructor(
    private readonly config: WatcherConfig,
    private readonly indexer: Indexer,
    loggerImpl?: Logger,
  ) {
    this.log = loggerImpl ?? logger;
  }

  start(): void {
    if (this.watcher) return;
    // Chokidar 6 ya no resuelve globs: se vigila la carpeta y se filtra .md.
    this.watcher = chokidar.watch(this.config.notesDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignored: (filePath: string) =>
        filePath.includes(`${path.sep}.obsidian${path.sep}`) || filePath.includes(`${path.sep}.trash${path.sep}`),
    });

    this.watcher
      .on('add', (filePath) => {
        if (filePath.endsWith('.md')) this.schedule(filePath, true);
      })
      .on('change', (filePath) => {
        if (filePath.endsWith('.md')) this.schedule(filePath, false);
      })
      .on('unlink', (filePath) => {
        if (!filePath.endsWith('.md')) return;
        void this.indexer.removeFile(filePath).catch((error: unknown) => {
          this.log.warn({ path: filePath, error: String(error) }, 'watcher.unlink_failed');
        });
      })
      .on('error', (error) => this.log.error({ error: String(error) }, 'watcher.error'));

    this.log.info({ dir: this.config.notesDir }, 'watcher.started');
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.watcher?.close();
    this.watcher = undefined;
  }

  private schedule(filePath: string, normalize: boolean): void {
    if (normalize) this.pendingNormalize.add(filePath);
    const previous = this.timers.get(filePath);
    if (previous) clearTimeout(previous);

    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      const shouldNormalize = this.pendingNormalize.delete(filePath);
      void this.process(filePath, shouldNormalize).catch((error: unknown) => {
        this.log.warn({ path: filePath, error: String(error) }, 'watcher.index_failed');
      });
    }, this.config.debounceMs ?? 500);

    this.timers.set(filePath, timer);
  }

  private async process(filePath: string, normalize: boolean): Promise<void> {
    let target = filePath;
    if (normalize && this.config.normalizer) {
      try {
        target = await this.config.normalizer.normalizeNewNote(filePath);
        if (target !== filePath) {
          this.log.info({ from: filePath, to: target }, 'watcher.note_numbered');
        }
      } catch (error) {
        this.log.warn({ path: filePath, error: String(error) }, 'watcher.normalize_failed');
      }
    }
    await this.indexer.indexFile(target);
  }
}
