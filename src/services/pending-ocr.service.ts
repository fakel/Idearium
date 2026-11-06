export type OcrStage = 'confirm' | 'editing';

export interface PendingOcr {
  text: string;
  imageFile: string;
  stage: OcrStage;
  createdAt: number;
  expiresAt: number;
}

/**
 * Texto OCR pendiente de confirmación antes de digerirlo y clasificarlo.
 * Vive en memoria, igual que PendingCaptureStore.
 */
export class PendingOcrStore {
  private readonly pending = new Map<number, PendingOcr>();

  constructor(
    private readonly ttlMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  create(chatId: number, text: string, imageFile: string): PendingOcr {
    const now = this.now();
    const pending: PendingOcr = {
      text,
      imageFile,
      stage: 'confirm',
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.pending.set(chatId, pending);
    return pending;
  }

  get(chatId: number): PendingOcr | undefined {
    const pending = this.pending.get(chatId);
    if (!pending) return undefined;
    if (this.now() > pending.expiresAt) {
      this.pending.delete(chatId);
      return undefined;
    }
    return pending;
  }

  has(chatId: number): boolean {
    return this.get(chatId) !== undefined;
  }

  /** Guarda el texto corregido y vuelve a pedir confirmación. */
  updateText(chatId: number, text: string): PendingOcr | undefined {
    const pending = this.get(chatId);
    if (!pending) return undefined;
    pending.text = text;
    pending.stage = 'confirm';
    pending.expiresAt = this.now() + this.ttlMs;
    return pending;
  }

  setStage(chatId: number, stage: OcrStage): PendingOcr | undefined {
    const pending = this.get(chatId);
    if (!pending) return undefined;
    pending.stage = stage;
    return pending;
  }

  clear(chatId: number): boolean {
    return this.pending.delete(chatId);
  }

  get size(): number {
    return this.pending.size;
  }
}
