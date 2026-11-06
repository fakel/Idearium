import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../src/services/providers/openai-compatible.provider.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAICompatibleProvider', () => {
  it('envía reasoning.effort cuando está configurado', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const provider = new OpenAICompatibleProvider({
      name: 'openrouter',
      apiKey: 'or-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-v4.1-flash',
      reasoningEffort: 'none',
      timeoutMs: 5_000,
    });

    await expect(provider.chatJson({ messages: [{ role: 'user', content: 'hola' }] })).resolves.toBe(
      '{"ok":true}',
    );
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omite reasoning si no se configura', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: 'hola' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const provider = new OpenAICompatibleProvider({
      name: 'openrouter',
      apiKey: 'or-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
      timeoutMs: 5_000,
    });

    await expect(provider.chatText({ messages: [{ role: 'user', content: 'hola' }] })).resolves.toBe('hola');
    expect(body.reasoning).toBeUndefined();
  });
});
