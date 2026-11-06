import { describe, expect, it } from 'vitest';
import { PendingOcrStore } from '../src/services/pending-ocr.service.js';

describe('PendingOcrStore', () => {
  it('guarda el texto OCR y pasa a edición y confirmación', () => {
    const store = new PendingOcrStore();
    const created = store.create(1, 'texto detectado', '/vault/foto.jpg');
    expect(created.stage).toBe('confirm');
    expect(store.has(1)).toBe(true);

    store.setStage(1, 'editing');
    expect(store.get(1)?.stage).toBe('editing');

    const updated = store.updateText(1, 'texto corregido');
    expect(updated?.stage).toBe('confirm');
    expect(store.get(1)?.text).toBe('texto corregido');
    expect(updated?.imageFile).toBe('/vault/foto.jpg');

    expect(store.clear(1)).toBe(true);
    expect(store.get(1)).toBeUndefined();
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
