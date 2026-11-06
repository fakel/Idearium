import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Env } from './config/env.js';
import { IngestController } from './controllers/ingest.controller.js';
import { ClusterService } from './services/cluster.service.js';
import { DocumentService } from './services/document.service.js';
import { OllamaEmbeddingService, OpenAICompatibleEmbeddingService, type Embedder } from './services/embedding.service.js';
import { Indexer } from './services/indexer.service.js';
import { createLlmRouter, type LlmRouter } from './services/llm-router.service.js';
import { MemorizeService } from './services/memorize.service.js';
import { NoteSelectorService } from './services/note-selector.service.js';
import { OcrService } from './services/ocr.service.js';
import { ObsidianService } from './services/obsidian.service.js';
import { QuizService } from './services/quiz.service.js';
import { RagService } from './services/rag.service.js';
import { StorageService } from './services/storage.service.js';
import { SttService } from './services/stt.service.js';
import { UsageTracker } from './services/usage.service.js';
import { VectorService } from './services/vector.service.js';

export interface Runtime {
  env: Env;
  router: LlmRouter;
  vector: VectorService;
  embedder: Embedder;
  indexer: Indexer;
  obsidian: ObsidianService;
  storage: StorageService;
  stt: SttService;
  documents: DocumentService;
  ocr: OcrService;
  ingest: IngestController;
  rag: RagService;
  selector: NoteSelectorService;
  cluster: ClusterService;
  memorize: MemorizeService;
  quiz: QuizService;
  usage: UsageTracker;
  close: () => Promise<void>;
}

export async function createRuntime(env: Env): Promise<Runtime> {
  const studiesDir = path.join(env.OBSIDIAN_VAULT_PATH, 'Estudios');
  await mkdir(env.notesDir, { recursive: true });
  await mkdir(studiesDir, { recursive: true });

  const usage = new UsageTracker(env.USAGE_FILE);
  const router = createLlmRouter(env, undefined, usage);
  const vector = new VectorService(env.LANCEDB_PATH, env.EMBEDDING_DIM);
  await vector.open();

  const embeddingModel =
    env.EMBEDDING_PROVIDER === 'openrouter' ? env.OPENROUTER_EMBED_MODEL : env.OLLAMA_EMBED_MODEL;
  const embedder: Embedder =
    env.EMBEDDING_PROVIDER === 'openrouter'
      ? new OpenAICompatibleEmbeddingService({
          baseUrl: env.OPENROUTER_BASE_URL,
          apiKey: env.OPENROUTER_API_KEY,
          model: env.OPENROUTER_EMBED_MODEL,
          dimension: env.EMBEDDING_DIM,
          timeoutMs: env.LLM_TIMEOUT_MS,
          providerName: 'OpenRouter',
          usage,
        })
      : new OllamaEmbeddingService({
          baseUrl: env.OLLAMA_API_URL,
          model: env.OLLAMA_EMBED_MODEL,
          dimension: env.EMBEDDING_DIM,
          timeoutMs: env.LLM_TIMEOUT_MS,
        });

  const indexer = new Indexer(
    {
      vaultPath: env.OBSIDIAN_VAULT_PATH,
      notesDir: env.notesDir,
      stateFile: path.join(path.dirname(env.LANCEDB_PATH), 'index-state.json'),
      embedding: `${env.EMBEDDING_PROVIDER}:${embeddingModel}:${env.EMBEDDING_DIM}`,
    },
    vector,
    embedder,
  );

  const obsidian = new ObsidianService({ vaultPath: env.OBSIDIAN_VAULT_PATH, notesDir: env.notesDir });
  const storage = new StorageService({
    audioDir: env.AUDIO_DIR,
    documentDir: env.DOCUMENT_DIR,
    imageDir: env.IMAGES_DIR,
    botToken: env.TELEGRAM_BOT_TOKEN,
  });
  const documents = new DocumentService({ maxChars: env.DOCUMENT_MAX_CHARS });
  const ocr = new OcrService({
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    model: env.visionModel,
    fallbackModel: env.visionFallbackModel,
    reasoningEffort: env.OPENROUTER_REASONING_EFFORT,
    timeoutMs: env.LLM_TIMEOUT_MS,
    usage,
  });
  const stt = new SttService({
    baseUrl: env.WHISPER_API_URL,
    // OpenRouter expone STT con la misma cuenta; permite no duplicar la clave.
    apiKey:
      env.WHISPER_API_KEY ||
      (env.WHISPER_API_URL.includes('openrouter.ai') ? env.OPENROUTER_API_KEY : ''),
    model: env.WHISPER_MODEL,
    timeoutMs: env.WHISPER_TIMEOUT_MS,
    usage,
  });

  const ingest = new IngestController({ router, obsidian, stt, documents, indexer });
  const rag = new RagService({ topK: env.RAG_TOP_K }, vector, embedder, router);
  const selector = new NoteSelectorService(
    { vaultPath: env.OBSIDIAN_VAULT_PATH, maxNotes: env.MEMORY_MAX_NOTES, maxChars: env.MEMORY_MAX_CHARS },
    vector,
    embedder,
  );
  const cluster = new ClusterService({ studiesDir }, vector, embedder, router, indexer);
  const memorize = new MemorizeService(
    {
      vaultPath: env.OBSIDIAN_VAULT_PATH,
      maxNotes: env.MEMORY_MAX_NOTES,
      maxChars: env.MEMORY_MAX_CHARS,
    },
    vector,
    embedder,
    router,
    indexer,
    selector,
  );
  const quiz = new QuizService(selector, router);

  return {
    env,
    router,
    vector,
    embedder,
    indexer,
    obsidian,
    storage,
    stt,
    documents,
    ocr,
    ingest,
    rag,
    selector,
    cluster,
    memorize,
    quiz,
    usage,
    close: async () => {
      await vector.close();
    },
  };
}
