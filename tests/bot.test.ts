import { describe, expect, it } from 'vitest';
import { findPalaceNumber, isPrivateChat, parsePalaceIndex } from '../src/bot/index.js';

describe('parsePalaceIndex', () => {
  it('acepta números positivos con o sin #', () => {
    expect(parsePalaceIndex('1')).toBe(1);
    expect(parsePalaceIndex(' 2 ')).toBe(2);
    expect(parsePalaceIndex('#3')).toBe(3);
    expect(parsePalaceIndex('01')).toBe(1);
  });

  it('rechaza cero, negativos, decimales y texto', () => {
    expect(parsePalaceIndex('0')).toBeNull();
    expect(parsePalaceIndex('-1')).toBeNull();
    expect(parsePalaceIndex('1.5')).toBeNull();
    expect(parsePalaceIndex('café')).toBeNull();
    expect(parsePalaceIndex('')).toBeNull();
    expect(parsePalaceIndex('1 2')).toBeNull();
  });
});

describe('findPalaceNumber', () => {
  const palaces = [{ path: '/vault/A.md' }, { path: '/vault/B.md' }];

  it('devuelve el número 1-based del palacio creado', () => {
    expect(findPalaceNumber(palaces, '/vault/B.md')).toBe(2);
    expect(findPalaceNumber(palaces, '/vault/A.md')).toBe(1);
  });

  it('devuelve null si no está en el listado', () => {
    expect(findPalaceNumber(palaces, '/vault/C.md')).toBeNull();
  });
});


describe('isPrivateChat', () => {
  it('solo acepta chats privados', () => {
    expect(isPrivateChat('private')).toBe(true);
    expect(isPrivateChat('group')).toBe(false);
    expect(isPrivateChat('supergroup')).toBe(false);
    expect(isPrivateChat('channel')).toBe(false);
    expect(isPrivateChat(undefined)).toBe(false);
  });
});
