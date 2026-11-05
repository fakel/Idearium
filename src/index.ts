import { loadEnv } from './config/env.js';
import { createRuntime } from './bootstrap.js';
import { createBot } from './bot/index.js';
import { logger } from './lib/logger.js';
import { WatcherService } from './services/watcher.service.js';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN no está configurado. Crea un bot con @BotFather y añade el token al .env.');
  }
  if (env.TELEGRAM_ALLOWED_USER_IDS.length === 0) {
    throw new Error('TELEGRAM_ALLOWED_USER_IDS está vacío: sin allowlist el bot no arranca.');
  }

  const runtime = await createRuntime(env);
  const watcher = new WatcherService({ notesDir: env.OBSIDIAN_VAULT_PATH }, runtime.indexer);
  watcher.start();

  const bot = createBot(runtime);
  await bot.init();
  logger.info(
    {
      username: bot.botInfo.username,
      model: env.OLLAMA_MODEL,
      preference: env.effectivePreference,
      vault: env.OBSIDIAN_VAULT_PATH,
    },
    'bot.started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'app.shutdown');
    await bot.stop();
    await watcher.stop();
    await runtime.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await bot.start({ drop_pending_updates: false });
}

main().catch((error: unknown) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, 'app.start_failed');
  process.exitCode = 1;
});
