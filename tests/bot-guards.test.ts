import { describe, expect, it, vi } from 'vitest';
import type { Runtime } from '../src/bootstrap.js';
import { createBot, menuActionForText } from '../src/bot/index.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

function fakeRuntime(quizActive: boolean) {
  return {
    env: {
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_ALLOWED_USER_IDS: ['1'],
      OBSIDIAN_VAULT_PATH: '/tmp/vault',
    },
    quiz: { hasSession: () => quizActive },
    vector: { count: async () => 0 },
    router: { status: () => 'test' },
  } as unknown as Runtime;
}

function privateMessage(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 1, type: 'private' as const },
      from: { id: 1, is_bot: false, first_name: 'Ana' },
      text,
      entities: [{ type: 'bot_command' as const, offset: 0, length: 6 }],
    },
  };
}

describe('bot guards', () => {
  it('mapea las etiquetas del teclado a acciones', () => {
    expect(menuActionForText('🔍 Consultar')).toBe('query');
    expect(menuActionForText('📚 Notas')).toBe('notes');
    expect(menuActionForText('texto libre')).toBeNull();
  });

  it('no borra notas mientras hay un quiz activo', async () => {
    const bot = createBot(fakeRuntime(true), silent);
    bot.botInfo = {
      id: 1,
      is_bot: true,
      first_name: 'Idearium',
      username: 'idearium_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    };

    const replies: Array<{ method: string; payload: unknown }> = [];
    bot.api.config.use(async (_prev, method, payload) => {
      replies.push({ method, payload });
      return { ok: true, result: true } as never;
    });

    await bot.handleUpdate(privateMessage('/notas rm 1'));

    expect(replies.some((call) => call.method === 'sendMessage')).toBe(true);
    expect(JSON.stringify(replies)).toContain('Hay un quiz activo');
  });

  it('responde a mensajes de grupos sin ejecutar comandos', async () => {
    const bot = createBot(fakeRuntime(false), silent);
    bot.botInfo = {
      id: 1,
      is_bot: true,
      first_name: 'Idearium',
      username: 'idearium_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    };

    const replies: unknown[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
      replies.push({ method, payload });
      return { ok: true, result: true } as never;
    });

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100, type: 'group' as const, title: 'Grupo' },
        from: { id: 1, is_bot: false, first_name: 'Ana' },
        text: '/start',
      },
    });

    expect(JSON.stringify(replies)).toContain('solo funciona en un chat privado');
  });
});
