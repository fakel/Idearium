import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { logger, type Logger } from '../lib/logger.js';
import type { Indexer } from './indexer.service.js';

export interface WatcherConfig {
  notesDir: string;
  debounceMs?: number;
}

export class WatcherService {
  private watcher?: FSWatcher;
  private readonly timers = new Map<string, NodeJS.Timeout>();
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
    const glob = path.join(this.config.notesDir, '**/*.md');
    this.watcher = chokidar.watch(glob, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignored: (filePath: string) =>
        filePath.includes(`${path.sep}.obsidian${path.sep}`) || filePath.includes(`${path.sep}.trash${path.sep}`),
    });

    this.watcher
      .on('add', (filePath) => this.schedule(filePath))
      .on('change', (filePath) => this.schedule(filePath))
      .on('unlink', (filePath) => {
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

  private schedule(filePath: string): void {
    const previous = this.timers.get(filePath);
    if (previous) clearTimeout(previous);

    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      void this.indexer.indexFile(filePath).catch((error: unknown) => {
        this.log.warn({ path: filePath, error: String(error) }, 'watcher.index_failed');
      });
    }, this.config.debounceMs ?? 500);

    this.timers.set(filePath, timer);
  }
}
