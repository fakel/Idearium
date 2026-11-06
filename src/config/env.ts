import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const llmPreferences = ['local_only', 'local_first', 'remote_first', 'remote_only'] as const;
export type LlmPreference = (typeof llmPreferences)[number];

export const escalationReasons = ['validation_failure', 'explicit_flag', 'long_input'] as const;
export type EscalationReason = (typeof escalationReasons)[number];

export const remoteProviderNames = ['openrouter'] as const;
export type RemoteProviderName = (typeof remoteProviderNames)[number];

export const embeddingProviders = ['ollama', 'openrouter'] as const;
export type EmbeddingProvider = (typeof embeddingProviders)[number];

export const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

export interface RemoteProviderConfig {
  name: RemoteProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const escalationSchema = z
  .string()
  .default('validation_failure,explicit_flag')
  .transform((value, ctx) => {
    const parsed = csv(value);
    const invalid = parsed.filter((item) => !escalationReasons.includes(item as EscalationReason));
    if (invalid.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `LLM_ESCALATE_ON contiene valores inválidos: ${invalid.join(', ')}. Válidos: ${escalationReasons.join(', ')}`,
      });
      return z.NEVER;
    }
    return parsed as EscalationReason[];
  });

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().optional().default(''),
  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .default('')
    .transform((value) => csv(value)),

  OLLAMA_API_URL: z.string().trim().min(1).default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().trim().min(1).default('qwen2.5:7b-instruct'),
  OLLAMA_EMBED_MODEL: z.string().trim().min(1).default('bge-m3'),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(8192),

  WHISPER_API_URL: z.string().trim().min(1).default('http://127.0.0.1:8000'),
  // Opcional: solo para proveedores externos compatibles con OpenAI.
  WHISPER_API_KEY: z.string().trim().default(''),
  WHISPER_MODEL: z.string().trim().min(1).default('small'),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  OBSIDIAN_VAULT_PATH: z
    .string()
    .trim()
    .min(1)
    .default(path.join(os.homedir(), 'Documents', 'IdeariumVault')),
  NOTE_SUBDIR: z.string().trim().min(1).default('Idearium'),

  LANCEDB_PATH: z.string().trim().min(1).default('./data/lancedb'),
  AUDIO_DIR: z.string().trim().min(1).default('./data/audio'),
  DOCUMENT_DIR: z.string().trim().min(1).default('./data/documents'),
  DOCUMENT_MAX_CHARS: z.coerce.number().int().min(1_000).max(1_000_000).default(200_000),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),

  LLM_PREFERENCE: z.enum(llmPreferences).default('local_first'),
  LLM_ESCALATE_ON: escalationSchema,
  LLM_MAX_LOCAL_CHARS: z.coerce.number().int().positive().default(12_000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  OPENROUTER_API_KEY: z.string().trim().optional().default(''),
  OPENROUTER_BASE_URL: z.string().trim().min(1).default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z.string().trim().default(''),
  /** none = sin tokens de razonamiento; subir solo para tareas que lo necesiten. */
  OPENROUTER_REASONING_EFFORT: z.enum(reasoningEfforts).default('none'),
  /** Alias histórico: si está definido, se usa como modelo de OpenRouter. */
  LLM_REMOTE_MODEL: z.string().trim().default(''),

  // Los embeddings también pueden ser remotos para servidores sin GPU.
  EMBEDDING_PROVIDER: z.enum(embeddingProviders).default('ollama'),
  OPENROUTER_EMBED_MODEL: z.string().trim().min(1).default('baai/bge-m3'),

  RAG_TOP_K: z.coerce.number().int().positive().default(8),
  MEMORY_MAX_NOTES: z.coerce.number().int().min(1).max(20).default(5),
  MEMORY_MAX_CHARS: z.coerce.number().int().min(1_000).max(100_000).default(24_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema> & {
  /** Notes are written here inside the vault. */
  notesDir: string;
  /** Remote chat providers with a configured API key, in routing order. */
  remoteProviders: RemoteProviderConfig[];
  /** True when at least one remote chat provider can be used. */
  hasRemote: boolean;
  /** True when embeddings are served by a remote provider. */
  hasRemoteEmbeddings: boolean;
  /** Preference actually in effect (degraded to local_first when remote is unusable). */
  effectivePreference: LlmPreference;
};

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida en .env:\n${details}`);
  }

  const parsed = result.data;

  if (parsed.EMBEDDING_PROVIDER === 'openrouter' && !parsed.OPENROUTER_API_KEY) {
    throw new Error(
      'EMBEDDING_PROVIDER=openrouter requiere OPENROUTER_API_KEY. Configúrala o usa EMBEDDING_PROVIDER=ollama.',
    );
  }

  // Solo OpenRouter: se ignoran claves de otros proveedores.
  const remoteProviders: RemoteProviderConfig[] = [];
  if (parsed.OPENROUTER_API_KEY) {
    remoteProviders.push({
      name: 'openrouter',
      apiKey: parsed.OPENROUTER_API_KEY,
      baseUrl: parsed.OPENROUTER_BASE_URL,
      // LLM_REMOTE_MODEL se conserva como alias para instalaciones antiguas.
      model: parsed.OPENROUTER_MODEL || parsed.LLM_REMOTE_MODEL || 'openai/gpt-4o-mini',
      reasoningEffort: parsed.OPENROUTER_REASONING_EFFORT,
    });
  }

  const hasRemote = remoteProviders.length > 0;
  let effectivePreference = parsed.LLM_PREFERENCE;
  if (!hasRemote && (effectivePreference === 'remote_first' || effectivePreference === 'remote_only')) {
    console.warn(
      `[env] LLM_PREFERENCE=${effectivePreference} sin OPENROUTER_API_KEY; se degrada a local_first.`,
    );
    effectivePreference = 'local_first';
  }

  return {
    ...parsed,
    notesDir: path.join(parsed.OBSIDIAN_VAULT_PATH, parsed.NOTE_SUBDIR),
    remoteProviders,
    hasRemote,
    hasRemoteEmbeddings: parsed.EMBEDDING_PROVIDER === 'openrouter',
    effectivePreference,
  };
}

let cached: Env | undefined;

export function loadEnv(): Env {
  if (!cached) cached = parseEnv();
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetEnv(): void {
  cached = undefined;
}
