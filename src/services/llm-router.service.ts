import type { Env, EscalationReason, LlmPreference } from '../config/env.js';
import { logger as defaultLogger } from '../lib/logger.js';
import {
  ValidationError,
  type ChatMessage,
  type ChatProvider,
  type ChatRequest,
} from './llm.service.js';
import { OllamaProvider } from './providers/ollama.provider.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider.js';
import type { UsageTracker } from './usage.service.js';

export interface RouterLogger {
  info: (obj: unknown, message: string) => void;
  warn: (obj: unknown, message: string) => void;
  debug: (obj: unknown, message: string) => void;
}

export interface RouterConfig {
  preference: LlmPreference;
  escalateOn: EscalationReason[];
  maxLocalChars: number;
  timeoutMs: number;
  hasRemote: boolean;
}

export interface RouterProviders {
  local: ChatProvider;
  /** Remote providers in routing order. */
  remotes?: ChatProvider[];
  /** Legacy single-provider field. */
  remote?: ChatProvider;
}

export interface JsonCompletionRequest<T> {
  messages: ChatMessage[];
  /** Parses and validates raw model output; must throw on invalid data. */
  parse: (raw: string) => T;
  /** Explicit `/remoto` flag or `--remote`. */
  explicitRemote?: boolean;
  /** Size of the source text, used for the long_input trigger. */
  inputChars?: number;
  temperature?: number;
}

export interface TextCompletionRequest {
  messages: ChatMessage[];
  explicitRemote?: boolean;
  inputChars?: number;
  temperature?: number;
}

export interface Completion<T> {
  value: T;
  raw: string;
  provider: string;
  model: string;
  usedRemote: boolean;
  /** Why this provider was chosen. */
  reason: string;
}

interface Plan {
  order: ChatProvider[];
  reason: string;
}

const remoteSeparator = ' · ';

export class LlmRouter {
  private readonly local: ChatProvider;
  private readonly remotes: ChatProvider[];

  constructor(
    private readonly config: RouterConfig,
    providers: RouterProviders,
    private readonly logger: RouterLogger = defaultLogger,
  ) {
    this.local = providers.local;
    this.remotes = providers.remotes ?? (providers.remote ? [providers.remote] : []);
  }

  status(): string {
    const remote =
      this.remotes.length > 0
        ? this.remotes.map((provider) => `${provider.name}: ${provider.model}`).join(', ')
        : 'sin proveedor remoto (OPENROUTER_API_KEY no configurada)';
    return [
      `Ollama: ${this.local.model}`,
      `remoto: ${remote}`,
      `preferencia: ${this.config.preference}${remoteSeparator}escala: ${this.config.escalateOn.join(',') || 'nunca'}`,
    ].join(remoteSeparator);
  }

  async completeJson<T>(request: JsonCompletionRequest<T>): Promise<Completion<T>> {
    const plan = this.plan(request.explicitRemote, request.inputChars ?? 0);
    let lastError: unknown;

    for (let index = 0; index < plan.order.length; index += 1) {
      const provider = plan.order[index]!;
      const isLocal = provider === this.local;
      try {
        const result = await this.attemptJson(provider, isLocal, request);
        const completion: Completion<T> = {
          ...result,
          provider: provider.name,
          model: provider.model,
          usedRemote: !isLocal,
          reason: plan.reason,
        };
        this.logger.info(
          { provider: completion.provider, model: completion.model, reason: plan.reason },
          'llm.completion',
        );
        return completion;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          {
            provider: provider.name,
            error: error instanceof Error ? error.message : String(error),
          },
          'llm.provider_error',
        );

        const canEscalate =
          isLocal &&
          error instanceof ValidationError &&
          this.remotes.length > 0 &&
          this.config.escalateOn.includes('validation_failure') &&
          !plan.order.some((candidate) => this.remotes.includes(candidate));

        if (canEscalate) {
          const target = this.remotes.map((remote) => remote.name).join(', ');
          this.logger.warn(
            { providers: target, reason: 'validation_failure' },
            'llm.escalating_to_remote',
          );
          plan.order.push(...this.remotes);
          plan.reason = 'validation_failure';
        }
      }
    }

    throw lastError ?? new Error('No hay proveedor LLM disponible.');
  }

  async completeText(request: TextCompletionRequest): Promise<Completion<string>> {
    const plan = this.plan(request.explicitRemote, request.inputChars ?? 0);
    let lastError: unknown;

    for (const provider of plan.order) {
      try {
        const raw = await provider.chatText(this.chatRequest(request));
        const completion: Completion<string> = {
          value: raw,
          raw,
          provider: provider.name,
          model: provider.model,
          usedRemote: provider !== this.local,
          reason: plan.reason,
        };
        this.logger.info(
          { provider: completion.provider, model: completion.model, reason: plan.reason },
          'llm.completion',
        );
        return completion;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          { provider: provider.name, error: error instanceof Error ? error.message : String(error) },
          'llm.provider_error',
        );
      }
    }

    throw lastError ?? new Error('No hay proveedor LLM disponible.');
  }

  private chatRequest(request: { messages: ChatMessage[]; temperature?: number }): ChatRequest {
    return {
      messages: request.messages,
      temperature: request.temperature,
      timeoutMs: this.config.timeoutMs,
    };
  }

  private async attemptJson<T>(
    provider: ChatProvider,
    isLocal: boolean,
    request: JsonCompletionRequest<T>,
  ): Promise<{ value: T; raw: string }> {
    let messages = request.messages;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await provider.chatJson({
        messages,
        temperature: request.temperature,
        timeoutMs: this.config.timeoutMs,
      });

      try {
        return { value: request.parse(raw), raw };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!isLocal || attempt === 1) {
          throw new ValidationError(message, provider.name, raw);
        }
        messages = [
          ...request.messages,
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content: `Tu respuesta anterior no pasó la validación (${message}). Devuelve únicamente el objeto JSON corregido, sin explicaciones ni bloques de código.`,
          },
        ];
      }
    }

    throw new ValidationError(
      lastError instanceof Error ? lastError.message : String(lastError),
      provider.name,
      '',
    );
  }

  private plan(explicitRemote: boolean | undefined, inputChars: number): Plan {
    const escalateExplicit = Boolean(explicitRemote) && this.config.escalateOn.includes('explicit_flag');
    const escalateLong =
      inputChars > this.config.maxLocalChars && this.config.escalateOn.includes('long_input');
    const hasRemotes = this.remotes.length > 0;

    switch (this.config.preference) {
      case 'local_only':
        return { order: [this.local], reason: 'local_only' };

      case 'remote_only':
        if (!hasRemotes) {
          throw new Error(
            'LLM_PREFERENCE=remote_only pero no hay OPENROUTER_API_KEY configurada.',
          );
        }
        return { order: [...this.remotes], reason: 'remote_only' };

      case 'remote_first':
        return hasRemotes
          ? { order: [...this.remotes, this.local], reason: 'remote_first' }
          : { order: [this.local], reason: 'remote_unavailable' };

      case 'local_first':
      default:
        if (hasRemotes && escalateExplicit) {
          return { order: [...this.remotes, this.local], reason: 'explicit_flag' };
        }
        if (hasRemotes && escalateLong) {
          return { order: [...this.remotes, this.local], reason: 'long_input' };
        }
        return { order: [this.local], reason: 'local_first' };
    }
  }
}

export function createLlmRouter(
  env: Env,
  logger: RouterLogger = defaultLogger,
  usage?: UsageTracker,
): LlmRouter {
  const local = new OllamaProvider({
    baseUrl: env.OLLAMA_API_URL,
    model: env.OLLAMA_MODEL,
    numCtx: env.OLLAMA_NUM_CTX,
    timeoutMs: env.LLM_TIMEOUT_MS,
  });

  const remotes = env.remoteProviders.map(
    (provider) =>
      new OpenAICompatibleProvider({
        name: provider.name,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: provider.model,
        reasoningEffort: provider.reasoningEffort,
        timeoutMs: env.LLM_TIMEOUT_MS,
        usage,
      }),
  );

  return new LlmRouter(
    {
      preference: env.effectivePreference,
      escalateOn: env.LLM_ESCALATE_ON,
      maxLocalChars: env.LLM_MAX_LOCAL_CHARS,
      timeoutMs: env.LLM_TIMEOUT_MS,
      hasRemote: remotes.length > 0,
    },
    { local, remotes },
    logger,
  );
}
