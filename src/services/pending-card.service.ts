import type { GeneratedCard } from './flashcard-generator.service.js';

export interface PendingCardBatch {
  cards: GeneratedCard[];
  sourceNote: string;
  sourceTitle: string;
  createdAt: number;
  expiresAt: number;
  edit?: {
    index: number;
    question: string;
    answer: string;
    stage: 'question' | 'answer';
  };
}

export interface PendingCardStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

const MAX_QUESTION = 500;
const MAX_ANSWER = 2_000;

/**
 * Short-lived preview/edit state for cards that have not been saved yet.
 * A batch is scoped to one chat; cards are copied before being stored.
 */
export class PendingCardStore {
  private readonly batches = new Map<number, PendingCardBatch>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: PendingCardStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 15 * 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  create(chatId: number, cards: GeneratedCard[], source: { note: string; title: string }): PendingCardBatch {
    const at = this.now();
    const batch: PendingCardBatch = {
      cards: cards.map((card) => ({ ...card, tags: [...card.tags] })),
      sourceNote: source.note,
      sourceTitle: source.title,
      createdAt: at,
      expiresAt: at + this.ttlMs,
    };
    this.batches.set(chatId, batch);
    return batch;
  }

  get(chatId: number): PendingCardBatch | undefined {
    const batch = this.batches.get(chatId);
    if (!batch) return undefined;
    if (batch.expiresAt <= this.now()) {
      this.batches.delete(chatId);
      return undefined;
    }
    return batch;
  }

  has(chatId: number): boolean {
    return this.get(chatId) !== undefined;
  }

  beginEdit(chatId: number, index: number): PendingCardBatch['edit'] | undefined {
    const batch = this.get(chatId);
    const card = batch?.cards[index];
    if (!batch || !card) return undefined;
    batch.edit = {
      index,
      question: card.question,
      answer: card.answer,
      stage: 'question',
    };
    return batch.edit;
  }

  /** Store a new question and move to the answer step. */
  submitQuestion(chatId: number, question: string): PendingCardBatch['edit'] | undefined {
    const batch = this.get(chatId);
    if (!batch?.edit || batch.edit.stage !== 'question') return undefined;
    const text = question.trim();
    if (!text || text.length > MAX_QUESTION) return undefined;
    batch.edit.question = text;
    batch.edit.stage = 'answer';
    return batch.edit;
  }

  /** Store the answer, replace the card in the preview and leave edit mode. */
  submitAnswer(chatId: number, answer: string): PendingCardBatch | undefined {
    const batch = this.get(chatId);
    if (!batch?.edit || batch.edit.stage !== 'answer') return undefined;
    const text = answer.trim();
    if (!text || text.length > MAX_ANSWER) return undefined;
    const card = batch.cards[batch.edit.index];
    if (!card) return undefined;
    card.question = batch.edit.question;
    card.answer = text;
    delete batch.edit;
    return batch;
  }

  cancelEdit(chatId: number): boolean {
    const batch = this.get(chatId);
    if (!batch?.edit) return false;
    delete batch.edit;
    return true;
  }

  clear(chatId: number): boolean {
    return this.batches.delete(chatId);
  }

  get size(): number {
    return this.batches.size;
  }
}
