import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { buildCalendar, escapeText, foldLine } from '../src/ics/builder.js';
import type { CalendarEntry } from '../src/ics/builder.js';
import { buildUid } from '../src/ics/uid.js';
import { emptyState, reconcile } from '../src/state/sequence.js';
import { TIMEZONE } from '../src/domain/types.js';
import { FIXED_NOW, makeMatch } from './helpers.js';

const GOLDEN_DIR = join(import.meta.dirname, 'golden');

/**
 * Compara com o golden em test/golden/. Para (re)gerar após mudança
 * intencional no formato: UPDATE_GOLDEN=1 pnpm test — e revise o diff.
 */
function expectGolden(name: string, actual: string): void {
  const path = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(path)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, actual, 'utf8');
    return;
  }
  expect(actual).toBe(readFileSync(path, 'utf8'));
}

function entryFor(match = makeMatch(), sequence = 0): CalendarEntry {
  return {
    match,
    meta: {
      uid: buildUid(match.competition, match.date, match.home.slug, match.away.slug),
      sequence,
      lastModified: FIXED_NOW.toISO({ suppressMilliseconds: true })!,
    },
  };
}

function roundTrip(ics: string): ICAL.Component {
  return new ICAL.Component(ICAL.parse(ics) as unknown as unknown[]);
}

/** Desfaz o line folding para asserções de substring (RFC 5545 §3.1). */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

describe('buildCalendar', () => {
  it('jogo normal com horário', () => {
    const ics = buildCalendar({ name: 'Palmeiras — jogos' }, [entryFor()]);
    expectGolden('normal.ics', ics);

    const cal = roundTrip(ics);
    const events = cal.getAllSubcomponents('vevent');
    expect(events).toHaveLength(1);
    const event = new ICAL.Event(events[0]!);
    expect(event.summary).toBe('Palmeiras x Corinthians');
    expect(event.startDate.toString()).toContain('2026-07-30T16:00:00');
    expect(cal.getAllSubcomponents('vtimezone')).toHaveLength(1);
  });

  it('jogo sem horário vira evento de dia inteiro', () => {
    const match = makeMatch({ kickoff: null, round: '30', date: '2026-10-18' });
    const ics = buildCalendar({ name: 'Palmeiras — jogos' }, [entryFor(match)]);
    expectGolden('sem-horario.ics', ics);

    expect(unfold(ics)).toContain('DTSTART;VALUE=DATE:20261018');
    expect(unfold(ics)).toContain('DTEND;VALUE=DATE:20261019');
    expect(unfold(ics)).toContain('Horário a definir.');
    const event = new ICAL.Event(roundTrip(ics).getAllSubcomponents('vevent')[0]!);
    expect(event.startDate.isDate).toBe(true);
  });

  it('nomes acentuados: folding por octeto e escape de vírgula', () => {
    const match = makeMatch({
      home: { name: 'Grêmio', slug: 'gremio' },
      away: { name: 'Atlético-MG', slug: 'atletico-mg' },
      venue: 'Arena do Grêmio, Porto Alegre',
      broadcasters: ['Prêmiere', 'TV Globo (exceto RS, onde há transmissão regional exclusiva)'],
    });
    const ics = buildCalendar({ name: 'Grêmio — jogos' }, [entryFor(match)]);
    expectGolden('acentos.ics', ics);

    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    const event = new ICAL.Event(roundTrip(ics).getAllSubcomponents('vevent')[0]!);
    expect(event.summary).toBe('Grêmio x Atlético-MG');
    expect(event.location).toBe('Arena do Grêmio, Porto Alegre');
  });

  it('jogo cancelado mantém o evento com STATUS:CANCELLED', () => {
    const match = makeMatch({ status: 'cancelled' });
    const ics = buildCalendar({ name: 'Palmeiras — jogos' }, [entryFor(match, 2)]);
    expectGolden('cancelado.ics', ics);
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:2');
  });

  it('placar no SUMMARY para jogo encerrado', () => {
    const match = makeMatch({ status: 'finished', score: { home: 2, away: 1 } });
    const ics = buildCalendar({ name: 'Palmeiras — jogos' }, [entryFor(match, 1)]);
    expect(ics).toContain('SUMMARY:Palmeiras 2 x 1 Corinthians');
  });

  it('é determinístico: mesma entrada → mesmos bytes', () => {
    const entries = [entryFor(), entryFor(makeMatch({ date: '2026-08-02', away: { name: 'Santos', slug: 'santos' } }))];
    expect(buildCalendar({ name: 'x' }, entries)).toBe(buildCalendar({ name: 'x' }, entries));
  });
});

describe('adiamento (reconcile + builder)', () => {
  it('mesma UID, data nova, SEQUENCE+1', () => {
    const state = emptyState();
    const original = makeMatch();
    const first = reconcile(state, [original], FIXED_NOW);
    const originalUid = first.entries[0]!.meta.uid;
    expect(first.entries[0]!.meta.sequence).toBe(0);

    // adiado: nova data e horário, mesmo confronto
    const postponed = makeMatch({
      date: '2026-08-12',
      kickoff: DateTime.fromISO('2026-08-12T20:00:00', { zone: TIMEZONE }),
    });
    const later = FIXED_NOW.plus({ days: 3 });
    const second = reconcile(state, [postponed], later);
    const entry = second.entries[0]!;

    expect(entry.meta.uid).toBe(originalUid); // UID preserva a data ORIGINAL
    expect(entry.meta.sequence).toBe(1);

    const ics = buildCalendar({ name: 'Palmeiras — jogos' }, [entry]);
    expectGolden('adiado.ics', ics);
    expect(unfold(ics)).toContain(`UID:${originalUid}`);
    expect(unfold(ics)).toContain('DTSTART;TZID=America/Sao_Paulo:20260812T200000');
    expect(unfold(ics)).toContain('SEQUENCE:1');
  });

  it('adiado sem nova data fica TENTATIVE na data original', () => {
    const match = makeMatch({ status: 'postponed' });
    const ics = buildCalendar({ name: 'x' }, [entryFor(match, 1)]);
    expect(unfold(ics)).toContain('STATUS:TENTATIVE');
    expect(unfold(ics)).toContain('Partida adiada — nova data a confirmar.');
  });
});

describe('escapeText', () => {
  it('escapa vírgula, ponto-e-vírgula, barra invertida e quebra de linha', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });
});

describe('foldLine', () => {
  it('não mexe em linha curta', () => {
    expect(foldLine('SUMMARY:curto')).toBe('SUMMARY:curto');
  });

  it('dobra em 75 octetos e nunca parte caractere multi-byte', () => {
    const line = 'DESCRIPTION:' + 'Grêmio é o Atlético põe aça çç '.repeat(10);
    const folded = foldLine(line);
    for (const piece of folded.split('\r\n')) {
      expect(Buffer.byteLength(piece, 'utf8')).toBeLessThanOrEqual(75);
    }
    // desdobrar recupera a linha original
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
});
