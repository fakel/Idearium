import { describe, expect, it } from 'vitest';
import { PendingCaptureStore } from '../src/services/pending.service.js';
import type { PreparedIngest } from '../src/controllers/ingest.controller.js';

const prepared: PreparedIngest = {
  transcript: 'texto',
  digest: {
    title: 'Título',
    summary: 'Resumen',
    category: 'idea',
    tags: ['uno', 'dos', 'tres'],
    action_items: [],
    key_ideas: ['idea'],
    language: 'es',
  },
  source: 'telegram_text',
  provider: 'fake',
  model: 'fake',
  usedRemote: false,
  reason: 'test',
};

describe('PendingCaptureStore', () => {
  it('pasa de carpeta a categoría y se limpia', () => {
    const store = new PendingCaptureStore();
    store.create(1, prepared, ['Idearium'], 'idea');
    expect(store.get(1)?.stage).toBe('folder');

    store.chooseFolder(1, 'Ideas', ['idea', 'proyecto']);
    const capture = store.get(1);
    expect(capture?.stage).toBe('category');
    expect(capture?.folder).toBe('Ideas');
    expect(store.clear(1)).toBe(true);
    expect(store.get(1)).toBeUndefined();
  });

  it('caduca tras el TTL', () => {
    const store = new PendingCaptureStore(1000);
    store.create(1, prepared, ['Idearium'], 'idea', 0);
    expect(store.get(1, 500)).toBeDefined();
    expect(store.get(1, 1001)).toBeUndefined();
  });
});
