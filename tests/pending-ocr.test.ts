import { describe, expect, it } from 'vitest';
import { PendingOcrStore } from '../src/services/pending-ocr.service.js';

describe('PendingOcrStore', () => {
  it('guarda el texto OCR y pasa a edición y confirmación', () => {
    const store = new PendingOcrStore();
    const created = store.create(1, 'texto detectado', '/vault/foto.jpg', 'gemma');
    expect(created.stage).toBe('confirm');
    expect(created.model).toBe('gemma');
    expect(store.has(1)).toBe(true);

    store.setStage(1, 'editing');
    expect(store.get(1)?.stage).toBe('editing');

    const updated = store.updateText(1, 'texto corregido', 'qwen');
    expect(updated?.stage).toBe('confirm');
    expect(updated?.model).toBe('qwen');
    expect(store.get(1)?.text).toBe('texto corregido');
    expect(updated?.imageFile).toBe('/vault/foto.jpg');

    expect(store.clear(1)).toBe(true);
    expect(store.get(1)).toBeUndefined();
  });

  it('acumula el coste del OCR original y del reintento', () => {
    const store = new PendingOcrStore();
    store.create(1, 'texto', '/vault/foto.jpg', 'gemma', {
      requests: 1,
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      costUsd: 0.0001,
    });
    const updated = store.updateText(1, 'texto qwen', 'qwen', {
      requests: 1,
      promptTokens: 200,
      completionTokens: 20,
      totalTokens: 220,
      costUsd: 0.0002,
    });
    expect(updated?.usage).toEqual({
      requests: 2,
      promptTokens: 300,
      completionTokens: 30,
      totalTokens: 330,
      costUsd: 0.0003,
    });
  });

  it('caduca tras el TTL', () => {
    let now = 0;
    const store = new PendingOcrStore(1000, () => now);
    store.create(1, 'texto', '/vault/foto.jpg');
    expect(store.get(1)).toBeDefined();
    now = 1001;
    expect(store.get(1)).toBeUndefined();
  });
});
