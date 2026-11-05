import { ProviderError, type ChatProvider, type ChatRequest } from '../llm.service.js';

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  numCtx?: number;
  timeoutMs?: number;
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

export class OllamaProvider implements ChatProvider {
  readonly name = 'ollama' as const;
  readonly model: string;

  constructor(private readonly options: OllamaProviderOptions) {
    this.model = options.model;
  }

  chatText(request: ChatRequest): Promise<string> {
    return this.chat(request, false);
  }

  chatJson(request: ChatRequest): Promise<string> {
    return this.chat(request, true);
  }

  private async chat(request: ChatRequest, json: boolean): Promise<string> {
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/api/chat`;
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs ?? 120_000;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          stream: false,
          ...(json ? { format: 'json' } : {}),
          options: {
            temperature: request.temperature ?? 0.2,
            num_ctx: this.options.numCtx ?? 8192,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(
        `No se pudo conectar con Ollama en ${url}: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(`Ollama respondió ${response.status}: ${body.slice(0, 500)}`, this.name, response.status);
    }

    const data = (await response.json()) as OllamaChatResponse;
    const content = data.message?.content;
    if (!content) {
      throw new ProviderError(`Ollama no devolvió contenido (${data.error ?? 'sin detalle'}).`, this.name);
    }
    return content;
  }
}
