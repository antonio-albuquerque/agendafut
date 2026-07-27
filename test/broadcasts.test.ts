import { describe, expect, it } from 'vitest';
import { enrichBroadcasts } from '../src/enrich/broadcasts.js';
import type { BroadcastLeague, LeagueScraper } from '../src/enrich/broadcasts.js';
import type { ScrapedGame } from '../src/providers/futebolnatv.js';
import { emptyState, reconcile } from '../src/state/sequence.js';
import { FIXED_NOW, makeMatch } from './helpers.js';

const LEAGUES: BroadcastLeague[] = [
  { slug: 'brasileirao-serie-a', url: 'https://fntv.example/liga/serie-a' },
];

const noop = () => {};

function makeGame(overrides: Partial<ScrapedGame> = {}): ScrapedGame {
  return {
    date: '2026-07-30',
    time: '16:00',
    homeRaw: 'Palmeiras',
    awayRaw: 'Corinthians',
    round: '18',
    channels: ['PREMIERE', 'Globo'],
    ...overrides,
  };
}

function fakeClient(games: ScrapedGame[]): LeagueScraper {
  return { leagueGames: () => Promise.resolve(games) };
}

const failingClient: LeagueScraper = {
  leagueGames: () => Promise.reject(new Error('HTTP 503')),
};

describe('enrichBroadcasts', () => {
  it('casa por data + par de times com alias e normaliza com o que veio da ESPN', async () => {
    // "Verdão" é alias de Palmeiras no teams.json; ESPN trouxe 'premiere'
    const match = makeMatch({ broadcasters: ['premiere'] });
    const report = await enrichBroadcasts([match], emptyState(), {
      now: FIXED_NOW,
      client: fakeClient([makeGame({ homeRaw: 'Verdão' })]),
      leagues: LEAGUES,
      log: noop,
    });
    expect(match.broadcasters).toEqual(['Globo', 'PREMIERE']); // união + dedupe + ordem canônica
    expect(report).toMatchObject({ scrapedGames: 1, matched: 1, fromStateOnly: 0 });
  });

  it('mando invertido no site ainda casa (fallback de par ordenado)', async () => {
    const match = makeMatch();
    const logs: string[] = [];
    await enrichBroadcasts([match], emptyState(), {
      now: FIXED_NOW,
      client: fakeClient([makeGame({ homeRaw: 'Corinthians', awayRaw: 'Palmeiras' })]),
      leagues: LEAGUES,
      log: (m) => logs.push(m),
    });
    expect(match.broadcasters).toEqual(['Globo', 'PREMIERE']);
    expect(logs.some((m) => m.includes('mando invertido'))).toBe(true);
  });

  it('scrape falhou → usa transmissão persistida do build anterior', async () => {
    // build anterior: canais frescos entraram no estado via reconcile
    const state = emptyState();
    const before = makeMatch({ broadcasters: ['GLOBO', 'PREMIERE'] });
    reconcile(state, [before], FIXED_NOW);

    const match = makeMatch(); // broadcasters vazio: ESPN não traz nada
    const report = await enrichBroadcasts([match], state, {
      now: FIXED_NOW,
      client: failingClient,
      leagues: LEAGUES,
      log: noop,
    });
    expect(match.broadcasters).toEqual(['GLOBO', 'PREMIERE']);
    expect(report.failedLeagues).toEqual(['brasileirao-serie-a']);
    expect(report.fromStateOnly).toBe(1);
  });

  it('dado fresco substitui o persistido (canal removido pela fonte some)', async () => {
    const state = emptyState();
    reconcile(state, [makeMatch({ broadcasters: ['GLOBO', 'PREMIERE'] })], FIXED_NOW);

    const match = makeMatch();
    await enrichBroadcasts([match], state, {
      now: FIXED_NOW,
      client: fakeClient([makeGame({ channels: ['PREMIERE'] })]),
      leagues: LEAGUES,
      log: noop,
    });
    expect(match.broadcasters).toEqual(['PREMIERE']); // GLOBO saiu
  });

  it('jogo do site sem partida ESPN correspondente só loga', async () => {
    const match = makeMatch();
    const logs: string[] = [];
    await enrichBroadcasts([match], emptyState(), {
      now: FIXED_NOW,
      client: fakeClient([makeGame({ date: '2026-08-15' })]),
      leagues: LEAGUES,
      log: (m) => logs.push(m),
    });
    expect(match.broadcasters).toEqual([]);
    expect(logs.some((m) => m.includes('sem partida ESPN'))).toBe(true);
  });

  it('liga sem partidas ESPN no build não é raspada', async () => {
    let called = 0;
    const client: LeagueScraper = {
      leagueGames: () => {
        called += 1;
        return Promise.resolve([]);
      },
    };
    await enrichBroadcasts([makeMatch({ competition: 'brasileirao-serie-b' })], emptyState(), {
      now: FIXED_NOW,
      client,
      leagues: LEAGUES, // só serie-a mapeada
      log: noop,
    });
    expect(called).toBe(0);
  });

  it('nunca rejeita, mesmo com tudo falhando', async () => {
    const report = await enrichBroadcasts([makeMatch()], emptyState(), {
      now: FIXED_NOW,
      client: failingClient,
      leagues: LEAGUES,
      log: noop,
    });
    expect(report.failedLeagues).toHaveLength(1);
  });
});
