import type { ReviewGrade } from '../lib/sm2.js';
import type { Flashcard, FlashcardService } from './flashcard.service.js';

export interface ReviewSessionCard {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  sourceTitle: string;
}

export interface ReviewStart {
  total: number;
  card: ReviewSessionCard;
  intro: string;
}

export interface ReviewReveal {
  card: ReviewSessionCard;
  answer: string;
}

export interface ReviewResult {
  finished: boolean;
  cardId: string;
  grade: ReviewGrade;
  reviewed: number;
  total: number;
  remaining: number;
  next?: ReviewSessionCard;
  summary?: string;
  undoable: boolean;
}

export interface ReviewUndo {
  card: ReviewSessionCard;
  reviewed: number;
  total: number;
}

interface ReviewSession {
  cards: Flashcard[];
  index: number;
  grades: Record<ReviewGrade, number>;
  startedAt: string;
  tag?: string;
  last?: { cardId: string; grade: ReviewGrade };
  finished: boolean;
}

export interface ReviewServiceOptions {
  maxDuePerSession?: number;
}

/**
 * One review session per chat. Cards are snapshotted at start so a rating
 * does not reorder the queue mid-session.
 */
export class ReviewService {
  private readonly sessions = new Map<number, ReviewSession>();
  private readonly maxDuePerSession: number;

  constructor(
    private readonly flashcards: FlashcardService,
    options: ReviewServiceOptions = {},
  ) {
    this.maxDuePerSession = Math.max(1, options.maxDuePerSession ?? 20);
  }

  has(chatId: number): boolean {
    return this.sessions.has(chatId);
  }

  async start(chatId: number, options: { tag?: string; limit?: number } = {}): Promise<ReviewStart> {
    const cards = await this.flashcards.due(chatId, {
      tag: options.tag,
      limit: Math.min(this.maxDuePerSession, options.limit ?? this.maxDuePerSession),
    });
    if (cards.length === 0) {
      throw new Error(
        options.tag
          ? `No hay tarjetas vencidas con #${options.tag}. Prueba sin filtro o crea tarjetas con /tarjeta.`
          : 'No hay tarjetas vencidas. Crea tarjetas con /tarjeta o espera a la próxima fecha.',
      );
    }
    const session: ReviewSession = {
      cards,
      index: 0,
      grades: { again: 0, hard: 0, good: 0, easy: 0 },
      startedAt: new Date().toISOString(),
      tag: options.tag,
      finished: false,
    };
    this.sessions.set(chatId, session);
    const intro = `🃏 Repaso: ${cards.length} tarjeta(s)${options.tag ? ` de #${options.tag}` : ''}.\nCalifica con Otra vez, Difícil, Bien o Fácil.`;
    return { total: cards.length, card: toSessionCard(cards[0]!), intro };
  }

  reveal(chatId: number): ReviewReveal | undefined {
    const session = this.sessions.get(chatId);
    const card = session && !session.finished ? session.cards[session.index] : undefined;
    if (!session || !card) return undefined;
    return { card: toSessionCard(card), answer: card.answer };
  }

  async rate(chatId: number, grade: ReviewGrade): Promise<ReviewResult | undefined> {
    const session = this.sessions.get(chatId);
    if (!session || session.finished) return undefined;
    const card = session.cards[session.index];
    if (!card) return undefined;
    await this.flashcards.rate(chatId, card.id, grade);
    session.grades[grade] += 1;
    session.last = { cardId: card.id, grade };
    session.index += 1;
    const finished = session.index >= session.cards.length;
    session.finished = finished;
    const remaining = session.cards.length - session.index;
    return {
      finished,
      cardId: card.id,
      grade,
      reviewed: session.index,
      total: session.cards.length,
      remaining,
      next: finished ? undefined : toSessionCard(session.cards[session.index]!),
      summary: finished ? this.summary(chatId) : undefined,
      undoable: true,
    };
  }

  async undo(chatId: number): Promise<ReviewUndo | undefined> {
    const session = this.sessions.get(chatId);
    const last = session?.last;
    if (!session || !last) return undefined;
    const card = await this.flashcards.undo(chatId, last.cardId);
    if (!card) return undefined;
    session.grades[last.grade] = Math.max(0, session.grades[last.grade] - 1);
    session.index = Math.max(0, session.index - 1);
    session.last = undefined;
    session.finished = false;
    return {
      card: toSessionCard(card),
      reviewed: session.index,
      total: session.cards.length,
    };
  }

  summary(chatId: number): string | undefined {
    const session = this.sessions.get(chatId);
    if (!session) return undefined;
    const reviewed = session.index;
    const correct = session.grades.good + session.grades.easy;
    const accuracy = reviewed > 0 ? Math.round((correct / reviewed) * 100) : 0;
    return [
      `Repaso terminado: ${reviewed}/${session.cards.length} tarjetas.`,
      `Otra vez: ${session.grades.again} · Difícil: ${session.grades.hard} · Bien: ${session.grades.good} · Fácil: ${session.grades.easy}`,
      `Precisión: ${accuracy}%.`,
    ].join('\n');
  }

  stop(chatId: number): boolean {
    return this.sessions.delete(chatId);
  }

  /** Rate limit reached: keep the summary but stop accepting cards. */
  markFinished(chatId: number): void {
    const session = this.sessions.get(chatId);
    if (session) session.finished = true;
  }
}

function toSessionCard(card: Flashcard): ReviewSessionCard {
  return {
    id: card.id,
    question: card.question,
    answer: card.answer,
    tags: card.tags,
    sourceTitle: card.sourceTitle,
  };
}
