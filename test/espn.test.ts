import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeEvent, LEAGUES, FEATURED_TEAMS, FEATURED_SLUGS } from '../src/providers/espn.js';
import type { LeagueConfig } from '../src/providers/espn.js';
import { isKnownTeam } from '../src/domain/slug.js';

// Fixture gravada da resposta real de /bra.1/scoreboard (2026-07-26):
// agendado com horário, agendado TBD, encerrado com placar, adiado.
const fixture = JSON.parse(
  readFileSync(new URL('../src/providers/fixtures/espn-bra1.json', import.meta.url), 'utf8'),
) as { events: unknown[] };

const league: LeagueConfig = {
  code: 'bra.1',
  slug: 'brasileirao-serie-a',
  name: 'Brasileirão Série A',
  required: true,
};

const noop = () => {};

function normalized() {
  return fixture.events.map((e) => normalizeEvent(e, league, 2026, noop)!);
}

describe('normalizeEvent', () => {
  it('jogo agendado com horário: converte UTC → America/Sao_Paulo', () => {
    const match = normalized().find((m) => m.id === '401841164')!;
    expect(match.home.slug).toBe('palmeiras');
    expect(match.away.slug).toBe('atletico-mg');
    expect(match.status).toBe('scheduled');
    // 2026-07-26T22:30Z = 19:30 em Brasília
    expect(match.kickoff!.toISO()).toBe('2026-07-26T19:30:00.000-03:00');
    expect(match.date).toBe('2026-07-26');
    expect(match.venue).toBe('Allianz Parque');
    expect(match.score).toBeNull();
  });

  it('timeValid=false: ignora horário placeholder e vira dia inteiro', () => {
    const match = normalized().find((m) => m.id === '401841208')!;
    expect(match.kickoff).toBeNull();
    expect(match.date).toBe('2026-08-29');
    expect(match.status).toBe('scheduled');
  });

  it('jogo encerrado: status finished e placar', () => {
    const match = normalized().find((m) => m.id === '401840808')!;
    expect(match.status).toBe('finished');
    expect(match.score).toEqual({ home: 2, away: 2 });
    expect(match.home.slug).toBe('atletico-mg');
  });

  it('jogo adiado: status postponed, sem horário', () => {
    const match = normalized().find((m) => m.id === '401840998')!;
    expect(match.status).toBe('postponed');
    expect(match.kickoff).toBeNull();
    expect(match.score).toBeNull(); // 0x0 de placeholder não é placar real
  });

  it('nomes canônicos vêm do teams.json via espnId', () => {
    for (const match of normalized()) {
      for (const team of [match.home, match.away]) {
        expect(team.slug).toMatch(/^[a-z0-9-]+$/);
      }
    }
    const match = normalized().find((m) => m.id === '401840998')!;
    expect(match.home.name).toBe('Bahia');
  });

  it('broadcasts/geoBroadcasts viram broadcasters normalizados', () => {
    // Shape real observado na eng.1 (ligas BR vêm vazias hoje)
    const raw = structuredClone(fixture.events[0]) as {
      competitions: Array<{ broadcasts?: unknown; geoBroadcasts?: unknown }>;
    };
    raw.competitions[0]!.broadcasts = [{ market: 'national', names: ['USA Net', 'ESPN 4'] }];
    raw.competitions[0]!.geoBroadcasts = [
      { type: { id: '1' }, media: { shortName: 'usa net' } },
      { type: { id: '4' }, media: {} },
    ];
    const match = normalizeEvent(raw, league, 2026, noop)!;
    expect(match.broadcasters).toEqual(['ESPN 4', 'USA Net']);
  });

  it('sem campos de transmissão → broadcasters vazio', () => {
    for (const match of normalized()) {
      expect(match.broadcasters).toEqual([]);
    }
  });

  it('status desconhecido avisa e cai em scheduled', () => {
    const warnings: string[] = [];
    const raw = structuredClone(fixture.events[0]) as {
      competitions: Array<{ status: { type: { name: string } } }>;
    };
    raw.competitions[0]!.status.type.name = 'STATUS_ALGO_NOVO';
    const match = normalizeEvent(raw, league, 2026, (m) => warnings.push(m))!;
    expect(match.status).toBe('scheduled');
    expect(warnings).toHaveLength(1);
  });

  it('campo obrigatório ausente falha alto (zod)', () => {
    const raw = structuredClone(fixture.events[0]) as { date?: string };
    delete raw.date;
    expect(() => normalizeEvent(raw, league, 2026, noop)).toThrow();
  });
});

describe('configuração', () => {
  it('são exatamente 25 times, todos no teams.json', () => {
    expect(FEATURED_TEAMS).toHaveLength(25);
    expect(FEATURED_SLUGS.size).toBe(25);
    for (const team of FEATURED_TEAMS) {
      expect(isKnownTeam(team.slug), `${team.slug} falta no teams.json`).toBe(true);
    }
  });

  it('slugs de liga são únicos', () => {
    const slugs = LEAGUES.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
