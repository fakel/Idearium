export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
}

export interface ChatProvider {
  readonly name: 'ollama' | 'openrouter';
  readonly model: string;
  /** Plain-text completion. */
  chatText(request: ChatRequest): Promise<string>;
  /** Completion forced into a JSON object. */
  chatJson(request: ChatRequest): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Remove Markdown code fences that some models wrap around JSON. */
export function stripCodeFence(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/** Extract the first JSON object from a model answer. */
export function extractJsonObject(raw: string): string {
  const text = stripCodeFence(raw);
  if (text.startsWith('{')) return text;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}
