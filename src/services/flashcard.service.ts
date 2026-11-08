import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localDateKey } from '../lib/local-time.js';
import { logger as defaultLogger, type Logger } from '../lib/logger.js';
import {
  reviewGrades,
  newCardSchedule,
  scheduleReview,
  type ReviewGrade,
  type SchedulingState,
} from '../lib/sm2.js';

export interface ReviewPrevious extends SchedulingState {
  dueAt: string;
}

export interface Flashcard extends SchedulingState {
  id: string;
  chatId: number;
  question: string;
  answer: string;
  tags: string[];
  sourceNote: string;
  sourceTitle: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  suspended: boolean;
  leech: boolean;
  lastReview?: { at: string; grade: ReviewGrade; previous: ReviewPrevious };
}

export interface FlashcardInput {
  question: string;
  answer: string;
  tags?: string[];
  sourceNote: string;
  sourceTitle: string;
}

export interface FlashcardUpdate {
  question?: string;
  answer?: string;
  tags?: string[];
}

export interface DailyStats {
  reviews: number;
  grades: Record<ReviewGrade, number>;
}

export interface NotificationState {
  date: string;
  slots: string[];
}

export interface FlashcardStats {
  total: number;
  active: number;
  due: number;
  suspended: number;
  leeches: number;
  nextDueAt?: string;
  todayReviews: number;
  reviewsLast30Days: number;
  accuracyLast30Days?: number;
  streak: number;
  byTag: Record<string, number>;
}

export interface RateResult {
  card: Flashcard;
  previous: ReviewPrevious;
  reviewsToday: number;
  dailyLimit: number;
}

interface PersistedFlashcards {
  version: 1;
  cards: Flashcard[];
  daily: Record<string, Record<string, DailyStats>>;
  notifications: Record<string, NotificationState>;
}

export interface FlashcardServiceOptions {
  logger?: Logger;
  now?: () => Date;
  maxCardsPerChat?: number;
  maxReviewsPerDay?: number;
  leechThreshold?: number;
  timeZone?: string;
}

export class FlashcardError extends Error {
  readonly code: 'not_found' | 'duplicate' | 'limit' | 'daily_limit' | 'invalid';
  constructor(code: FlashcardError['code'], message: string) {
    super(message);
    this.name = 'FlashcardError';
    this.code = code;
  }
}

const MAX_QUESTION = 500;
const MAX_ANSWER = 2_000;
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 40;

const emptyDaily = (): DailyStats => ({
  reviews: 0,
  grades: { again: 0, hard: 0, good: 0, easy: 0 },
});

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const normalizeTags = (tags: string[] | undefined): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/^#/, '').toLowerCase();
    if (!tag || seen.has(tag)) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new FlashcardError('invalid', `La etiqueta "${tag.slice(0, 20)}…" es demasiado larga.`);
    }
    seen.add(tag);
    result.push(tag);
  }
  if (result.length > MAX_TAGS) {
    throw new FlashcardError('invalid', `Máximo ${MAX_TAGS} etiquetas por tarjeta.`);
  }
  return result;
};

function validateText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!text) throw new FlashcardError('invalid', `La ${label} no puede estar vacía.`);
  if (text.length > max) {
    throw new FlashcardError('invalid', `La ${label} no puede superar ${max} caracteres.`);
  }
  return text;
}

/**
 * Persistent spaced-repetition box, one per Telegram chat.
 * The JSON file is the source of truth; all writes are serialized and atomic.
 */
export class FlashcardService {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly maxCardsPerChat: number;
  private readonly maxReviewsPerDay: number;
  private readonly leechThreshold: number;
  private readonly timeZone: string;
  private state?: PersistedFlashcards;
  private loading?: Promise<void>;
  private saving: Promise<void> = Promise.resolve();

  constructor(filePath: string, options: FlashcardServiceOptions = {}) {
    this.filePath = filePath;
    this.logger = options.logger ?? defaultLogger;
    this.now = options.now ?? (() => new Date());
    this.maxCardsPerChat = options.maxCardsPerChat ?? 5_000;
    this.maxReviewsPerDay = options.maxReviewsPerDay ?? 40;
    this.leechThreshold = options.leechThreshold ?? 6;
    this.timeZone = options.timeZone ?? 'America/Lima';
  }

  async list(chatId: number, query?: string): Promise<Flashcard[]> {
    await this.ensureLoaded();
    const cards = this.state!.cards.filter((card) => card.chatId === chatId);
    const q = query ? normalize(query) : '';
    const filtered = q
      ? cards.filter(
          (card) =>
            normalize(card.question).includes(q) ||
            normalize(card.answer).includes(q) ||
            normalize(card.sourceTitle).includes(q) ||
            card.tags.some((tag) => normalize(tag).includes(q.replace(/^#/, ''))),
        )
      : cards;
    return filtered.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  async get(chatId: number, id: string): Promise<Flashcard | undefined> {
    await this.ensureLoaded();
    return this.state!.cards.find((card) => card.chatId === chatId && card.id === id);
  }

  async addMany(chatId: number, inputs: FlashcardInput[]): Promise<Flashcard[]> {
    await this.ensureLoaded();
    const state = this.state!;
    const existing = state.cards.filter((card) => card.chatId === chatId);
    if (existing.length + inputs.length > this.maxCardsPerChat) {
      throw new FlashcardError(
        'limit',
        `Límite de ${this.maxCardsPerChat} tarjetas por chat alcanzado. Borra algunas antes de añadir más.`,
      );
    }

    const seen = new Set(existing.map((card) => `${normalize(card.question)}\n${normalize(card.answer)}`));
    const created: Flashcard[] = [];
    const at = this.now();
    const nowIso = at.toISOString();

    for (const input of inputs) {
      const question = validateText(input.question, 'pregunta', MAX_QUESTION);
      const answer = validateText(input.answer, 'respuesta', MAX_ANSWER);
      const key = `${normalize(question)}\n${normalize(answer)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const schedule = newCardSchedule(at);
      created.push({
        id: this.newId(chatId, state.cards),
        chatId,
        question,
        answer,
        tags: normalizeTags(input.tags),
        sourceNote: input.sourceNote,
        sourceTitle: input.sourceTitle,
        createdAt: nowIso,
        updatedAt: nowIso,
        dueAt: schedule.dueAt,
        intervalMinutes: schedule.intervalMinutes,
        ease: schedule.ease,
        repetitions: schedule.repetitions,
        lapses: schedule.lapses,
        suspended: false,
        leech: false,
      });
    }

    if (created.length === 0) {
      throw new FlashcardError('duplicate', 'Todas las tarjetas ya existen en tu caja.');
    }
    state.cards.push(...created);
    await this.persist();
    return created;
  }

  async update(chatId: number, id: string, update: FlashcardUpdate): Promise<Flashcard> {
    await this.ensureLoaded();
    const card = this.requireCard(chatId, id);
    if (update.question !== undefined) card.question = validateText(update.question, 'pregunta', MAX_QUESTION);
    if (update.answer !== undefined) card.answer = validateText(update.answer, 'respuesta', MAX_ANSWER);
    if (update.tags !== undefined) card.tags = normalizeTags(update.tags);
    const duplicate = this.state!.cards.some(
      (other) =>
        other.chatId === chatId &&
        other.id !== id &&
        normalize(other.question) === normalize(card.question) &&
        normalize(other.answer) === normalize(card.answer),
    );
    if (duplicate) throw new FlashcardError('duplicate', 'Ya existe una tarjeta con esa pregunta y respuesta.');
    card.updatedAt = this.now().toISOString();
    await this.persist();
    return card;
  }

  async remove(chatId: number, id: string): Promise<boolean> {
    await this.ensureLoaded();
    const state = this.state!;
    const index = state.cards.findIndex((card) => card.chatId === chatId && card.id === id);
    if (index === -1) return false;
    state.cards.splice(index, 1);
    await this.persist();
    return true;
  }

  async setSuspended(chatId: number, id: string, suspended: boolean): Promise<Flashcard> {
    await this.ensureLoaded();
    const card = this.requireCard(chatId, id);
    card.suspended = suspended;
    card.updatedAt = this.now().toISOString();
    await this.persist();
    return card;
  }

  async due(
    chatId: number,
    options: { tag?: string; limit?: number; now?: Date } = {},
  ): Promise<Flashcard[]> {
    await this.ensureLoaded();
    const at = (options.now ?? this.now()).toISOString();
    const tag = options.tag?.trim().replace(/^#/, '').toLowerCase();
    const limit = Math.max(1, options.limit ?? 20);
    return this.state!.cards
      .filter(
        (card) =>
          card.chatId === chatId &&
          !card.suspended &&
          card.dueAt <= at &&
          (!tag || card.tags.includes(tag)),
      )
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, limit);
  }

  async rate(chatId: number, id: string, grade: ReviewGrade): Promise<RateResult> {
    await this.ensureLoaded();
    if (!reviewGrades.includes(grade)) throw new FlashcardError('invalid', 'Calificación inválida.');
    const card = this.requireCard(chatId, id);
    const at = this.now();
    const date = localDateKey(at, this.timeZone);
    const daily = this.dailyFor(chatId, date);
    if (daily.reviews >= this.maxReviewsPerDay) {
      throw new FlashcardError(
        'daily_limit',
        `Has alcanzado el límite de ${this.maxReviewsPerDay} repasos hoy. Vuelve mañana.`,
      );
    }

    const previous: ReviewPrevious = {
      dueAt: card.dueAt,
      intervalMinutes: card.intervalMinutes,
      ease: card.ease,
      repetitions: card.repetitions,
      lapses: card.lapses,
    };
    const next = scheduleReview(card, grade, at, this.leechThreshold);
    card.dueAt = next.dueAt;
    card.intervalMinutes = next.intervalMinutes;
    card.ease = next.ease;
    card.repetitions = next.repetitions;
    card.lapses = next.lapses;
    card.leech = next.leech;
    card.updatedAt = at.toISOString();
    card.lastReview = { at: at.toISOString(), grade, previous };
    daily.reviews += 1;
    daily.grades[grade] += 1;
    await this.persist();
    return { card, previous, reviewsToday: daily.reviews, dailyLimit: this.maxReviewsPerDay };
  }

  /** Undo the last rating of a card, if it is still the current one. */
  async undo(chatId: number, id: string): Promise<Flashcard | undefined> {
    await this.ensureLoaded();
    const card = this.requireCard(chatId, id);
    const last = card.lastReview;
    if (!last) return undefined;
    const date = localDateKey(new Date(last.at), this.timeZone);
    const daily = this.dailyFor(chatId, date);
    if (daily.reviews > 0) daily.reviews -= 1;
    if (daily.grades[last.grade] > 0) daily.grades[last.grade] -= 1;
    card.dueAt = last.previous.dueAt;
    card.intervalMinutes = last.previous.intervalMinutes;
    card.ease = last.previous.ease;
    card.repetitions = last.previous.repetitions;
    card.lapses = last.previous.lapses;
    card.leech = card.lapses >= this.leechThreshold;
    card.updatedAt = this.now().toISOString();
    delete card.lastReview;
    await this.persist();
    return card;
  }

  async stats(chatId: number): Promise<FlashcardStats> {
    await this.ensureLoaded();
    const at = this.now();
    const nowIso = at.toISOString();
    const cards = this.state!.cards.filter((card) => card.chatId === chatId);
    const active = cards.filter((card) => !card.suspended);
    const due = active.filter((card) => card.dueAt <= nowIso);
    const next = active
      .map((card) => card.dueAt)
      .filter((dueAt) => dueAt > nowIso)
      .sort()[0];
    const byTag: Record<string, number> = {};
    for (const card of active) {
      for (const tag of card.tags) byTag[tag] = (byTag[tag] ?? 0) + 1;
    }

    const daily = this.state!.daily[String(chatId)] ?? {};
    const today = daily[localDateKey(at, this.timeZone)] ?? emptyDaily();
    const last30 = new Date(at.getTime() - 30 * 24 * 60 * 60_000);
    let reviews30 = 0;
    let good30 = 0;
    for (const [date, stats] of Object.entries(daily)) {
      if (new Date(`${date}T12:00:00Z`) < last30) continue;
      reviews30 += stats.reviews;
      good30 += stats.grades.good + stats.grades.easy;
    }

    return {
      total: cards.length,
      active: active.length,
      due: due.length,
      suspended: cards.length - active.length,
      leeches: active.filter((card) => card.leech).length,
      nextDueAt: next,
      todayReviews: today.reviews,
      reviewsLast30Days: reviews30,
      accuracyLast30Days: reviews30 > 0 ? good30 / reviews30 : undefined,
      streak: this.streak(chatId, at),
      byTag,
    };
  }

  async getNotification(chatId: number): Promise<NotificationState | undefined> {
    await this.ensureLoaded();
    return this.state!.notifications[String(chatId)];
  }

  async markNotified(chatId: number, date: string, slot: string): Promise<void> {
    await this.ensureLoaded();
    const key = String(chatId);
    const current = this.state!.notifications[key];
    const slots = current?.date === date ? [...new Set([...current.slots, slot])] : [slot];
    this.state!.notifications[key] = { date, slots };
    await this.persist();
  }

  async chatIds(): Promise<number[]> {
    await this.ensureLoaded();
    return [...new Set(this.state!.cards.map((card) => card.chatId))];
  }

  private streak(chatId: number, at: Date): number {
    const daily = this.state!.daily[String(chatId)] ?? {};
    let cursor = new Date(at);
    if (!daily[localDateKey(cursor, this.timeZone)]?.reviews) {
      cursor = new Date(cursor.getTime() - 24 * 60 * 60_000);
    }
    let count = 0;
    for (let i = 0; i < 400; i += 1) {
      const key = localDateKey(cursor, this.timeZone);
      if (!daily[key]?.reviews) break;
      count += 1;
      cursor = new Date(cursor.getTime() - 24 * 60 * 60_000);
    }
    return count;
  }

  private dailyFor(chatId: number, date: string): DailyStats {
    const key = String(chatId);
    const perChat = (this.state!.daily[key] ??= {});
    return (perChat[date] ??= emptyDaily());
  }

  private requireCard(chatId: number, id: string): Flashcard {
    const card = this.state!.cards.find((item) => item.chatId === chatId && item.id === id);
    if (!card) throw new FlashcardError('not_found', `No encontré la tarjeta ${id}.`);
    return card;
  }

  private newId(chatId: number, cards: Flashcard[]): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = randomUUID().replace(/-/g, '').slice(0, 8);
      if (!cards.some((card) => card.chatId === chatId && card.id === id)) return id;
    }
    throw new FlashcardError('limit', 'No se pudo generar un ID único para la tarjeta.');
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedFlashcards>;
      this.state = {
        version: 1,
        cards: Array.isArray(parsed.cards) ? (parsed.cards as Flashcard[]) : [],
        daily: parsed.daily && typeof parsed.daily === 'object' ? parsed.daily : {},
        notifications:
          parsed.notifications && typeof parsed.notifications === 'object' ? parsed.notifications : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const backup = `${this.filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await rename(this.filePath, backup).catch(() => undefined);
        this.logger.warn(
          { error: error instanceof Error ? error.message : String(error), file: this.filePath, backup },
          'flashcards.load_failed_resetting',
        );
      }
      this.state = { version: 1, cards: [], daily: {}, notifications: {} };
    }
  }

  private persist(): Promise<void> {
    this.saving = this.saving
      .then(() => this.save())
      .catch((error: unknown) => {
        this.logger.warn(
          { error: error instanceof Error ? error.message : String(error), file: this.filePath },
          'flashcards.save_failed',
        );
      });
    return this.saving;
  }

  private async save(): Promise<void> {
    if (!this.state) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filePath);
  }
}
