import path from 'node:path';
import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { Runtime } from '../bootstrap.js';
import { truncate } from '../lib/text.js';
import type { IngestResult, PreparedIngest } from '../controllers/ingest.controller.js';
import { PendingCaptureStore, type PendingCapture } from '../services/pending.service.js';
import { PendingOcrStore, type PendingOcr } from '../services/pending-ocr.service.js';
import { AwaitingActionStore } from '../services/menu-flow.service.js';
import type { MemorizeResult } from '../services/memorize.service.js';
import { isSupportedDocumentExtension, supportedDocumentExtensions } from '../services/document.service.js';
import { categoryOptions, normalizeCategory, normalizeFolder, type NoteCategory } from '../lib/classification.js';
import { noteCategories } from '../schemas/noteDigest.schema.js';
import { logger, type Logger } from '../lib/logger.js';
import { formatNoteList } from '../lib/note-list.js';

const maxTelegramChars = 4000;
const maxDocumentBytes = 20 * 1024 * 1024;

const menuButtons = {
  query: '🔍 Consultar',
  notes: '📚 Notas',
  palaces: '🏛️ Palacios',
  memorize: '🧠 Memorizar',
  quiz: '🎯 Quiz',
  reindex: '🔄 Reindexar',
  help: '❓ Ayuda',
} as const;

type MenuButtonAction = keyof typeof menuButtons;

const helpText = [
  'Idearium — tu memoria externa en Obsidian.',
  '',
  'Envíame texto, una nota de voz, una foto con texto o un documento (.md, .pdf, .txt, .doc, .docx).',
  'Tras el OCR de una foto te pediré confirmar o corregir el texto antes de guardar.',
  '',
  'Usa los botones de abajo para no escribir comandos. Si prefieres el teclado, también funcionan:',
  '',
  'Comandos:',
  '/query <pregunta> — buscar en tus notas (RAG)',
  '/notas [texto] — listar notas y su número',
  '/notas <número> — mostrar el contenido de una nota',
  '/notas rm <número|título|ruta> — borrar una nota',
  '/reindex — reindexar todo el vault',
  '/remoto <texto> — forzar el proveedor remoto',
  '/cluster <tema> — crear un estudio que agrupa notas',
  '/menu — mostrar los botones',
  '/memorize <nota|tema> — crear palacio de una sola nota',
  '/palacio [número|nota|tema] — ver un palacio o listar todos',
  '/palacio rm <número|nota|tema> — borrar un palacio y sus enlaces',
  '/quiz <número|tema|varias notas> — quiz interactivo multi-nota',
  '/quiz stop — terminar el quiz actual',
  '/cancelar — descartar la captura pendiente',
  '/start — esta ayuda y estado del sistema',
].join('\n');

export function isPrivateChat(type: string | undefined): boolean {
  return type === 'private';
}

export function createBot(runtime: Runtime, log: Logger = logger): Bot {
  const bot = new Bot(runtime.env.TELEGRAM_BOT_TOKEN);
  const pending = new PendingCaptureStore();
  const pendingOcr = new PendingOcrStore();
  const menuFlow = new AwaitingActionStore();
  const palaceChoices = new Map<
    number,
    { notes: Array<{ path: string; title: string }>; expiresAt: number }
  >();
  const palaceChoiceTtlMs = 10 * 60 * 1000;
  const allowed = new Set(runtime.env.TELEGRAM_ALLOWED_USER_IDS.map((id) => Number(id)).filter((id) => Number.isFinite(id)));

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !allowed.has(userId)) {
      if (userId) await ctx.reply('No estás autorizado para usar este bot.');
      log.warn({ userId }, 'bot.unauthorized');
      return;
    }
    if (!isPrivateChat(ctx.chat?.type)) {
      await ctx
        .reply('Por privacidad, este bot solo funciona en un chat privado.')
        .catch(() => undefined);
      log.warn({ chatId: ctx.chat?.id, type: ctx.chat?.type }, 'bot.unsupported_chat');
      return;
    }
    if (ctx.message?.text?.startsWith('/')) menuFlow.clear(ctx.chat?.id ?? 0);
    await next();
  });

  bot.command('start', async (ctx) => {
    await sendHelp(ctx);
  });

  bot.command('menu', async (ctx) => {
    await ctx.reply('Menú activado. Usa los botones de abajo o escribe /start para ver la ayuda.', {
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command('notas', (ctx) => runNotes(ctx, ctx.match.trim()));

  bot.command('query', (ctx) => runQuery(ctx, ctx.match.trim()));

  bot.command('remoto', async (ctx) => {
    const text = ctx.match.trim();
    if (!text) return reply(ctx, 'Uso: /remoto <texto>');
    if (!runtime.env.hasRemote) {
      return reply(ctx, 'No hay proveedor remoto configurado (OPENROUTER_API_KEY).');
    }

    await typing(ctx);
    try {
      if (await rejectIfCapturePending(ctx, ctx.chat.id, 'usar /remoto')) return;
      if (await rejectIfQuizActive(ctx, ctx.chat.id, 'usar /remoto')) return;
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
    const clearedOcr = pendingOcr.clear(ctx.chat.id);
    const cleared = pending.clear(ctx.chat.id);
    await reply(
      ctx,
      clearedOcr || cleared
        ? 'Captura cancelada. No se guardó la nota.'
        : 'No hay una captura pendiente.',
    );
  });

  bot.command('reindex', (ctx) => runReindex(ctx));

  bot.command('cluster', async (ctx) => {
    const topic = ctx.match.trim();
    if (!topic) return reply(ctx, 'Uso: /cluster <tema>');
    if (await rejectIfQuizActive(ctx, ctx.chat.id, 'usar /cluster')) return;
    await typing(ctx);
    try {
      const result = await runtime.cluster.run(topic);
      await reply(ctx, `Estudio creado: ${result.title}\n${result.path}\nNotas usadas: ${result.noteCount}`);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.command('memorize', (ctx) => runMemorize(ctx, ctx.match.trim()));

  async function sendPalaceCreated(ctx: Context, result: MemorizeResult): Promise<void> {
    const status = result.combined
      ? `Palacio combinado creado (${result.noteCount} notas)`
      : result.created
        ? 'Palacio añadido'
        : 'Palacio actualizado';
    const sources = result.combined ? `Notas: ${result.notes.join(', ')}` : '';
    const palaces = await runtime.memorize.listPalaces();
    const number = findPalaceNumber(palaces, result.path);
    const lines = [`${status}: ${result.title}`, result.path];
    if (number) lines.push(`Número: ${number} — consulta con /palacio ${number}`);
    if (sources) lines.push(sources);
    await reply(ctx, lines.join('\n'));
  }

  bot.command('palacio', (ctx) => runPalace(ctx, ctx.match.trim()));

  bot.command('quiz', (ctx) => runQuiz(ctx, ctx.match.trim()));

  async function sendHelp(ctx: Context): Promise<void> {
    const count = await runtime.vector.count().catch(() => 0);
    const text = [
      helpText,
      '',
      `Proveedor: ${runtime.router.status()}`,
      `Vault: ${runtime.env.OBSIDIAN_VAULT_PATH}`,
      `Notas indexadas (chunks): ${count}`,
    ].join('\n');
    await ctx.reply(text.slice(0, maxTelegramChars), { reply_markup: mainMenuKeyboard() });
  }

  async function rejectIfQuizActive(
    ctx: Context,
    chatId: number,
    action: string,
  ): Promise<boolean> {
    if (!runtime.quiz.hasSession(chatId)) return false;
    await reply(ctx, `Hay un quiz activo. Termínalo con /quiz stop antes de ${action}.`);
    return true;
  }

  async function rejectIfCapturePending(
    ctx: Context,
    chatId: number,
    action: string,
  ): Promise<boolean> {
    if (!pending.has(chatId) && !pendingOcr.has(chatId)) return false;
    await reply(ctx, `Tienes una captura pendiente. Termínala o usa /cancelar antes de ${action}.`);
    return true;
  }

  async function handleMenuButton(ctx: Context, action: MenuButtonAction): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (action === 'help') {
      await sendHelp(ctx);
      return;
    }
    if (pending.has(chatId) || pendingOcr.has(chatId)) {
      await reply(ctx, 'Tienes una captura pendiente. Termínala o usa /cancelar antes de usar el menú.');
      return;
    }
    if (runtime.quiz.hasSession(chatId) && action !== 'quiz') {
      await reply(ctx, 'Hay un quiz activo. Termínalo con /quiz stop antes de usar otra acción.');
      return;
    }

    switch (action) {
      case 'query':
        menuFlow.set(chatId, 'query');
        await reply(ctx, 'Escribe tu pregunta y la buscaré en tus notas.');
        return;
      case 'notes':
        await runNotes(ctx, '');
        return;
      case 'palaces':
        await runPalace(ctx, '');
        return;
      case 'memorize':
        menuFlow.set(chatId, 'memorize');
        await reply(ctx, 'Escribe el número, título o tema de la nota para crear su palacio.');
        return;
      case 'quiz':
        if (runtime.quiz.hasSession(chatId)) {
          await reply(ctx, 'Hay un quiz activo. Termínalo con /quiz stop antes de empezar otro.');
          return;
        }
        menuFlow.set(chatId, 'quiz');
        await reply(ctx, 'Escribe el número, título o tema de las notas para el quiz.');
        return;
      case 'reindex':
        await runReindex(ctx);
        return;
    }
  }

  async function runNotes(ctx: Context, raw: string): Promise<void> {
    const removing = /^rm(?:\s+(.+))?$/i.exec(raw);
    if (removing) {
      const target = removing[1]?.trim();
      if (!target) {
        return reply(ctx, 'Uso: /notas rm <número|título|ruta>');
      }
      const chatId = ctx.chat?.id;
      if (chatId && (await rejectIfQuizActive(ctx, chatId, 'borrar notas'))) return;
      await typing(ctx);
      try {
        const deleted = await runtime.memorize.deleteNote(target);
        const number = deleted.noteNumber
          ? ` (#${String(deleted.noteNumber).padStart(4, '0')})`
          : '';
        return reply(
          ctx,
          `🗑️ Nota eliminada: ${deleted.title}${number}\n${deleted.relativePath}\n\nSi había un palacio, sus enlaces pueden quedar obsoletos.`,
        );
      } catch (error) {
        return replyError(ctx, error);
      }
    }

    const numeric = /^#?(\d{1,9})$/.exec(raw);
    if (numeric) {
      await typing(ctx);
      try {
        const note = await runtime.memorize.readNote(numeric[1]);
        const number = note.noteNumber
          ? ` (#${String(note.noteNumber).padStart(4, '0')})`
          : '';
        return replyLong(
          ctx,
          [
            `📄 ${note.title}${number}`,
            note.relativePath,
            '',
            note.content || '_Nota vacía._',
          ].join('\n'),
        );
      } catch (error) {
        return replyError(ctx, error);
      }
    }

    const filter = raw.toLowerCase();
    await typing(ctx);
    try {
      const notes = await runtime.memorize.listNotes();
      const filtered = filter
        ? notes.filter((note) =>
            `${note.title} ${note.relativePath}`.toLowerCase().includes(filter),
          )
        : notes;
      if (filtered.length === 0) {
        return reply(
          ctx,
          filter ? `No hay notas que coincidan con "${filter}".` : 'No hay notas en el vault.',
        );
      }
      await replyLong(ctx, formatNoteList(filtered));
    } catch (error) {
      await replyError(ctx, error);
    }
  }

  async function runQuery(ctx: Context, question: string): Promise<void> {
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
  }

  async function runReindex(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId && (await rejectIfQuizActive(ctx, chatId, 'reindexar'))) return;
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
  }

  async function runMemorize(ctx: Context, target: string): Promise<void> {
    if (!target) {
      return reply(
        ctx,
        'Uso: /memorize <nota|tema>\nSi hay varias coincidencias, te muestro una lista para elegir una sola nota.',
      );
    }
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    if (await rejectIfQuizActive(ctx, chatId, 'crear un palacio')) return;
    if (await rejectIfCapturePending(ctx, chatId, 'crear un palacio')) return;

    await typing(ctx);
    try {
      const candidates = await runtime.memorize.candidates(target);
      if (candidates.length === 0) {
        return reply(ctx, `No encontré notas para "${target}". Prueba con el título o la ruta .md.`);
      }
      if (candidates.length === 1) {
        const result = await runtime.memorize.run(candidates[0]!.path);
        await sendPalaceCreated(ctx, result);
        return;
      }

      palaceChoices.set(chatId, {
        notes: candidates.map((note) => ({ path: note.path, title: note.title })),
        expiresAt: Date.now() + palaceChoiceTtlMs,
      });
      const keyboard = new InlineKeyboard();
      candidates.forEach((note, index) => {
        if (index > 0 && index % 2 === 0) keyboard.row();
        keyboard.text(truncate(note.title, 48), `pm:${index}`);
      });
      await replyKeyboard(
        ctx,
        `Encontré ${candidates.length} notas para "${target}". ¿De cuál quieres el palacio?`,
        keyboard,
      );
    } catch (error) {
      await replyError(ctx, error);
    }
  }

  async function runPalace(ctx: Context, target: string): Promise<void> {
    await typing(ctx);
    try {
      const remove = /^rm(?:\s+(.+))?$/i.exec(target);
      if (remove) {
        const requested = remove[1]?.trim();
        if (!requested) {
          return reply(ctx, 'Uso: /palacio rm <número|nota|tema>');
        }
        const chatId = ctx.chat?.id;
        if (chatId && (await rejectIfQuizActive(ctx, chatId, 'borrar un palacio'))) return;
        const index = parsePalaceIndex(requested);
        let targetPath = requested;
        if (index !== null) {
          const palaces = await runtime.memorize.listPalaces();
          const selected = palaces[index - 1];
          if (!selected) {
            return reply(
              ctx,
              `No hay palacio número ${index}. Usa /palacio para ver la lista (${palaces.length} en total).`,
            );
          }
          targetPath = selected.path;
        }
        const result = await runtime.memorize.deletePalace(targetPath);
        const where = result.deletedFile
          ? result.path
          : `Sección eliminada de ${result.path}`;
        return reply(
          ctx,
          `🗑️ Palacio eliminado: ${result.title}\n${where}\nEnlaces eliminados: ${result.references}`,
        );
      }

      if (!target) {
        const palaces = await runtime.memorize.listPalaces();
        if (palaces.length === 0) {
          return reply(ctx, 'Aún no hay palacios de la memoria. Crea uno con /memorize <nota|tema>.');
        }
        const lines = [
          `🏛️ Palacios de la memoria (${palaces.length}):`,
          '',
          ...palaces.map(
            (palace, index) =>
              `${index + 1}. ${palace.combined ? '[combinado] ' : ''}${palace.title}`,
          ),
          '',
          'Consulta uno con /palacio <número> o /palacio <nota|tema>.',
        ];
        return replyLong(ctx, lines.join('\n'));
      }

      const index = parsePalaceIndex(target);
      if (index !== null) {
        const palaces = await runtime.memorize.listPalaces();
        const selected = palaces[index - 1];
        if (!selected) {
          return reply(
            ctx,
            `No hay palacio número ${index}. Usa /palacio para ver la lista (${palaces.length} en total).`,
          );
        }
        const palace = await runtime.memorize.readPalace(selected.path);
        if (!palace) {
          return reply(ctx, `No se pudo leer el palacio número ${index}. Prueba /palacio de nuevo.`);
        }
        return replyLong(ctx, formatPalace(palace));
      }

      const palace = await runtime.memorize.readPalace(target);
      if (!palace) {
        return reply(
          ctx,
          `La nota "${target}" no tiene un palacio de la memoria. Créalo con /memorize ${target}.`,
        );
      }

      return replyLong(ctx, formatPalace(palace));
    } catch (error) {
      await replyError(ctx, error);
    }
  }

  async function runQuiz(ctx: Context, topic: string): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!topic) return reply(ctx, 'Uso: /quiz <tema> o /quiz stop');
    if (topic.toLowerCase() !== 'stop' && (pending.has(chatId) || pendingOcr.has(chatId))) {
      return reply(ctx, 'Termina la captura pendiente o usa /cancelar antes de empezar un quiz.');
    }
    if (topic.toLowerCase() !== 'stop' && runtime.quiz.hasSession(chatId)) {
      return reply(ctx, 'Ya hay un quiz activo. Termínalo con /quiz stop antes de empezar otro.');
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
  }

  bot.on('message:voice', async (ctx) => {
    menuFlow.clear(ctx.chat.id);
    if (pending.has(ctx.chat.id) || pendingOcr.has(ctx.chat.id)) {
      return reply(ctx, 'Tienes una captura pendiente. Termínala o usa /cancelar.');
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

  bot.on('message:photo', async (ctx) => {
    menuFlow.clear(ctx.chat.id);
    const photo = ctx.message.photo.at(-1);
    if (!photo) return;
    if (photo.file_size && photo.file_size > maxDocumentBytes) {
      return reply(ctx, 'La foto supera el límite de 20 MB de Telegram.');
    }
    if (pending.has(ctx.chat.id) || pendingOcr.has(ctx.chat.id)) {
      return reply(ctx, 'Tienes una captura pendiente. Termínala o usa /cancelar.');
    }
    if (runtime.quiz.hasSession(ctx.chat.id)) {
      return reply(ctx, 'Hay un quiz activo. Termínalo con /quiz stop antes de enviar una foto.');
    }

    await typing(ctx);
    try {
      const stored = await runtime.storage.saveTelegramPhoto(photo.file_id);
      const ocr = await runtime.ocr.extract(stored.path);
      const waiting = pendingOcr.create(ctx.chat.id, ocr.text, stored.path, ocr.model);
      await sendOcrConfirmation(ctx, waiting);
    } catch (error) {
      await replyError(ctx, error);
    }
  });

  bot.on('message:document', async (ctx) => {
    menuFlow.clear(ctx.chat.id);
    const document = ctx.message.document;
    const fileName = document.file_name ?? 'documento';
    const extension = path.extname(fileName).toLowerCase();

    if (!isSupportedDocumentExtension(extension)) {
      return reply(ctx, `Formato no soportado. Envía uno de: ${supportedDocumentExtensions.join(', ')}.`);
    }
    if (document.file_size && document.file_size > maxDocumentBytes) {
      return reply(ctx, 'El documento supera el límite de 20 MB de Telegram.');
    }
    if (pending.has(ctx.chat.id) || pendingOcr.has(ctx.chat.id)) {
      return reply(ctx, 'Tienes una captura pendiente. Termínala o usa /cancelar.');
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

    const menuAction = menuActionForText(text);
    if (menuAction) {
      menuFlow.clear(ctx.chat.id);
      await handleMenuButton(ctx, menuAction);
      return;
    }

    if (text.startsWith('/')) {
      await reply(ctx, 'Comando no reconocido. Usa /start para ver la ayuda.');
      return;
    }

    const awaited = menuFlow.take(ctx.chat.id);
    if (awaited) {
      if (awaited === 'query') await runQuery(ctx, text);
      else if (awaited === 'memorize') await runMemorize(ctx, text);
      else await runQuiz(ctx, text);
      return;
    }

    const ocr = pendingOcr.get(ctx.chat.id);
    if (ocr) {
      if (ocr.stage === 'editing') {
        const updated = pendingOcr.updateText(ctx.chat.id, text);
        if (updated) await sendOcrConfirmation(ctx, updated);
        return;
      }
      await reply(ctx, 'Tienes una foto pendiente de confirmar. Usa los botones del mensaje o /cancelar.');
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

    if (data.startsWith('ocr:')) {
      const waiting = pendingOcr.get(chatId);
      if (!waiting) {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        await ctx.reply('La confirmación de la foto caducó. Envía la foto de nuevo.');
        return;
      }

      if (data === 'ocr:cancel') {
        pendingOcr.clear(chatId);
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        await ctx.reply('Foto descartada. No se guardó ninguna nota.');
        return;
      }

      if (data === 'ocr:edit') {
        pendingOcr.setStage(chatId, 'editing');
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        await ctx.reply('Envía el texto corregido de la foto. Puedes usar /cancelar para descartarla.');
        return;
      }

      if (data === 'ocr:retry') {
        if (waiting.stage !== 'confirm') {
          await ctx.reply('Envía primero el texto corregido.');
          return;
        }
        if (!runtime.ocr.fallbackModel) {
          await ctx.reply('No hay un modelo alternativo de OCR configurado.');
          return;
        }
        await typing(ctx);
        try {
          const ocr = await runtime.ocr.extract(waiting.imageFile, { useFallback: true });
          const updated = pendingOcr.updateText(chatId, ocr.text, ocr.model);
          await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
          if (updated) await sendOcrConfirmation(ctx, updated);
        } catch (error) {
          await replyError(ctx, error);
        }
        return;
      }

      if (data !== 'ocr:ok') return;
      if (waiting.stage !== 'confirm') {
        await ctx.reply('Envía primero el texto corregido.');
        return;
      }

      await typing(ctx);
      try {
        const prepared = await runtime.ingest.prepareText(waiting.text, {
          source: 'telegram_photo',
          imageFile: waiting.imageFile,
        });
        pendingOcr.clear(chatId);
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        await startClassification(ctx, prepared);
      } catch (error) {
        await replyError(ctx, error);
      }
      return;
    }

    if (data.startsWith('pm:')) {
      const choice = palaceChoices.get(chatId);
      if (!choice || choice.expiresAt < Date.now()) {
        palaceChoices.delete(chatId);
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        await ctx.reply('La lista de notas caducó. Vuelve a enviar /memorize.');
        return;
      }
      const note = choice.notes[Number(data.slice(3))];
      if (!note) {
        await ctx.reply('Opción de nota no válida.');
        return;
      }
      if (await rejectIfCapturePending(ctx, chatId, 'crear un palacio')) return;
      if (await rejectIfQuizActive(ctx, chatId, 'crear un palacio')) return;
      menuFlow.clear(chatId);
      palaceChoices.delete(chatId);
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      await typing(ctx);
      try {
        const result = await runtime.memorize.run(note.path);
        await sendPalaceCreated(ctx, result);
      } catch (error) {
        await replyError(ctx, error);
      }
      return;
    }

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

  async function sendOcrConfirmation(ctx: Context, waiting: PendingOcr): Promise<void> {
    const preview = truncate(waiting.text, 3200);
    const lines = [
      `📷 Texto detectado (${waiting.text.length} caracteres):`,
      '',
      preview,
    ];
    if (preview.length < waiting.text.length) lines.push('', '_Vista previa recortada._');
    if (waiting.model) lines.push('', `_Modelo: ${waiting.model}_`);
    lines.push('', '¿Es correcto?');
    const keyboard = new InlineKeyboard()
      .text('✅ Usar este texto', 'ocr:ok')
      .row()
      .text('✏️ Corregir', 'ocr:edit')
      .text('❌ Cancelar', 'ocr:cancel');
    if (runtime.ocr.fallbackModel && waiting.model !== runtime.ocr.fallbackModel) {
      keyboard.row().text('🔄 Reintentar con alternativa', 'ocr:retry');
    }
    await replyKeyboard(ctx, lines.join('\n'), keyboard);
  }

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
  const lines = [
    `📝 ${prepared.digest.title}`,
    truncate(prepared.digest.summary, 400),
    `Categoría sugerida: #${prepared.digest.category}`,
  ];
  return lines.join('\n');
}

function mainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text(menuButtons.query)
    .text(menuButtons.notes)
    .row()
    .text(menuButtons.palaces)
    .text(menuButtons.memorize)
    .row()
    .text(menuButtons.quiz)
    .text(menuButtons.reindex)
    .row()
    .text(menuButtons.help)
    .resized()
    .persistent();
}

export function menuActionForText(text: string): MenuButtonAction | null {
  const match = (Object.entries(menuButtons) as Array<[MenuButtonAction, string]>).find(
    ([, label]) => label === text,
  );
  return match ? match[0] : null;
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

export function parsePalaceIndex(input: string): number | null {
  const match = /^#?(\d+)$/.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function findPalaceNumber(
  palaces: Array<{ path: string }>,
  target: string,
): number | null {
  const index = palaces.findIndex(
    (palace) => path.resolve(palace.path) === path.resolve(target),
  );
  return index >= 0 ? index + 1 : null;
}

function formatPalace(palace: { title: string; combined: boolean; story: string; section: string }): string {
  return `🏛️ ${palace.combined ? '[combinado] ' : ''}${palace.title}\n\n${palace.story || palace.section}`;
}

async function replyError(ctx: Context, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ error: message }, 'bot.handler_failed');
  await reply(ctx, `⚠️ ${message}`);
}

export const telegramCommands = [
  { command: 'start', description: 'Ayuda, estado y menú' },
  { command: 'menu', description: 'Mostrar los botones' },
  { command: 'query', description: 'Preguntar a tus notas (RAG)' },
  { command: 'notas', description: 'Listar, leer o borrar notas' },
  { command: 'palacio', description: 'Ver o borrar palacios' },
  { command: 'memorize', description: 'Crear un palacio de una nota' },
  { command: 'quiz', description: 'Empezar o parar un quiz' },
  { command: 'cluster', description: 'Crear un estudio por tema' },
  { command: 'reindex', description: 'Reindexar el vault' },
  { command: 'remoto', description: 'Capturar usando el proveedor remoto' },
  { command: 'cancelar', description: 'Descartar la captura pendiente' },
];
