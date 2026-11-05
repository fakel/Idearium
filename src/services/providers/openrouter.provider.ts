import { OpenAICompatibleProvider } from './openai-compatible.provider.js';

export interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
}

/** Backwards-compatible wrapper around the generic OpenAI-compatible client. */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: OpenRouterProviderOptions) {
    super({
      name: 'openrouter',
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
      model: options.model,
      timeoutMs: options.timeoutMs,
    });
  }
}
