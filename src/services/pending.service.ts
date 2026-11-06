import type { PreparedIngest } from '../controllers/ingest.controller.js';

export type PendingStage = 'folder' | 'category';

export interface PendingCapture {
  prepared: PreparedIngest;
  stage: PendingStage;
  folders: string[];
  categories: string[];
  suggestedCategory: string;
  folder?: string;
  createdAt: number;
}

/**
 * Capturas que esperan la elección de carpeta/categoría.
 * Vive en memoria: si el bot se reinicia, la captura pendiente se pierde
 * (el audio ya está en disco, pero hay que reenviarlo para digerirlo).
 */
export class PendingCaptureStore {
  private readonly captures = new Map<number, PendingCapture>();

  constructor(private readonly ttlMs = 30 * 60 * 1000) {}

  create(
    chatId: number,
    prepared: PreparedIngest,
    folders: string[],
    suggestedCategory: string,
    now = Date.now(),
  ): PendingCapture {
    const capture: PendingCapture = {
      prepared,
      stage: 'folder',
      folders,
      categories: [],
      suggestedCategory,
      createdAt: now,
    };
    this.captures.set(chatId, capture);
    return capture;
  }

  get(chatId: number, now = Date.now()): PendingCapture | undefined {
    const capture = this.captures.get(chatId);
    if (!capture) return undefined;
    if (now - capture.createdAt > this.ttlMs) {
      this.captures.delete(chatId);
      return undefined;
    }
    return capture;
  }

  has(chatId: number): boolean {
    return this.get(chatId) !== undefined;
  }

  chooseFolder(
    chatId: number,
    folder: string,
    categories: string[],
    now = Date.now(),
  ): PendingCapture | undefined {
    const capture = this.get(chatId, now);
    if (!capture) return undefined;
    capture.folder = folder;
    capture.categories = categories;
    capture.stage = 'category';
    capture.createdAt = now;
    return capture;
  }

  clear(chatId: number): boolean {
    return this.captures.delete(chatId);
  }

  get size(): number {
    return this.captures.size;
  }
}
