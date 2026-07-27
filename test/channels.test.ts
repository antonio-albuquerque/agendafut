import { describe, expect, it } from 'vitest';
import { normalizeChannels } from '../src/domain/channels.js';

describe('normalizeChannels', () => {
  it('apara, colapsa espaços e descarta vazios', () => {
    expect(normalizeChannels(['  ESPN  4 ', '', '   '])).toEqual(['ESPN 4']);
  });

  it('dedup case-insensitive mantendo a variante lexicograficamente menor', () => {
    expect(normalizeChannels(['Premiere', 'PREMIERE', 'premiere'])).toEqual(['PREMIERE']);
  });

  it('ordena por code unit, não por locale', () => {
    // Por locale "Água" viria antes de "ZAPPING"; por code unit vem depois.
    expect(normalizeChannels(['Água TV', 'ZAPPING', 'CANAL GOAT'])).toEqual([
      'CANAL GOAT',
      'ZAPPING',
      'Água TV',
    ]);
  });

  it('é idempotente', () => {
    const once = normalizeChannels(['DISNEY+', 'ESPN 4', 'disney+']);
    expect(normalizeChannels(once)).toEqual(once);
  });
});
