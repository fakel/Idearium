import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentService, isSupportedDocumentExtension } from '../src/services/document.service.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'idearium-doc-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('DocumentService', () => {
  it('extrae texto de .md sin el frontmatter y de .txt', async () => {
    const dir = await tempDir();
    const md = path.join(dir, 'nota.md');
    const txt = path.join(dir, 'nota.txt');
    await writeFile(md, '---\ntitle: Otra\n---\n\nContenido **markdown**.\n', 'utf8');
    await writeFile(txt, '\uFEFFTexto plano con café.\n', 'utf8');

    const service = new DocumentService();
    expect((await service.extract(md)).text).toBe('Contenido **markdown**.');
    expect((await service.extract(txt)).text).toBe('Texto plano con café.');
  });

  it('rechaza formatos no soportados y documentos vacíos', async () => {
    const dir = await tempDir();
    const rtf = path.join(dir, 'nota.rtf');
    const empty = path.join(dir, 'vacio.txt');
    await writeFile(rtf, '{\\rtf1 hola}', 'utf8');
    await writeFile(empty, '   \n', 'utf8');

    const service = new DocumentService();
    await expect(service.extract(rtf)).rejects.toThrow('Formato no soportado');
    await expect(service.extract(empty)).rejects.toThrow('no contiene texto extraíble');
    expect(isSupportedDocumentExtension('.DOCX')).toBe(true);
    expect(isSupportedDocumentExtension('.rtf')).toBe(false);
  });

  it('recorta documentos largos y lo indica', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'largo.txt');
    await writeFile(file, 'x'.repeat(2_000), 'utf8');

    const result = await new DocumentService({ maxChars: 1_000 }).extract(file);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('Documento recortado');
    expect(result.text.length).toBeLessThan(1_200);
  });
});
