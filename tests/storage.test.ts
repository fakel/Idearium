import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from '../src/services/storage.service.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('StorageService', () => {
  it('descarga una foto de Telegram a IMAGES_DIR', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-storage-'));
    dirs.push(dir);
    const imageDir = path.join(dir, 'images');

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/getFile')) {
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.jpg' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      expect(String(url)).toContain('/file/bot123/photos/file_1.jpg');
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
    });

    const storage = new StorageService({
      audioDir: path.join(dir, 'audio'),
      imageDir,
      botToken: '123',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const stored = await storage.saveTelegramPhoto('file-id');
    expect(stored.path.startsWith(imageDir + path.sep)).toBe(true);
    expect(stored.path.endsWith('.jpg')).toBe(true);
    expect([...await readFile(stored.path)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it('exige IMAGES_DIR para guardar fotos', async () => {
    const storage = new StorageService({ audioDir: '/tmp/audio', botToken: '123' });
    await expect(storage.saveTelegramPhoto('file-id')).rejects.toThrow('IMAGES_DIR no está configurado');
  });
});
