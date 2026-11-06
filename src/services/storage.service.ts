import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface StorageConfig {
  audioDir: string;
  documentDir?: string;
  imageDir?: string;
  botToken: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface StoredFile {
  path: string;
  bytes?: number;
}

export type StoredAudio = StoredFile;

interface TelegramFileResponse {
  ok: boolean;
  result?: { file_path?: string };
  description?: string;
}

export class StorageService {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: StorageConfig) {
    this.apiBaseUrl = (config.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Resolve the Telegram file path and stream it to local disk. */
  async saveTelegramAudio(fileId: string, extension = 'ogg'): Promise<StoredAudio> {
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(this.config.audioDir, day, `${randomUUID()}.${extension}`);
    return this.downloadTelegramFile(fileId, target, 'audio');
  }

  /** Stream a Telegram photo to the images directory. */
  async saveTelegramPhoto(fileId: string, extension = 'jpg'): Promise<StoredFile> {
    if (!this.config.imageDir) {
      throw new Error('IMAGES_DIR no está configurado; no se puede guardar la foto.');
    }

    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(this.config.imageDir, day, `${randomUUID()}.${extension}`);
    return this.downloadTelegramFile(fileId, target, 'foto');
  }

  /** Download a Telegram document preserving its extension. */
  async saveTelegramDocument(fileId: string, fileName: string): Promise<StoredFile> {
    if (!this.config.documentDir) {
      throw new Error('DOCUMENT_DIR no está configurado; no se puede guardar el documento.');
    }

    const day = new Date().toISOString().slice(0, 10);
    const safeName = safeFileName(fileName);
    const target = path.join(this.config.documentDir, day, `${randomUUID()}-${safeName}`);
    return this.downloadTelegramFile(fileId, target, 'documento');
  }

  private async downloadTelegramFile(fileId: string, target: string, label: string): Promise<StoredFile> {
    if (!this.config.botToken) {
      throw new Error(`TELEGRAM_BOT_TOKEN no está configurado; no se puede descargar el ${label}.`);
    }

    const filePath = await this.resolveTelegramFilePath(fileId);
    const url = `${this.apiBaseUrl}/file/bot${this.config.botToken}/${filePath}`;
    const response = await this.fetchImpl(url);
    if (!response.ok || !response.body) {
      throw new Error(`Telegram respondió ${response.status} al descargar el ${label}.`);
    }

    await mkdir(path.dirname(target), { recursive: true });
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
    return { path: target };
  }

  private async resolveTelegramFilePath(fileId: string): Promise<string> {
    const url = `${this.apiBaseUrl}/bot${this.config.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Telegram getFile respondió ${response.status}.`);
    }
    const data = (await response.json()) as TelegramFileResponse;
    const filePath = data.result?.file_path;
    if (!data.ok || !filePath) {
      throw new Error(`Telegram getFile sin file_path (${data.description ?? 'sin detalle'}).`);
    }
    return filePath;
  }
}

function safeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(-120);
  return base || 'documento';
}
