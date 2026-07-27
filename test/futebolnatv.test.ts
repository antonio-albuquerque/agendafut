import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { parseLeaguePage, resolveDateHeader } from '../src/providers/futebolnatv.js';
import { TIMEZONE } from '../src/domain/types.js';

// Página real de /liga/brasileirao-serie-b-* capturada em 2026-07-27.
const fixture = readFileSync(
  new URL('../src/providers/fixtures/fntv-serie-b.html', import.meta.url),
  'utf8',
);
const newYear = readFileSync(
  new URL('../src/providers/fixtures/fntv-newyear.html', import.meta.url),
  'utf8',
);

/** "hoje" da captura da fixture real */
const CAPTURE_DAY = DateTime.fromISO('2026-07-27T12:00:00', { zone: TIMEZONE });

const noop = () => {};

describe('resolveDateHeader', () => {
  it('Hoje/Amanhã relativos a today', () => {
    expect(resolveDateHeader('Hoje', CAPTURE_DAY)).toBe('2026-07-27');
    expect(resolveDateHeader('  Amanhã ', CAPTURE_DAY)).toBe('2026-07-28');
  });

  it('dd/MM usa o ano corrente', () => {
    expect(resolveDateHeader('Sex, 07/08', CAPTURE_DAY)).toBe('2026-08-07');
  });

  it('virada de ano: dd/MM no passado distante vira ano seguinte', () => {
    const dec30 = DateTime.fromISO('2026-12-30T12:00:00', { zone: TIMEZONE });
    expect(resolveDateHeader('Qui, 02/01', dec30)).toBe('2027-01-02');
    // ontem/anteontem continuam no ano corrente (graça de 2 dias)
    expect(resolveDateHeader('Ter, 29/12', dec30)).toBe('2026-12-29');
  });

  it('header que não é data → null', () => {
    expect(resolveDateHeader('Direitos de transmissão', CAPTURE_DAY)).toBeNull();
    expect(resolveDateHeader('Sáb, 31/02', CAPTURE_DAY)).toBeNull();
  });
});

describe('parseLeaguePage', () => {
  it('extrai todos os jogos da página real com data, times e canais', () => {
    const games = parseLeaguePage(fixture, CAPTURE_DAY, noop);
    // A página tem 10 cards; 2 (Sáb 08/08) ainda sem canal anunciado são pulados.
    expect(games).toHaveLength(8);

    const crb = games.find((g) => g.homeRaw === 'CRB')!;
    expect(crb).toMatchObject({
      date: '2026-07-27',
      time: '19:30',
      awayRaw: 'Vila Nova',
      round: '20',
    });
    expect(crb.channels).toEqual(['XSPORTS', 'ESPN', 'CANAL GOAT', 'DISNEY+']);

    const fortaleza = games.find((g) => g.homeRaw === 'Fortaleza')!;
    expect(fortaleza).toMatchObject({ date: '2026-07-28', time: '21:35', awayRaw: 'Botafogo SP' });
    expect(fortaleza.channels).toContain('REDETV!');

    // grupos de data com dd/MM
    expect(games.filter((g) => g.date === '2026-08-07')).toHaveLength(2);
    // os 2 jogos de 08/08 não têm canal anunciado → pulados
    expect(games.filter((g) => g.date === '2026-08-08')).toHaveLength(0);
  });

  it('card quebrado é pulado com warn; o resto da página sobrevive', () => {
    const warnings: string[] = [];
    const dec30 = DateTime.fromISO('2026-12-30T12:00:00', { zone: TIMEZONE });
    const games = parseLeaguePage(newYear, dec30, (m) => warnings.push(m));
    expect(games).toHaveLength(2);
    expect(warnings).toHaveLength(1);

    const carioca = games.find((g) => g.homeRaw === 'Flamengo')!;
    expect(carioca.date).toBe('2027-01-02'); // virada de ano
    expect(carioca.channels).toEqual(['BAND', 'CANAL GOAT']);
  });

  it('página sem nenhum card parseável lança', () => {
    expect(() => parseLeaguePage('<html><body><p>manutenção</p></body></html>', CAPTURE_DAY, noop))
      .toThrow(/nenhum jogo/);
  });
});
