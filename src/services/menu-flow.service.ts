export type AwaitingAction = 'query' | 'memorize' | 'quiz';

interface PendingAction {
  action: AwaitingAction;
  expiresAt: number;
}

/** Recuerda qué dato está esperando el bot tras pulsar un botón del menú. */
export class AwaitingActionStore {
  private readonly actions = new Map<number, PendingAction>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  set(chatId: number, action: AwaitingAction): void {
    this.actions.set(chatId, { action, expiresAt: this.now() + this.ttlMs });
  }

  get(chatId: number): AwaitingAction | undefined {
    const pending = this.actions.get(chatId);
    if (!pending) return undefined;
    if (pending.expiresAt <= this.now()) {
      this.actions.delete(chatId);
      return undefined;
    }
    return pending.action;
  }

  /** Devuelve la acción y la consume; el siguiente texto libre ya no la repite. */
  take(chatId: number): AwaitingAction | undefined {
    const action = this.get(chatId);
    this.actions.delete(chatId);
    return action;
  }

  clear(chatId: number): boolean {
    return this.actions.delete(chatId);
  }

  size(): number {
    return this.actions.size;
  }
}
