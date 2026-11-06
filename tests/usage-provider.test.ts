import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../src/services/providers/openai-compatible.provider.js';
import { UsageTracker } from '../src/services/usage.service.js';

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('OpenAICompatibleProvider usage', () => {
  it('pide usage.include y registra la respuesta de OpenRouter', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-usage-provider-'));
    dirs.push(dir);
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            model: 'deepseek/deepseek-v4.1-flash',
            choices: [{ message: { content: 'hola' } }],
            usage: {
              prompt_tokens: 40,
              completion_tokens: 4,
              total_tokens: 44,
              cost: 0.000042,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    const tracker = new UsageTracker(path.join(dir, 'usage.json'));
    const provider = new OpenAICompatibleProvider({
      name: 'openrouter',
      apiKey: 'or-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-v4.1-flash',
      usage: tracker,
    });

    await expect(provider.chatText({ messages: [{ role: 'user', content: 'hola' }] })).resolves.toBe('hola');
    expect(body.usage).toEqual({ include: true });

    const snapshot = await tracker.snapshot();
    expect(snapshot.requests).toBe(1);
    expect(snapshot.promptTokens).toBe(40);
    expect(snapshot.completionTokens).toBe(4);
    expect(snapshot.costUsd).toBeCloseTo(0.000042, 8);
    expect(snapshot.byKind.chat?.requests).toBe(1);
  });
});
