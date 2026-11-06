import type { ReasoningEffort } from '../../config/env.js';
import type { UsageTracker } from '../usage.service.js';
import { OpenAICompatibleProvider } from './openai-compatible.provider.js';

export interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  usage?: UsageTracker;
}

/** Backwards-compatible wrapper around the generic OpenAI-compatible client. */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: OpenRouterProviderOptions) {
    super({
      name: 'openrouter',
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      timeoutMs: options.timeoutMs,
      usage: options.usage,
    });
  }
}
