import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SttService } from '../src/services/stt.service.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('SttService', () => {
  it('envía Bearer y modelo al proveedor externo', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-stt-'));
    dirs.push(dir);
    const audio = path.join(dir, 'nota.ogg');
    await writeFile(audio, Buffer.from('fake-audio'));

    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-key');
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('model')).toBe('whisper-1');
      return new Response(JSON.stringify({ text: 'hola mundo', language: 'es' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const stt = new SttService({
      baseUrl: 'https://api.example.com/',
      apiKey: 'test-key',
      model: 'whisper-1',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await stt.transcribe(audio);
    expect(result).toEqual({ text: 'hola mundo', language: 'es', duration: undefined });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reintenta cuando el proveedor responde 429', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-stt-'));
    dirs.push(dir);
    const audio = path.join(dir, 'nota.ogg');
    await writeFile(audio, Buffer.from('fake-audio'));

    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ detail: 'rate limited' }), { status: 429 });
      }
      return new Response(JSON.stringify({ text: 'hola' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const stt = new SttService({
      baseUrl: 'https://api.example.com',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(stt.transcribe(audio)).resolves.toEqual({
      text: 'hola',
      language: undefined,
      duration: undefined,
    });
    expect(calls).toBe(2);
  });
});
