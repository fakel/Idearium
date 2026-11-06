import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  currentUsageSession,
  formatUsageNote,
  formatUsageReport,
  formatUsd,
  UsageTracker,
  withUsageSession,
} from '../src/services/usage.service.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-usage-'));
  dirs.push(dir);
  return path.join(dir, 'usage.json');
}

describe('UsageTracker', () => {
  it('acumula tokens, coste y desglose por tipo', async () => {
    const tracker = new UsageTracker(await temporaryFile());
    await tracker.record({
      kind: 'chat',
      provider: 'openrouter',
      model: 'modelo/a',
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      costUsd: 0.0012,
    });
    await tracker.record({
      kind: 'embedding',
      provider: 'OpenRouter',
      model: 'baai/bge-m3',
      promptTokens: 50,
      totalTokens: 50,
      costUsd: 0.00001,
    });

    const snapshot = await tracker.snapshot();
    expect(snapshot.requests).toBe(2);
    expect(snapshot.totalTokens).toBe(170);
    expect(snapshot.costUsd).toBeCloseTo(0.00121, 8);
    expect(snapshot.byKind.chat?.costUsd).toBeCloseTo(0.0012, 8);
    expect(snapshot.byKind.embedding?.requests).toBe(1);
    expect(formatUsageReport(snapshot)).toContain('Uso de OpenRouter desde');
    expect(formatUsageReport(snapshot)).toContain('Chat:');
  });

  it('persiste el acumulado entre instancias', async () => {
    const file = await temporaryFile();
    const first = new UsageTracker(file);
    await first.record({
      kind: 'chat',
      provider: 'openrouter',
      model: 'modelo/a',
      totalTokens: 10,
      costUsd: 0.0005,
    });

    const second = new UsageTracker(file);
    const snapshot = await second.snapshot();
    expect(snapshot.requests).toBe(1);
    expect(snapshot.costUsd).toBeCloseTo(0.0005, 8);
    expect(snapshot.byModel['openrouter/modelo/a']?.totalTokens).toBe(10);
  });

  it('atribuye llamadas a la sesión de la petición actual', async () => {
    const tracker = new UsageTracker(await temporaryFile());
    await withUsageSession(async () => {
      await tracker.record({
        kind: 'chat',
        provider: 'openrouter',
        model: 'modelo/a',
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costUsd: 0.0001,
      });
      const session = currentUsageSession();
      expect(session?.size).toBe(1);
      const note = formatUsageNote(session, await tracker.snapshot());
      expect(note).toContain('$0.000100');
      expect(note).toContain('15 tokens');
      expect(note).toContain('total $0.000100');
    });
  });

  it('no muestra nota si la petición no generó coste ni tokens', async () => {
    await withUsageSession(async () => {
      expect(formatUsageNote(currentUsageSession())).toBe('');
    });
  });

  it('formatea importes con seis decimales', () => {
    expect(formatUsd(0.000105)).toBe('$0.000105');
    expect(formatUsd(undefined)).toBe('$0.000000');
  });
});
