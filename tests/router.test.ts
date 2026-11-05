import { describe, expect, it, vi } from 'vitest';
import { LlmRouter, type RouterLogger } from '../src/services/llm-router.service.js';
import type { ChatProvider } from '../src/services/llm.service.js';

const logger: RouterLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

function provider(
  name: ChatProvider['name'],
  model: string,
  reply: () => Promise<string>,
): ChatProvider {
  return {
    name,
    model,
    chatJson: vi.fn(reply),
    chatText: vi.fn(reply),
  };
}

function config(overrides: Partial<ConstructorParameters<typeof LlmRouter>[0]> = {}) {
  return {
    preference: 'local_first' as const,
    escalateOn: ['validation_failure' as const],
    maxLocalChars: 100,
    timeoutMs: 1_000,
    hasRemote: true,
    ...overrides,
  };
}

const jsonRequest = {
  messages: [{ role: 'user' as const, content: 'hola' }],
  parse: (raw: string) => JSON.parse(raw) as { ok: boolean },
};

describe('LlmRouter con fallback remoto', () => {
  it('en remote_only pasa al siguiente proveedor si el primero falla', async () => {
    const local = provider('ollama', 'local', async () => '{"ok":true}');
    const down = provider('openrouter', 'or-model', async () => {
      throw new Error('sin saldo');
    });
    const backup = provider('openrouter', 'or-backup', async () => '{"ok":true}');

    const router = new LlmRouter(
      config({ preference: 'remote_only' }),
      { local, remotes: [down, backup] },
      logger,
    );

    const result = await router.completeJson(jsonRequest);
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('or-backup');
    expect(result.usedRemote).toBe(true);
    expect(local.chatJson).not.toHaveBeenCalled();
  });

  it('escala a todos los remotos cuando el local no valida el JSON', async () => {
    const local = provider('ollama', 'local', async () => 'no es json');
    const remotes = [
      provider('openrouter', 'or-model', async () => {
        throw new Error('down');
      }),
      provider('openrouter', 'or-backup', async () => '{"ok":true}'),
    ];

    const router = new LlmRouter(config(), { local, remotes }, logger);
    const result = await router.completeJson(jsonRequest);

    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('or-backup');
    expect(result.reason).toBe('validation_failure');
    expect(result.usedRemote).toBe(true);
  });

  it('remote_first cae al local si todos los remotos fallan', async () => {
    const local = provider('ollama', 'local', async () => 'respuesta local');
    const remotes = [
      provider('openrouter', 'or-model', async () => {
        throw new Error('down');
      }),
    ];

    const router = new LlmRouter(
      config({ preference: 'remote_first' }),
      { local, remotes },
      logger,
    );

    const result = await router.completeText({
      messages: [{ role: 'user', content: 'hola' }],
    });
    expect(result.value).toBe('respuesta local');
    expect(result.usedRemote).toBe(false);
    expect(result.reason).toBe('remote_first');
  });
});
