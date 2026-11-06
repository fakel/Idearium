import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OcrService } from '../src/services/ocr.service.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function imageFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-ocr-'));
  dirs.push(dir);
  const file = path.join(dir, 'foto.jpg');
  await writeFile(file, Buffer.from('fake-image'));
  return file;
}

describe('OcrService', () => {
  it('envía la imagen como data URL y devuelve el texto', async () => {
    const file = await imageFile();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer test-key');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        reasoning: { effort: string };
        messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
      };
      expect(body.model).toBe('deepseek/deepseek-v4.1-flash');
      expect(body.reasoning.effort).toBe('none');
      expect(body.messages[0]!.content[0]!.type).toBe('text');
      expect(body.messages[0]!.content[0]!.text).toContain('tabla Markdown');
      expect(body.messages[0]!.content[1]!.image_url?.url).toMatch(
        /^data:image\/jpeg;base64,/,
      );
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Recordatorio\n- arroz' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const ocr = new OcrService({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1/',
      model: 'deepseek/deepseek-v4.1-flash',
      reasoningEffort: 'none',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(ocr.extract(file)).resolves.toEqual({
      text: 'Recordatorio\n- arroz',
      model: 'deepseek/deepseek-v4.1-flash',
    });
  });

  it('cae al modelo alternativo si el principal falla', async () => {
    const file = await imageFile();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      calls.push(body.model);
      if (calls.length === 1) {
        return new Response('model unavailable', { status: 503 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Texto del alternativo' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const ocr = new OcrService({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'primary',
      fallbackModel: 'fallback',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(ocr.extract(file)).resolves.toEqual({
      text: 'Texto del alternativo',
      model: 'fallback',
    });
    expect(calls).toEqual(['primary', 'fallback']);
  });

  it('puede forzar solo el modelo alternativo', async () => {
    const file = await imageFile();
    const models: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      models.push(body.model);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Reintento' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const ocr = new OcrService({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'primary',
      fallbackModel: 'fallback',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(ocr.extract(file, { useFallback: true })).resolves.toEqual({
      text: 'Reintento',
      model: 'fallback',
    });
    expect(models).toEqual(['fallback']);
  });

  it('falla si no hay texto legible', async () => {
    const file = await imageFile();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'SIN_TEXTO' } }] }), {
        status: 200,
      }),
    );

    const ocr = new OcrService({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'vision',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(ocr.extract(file)).rejects.toThrow('No se detectó texto legible');
  });

  it('propaga el error de OpenRouter', async () => {
    const file = await imageFile();
    const fetchImpl = vi.fn(async () => new Response('model does not support images', { status: 400 }));

    const ocr = new OcrService({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'text-only',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(ocr.extract(file)).rejects.toThrow('OpenRouter Vision respondió 400');
  });
});
