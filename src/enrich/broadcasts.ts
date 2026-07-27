import { readFileSync } from 'node:fs';
import type { DateTime } from 'luxon';
import { z } from 'zod';
import type { Match } from '../domain/types.js';
import { normalizeChannels } from '../domain/channels.js';
import { resolveTeam, isKnownTeam } from '../domain/slug.js';
import { FntvClient } from '../providers/futebolnatv.js';
import type { ScrapedGame } from '../providers/futebolnatv.js';
import { pairKey } from '../state/sequence.js';
import type { StateFile } from '../state/sequence.js';

/**
 * Enriquecimento de transmissão: casa os jogos raspados do futebolnatv com
 * as partidas da ESPN e preenche `match.broadcasters`. É camada opcional —
 * NUNCA lança; qualquer falha cai no último valor persistido no state.json.
 */

const BroadcastLeagueSchema = z.array(
  z.object({ slug: z.string().min(1), url: z.string().url() }),
);

export type BroadcastLeague = z.infer<typeof BroadcastLeagueSchema>[number];

export const BROADCAST_LEAGUES: BroadcastLeague[] = BroadcastLeagueSchema.parse(
  JSON.parse(readFileSync(new URL('../../data/broadcast-leagues.json', import.meta.url), 'utf8')),
);

export interface EnrichReport {
  scrapedGames: number;
  matched: number;
  fromStateOnly: number;
  failedLeagues: string[];
}

/** O que o orquestrador precisa de um scraper — permite fake nos testes. */
export interface LeagueScraper {
  leagueGames(url: string, today: DateTime, warn: (msg: string) => void): Promise<ScrapedGame[]>;
}

export interface EnrichOptions {
  now: DateTime;
  client?: LeagueScraper;
  leagues?: BroadcastLeague[];
  log?: (msg: string) => void;
}

/** Última transmissão persistida para o match, via a mesma resolução de UID do reconcile. */
function persistedFor(state: StateFile, match: Match): string[] | null {
  const key = pairKey(match);
  const uid = state.pairIndex[key] ?? state.pairIndex[`${key}:${match.date}`];
  if (uid === undefined) return null;
  return state.events[uid]?.broadcasters ?? null;
}

export async function enrichBroadcasts(
  matches: Match[],
  state: StateFile,
  opts: EnrichOptions,
): Promise<EnrichReport> {
  const log = opts.log ?? ((msg) => console.warn(`[fntv] ${msg}`));
  const leagues = opts.leagues ?? BROADCAST_LEAGUES;
  const client = opts.client ?? new FntvClient();

  // Índices por competição: primário respeita mando; o fallback com par
  // ordenado cobre o site invertendo mandante/visitante.
  const byExact = new Map<string, Match>();
  const byPair = new Map<string, Match>();
  const competitionsWithMatches = new Set<string>();
  for (const match of matches) {
    competitionsWithMatches.add(match.competition);
    byExact.set(`${match.competition}|${match.date}|${match.home.slug}|${match.away.slug}`, match);
    const pair = [match.home.slug, match.away.slug].sort().join('|');
    byPair.set(`${match.competition}|${match.date}|${pair}`, match);
  }

  const report: EnrichReport = { scrapedGames: 0, matched: 0, fromStateOnly: 0, failedLeagues: [] };
  const fresh = new Map<Match, string[]>();

  // Páginas independentes: busca em paralelo (pior caso = 1 timeout de 15s,
  // não 15s × nº de ligas). O casamento continua serial e determinístico na
  // ordem de data/broadcast-leagues.json.
  const pages = await Promise.all(
    leagues
      .filter((league) => competitionsWithMatches.has(league.slug))
      .map(async (league) => {
        try {
          const games = await client.leagueGames(league.url, opts.now, (msg) =>
            log(`${league.slug}: ${msg}`),
          );
          return { league, games };
        } catch (err) {
          return { league, games: null, error: err };
        }
      }),
  );

  for (const page of pages) {
    const league = page.league;
    if (page.games === null) {
      report.failedLeagues.push(league.slug);
      log(`${league.slug}: scrape falhou (${String(page.error)}) — usando transmissões persistidas`);
      continue;
    }
    const games = page.games;

    report.scrapedGames += games.length;
    for (const game of games) {
      const homeSlug = resolveTeam(game.homeRaw).slug;
      const awaySlug = resolveTeam(game.awayRaw).slug;

      let match = byExact.get(`${league.slug}|${game.date}|${homeSlug}|${awaySlug}`);
      if (!match) {
        const pair = [homeSlug, awaySlug].sort().join('|');
        match = byPair.get(`${league.slug}|${game.date}|${pair}`);
        if (match) log(`${league.slug}: mando invertido no site para ${homeSlug} x ${awaySlug}`);
      }
      if (!match) {
        log(`${league.slug}: ${game.date} ${game.homeRaw} x ${game.awayRaw} sem partida ESPN correspondente`);
        // Nome fora do teams.json só importa quando o casamento falhou:
        // é aí que um alias novo pode ser a causa.
        for (const raw of [game.homeRaw, game.awayRaw]) {
          if (!isKnownTeam(raw)) {
            log(`time desconhecido: "${raw}" — adicionar alias em data/teams.json?`);
          }
        }
        continue;
      }

      const kickoffLocal = match.kickoff?.toFormat('HH:mm');
      if (game.time !== null && kickoffLocal !== undefined && game.time !== kickoffLocal) {
        log(`${league.slug}: horário divergente em ${homeSlug} x ${awaySlug} (site ${game.time}, ESPN ${kickoffLocal}) — ESPN prevalece`);
      }

      // União com o que a ESPN trouxe; substitui (não soma) o persistido —
      // com dado fresco em mãos, canal removido pela fonte deve sumir.
      fresh.set(match, normalizeChannels([...match.broadcasters, ...game.channels]));
      report.matched += 1;
    }
  }

  for (const match of matches) {
    const channels = fresh.get(match);
    if (channels !== undefined) {
      match.broadcasters = channels;
      continue;
    }
    const persisted = persistedFor(state, match);
    if (persisted !== null && persisted.length > 0 && match.broadcasters.length === 0) {
      match.broadcasters = persisted;
      report.fromStateOnly += 1;
    } else {
      match.broadcasters = normalizeChannels(match.broadcasters);
    }
  }

  return report;
}
