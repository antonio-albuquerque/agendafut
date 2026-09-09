import { mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import type { Match, Team } from './domain/types.js';
import { buildCalendar } from './ics/builder.js';
import type { CalendarEntry } from './ics/builder.js';
import { EspnProvider, FEATURED_SLUGS, LEAGUES } from './providers/espn.js';
import { FntvClient } from './providers/futebolnatv.js';
import { enrichBroadcasts } from './enrich/broadcasts.js';
import { loadState, saveState, reconcile } from './state/sequence.js';
import {
  applyLeagueResult,
  emptySnapshots,
  loadSnapshots,
  saveSnapshots,
  STALE_SNAPSHOT_DAYS,
} from './state/snapshots.js';
import { TIMEZONE } from './domain/types.js';
import { renderShell } from './site/index.js';
import type { FeedRef, FeedsIndex } from './site/index.js';
import { buildFeedJson } from './site/feedJson.js';

const STATE_PATH = 'data/state.json';
const SNAPSHOTS_PATH = 'data/snapshots.json';
const DIST = 'dist';

/**
 * Smoke test offline: ESPN_FIXTURE=<caminho.json> serve o mesmo arquivo
 * para toda chamada da API, sem rede.
 */
function fixtureFetch(path: string): typeof fetch {
  const body = readFileSync(path, 'utf8');
  return () => Promise.resolve(new Response(body, { status: 200 }));
}

/**
 * Liga servida por um snapshot velho demais: o build passa (invariante 4 —
 * nunca publicar feed vazio), mas o feed está mentindo devagar. Sem sinal
 * explícito isso apodrece calado, que foi o que aconteceu com a Série C.
 */
interface DegradedLeague {
  slug: string;
  ageDays: number;
}

/**
 * Avisa o CI que o build passou porém degradado. O job de alerta lê a saída
 * e abre/atualiza a issue; fora do Actions as variáveis não existem e isto
 * vira só um log.
 */
function reportDegraded(leagues: DegradedLeague[]): void {
  if (leagues.length === 0) return;
  const resumo = leagues.map((l) => `${l.slug} (${l.ageDays}d)`).join(', ');
  console.warn(`[build] DEGRADADO: sem dados novos da fonte há mais de ${STALE_SNAPSHOT_DAYS} dias: ${resumo}`);
  // Anotação aparece no resumo do run mesmo com o build verde.
  console.log(`::warning title=Snapshot velho::${resumo}`);
  const output = process.env.GITHUB_OUTPUT;
  if (output !== undefined) appendFileSync(output, `degraded=${resumo}\n`, 'utf8');
}

async function fetchAllMatches(): Promise<Match[]> {
  const fixturePath = process.env.ESPN_FIXTURE;
  const provider = new EspnProvider(
    fixturePath ? { fetchImpl: fixtureFetch(fixturePath), cacheTtlMs: 0 } : {},
  );
  const competitions = await provider.competitions();

  // Best-effort por liga: fetch falho ou 0 eventos reusa o último snapshot
  // bom em vez de derrubar o build (a ESPN já sumiu com uma liga inteira
  // por um dia). No smoke offline os snapshots não são lidos nem escritos.
  const warn = (msg: string) => console.warn(`[build] ${msg}`);
  const snapshots = fixturePath ? emptySnapshots() : loadSnapshots(SNAPSHOTS_PATH, warn);
  const nowIso = DateTime.now().toUTC().toISO({ suppressMilliseconds: true })!;

  const all: Match[] = [];
  const fromSnapshot: string[] = [];
  const degraded: DegradedLeague[] = [];
  for (const competition of competitions) {
    const league = LEAGUES.find((l) => l.code === competition.id)!;
    let fresh: Match[] | null = null;
    try {
      fresh = await provider.matches(competition.id, competition.season);
    } catch (err) {
      warn(`${competition.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { matches, usedSnapshot, snapshotAgeDays } = applyLeagueResult(
      snapshots,
      league,
      fresh,
      nowIso,
      warn,
    );
    if (usedSnapshot) fromSnapshot.push(competition.slug);
    if (snapshotAgeDays !== null && snapshotAgeDays >= STALE_SNAPSHOT_DAYS) {
      degraded.push({ slug: competition.slug, ageDays: snapshotAgeDays });
    }
    console.log(
      `[build] ${competition.slug}: ${matches.length} partidas${usedSnapshot ? ' (snapshot)' : ''}`,
    );
    all.push(...matches);
  }

  if (!fixturePath) saveSnapshots(SNAPSHOTS_PATH, snapshots);
  if (fromSnapshot.length > 0) {
    console.warn(`[build] ligas sem dados novos (usando snapshot): ${fromSnapshot.join(', ')}`);
  }
  reportDegraded(degraded);
  return all;
}

function groupByTeam(entries: CalendarEntry[]): Map<string, { team: Team; entries: CalendarEntry[] }> {
  const groups = new Map<string, { team: Team; entries: CalendarEntry[] }>();
  for (const entry of entries) {
    for (const team of [entry.match.home, entry.match.away]) {
      let group = groups.get(team.slug);
      if (!group) {
        group = { team, entries: [] };
        groups.set(team.slug, group);
      }
      group.entries.push(entry);
    }
  }
  return groups;
}

function groupByCompetition(
  entries: CalendarEntry[],
): Map<string, { name: string; entries: CalendarEntry[] }> {
  const groups = new Map<string, { name: string; entries: CalendarEntry[] }>();
  for (const entry of entries) {
    let group = groups.get(entry.match.competition);
    if (!group) {
      group = { name: entry.match.competitionName, entries: [] };
      groups.set(entry.match.competition, group);
    }
    group.entries.push(entry);
  }
  return groups;
}

async function main(): Promise<void> {
  // Liga sem dados novos cai no snapshot anterior; se uma liga required
  // ficar sem dados E sem snapshot, o throw derruba o processo ANTES de
  // tocar em dist/: publicar um feed vazio apagaria a agenda de quem assinou.
  const matches = await fetchAllMatches();
  if (matches.length === 0) {
    throw new Error('0 partidas no total — abortando sem publicar');
  }

  const state = loadState(STATE_PATH);

  // Transmissões: enriquecimento fail-soft (falha nunca derruba o build).
  // FNTV_FIXTURE=<caminho.html> → offline; só ESPN_FIXTURE → pula o scrape
  // (o smoke offline não pode tocar a rede); persistido cobre os dois casos.
  const fntvFixture = process.env.FNTV_FIXTURE;
  const skipScrape = fntvFixture === undefined && process.env.ESPN_FIXTURE !== undefined;
  const report = await enrichBroadcasts(matches, state, {
    now: DateTime.now().setZone(TIMEZONE),
    client: fntvFixture !== undefined ? new FntvClient({ fetchImpl: fixtureFetch(fntvFixture) }) : undefined,
    leagues: skipScrape ? [] : undefined,
  });
  console.log(
    `[build] transmissões: ${report.matched} casadas de ${report.scrapedGames} raspadas, ` +
      `${report.fromStateOnly} só do estado` +
      (report.failedLeagues.length > 0 ? `, falhas: ${report.failedLeagues.join(', ')}` : ''),
  );

  const { entries, changed } = reconcile(state, matches, DateTime.now());
  console.log(`[build] ${entries.length} eventos, ${changed.length} alterados`);

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, 'calendars', 'team'), { recursive: true });
  mkdirSync(join(DIST, 'calendars', 'competition'), { recursive: true });

  // Feeds de time só para os 25 selecionados; adversários aparecem nos
  // eventos, mas não ganham feed próprio.
  const teamGroups = [...groupByTeam(entries)].filter(([slug]) => FEATURED_SLUGS.has(slug));
  const teamFeeds: FeedRef[] = [];
  for (const [slug, group] of teamGroups.sort(([a], [b]) => a.localeCompare(b))) {
    const path = `calendars/team/${slug}.ics`;
    const jsonPath = `calendars/team/${slug}.json`;
    const ics = buildCalendar({ name: `${group.team.name} — jogos` }, group.entries);
    writeFileSync(join(DIST, path), ics, 'utf8');
    const json = buildFeedJson('team', slug, group.team.name, group.entries);
    writeFileSync(join(DIST, jsonPath), JSON.stringify(json) + '\n', 'utf8');
    teamFeeds.push({ slug, name: group.team.name, path, jsonPath, matchCount: group.entries.length });
  }

  const competitionFeeds: FeedRef[] = [];
  for (const [slug, group] of [...groupByCompetition(entries)].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const path = `calendars/competition/${slug}.ics`;
    const jsonPath = `calendars/competition/${slug}.json`;
    const ics = buildCalendar({ name: group.name }, group.entries);
    writeFileSync(join(DIST, path), ics, 'utf8');
    const json = buildFeedJson('competition', slug, group.name, group.entries);
    writeFileSync(join(DIST, jsonPath), JSON.stringify(json) + '\n', 'utf8');
    competitionFeeds.push({ slug, name: group.name, path, jsonPath, matchCount: group.entries.length });
  }

  const feedsIndex: FeedsIndex = {
    generatedAt: DateTime.now().toUTC().toISO({ suppressMilliseconds: true })!,
    teams: teamFeeds,
    competitions: competitionFeeds,
  };
  writeFileSync(join(DIST, 'feeds.json'), JSON.stringify(feedsIndex, null, 2) + '\n', 'utf8');
  writeFileSync(join(DIST, 'index.html'), renderShell(), 'utf8');
  cpSync(fileURLToPath(new URL('./site/static/', import.meta.url)), join(DIST, 'assets'), {
    recursive: true,
  });
  writeFileSync(join(DIST, '.nojekyll'), '', 'utf8');

  saveState(STATE_PATH, state);
  console.log(
    `[build] ok: ${teamFeeds.length} feeds de time, ${competitionFeeds.length} de competição`,
  );
}

main().catch((err: unknown) => {
  console.error('[build] FALHOU:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
