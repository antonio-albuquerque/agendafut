import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Competition, Match, MatchStatus } from '../domain/types.js';
import { TIMEZONE } from '../domain/types.js';
import { resolveTeam } from '../domain/slug.js';
import { normalizeChannels } from '../domain/channels.js';
import type { FixtureProvider } from './provider.js';

export interface LeagueConfig {
  /** código ESPN, ex.: 'bra.1' */
  code: string;
  slug: string;
  name: string;
  /**
   * required=true → sem dados novos NEM snapshot anterior, o build aborta
   * (proteção contra feed vazio). Estaduais e mata-matas continentais
   * podem legitimamente estar vazios.
   */
  required: boolean;
}

export const LEAGUES = JSON.parse(
  readFileSync(new URL('../../data/leagues.json', import.meta.url), 'utf8'),
) as LeagueConfig[];

interface FeaturedTeam {
  slug: string;
  espnId: string;
}

export const FEATURED_TEAMS = JSON.parse(
  readFileSync(new URL('../../data/featured-teams.json', import.meta.url), 'utf8'),
) as FeaturedTeam[];

/** espnId → slug canônico. Matching por id é imune a variação de nome. */
const featuredById = new Map(FEATURED_TEAMS.map((t) => [t.espnId, t.slug]));

export const FEATURED_SLUGS = new Set(FEATURED_TEAMS.map((t) => t.slug));

// ── Schemas ──────────────────────────────────────────────────────────────
// API não documentada; falhar alto no parse é melhor que .ics com undefined.

const CompetitorSchema = z
  .object({
    homeAway: z.enum(['home', 'away']),
    team: z.object({ id: z.string(), displayName: z.string() }).passthrough(),
    // scoreboard entrega string ('2'); o endpoint de schedule, objeto
    score: z
      .union([z.string(), z.object({ value: z.number().nullish() }).passthrough()])
      .nullish(),
  })
  .passthrough();

const CompetitionBlockSchema = z
  .object({
    timeValid: z.boolean().optional(),
    venue: z.object({ fullName: z.string().nullish() }).nullish(),
    status: z.object({ type: z.object({ name: z.string() }).passthrough() }).passthrough(),
    competitors: z.array(CompetitorSchema).min(2),
    // Vazio p/ ligas brasileiras hoje, mas extraímos caso passem a preencher.
    // Só geoBroadcasts: cada entrada declara region/lang. O array irmão
    // `broadcasts` é o mercado dos EUA sem marcação de região — canal
    // americano no feed de assinante brasileiro é pior que canal nenhum.
    geoBroadcasts: z
      .array(
        z
          .object({
            media: z.object({ shortName: z.string().nullish() }).passthrough().nullish(),
            region: z.string().nullish(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const EventSchema = z
  .object({
    id: z.string(),
    date: z.string(),
    competitions: z.array(CompetitionBlockSchema).min(1),
    season: z.object({ year: z.number() }).passthrough().optional(),
  })
  .passthrough();

const ScoreboardSchema = z
  .object({
    leagues: z
      .array(z.object({ season: z.object({ year: z.number() }).passthrough() }).passthrough())
      .min(1),
    events: z.array(z.unknown()),
  })
  .passthrough();

type EspnEvent = z.infer<typeof EventSchema>;

const STATUS_MAP: Record<string, MatchStatus> = {
  STATUS_SCHEDULED: 'scheduled',
  STATUS_DELAYED: 'confirmed',
  STATUS_FIRST_HALF: 'confirmed',
  STATUS_HALFTIME: 'confirmed',
  STATUS_SECOND_HALF: 'confirmed',
  STATUS_IN_PROGRESS: 'confirmed',
  STATUS_FULL_TIME: 'finished',
  STATUS_FINAL: 'finished',
  STATUS_FINAL_PEN: 'finished',
  STATUS_FINAL_AET: 'finished',
  STATUS_POSTPONED: 'postponed',
  // jogo suspenso no meio: tratamos como adiado (vai ser remarcado/retomado)
  STATUS_ABANDONED: 'postponed',
  STATUS_SUSPENDED: 'postponed',
  STATUS_CANCELED: 'cancelled',
  STATUS_CANCELLED: 'cancelled',
};

function scoreValue(raw: z.infer<typeof CompetitorSchema>['score']): number | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'string' ? Number(raw) : raw.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function broadcastNames(block: z.infer<typeof CompetitionBlockSchema>): string[] {
  return normalizeChannels(
    (block.geoBroadcasts ?? [])
      .filter((g) => g.region?.toLowerCase() === 'br')
      .flatMap((g) => g.media?.shortName ?? []),
  );
}

function toTeam(competitor: z.infer<typeof CompetitorSchema>) {
  const featuredSlug = featuredById.get(competitor.team.id);
  // resolveTeam aceita o próprio slug como alias → devolve o nome canônico
  return resolveTeam(featuredSlug ?? competitor.team.displayName);
}

export function normalizeEvent(
  raw: unknown,
  league: LeagueConfig,
  season: number,
  warn: (msg: string) => void,
): Match | null {
  const event: EspnEvent = EventSchema.parse(raw);
  const block = event.competitions[0]!;

  const home = block.competitors.find((c) => c.homeAway === 'home');
  const away = block.competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) {
    warn(`evento ${event.id} sem mandante/visitante — ignorado`);
    return null;
  }

  const utc = DateTime.fromISO(event.date, { zone: 'utc' });
  if (!utc.isValid) {
    warn(`evento ${event.id} com data inválida "${event.date}" — ignorado`);
    return null;
  }
  const local = utc.setZone(TIMEZONE);

  const statusName = block.status.type.name;
  const status = STATUS_MAP[statusName];
  if (status === undefined) {
    warn(`status desconhecido "${statusName}" no evento ${event.id} — tratando como scheduled`);
  }

  // timeValid=false → horário placeholder (18:00Z/20:00Z), não real.
  // Vira evento de dia inteiro; a data local continua correta porque os
  // placeholders nunca cruzam a meia-noite de Brasília.
  const timeValid = block.timeValid !== false;

  const homeScore = scoreValue(home.score);
  const awayScore = scoreValue(away.score);
  const finished = (status ?? 'scheduled') === 'finished';

  return {
    id: event.id,
    competition: league.slug,
    competitionName: league.name,
    season: event.season?.year ?? season,
    round: null, // o scoreboard da ESPN não expõe a rodada
    home: toTeam(home),
    away: toTeam(away),
    kickoff: timeValid ? local : null,
    date: local.toISODate()!,
    venue: block.venue?.fullName?.trim() || null,
    status: status ?? 'scheduled',
    broadcasters: broadcastNames(block),
    score: finished && homeScore !== null && awayScore !== null
      ? { home: homeScore, away: awayScore }
      : null,
  };
}

// ── Provider ─────────────────────────────────────────────────────────────

export interface EspnOptions {
  baseUrl?: string;
  cacheDir?: string;
  /** TTL do cache em ms — só para o dev loop; o CI busca fresco 1x/dia. */
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

interface CacheEnvelope {
  fetchedAt: string;
  payload: unknown;
}

export class EspnProvider implements FixtureProvider {
  readonly name = 'espn';

  private readonly baseUrl: string;
  private readonly cacheDir: string;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (msg: string) => void;

  constructor(opts: EspnOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://site.api.espn.com/apis/site/v2/sports/soccer';
    this.cacheDir = opts.cacheDir ?? '.cache/espn';
    this.cacheTtlMs = opts.cacheTtlMs ?? 6 * 60 * 60 * 1000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? ((msg) => console.warn(`[espn] ${msg}`));
  }

  competitions(): Promise<Competition[]> {
    const season = DateTime.now().setZone(TIMEZONE).year;
    return Promise.resolve(
      LEAGUES.map((l) => ({ id: l.code, slug: l.slug, name: l.name, season })),
    );
  }

  async matches(competitionId: string, season: number): Promise<Match[]> {
    const league = LEAGUES.find((l) => l.code === competitionId);
    if (!league) {
      throw new Error(`liga desconhecida em data/leagues.json: ${competitionId}`);
    }

    const payload = await this.fetchJson(
      `/${league.code}/scoreboard?dates=${season}0101-${season}1231&limit=1000`,
    );
    const scoreboard = ScoreboardSchema.parse(payload);

    if (scoreboard.events.length === 0) {
      // Quem decide o que fazer (snapshot anterior / abortar) é o chamador.
      this.log(`0 eventos em ${league.slug}`);
      return [];
    }
    if (scoreboard.events.length >= 1000) {
      // limit=1000 estourado significaria temporada truncada silenciosamente
      throw new Error(`${league.slug}: resposta atingiu o limite de 1000 eventos — paginação necessária`);
    }

    const seasonYear = scoreboard.leagues[0]!.season.year;
    const matches: Match[] = [];
    for (const raw of scoreboard.events) {
      const match = normalizeEvent(raw, league, seasonYear, this.log);
      if (match) matches.push(match);
    }
    return matches;
  }

  private async fetchJson(endpoint: string): Promise<unknown> {
    const cacheFile = join(
      this.cacheDir,
      endpoint.replace(/^\//, '').replace(/[/?&=]/g, '_') + '.json',
    );
    if (existsSync(cacheFile)) {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as CacheEnvelope;
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < this.cacheTtlMs) {
        this.log(`cache hit: ${endpoint} (${Math.round(age / 60000)}min)`);
        return cached.payload;
      }
    }

    const res = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
      headers: {
        'User-Agent': 'agendafut/0.1 (+https://github.com/antonio-albuquerque/agendafut)',
      },
    });
    if (!res.ok) {
      throw new Error(`ESPN ${endpoint}: HTTP ${res.status} ${res.statusText}`);
    }
    const payload: unknown = await res.json();

    mkdirSync(this.cacheDir, { recursive: true });
    const envelope: CacheEnvelope = { fetchedAt: new Date().toISOString(), payload };
    writeFileSync(cacheFile, JSON.stringify(envelope, null, 2), 'utf8');
    return payload;
  }
}
