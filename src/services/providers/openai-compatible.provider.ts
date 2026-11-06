import type { ReasoningEffort, RemoteProviderName } from '../../config/env.js';
import { ProviderError, type ChatProvider, type ChatRequest } from '../llm.service.js';

export interface OpenAICompatibleProviderOptions {
  name: RemoteProviderName;
  apiKey: string;
  /** Base URL without the trailing `/chat/completions`. */
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

const displayNames: Record<RemoteProviderName, string> = {
  openrouter: 'OpenRouter',
};

/** Chat provider for OpenRouter's OpenAI-compatible `/chat/completions` API. */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly name: RemoteProviderName;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    this.name = options.name;
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  chatText(request: ChatRequest): Promise<string> {
    return this.chat(request, false);
  }

  chatJson(request: ChatRequest): Promise<string> {
    return this.chat(request, true);
  }

  private async chat(request: ChatRequest, json: boolean): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs ?? 120_000;
    const label = displayNames[this.name];

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
          ...(this.name === 'openrouter' ? { 'x-title': 'Idearium' } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          ...(this.options.reasoningEffort
            ? { reasoning: { effort: this.options.reasoningEffort } }
            : {}),
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(
        `No se pudo conectar con ${label}: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        `${label} respondió ${response.status}: ${body.slice(0, 500)}`,
        this.name,
        response.status,
      );
    }

    const data = (await response.json()) as ChatCompletionsResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError(
        `${label} no devolvió contenido (${data.error?.message ?? 'sin detalle'}).`,
        this.name,
      );
    }
    return content;
  }
}
