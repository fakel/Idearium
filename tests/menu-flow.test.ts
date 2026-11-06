import { describe, expect, it } from 'vitest';
import { AwaitingActionStore } from '../src/services/menu-flow.service.js';

describe('AwaitingActionStore', () => {
  it('guarda la acción y la consume una sola vez', () => {
    const store = new AwaitingActionStore();
    store.set(1, 'query');

    expect(store.get(1)).toBe('query');
    expect(store.take(1)).toBe('query');
    expect(store.take(1)).toBeUndefined();
  });

  it('caduca tras el TTL', () => {
    let now = 0;
    const store = new AwaitingActionStore(1000, () => now);
    store.set(1, 'quiz');
    now = 1001;

    expect(store.get(1)).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('permite cancelar la espera', () => {
    const store = new AwaitingActionStore();
    store.set(2, 'memorize');
    expect(store.clear(2)).toBe(true);
    expect(store.get(2)).toBeUndefined();
  });
});
