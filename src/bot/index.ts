import path from 'node:path';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Runtime } from '../bootstrap.js';
import { truncate } from '../lib/text.js';
import type { IngestResult, PreparedIngest } from '../controllers/ingest.controller.js';
import { PendingCaptureStore, type PendingCapture } from '../services/pending.service.js';
import { isSupportedDocumentExtension, supportedDocumentExtensions } from '../services/document.service.js';
import { categoryOptions, normalizeCategory, normalizeFolder, type NoteCategory } from '../lib/classification.js';
import { noteCategories } from '../schemas/noteDigest.schema.js';
import { logger, type Logger } from '../lib/logger.js';

const maxTelegramChars = 4000;
const maxDocumentBytes = 20 * 1024 * 1024;

const helpText = [
  'Idearium — tu memoria externa en Obsidian.',
  '',
  'Envíame texto, una nota de voz o un documento (.md, .pdf, .txt, .doc, .docx).',
  '',
  'Comandos:',
  '/query <pregunta> — buscar en tus notas (RAG)',
  '/reindex — reindexar todo el vault',
  '/remoto <texto> — forzar el proveedor remoto',
  '/cluster <tema> — crear un estudio que agrupa notas',
  '/memorize <nota|tema|varias notas> — crear palacio de la memoria',
  '/palacio [nota|tema] — ver un palacio o listar todos',
  '/quiz <tema|varias notas> — quiz interactivo multi-nota',
  '/quiz stop — terminar el quiz actual',
  '/cancelar — descartar la captura pendiente',
  '/start — esta ayuda y estado del sistema',
].join('\n');

export function createBot(runtime: Runtime, log: Logger = logger): Bot {
  const bot = new Bot(runtime.env.TELEGRAM_BOT_TOKEN);
  const pending = new PendingCaptureStore();
  const allowed = new Set(runtime.env.TELEGRAM_ALLOWED_USER_IDS.map((id) => Number(id)).filter((id) => Number.isFinite(id)));

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !allowed.has(userId)) {
      if (userId) await ctx.reply('No estás autorizado para usar este bot.');
      log.warn({ userId }, 'bot.unauthorized');
      return;
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    const count = await runtime.vector.count().catch(() => 0);
    await reply(
      ctx,
      [
        helpText,
        '',
        `Proveedor: ${runtime.router.status()}`,
        `Vault: ${runtime.env.OBSIDIAN_VAULT_PATH}`,
        `Notas indexadas (chunks): ${count}`,
      ].join('\n'),
    );
  });

  bot.command('query', async (ctx) => {
    const question = ctx.match.trim();
    if (!question) return reply(ctx, 'Uso: /query <pregunta>');

    await typing(ctx);
    try {
      const answer = await runtime.rag.query(question);
      const sources = answer.sources.length
        ? `\n\nFuentes:\n${answer.sources
            .map((source) => `- [[${source.title}]] (${source.path})`)
            .join('\n')}`
        : '';
      await reply(ctx, `${answer.answer}${sources}`);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.command('remoto', async (ctx) => {
    const text = ctx.match.trim();
    if (!text) return reply(ctx, 'Uso: /remoto <texto>');
    if (!runtime.env.hasRemote) {
      return reply(ctx, 'No hay proveedor remoto configurado (OPENROUTER_API_KEY).');
    }

    await typing(ctx);
    try {
      if (pending.has(ctx.chat.id)) {
        return reply(ctx, 'Tienes una captura pendiente. Elige carpeta y categoría o usa /cancelar.');
      }
      const prepared = await runtime.ingest.prepareText(text, {
        source: 'telegram_text',
        remote: true,
      });
      await startClassification(ctx, prepared);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.command('cancelar', async (ctx) => {
    const cleared = pending.clear(ctx.chat.id);
    await reply(
      ctx,
      cleared ? 'Captura cancelada. No se guardó la nota.' : 'No hay una captura pendiente.',
    );
  });

  bot.command('reindex', async (ctx) => {
    await reply(ctx, 'Reindexando el vault… esto puede tardar.');
    try {
      const result = await runtime.indexer.reindexAll();
      await reply(
        ctx,
        `Reindexado: ${result.indexed} notas indexadas, ${result.skipped} sin cambios, ${result.removed} eliminadas, ${result.failed} fallidas.`,
      );
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.command('cluster', async (ctx) => {
    const topic = ctx.match.trim();
    if (!topic) return reply(ctx, 'Uso: /cluster <tema>');
    await typing(ctx);
    try {
      const result = await runtime.cluster.run(topic);
      await reply(ctx, `Estudio creado: ${result.title}\n${result.path}\nNotas usadas: ${result.noteCount}`);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.command('memorize', async (ctx) => {
    const target = ctx.match.trim();
    if (!target) {
      return reply(
        ctx,
        'Uso: /memorize <nota|tema|varias notas>\nEjemplo: /memorize palacio de la memoria de las notas A, B y C',
      );
    }
    await typing(ctx);
    try {
      const result = await runtime.memorize.run(target);
      const status = result.combined
        ? `Palacio combinado creado (${result.noteCount} notas)`
        : result.created
          ? 'Palacio añadido'
          : 'Palacio actualizado';
      const sources = result.combined ? `\nNotas: ${result.notes.join(', ')}` : '';
      await reply(ctx, `${status}: ${result.title}\n${result.path}${sources}`);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.command('palacio', async (ctx) => {
    const target = ctx.match.trim();
    await typing(ctx);
    try {
      if (!target) {
        const palaces = await runtime.memorize.listPalaces();
        if (palaces.length === 0) {
          return reply(ctx, 'Aún no hay palacios de la memoria. Crea uno con /memorize <nota|tema>.');
        }
        const lines = [
          `🏛️ Palacios de la memoria (${palaces.length}):`,
          '',
          ...palaces.map(
            (palace) =>
              `• ${palace.combined ? '[combinado] ' : ''}[[${palace.title}]] — ${palace.relativePath}`,
          ),
          '',
          'Consulta uno con /palacio <ruta-o-tema>.',
        ];
        return replyLong(ctx, lines.join('\n'));
      }

      const palace = await runtime.memorize.readPalace(target);
      if (!palace) {
        return reply(
          ctx,
          `La nota "${target}" no tiene un palacio de la memoria. Créalo con /memorize ${target}.`,
        );
      }

      return replyLong(
        ctx,
        `🏛️ ${palace.combined ? '[combinado] ' : ''}${palace.title}\n${palace.path}\n\n${palace.section}`,
      );
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.command('quiz', async (ctx) => {
    const topic = ctx.match.trim();
    const chatId = ctx.chat.id;

    if (!topic) return reply(ctx, 'Uso: /quiz <tema> o /quiz stop');
    if (topic.toLowerCase() !== 'stop' && pending.has(chatId)) {
      return reply(ctx, 'Termina la captura pendiente (carpeta y categoría) o usa /cancelar antes de empezar un quiz.');
    }
    if (topic.toLowerCase() === 'stop') {
      const stopped = runtime.quiz.stop(chatId);
      return reply(ctx, stopped ? 'Quiz terminado.' : 'No hay un quiz activo.');
    }

    await typing(ctx);
    try {
      const started = await runtime.quiz.start(chatId, topic);
      await reply(ctx, `${started.intro}\n\n${started.question}`);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.on('message:voice', async (ctx) => {
    if (pending.has(ctx.chat.id)) {
      return reply(ctx, 'Tienes una captura pendiente. Elige carpeta y categoría o usa /cancelar.');
    }
    if (runtime.quiz.hasSession(ctx.chat.id)) {
      return reply(ctx, 'Hay un quiz activo. Termínalo con /quiz stop antes de enviar una nota de voz.');
    }

    await typing(ctx);
    try {
      const stored = await runtime.storage.saveTelegramAudio(ctx.message.voice.file_id);
      const prepared = await runtime.ingest.prepareAudio(stored.path, {
        source: 'telegram_voice',
        audioFile: stored.path,
      });
      await startClassification(ctx, prepared);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.on('message:document', async (ctx) => {
    const document = ctx.message.document;
    const fileName = document.file_name ?? 'documento';
    const extension = path.extname(fileName).toLowerCase();

    if (!isSupportedDocumentExtension(extension)) {
      return reply(ctx, `Formato no soportado. Envía uno de: ${supportedDocumentExtensions.join(', ')}.`);
    }
    if (document.file_size && document.file_size > maxDocumentBytes) {
      return reply(ctx, 'El documento supera el límite de 20 MB de Telegram.');
    }
    if (pending.has(ctx.chat.id)) {
      return reply(ctx, 'Tienes una captura pendiente. Elige carpeta y categoría o usa /cancelar.');
    }
    if (runtime.quiz.hasSession(ctx.chat.id)) {
      return reply(ctx, 'Hay un quiz activo. Termínalo con /quiz stop antes de enviar un documento.');
    }

    await typing(ctx);
    try {
      const stored = await runtime.storage.saveTelegramDocument(document.file_id, fileName);
      const prepared = await runtime.ingest.prepareDocument(stored.path, {
        source: 'telegram_document',
        documentFile: stored.path,
      });
      await startClassification(ctx, prepared);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;
    if (text.startsWith('/')) {
      await reply(ctx, 'Comando no reconocido. Usa /start para ver la ayuda.');
      return;
    }

    const capture = pending.get(ctx.chat.id);
    if (capture) {
      if (capture.stage === 'folder') {
        const folder = normalizeFolder(text);
        if (!folder) {
          await reply(ctx, 'Carpeta no válida. Escribe un nombre relativo, por ejemplo "Ideas" o "Proyectos/Idearium".');
          return;
        }
        await askCategory(ctx, capture, folder);
        return;
      }

      const category = normalizeCategory(text);
      if (!category) {
        await reply(
          ctx,
          `Categoría no válida. Escribe una de: ${noteCategories.map((item) => `#${item}`).join(', ')}.`,
        );
        return;
      }
      await finishClassification(ctx, capture, category);
      return;
    }

    if (runtime.quiz.hasSession(ctx.chat.id)) {
      await typing(ctx);
      try {
        const feedback = await runtime.quiz.answer(ctx.chat.id, text);
        if (!feedback) {
          await reply(ctx, 'No hay un quiz activo.');
          return;
        }
        const parts = [feedback.feedback];
        if (feedback.finished) {
          parts.push('', feedback.summary ?? '');
        } else if (feedback.nextQuestion) {
          parts.push('', `Siguiente pregunta: ${feedback.nextQuestion}`);
        }
        await reply(ctx, parts.filter(Boolean).join('\n'));
      } catch (error) {
        await replyError(ctx, error);
      }
      return;
    }

    await typing(ctx);
    try {
      const prepared = await runtime.ingest.prepareText(text, { source: 'telegram_text' });
      await startClassification(ctx, prepared);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id;
    if (!chatId) return;
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => undefined);

    const capture = pending.get(chatId);
    if (!capture) {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      await ctx.reply('La captura ya no está disponible (caducó o se guardó). Envía la nota de nuevo.');
      return;
    }

    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

    if (data.startsWith('pf:')) {
      if (capture.stage !== 'folder') return;
      const key = data.slice(3);
      if (key === 'new') {
        await ctx.reply('Escribe el nombre de la carpeta (puedes usar subcarpetas con /), por ejemplo "Ideas" o "Proyectos/Idearium".');
        return;
      }
      const folder = capture.folders[Number(key)];
      if (!folder) {
        await ctx.reply('Opción de carpeta no válida.');
        return;
      }
      await askCategory(ctx, capture, folder);
      return;
    }

    if (data.startsWith('pc:')) {
      if (capture.stage !== 'category') return;
      const key = data.slice(3);
      if (key === 'new') {
        await ctx.reply(
          `Escribe la categoría: ${noteCategories.map((item) => `#${item}`).join(', ')}.`,
        );
        return;
      }
      const category = normalizeCategory(capture.categories[Number(key)] ?? '');
      if (!category) {
        await ctx.reply('Opción de categoría no válida.');
        return;
      }
      await finishClassification(ctx, capture, category);
    }
  });

  async function startClassification(ctx: Context, prepared: PreparedIngest): Promise<void> {
    if (!ctx.chat) return;
    const existing = await runtime.obsidian.listFolders();
    const preferred = path.relative(runtime.env.OBSIDIAN_VAULT_PATH, runtime.env.notesDir);
    const folders = [
      ...(existing.includes(preferred) ? [preferred] : []),
      ...existing.filter((folder) => folder !== preferred),
    ].slice(0, 8);
    const capture = pending.create(
      ctx.chat.id,
      prepared,
      folders,
      prepared.digest.category,
    );
    await replyKeyboard(
      ctx,
      `${capturePreview(prepared)}\n\n¿En qué carpeta la guardo?`,
      folderKeyboard(folders),
    );
  }

  async function askCategory(
    ctx: Context,
    capture: PendingCapture,
    folder: string,
  ): Promise<void> {
    if (!ctx.chat) return;
    const existing = await runtime.obsidian.listCategories();
    const options = categoryOptions(capture.suggestedCategory, existing);
    pending.chooseFolder(ctx.chat.id, folder, options);
    await replyKeyboard(
      ctx,
      [
        `📁 ${folder}`,
        '',
        `¿Qué categoría? Sugerida: #${capture.suggestedCategory}`,
        `También puedes escribir una: ${noteCategories.map((item) => `#${item}`).join(', ')}.`,
      ].join('\n'),
      categoryKeyboard(options),
    );
  }

  async function finishClassification(
    ctx: Context,
    capture: PendingCapture,
    category: NoteCategory,
  ): Promise<void> {
    if (!ctx.chat) return;
    try {
      const result = await runtime.ingest.save(capture.prepared, {
        subdir: capture.folder,
        category,
      });
      pending.clear(ctx.chat.id);
      await reply(ctx, `📁 ${capture.folder}\n${formatIngest(result)}`);
    } catch (error) {
      await replyError(ctx, error);
    }
  }

  bot.catch((error) => {
    log.error({ error: error.message, update: error.ctx.update.update_id }, 'bot.error');
  });

  return bot;
}

function formatIngest(result: IngestResult): string {
  const lines = [
    `📝 ${result.note.title}`,
    `Archivo: ${result.note.relativePath}`,
    `Tags: ${result.note.tags.map((tag) => `#${tag}`).join(' ')}`,
    `Modelo: ${result.provider}/${result.model}${result.usedRemote ? ' (remoto)' : ''}`,
  ];
  if (result.indexingError) {
    lines.push(`⚠️ Se guardó, pero falló la indexación: ${truncate(result.indexingError, 200)}`);
  } else if (result.indexed) {
    lines.push('Indexada para búsquedas.');
  }
  return lines.join('\n');
}

async function typing(ctx: Context): Promise<void> {
  await ctx.replyWithChatAction('typing').catch(() => undefined);
}

function capturePreview(prepared: PreparedIngest): string {
  return [
    `📝 ${prepared.digest.title}`,
    truncate(prepared.digest.summary, 400),
    `Categoría sugerida: #${prepared.digest.category}`,
  ].join('\n');
}

function folderKeyboard(folders: string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  folders.forEach((folder, index) => {
    if (index > 0 && index % 2 === 0) keyboard.row();
    keyboard.text(truncate(folder, 30), `pf:${index}`);
  });
  keyboard.row().text('➕ Otra carpeta', 'pf:new');
  return keyboard;
}

function categoryKeyboard(categories: NoteCategory[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  categories.forEach((category, index) => {
    if (index > 0 && index % 2 === 0) keyboard.row();
    keyboard.text(`#${category}`, `pc:${index}`);
  });
  keyboard.row().text('➕ Otra categoría', 'pc:new');
  return keyboard;
}

async function replyKeyboard(ctx: Context, text: string, keyboard: InlineKeyboard): Promise<void> {
  await ctx.reply(text.slice(0, maxTelegramChars), { reply_markup: keyboard });
}

async function reply(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text.slice(0, maxTelegramChars));
}

async function replyLong(ctx: Context, text: string): Promise<void> {
  for (const part of splitMessage(text, maxTelegramChars)) {
    await ctx.reply(part);
  }
}

export function splitMessage(text: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function replyError(ctx: Context, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ error: message }, 'bot.handler_failed');
  await reply(ctx, `⚠️ ${message}`);
}
