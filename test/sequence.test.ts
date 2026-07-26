import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { emptyState, reconcile, pairKey } from '../src/state/sequence.js';
import { buildCalendar } from '../src/ics/builder.js';
import { TIMEZONE } from '../src/domain/types.js';
import { FIXED_NOW, makeMatch } from './helpers.js';

const LATER = FIXED_NOW.plus({ days: 1 });

describe('reconcile', () => {
  it('evento novo começa com sequence 0', () => {
    const state = emptyState();
    const { entries, changed } = reconcile(state, [makeMatch()], FIXED_NOW);
    expect(entries[0]!.meta.sequence).toBe(0);
    expect(changed).toHaveLength(1);
    expect(state.pairIndex[pairKey(makeMatch())]).toBe(entries[0]!.meta.uid);
  });

  it('idempotência: build 2x sem mudança na fonte → .ics byte-idêntico', () => {
    const state = emptyState();
    const matches = [makeMatch(), makeMatch({ home: { name: 'Santos', slug: 'santos' }, away: { name: 'Bahia', slug: 'bahia' }, date: '2026-08-01' })];

    const first = reconcile(state, matches, FIXED_NOW);
    const icsFirst = buildCalendar({ name: 'x' }, first.entries);

    // segunda rodada do build, horas depois, fonte inalterada
    const second = reconcile(state, matches, LATER);
    const icsSecond = buildCalendar({ name: 'x' }, second.entries);

    expect(second.changed).toHaveLength(0);
    expect(icsSecond).toBe(icsFirst); // inclui DTSTAMP/LAST-MODIFIED preservados
  });

  it('mudança de horário → sequence + 1 e lastModified atualizado', () => {
    const state = emptyState();
    reconcile(state, [makeMatch()], FIXED_NOW);

    const rescheduled = makeMatch({
      kickoff: DateTime.fromISO('2026-07-30T21:30:00', { zone: TIMEZONE }),
    });
    const { entries, changed } = reconcile(state, [rescheduled], LATER);
    expect(entries[0]!.meta.sequence).toBe(1);
    expect(entries[0]!.meta.lastModified).toBe(LATER.toISO({ suppressMilliseconds: true }));
    expect(changed).toHaveLength(1);
  });

  it('horário definido para jogo que era dia inteiro → sequence + 1', () => {
    const state = emptyState();
    reconcile(state, [makeMatch({ kickoff: null })], FIXED_NOW);
    const { entries } = reconcile(state, [makeMatch()], LATER);
    expect(entries[0]!.meta.sequence).toBe(1);
  });

  it('mudança de mando de campo (LOCATION) → sequence + 1', () => {
    const state = emptyState();
    reconcile(state, [makeMatch()], FIXED_NOW);
    const { entries } = reconcile(state, [makeMatch({ venue: 'Arena Barueri' })], LATER);
    expect(entries[0]!.meta.sequence).toBe(1);
  });

  it('mudança de status → sequence + 1', () => {
    const state = emptyState();
    reconcile(state, [makeMatch()], FIXED_NOW);
    const { entries } = reconcile(state, [makeMatch({ status: 'cancelled' })], LATER);
    expect(entries[0]!.meta.sequence).toBe(1);
  });

  it('placar (só conteúdo) → mesma sequence, lastModified novo', () => {
    const state = emptyState();
    const scheduled = makeMatch({ status: 'confirmed' });
    reconcile(state, [scheduled], FIXED_NOW);

    const finished = makeMatch({ status: 'finished', score: { home: 2, away: 1 } });
    // status mudou → bump esperado aqui
    const afterFinish = reconcile(state, [finished], LATER);
    expect(afterFinish.entries[0]!.meta.sequence).toBe(1);

    // correção de placar depois: status igual, só o SUMMARY muda
    const corrected = makeMatch({ status: 'finished', score: { home: 3, away: 1 } });
    const MUCH_LATER = LATER.plus({ hours: 2 });
    const { entries, changed } = reconcile(state, [corrected], MUCH_LATER);
    expect(entries[0]!.meta.sequence).toBe(1); // sem bump
    expect(entries[0]!.meta.lastModified).toBe(MUCH_LATER.toISO({ suppressMilliseconds: true }));
    expect(changed).toHaveLength(1);
  });

  it('partida adiada reaparece com outra data mas mesmo UID', () => {
    const state = emptyState();
    const first = reconcile(state, [makeMatch()], FIXED_NOW);
    const uid = first.entries[0]!.meta.uid;

    const moved = makeMatch({
      date: '2026-09-02',
      kickoff: DateTime.fromISO('2026-09-02T19:00:00', { zone: TIMEZONE }),
    });
    const second = reconcile(state, [moved], LATER);
    expect(second.entries[0]!.meta.uid).toBe(uid);
    expect(uid).toContain('2026-07-30'); // UID congela a data original
  });
});
