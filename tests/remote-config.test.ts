import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('env remoto (solo OpenRouter)', () => {
  it('usa OpenRouter cuando hay clave e ignora claves de otros proveedores', () => {
    const env = parseEnv({
      OPENROUTER_API_KEY: 'or-key',
      DEEPSEEK_API_KEY: 'ds-key',
    });

    expect(env.hasRemote).toBe(true);
    expect(env.remoteProviders).toHaveLength(1);
    expect(env.remoteProviders[0]).toMatchObject({
      name: 'openrouter',
      model: 'openai/gpt-4o-mini',
      reasoningEffort: 'none',
    });
  });

  it('OPENROUTER_MODEL tiene prioridad sobre el alias histórico', () => {
    const env = parseEnv({
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_MODEL: 'google/gemini-3.1-flash-lite',
      LLM_REMOTE_MODEL: 'anthropic/claude-3.5-haiku',
    });

    expect(env.remoteProviders[0]!.model).toBe('google/gemini-3.1-flash-lite');
  });

  it('permite cambiar el esfuerzo de razonamiento', () => {
    const env = parseEnv({
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_REASONING_EFFORT: 'low',
    });

    expect(env.remoteProviders[0]!.reasoningEffort).toBe('low');
  });

  it('mantiene LLM_REMOTE_MODEL como alias de OpenRouter', () => {
    const env = parseEnv({
      OPENROUTER_API_KEY: 'or-key',
      LLM_REMOTE_MODEL: 'anthropic/claude-3.5-haiku',
    });

    expect(env.remoteProviders[0]!.model).toBe('anthropic/claude-3.5-haiku');
  });

  it('degrada remote_only sin claves y avisa', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = parseEnv({ LLM_PREFERENCE: 'remote_only' });

    expect(env.hasRemote).toBe(false);
    expect(env.effectivePreference).toBe('local_first');
    expect(warn).toHaveBeenCalled();
  });

  it('usa Gemma para visión y Qwen como alternativa por defecto', () => {
    const env = parseEnv({ OPENROUTER_API_KEY: 'or-key' });

    expect(env.visionModel).toBe('google/gemma-4-31b-it');
    expect(env.visionFallbackModel).toBe('qwen/qwen3-vl-30b-a3b-instruct');
  });

  it('exige OPENROUTER_API_KEY para embeddings remotos', () => {
    expect(() => parseEnv({ EMBEDDING_PROVIDER: 'openrouter' })).toThrow(
      'EMBEDDING_PROVIDER=openrouter requiere OPENROUTER_API_KEY',
    );
  });
});
