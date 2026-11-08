import { loadEnv } from './config/env.js';
import { createRuntime } from './bootstrap.js';
import { createBot, telegramCommands } from './bot/index.js';
import { logger } from './lib/logger.js';
import { seedCourseIfEmpty } from './services/seed.service.js';
import { ReviewSchedulerService } from './services/review-scheduler.service.js';
import { WatcherService } from './services/watcher.service.js';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN no está configurado. Crea un bot con @BotFather y añade el token al .env.');
  }
  if (env.TELEGRAM_ALLOWED_USER_IDS.length === 0) {
    throw new Error('TELEGRAM_ALLOWED_USER_IDS está vacío: sin allowlist el bot no arranca.');
  }

  let seeded = 0;
  if (env.SEED_ON_EMPTY) {
    try {
      const result = await seedCourseIfEmpty({
        vaultPath: env.OBSIDIAN_VAULT_PATH,
        seedDir: env.SEED_DIR,
        logger,
      });
      seeded = result.copied;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'seed.failed',
      );
    }
  }

  const runtime = await createRuntime(env);
  if (seeded > 0) {
    try {
      const indexed = await runtime.indexer.reindexAll();
      logger.info({ notes: seeded, ...indexed }, 'seed.indexed');
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'seed.index_failed',
      );
    }
  }

  const bot = createBot(runtime);
  let watcher: WatcherService | undefined;
  let reviewScheduler: ReviewSchedulerService | undefined;

  try {
    await bot.init();
    await bot.api.setMyCommands(telegramCommands).catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'bot.set_commands_failed',
      );
    });

    // El watcher necesita el bot ya inicializado: si el token falla, no debe
    // quedar un proceso vivo sin bot escuchando.
    watcher = new WatcherService({ notesDir: env.OBSIDIAN_VAULT_PATH }, runtime.indexer);
    watcher.start();

    reviewScheduler = new ReviewSchedulerService(
      runtime.flashcards,
      (chatId, text) => bot.api.sendMessage(chatId, text).then(() => undefined),
      {
        enabled: env.SR_ENABLED,
        timeZone: env.SR_TIMEZONE,
        notifyTimes: env.SR_NOTIFY_TIMES,
        graceMinutes: env.SR_NOTIFY_GRACE_MINUTES,
        maxReviewsPerDay: env.SR_MAX_REVIEWS_PER_DAY,
      },
    );
    reviewScheduler.start();

    const remoteFirst = env.effectivePreference === 'remote_only' || env.effectivePreference === 'remote_first';
    const remote = env.remoteProviders[0];
    logger.info(
      {
        username: bot.botInfo.username,
        provider: remoteFirst && remote ? remote.name : 'ollama',
        model: remoteFirst && remote ? remote.model : env.OLLAMA_MODEL,
        preference: env.effectivePreference,
        vault: env.OBSIDIAN_VAULT_PATH,
      },
      'bot.started',
    );

    const shutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'app.shutdown');
      await bot.stop();
      await reviewScheduler?.stop();
      await watcher?.stop();
      await runtime.close();
      process.exit(0);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));

    await bot.start({ drop_pending_updates: false });
  } catch (error) {
    reviewScheduler?.stop();
    await watcher?.stop().catch(() => undefined);
    await runtime.close().catch(() => undefined);
    throw error;
  }
}

main().catch((error: unknown) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, 'app.start_failed');
  process.exitCode = 1;
});
