import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import type { Match, Team } from './domain/types.js';
import { buildCalendar } from './ics/builder.js';
import type { CalendarEntry } from './ics/builder.js';
import { EspnProvider, FEATURED_SLUGS } from './providers/espn.js';
import { loadState, saveState, reconcile } from './state/sequence.js';
import { renderIndexHtml } from './site/index.js';
import type { FeedRef, FeedsIndex } from './site/index.js';

const STATE_PATH = 'data/state.json';
const DIST = 'dist';

/**
 * Smoke test offline: ESPN_FIXTURE=<caminho.json> serve o mesmo arquivo
 * para toda chamada da API, sem rede.
 */
function fixtureFetch(path: string): typeof fetch {
  const body = readFileSync(path, 'utf8');
  return () => Promise.resolve(new Response(body, { status: 200 }));
}

async function fetchAllMatches(): Promise<Match[]> {
  const fixturePath = process.env.ESPN_FIXTURE;
  const provider = new EspnProvider(
    fixturePath ? { fetchImpl: fixtureFetch(fixturePath), cacheTtlMs: 0 } : {},
  );
  const competitions = await provider.competitions();

  const all: Match[] = [];
  for (const competition of competitions) {
    const matches = await provider.matches(competition.id, competition.season);
    console.log(`[build] ${competition.slug}: ${matches.length} partidas`);
    all.push(...matches);
  }
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
  // Se o provider falhar, o throw derruba o processo ANTES de tocar em dist/:
  // publicar um feed vazio apagaria a agenda de quem assinou.
  const matches = await fetchAllMatches();
  if (matches.length === 0) {
    throw new Error('0 partidas no total — abortando sem publicar');
  }

  const state = loadState(STATE_PATH);
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
    const ics = buildCalendar({ name: `${group.team.name} — jogos` }, group.entries);
    writeFileSync(join(DIST, path), ics, 'utf8');
    teamFeeds.push({ slug, name: group.team.name, path, matchCount: group.entries.length });
  }

  const competitionFeeds: FeedRef[] = [];
  for (const [slug, group] of [...groupByCompetition(entries)].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const path = `calendars/competition/${slug}.ics`;
    const ics = buildCalendar({ name: group.name }, group.entries);
    writeFileSync(join(DIST, path), ics, 'utf8');
    competitionFeeds.push({ slug, name: group.name, path, matchCount: group.entries.length });
  }

  const feedsIndex: FeedsIndex = {
    generatedAt: DateTime.now().toUTC().toISO({ suppressMilliseconds: true })!,
    teams: teamFeeds,
    competitions: competitionFeeds,
  };
  writeFileSync(join(DIST, 'feeds.json'), JSON.stringify(feedsIndex, null, 2) + '\n', 'utf8');
  writeFileSync(join(DIST, 'index.html'), renderIndexHtml(feedsIndex), 'utf8');
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
