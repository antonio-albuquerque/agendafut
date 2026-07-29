import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Match } from '../domain/types.js';
import { TIMEZONE } from '../domain/types.js';

/**
 * Último resultado bom de cada liga, persistido entre builds (o CI commita
 * junto com o state.json). Se a ESPN falhar ou devolver 0 eventos para uma
 * liga — como já sumiu com a Série C inteira por um dia — o build reusa o
 * snapshot em vez de abortar ou de deixar os eventos órfãos nos assinantes.
 */

const TeamSchema = z.object({ name: z.string(), slug: z.string() });

const StoredMatchSchema = z.object({
  id: z.string().nullable(),
  competition: z.string(),
  competitionName: z.string(),
  season: z.number(),
  round: z.string().nullable(),
  home: TeamSchema,
  away: TeamSchema,
  /** ISO com offset na zona America/Sao_Paulo; null = dia inteiro */
  kickoff: z.string().nullable(),
  date: z.string(),
  venue: z.string().nullable(),
  status: z.enum(['scheduled', 'confirmed', 'postponed', 'cancelled', 'finished']),
  broadcasters: z.array(z.string()),
  score: z.object({ home: z.number(), away: z.number() }).nullable(),
});

const SnapshotFileSchema = z.object({
  version: z.literal(1),
  leagues: z.record(
    z.string(),
    z.object({ fetchedAt: z.string(), matches: z.array(StoredMatchSchema) }),
  ),
});

export type StoredMatch = z.infer<typeof StoredMatchSchema>;
export type SnapshotFile = z.infer<typeof SnapshotFileSchema>;

export function emptySnapshots(): SnapshotFile {
  return { version: 1, leagues: {} };
}

export function serializeMatch(match: Match): StoredMatch {
  return {
    id: match.id,
    competition: match.competition,
    competitionName: match.competitionName,
    season: match.season,
    round: match.round,
    home: match.home,
    away: match.away,
    kickoff: match.kickoff !== null ? match.kickoff.setZone(TIMEZONE).toISO() : null,
    date: match.date,
    venue: match.venue,
    status: match.status,
    broadcasters: match.broadcasters,
    score: match.score,
  };
}

export function deserializeMatch(stored: StoredMatch): Match {
  return {
    ...stored,
    kickoff:
      stored.kickoff !== null ? DateTime.fromISO(stored.kickoff, { zone: TIMEZONE }) : null,
  };
}

export interface ApplyResult {
  matches: Match[];
  usedSnapshot: boolean;
}

/**
 * Decide o que entra no feed para uma liga, best-effort:
 * - fetch ok com partidas → usa e atualiza o snapshot (fetchedAt só muda
 *   quando os dados mudam, para o arquivo ficar byte-estável entre builds);
 * - fetch falhou (`fresh === null`) ou 0 eventos → reusa o snapshot;
 * - sem snapshot: liga required aborta (nunca publicar feed vazio),
 *   opcional segue sem partidas.
 * Muta `snapshots` in place — o chamador persiste depois.
 */
export function applyLeagueResult(
  snapshots: SnapshotFile,
  league: { slug: string; required: boolean },
  fresh: Match[] | null,
  nowIso: string,
  log: (msg: string) => void,
): ApplyResult {
  if (fresh !== null && fresh.length > 0) {
    const serialized = fresh.map(serializeMatch);
    const prev = snapshots.leagues[league.slug];
    if (prev === undefined || JSON.stringify(prev.matches) !== JSON.stringify(serialized)) {
      snapshots.leagues[league.slug] = { fetchedAt: nowIso, matches: serialized };
    }
    return { matches: fresh, usedSnapshot: false };
  }

  const reason = fresh === null ? 'fonte falhou' : '0 eventos';
  const snap = snapshots.leagues[league.slug];
  if (snap !== undefined && snap.matches.length > 0) {
    log(
      `${league.slug}: ${reason} — mantendo ${snap.matches.length} partidas do snapshot de ${snap.fetchedAt}`,
    );
    return { matches: snap.matches.map(deserializeMatch), usedSnapshot: true };
  }

  if (league.required) {
    throw new Error(
      `${league.slug}: ${reason} e nenhum snapshot anterior — abortando sem publicar`,
    );
  }
  if (fresh === null) {
    log(`${league.slug}: ${reason} (liga opcional, sem snapshot) — seguindo sem partidas`);
  }
  return { matches: [], usedSnapshot: false };
}

export function loadSnapshots(path: string, log: (msg: string) => void): SnapshotFile {
  if (!existsSync(path)) return emptySnapshots();
  const result = SnapshotFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.success) {
    // Snapshot corrompido não pode derrubar o build: sem ele voltamos ao
    // comportamento antigo (required sem dados aborta), que já é seguro.
    log(`snapshots inválidos em ${path} — ignorando (${result.error.issues[0]?.message})`);
    return emptySnapshots();
  }
  return result.data;
}

/** Chaves ordenadas para o diff do commit do CI ficar legível. */
export function saveSnapshots(path: string, snapshots: SnapshotFile): void {
  const normalized: SnapshotFile = {
    version: 1,
    leagues: Object.fromEntries(
      Object.entries(snapshots.leagues).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
}
