import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger as defaultLogger, type Logger } from '../lib/logger.js';

export type UsageKind = 'chat' | 'ocr' | 'embedding' | 'stt';

/** One provider response. Missing token fields mean the provider did not report them. */
export interface UsageRecord {
  kind: UsageKind;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Cost in USD as reported by OpenRouter. */
  costUsd?: number;
}

export interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageSnapshot extends UsageTotals {
  since: string;
  lastAt?: string;
  byKind: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
}

interface PersistedUsage {
  version: 1;
  since: string;
  lastAt?: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  byKind: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
}

function emptyTotals(): UsageTotals {
  return { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
}

const roundUsd = (value: number): number => Math.round(value * 1e12) / 1e12;

function snapshotTotals(totals: UsageTotals): UsageTotals {
  return { ...totals };
}

export function formatUsd(value: number | undefined): string {
  const amount = Number.isFinite(value) ? (value as number) : 0;
  return `$${amount.toFixed(6)}`;
}

export function formatTokens(value: number): string {
  return new Intl.NumberFormat('es-PE').format(Math.max(0, Math.round(value)));
}

/** Per-update accumulator. Providers record into the active session via AsyncLocalStorage. */
export class UsageSession {
  private readonly entries: UsageRecord[] = [];

  add(record: UsageRecord): void {
    this.entries.push(record);
  }

  totals(): UsageTotals {
    const totals = emptyTotals();
    for (const record of this.entries) {
      totals.requests += 1;
      totals.promptTokens += record.promptTokens ?? 0;
      totals.completionTokens += record.completionTokens ?? 0;
      totals.totalTokens += record.totalTokens ?? 0;
      totals.costUsd = roundUsd(totals.costUsd + (record.costUsd ?? 0));
    }
    return totals;
  }

  get size(): number {
    return this.entries.length;
  }
}

const usageStorage = new AsyncLocalStorage<UsageSession>();

/** Run one Telegram update/CLI operation with its own usage accumulator. */
export function withUsageSession<T>(fn: (session: UsageSession) => Promise<T>): Promise<T> {
  return usageStorage.run(new UsageSession(), () => fn(usageStorage.getStore()!));
}

export function currentUsageSession(): UsageSession | undefined {
  return usageStorage.getStore();
}

/**
 * Aggregated OpenRouter usage, persisted as a small JSON file.
 * Only totals are stored: enough for "since the beginning", no conversation data.
 */
export class UsageTracker {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private state?: PersistedUsage;
  private loading?: Promise<void>;
  private saving: Promise<void> = Promise.resolve();

  constructor(filePath: string, options: { logger?: Logger; now?: () => Date } = {}) {
    this.filePath = filePath;
    this.logger = options.logger ?? defaultLogger;
    this.now = options.now ?? (() => new Date());
  }

  async record(record: UsageRecord): Promise<void> {
    currentUsageSession()?.add(record);
    await this.ensureLoaded();
    const state = this.state!;
    const at = this.now().toISOString();
    const normalized: UsageTotals = {
      requests: 1,
      promptTokens: record.promptTokens ?? 0,
      completionTokens: record.completionTokens ?? 0,
      totalTokens: record.totalTokens ?? 0,
      costUsd: record.costUsd ?? 0,
    };
    this.apply(state, normalized);
    addToBucket(state.byKind, record.kind, record);
    addToBucket(state.byModel, `${record.provider}/${record.model}`, record);
    state.lastAt = at;
    this.queueSave();
    await this.saving;
  }

  async snapshot(): Promise<UsageSnapshot> {
    await this.ensureLoaded();
    const state = this.state!;
    return {
      since: state.since,
      lastAt: state.lastAt,
      requests: state.requests,
      promptTokens: state.promptTokens,
      completionTokens: state.completionTokens,
      totalTokens: state.totalTokens,
      costUsd: state.costUsd,
      byKind: Object.fromEntries(
        Object.entries(state.byKind).map(([key, totals]) => [key, snapshotTotals(totals)]),
      ),
      byModel: Object.fromEntries(
        Object.entries(state.byModel).map(([key, totals]) => [key, snapshotTotals(totals)]),
      ),
    };
  }

  private apply(state: PersistedUsage, totals: UsageTotals): void {
    state.requests += totals.requests;
    state.promptTokens += totals.promptTokens;
    state.completionTokens += totals.completionTokens;
    state.totalTokens += totals.totalTokens;
    state.costUsd = roundUsd(state.costUsd + totals.costUsd);
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    const since = this.now().toISOString();
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedUsage>;
      this.state = {
        version: 1,
        since: typeof parsed.since === 'string' ? parsed.since : since,
        lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : undefined,
        requests: Number(parsed.requests) || 0,
        promptTokens: Number(parsed.promptTokens) || 0,
        completionTokens: Number(parsed.completionTokens) || 0,
        totalTokens: Number(parsed.totalTokens) || 0,
        costUsd: Number(parsed.costUsd) || 0,
        byKind: parsed.byKind ?? {},
        byModel: parsed.byModel ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          { error: error instanceof Error ? error.message : String(error), file: this.filePath },
          'usage.load_failed_resetting',
        );
      }
      this.state = {
        version: 1,
        since,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        byKind: {},
        byModel: {},
      };
    }
  }

  private queueSave(): void {
    this.saving = this.saving
      .then(() => this.save())
      .catch((error: unknown) => {
        this.logger.warn(
          { error: error instanceof Error ? error.message : String(error), file: this.filePath },
          'usage.save_failed',
        );
      });
  }

  private async save(): Promise<void> {
    if (!this.state) return;
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filePath);
  }
}

/** Add one response to the persisted aggregate. */
export function recordUsage(tracker: UsageTracker | undefined, record: UsageRecord): Promise<void> {
  return tracker?.record(record) ?? Promise.resolve();
}

function addToBucket(
  buckets: Record<string, UsageTotals>,
  key: string,
  record: UsageRecord,
): void {
  const bucket = (buckets[key] ??= emptyTotals());
  bucket.requests += 1;
  bucket.promptTokens += record.promptTokens ?? 0;
  bucket.completionTokens += record.completionTokens ?? 0;
  bucket.totalTokens += record.totalTokens ?? 0;
  bucket.costUsd = roundUsd(bucket.costUsd + (record.costUsd ?? 0));
}

export function mergeUsageTotals(
  ...parts: Array<UsageTotals | undefined>
): UsageTotals | undefined {
  const present = parts.filter((part): part is UsageTotals => Boolean(part));
  if (present.length === 0) return undefined;
  const merged = emptyTotals();
  for (const totals of present) {
    merged.requests += totals.requests;
    merged.promptTokens += totals.promptTokens;
    merged.completionTokens += totals.completionTokens;
    merged.totalTokens += totals.totalTokens;
    merged.costUsd = roundUsd(merged.costUsd + totals.costUsd);
  }
  return merged;
}

export function formatUsageTotalsNote(
  totals: UsageTotals | undefined,
  snapshot?: UsageSnapshot,
): string {
  if (!totals || totals.requests === 0) return '';
  if (totals.costUsd === 0 && totals.totalTokens === 0) return '';
  const tokens =
    totals.totalTokens > 0
      ? `${formatTokens(totals.totalTokens)} tokens`
      : 'sin tokens reportados';
  const total = snapshot ? ` · total ${formatUsd(snapshot.costUsd)}` : '';
  return `💵 ${formatUsd(totals.costUsd)} · ${tokens}${total}`;
}

export function formatUsageNote(
  session: UsageSession | undefined,
  snapshot?: UsageSnapshot,
): string {
  if (!session || session.size === 0) return '';
  return formatUsageTotalsNote(session.totals(), snapshot);
}

export function formatUsageReport(snapshot: UsageSnapshot): string {
  const since = snapshot.since.slice(0, 10);
  if (snapshot.requests === 0) {
    return `💵 Sin uso de OpenRouter registrado desde ${since}.`;
  }

  const lines = [
    `💵 Uso de OpenRouter desde ${since}`,
    `Total: ${formatUsd(snapshot.costUsd)} · ${formatTokens(snapshot.requests)} solicitudes · ${formatTokens(snapshot.totalTokens)} tokens`,
  ];

  const labels: Record<string, string> = {
    chat: 'Chat',
    ocr: 'OCR',
    embedding: 'Embeddings',
    stt: 'Transcripción',
  };
  const parts = Object.entries(snapshot.byKind)
    .filter(([, totals]) => totals.requests > 0)
    .map(([kind, totals]) => `${labels[kind] ?? kind}: ${formatUsd(totals.costUsd)} (${formatTokens(totals.requests)})`);
  if (parts.length > 0) lines.push(parts.join(' · '));

  const models = Object.entries(snapshot.byModel)
    .filter(([, totals]) => totals.requests > 0)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd)
    .slice(0, 5)
    .map(([model, totals]) => `- ${model}: ${formatUsd(totals.costUsd)} (${formatTokens(totals.requests)} solicitudes)`);
  if (models.length > 0) lines.push('Por modelo:', ...models);

  if (snapshot.lastAt) lines.push(`Última llamada: ${snapshot.lastAt.slice(0, 16).replace('T', ' ')} UTC`);
  return lines.join('\n');
}
