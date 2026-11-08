import { isSlotDue, slotDate } from '../lib/local-time.js';
import { logger as defaultLogger, type Logger } from '../lib/logger.js';
import type { FlashcardService } from './flashcard.service.js';

export interface ReviewSchedulerConfig {
  enabled: boolean;
  timeZone: string;
  notifyTimes: string[];
  graceMinutes: number;
  maxReviewsPerDay: number;
}

export interface ReviewSchedulerOptions {
  now?: () => Date;
  intervalMs?: number;
  logger?: Logger;
}

export type ReviewNotifier = (chatId: number, text: string) => Promise<void>;

/**
 * Sends one reminder per configured slot, per chat and local day.
 * It is deliberately idempotent: a restart inside the grace window does not
 * send the same reminder twice.
 */
export class ReviewSchedulerService {
  private readonly config: ReviewSchedulerConfig;
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly logger: Logger;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly flashcards: FlashcardService,
    private readonly notify: ReviewNotifier,
    config: ReviewSchedulerConfig,
    options: ReviewSchedulerOptions = {},
  ) {
    this.config = config;
    this.now = options.now ?? (() => new Date());
    this.intervalMs = options.intervalMs ?? 60_000;
    this.logger = options.logger ?? defaultLogger;
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.info(
      { times: this.config.notifyTimes, timeZone: this.config.timeZone },
      'review_scheduler.started',
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<number> {
    if (!this.config.enabled || this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const at = this.now();
      const chatIds = await this.flashcards.chatIds();
      for (const chatId of chatIds) {
        const stats = await this.flashcards.stats(chatId);
        if (stats.due === 0) continue;
        if (stats.todayReviews >= this.config.maxReviewsPerDay) continue;

        const state = await this.flashcards.getNotification(chatId);
        for (const slot of this.config.notifyTimes) {
          if (!isSlotDue(at, this.config.timeZone, slot, this.config.graceMinutes)) continue;
          const date = slotDate(at, this.config.timeZone, slot, this.config.graceMinutes);
          if (state?.date === date && state.slots.includes(slot)) continue;

          const text = [
            `🃏 Tienes ${stats.due} tarjeta(s) para repasar.`,
            'Usa /repasar para empezar.',
            stats.leeches > 0 ? `Atención: ${stats.leeches} tarjeta(s) son leeches (muchos fallos).` : '',
          ]
            .filter(Boolean)
            .join('\n');
          await this.notify(chatId, text);
          await this.flashcards.markNotified(chatId, date, slot);
          sent += 1;
          break; // one reminder per tick is enough
        }
      }
      return sent;
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'review_scheduler.tick_failed',
      );
      return sent;
    } finally {
      this.running = false;
    }
  }
}
