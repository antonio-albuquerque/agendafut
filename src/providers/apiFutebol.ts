import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Competition, Match, MatchStatus } from '../domain/types.js';
import { TIMEZONE } from '../domain/types.js';
import { resolveTeam, isKnownTeam } from '../domain/slug.js';
import type { FixtureProvider } from './provider.js';

export interface CompetitionConfig {
  providerId: number;
  slug: string;
  name: string;
  season: number;
}

const COMPETITIONS = JSON.parse(
  readFileSync(new URL('../../data/competitions.json', import.meta.url), 'utf8'),
) as CompetitionConfig[];

// ── Schemas ──────────────────────────────────────────────────────────────
// API de terceiro muda schema sem aviso; falhar alto no parse é melhor que
// gerar .ics com undefined no meio. Campos que não usamos passam direto.

const TimeSchema = z
  .object({
    time_id: z.number().optional(),
    nome_popular: z.string(),
    sigla: z.string().nullish(),
  })
  .passthrough();

const PartidaSchema = z
  .object({
    partida_id: z.number(),
    time_mandante: TimeSchema,
    time_visitante: TimeSchema,
    status: z.string().nullish(),
    /** ex.: '2026-07-30T16:00:00-03:00' — nem sempre presente */
    data_realizacao_iso: z.string().nullish(),
    /** 'dd/MM/yyyy' */
    data_realizacao: z.string().nullish(),
    /** 'HH:mm' — null quando a CBF ainda não detalhou a rodada */
    hora_realizacao: z.string().nullish(),
    estadio: z.object({ nome_popular: z.string().nullish() }).nullish(),
    placar_mandante: z.number().nullish(),
    placar_visitante: z.number().nullish(),
    rodada: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();

type Partida = z.infer<typeof PartidaSchema>;

function looksLikePartida(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'time_mandante' in value &&
    'time_visitante' in value
  );
}

/**
 * A resposta de /campeonatos/{id}/partidas agrupa por fase e rodada com
 * chaves que variam por formato de campeonato (pontos corridos × mata-mata).
 * Em vez de fixar o shape do envelope, caminhamos a árvore coletando tudo
 * que parece uma partida — cada partida em si é validada com zod.
 */
export function collectPartidas(
  node: unknown,
  roundHint: string | null = null,
): Array<{ partida: Partida; round: string | null }> {
  if (looksLikePartida(node)) {
    return [{ partida: PartidaSchema.parse(node), round: roundHint }];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item) => collectPartidas(item, roundHint));
  }
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([key, value]) => {
      const roundMatch = /^rodada[-_]?(\d+)$/i.exec(key);
      const hint = roundMatch ? roundMatch[1]! : roundHint;
      return collectPartidas(value, hint);
    });
  }
  return [];
}

const STATUS_MAP: Record<string, MatchStatus> = {
  'agendado': 'scheduled',
  'agendada': 'scheduled',
  'sem-data': 'scheduled',
  'confirmado': 'confirmed',
  'ao-vivo': 'confirmed',
  'andamento': 'confirmed',
  'em-andamento': 'confirmed',
  'intervalo': 'confirmed',
  'finalizado': 'finished',
  'encerrado': 'finished',
  'adiado': 'postponed',
  'adiada': 'postponed',
  'cancelado': 'cancelled',
  'cancelada': 'cancelled',
};

function mapStatus(raw: string | null | undefined): MatchStatus {
  if (!raw) return 'scheduled';
  const key = raw.trim().toLowerCase().replace(/\s+/g, '-');
  return STATUS_MAP[key] ?? 'scheduled';
}

interface ParsedWhen {
  date: string;
  kickoff: DateTime | null;
}

/**
 * Regra crítica: `date` sempre presente, `kickoff` opcional. A CBF publica
 * horário só para blocos de 5–6 rodadas; fora disso existe data sem hora.
 * Não confiar em meia-noite do campo ISO como horário real: só considera
 * horário definido quando hora_realizacao veio preenchida.
 */
export function parseWhen(partida: Partida): ParsedWhen | null {
  let date: string | null = null;

  if (partida.data_realizacao) {
    const dt = DateTime.fromFormat(partida.data_realizacao, 'dd/MM/yyyy', { zone: TIMEZONE });
    if (dt.isValid) date = dt.toISODate();
  }
  if (date === null && partida.data_realizacao_iso) {
    const dt = DateTime.fromISO(partida.data_realizacao_iso, { zone: TIMEZONE });
    if (dt.isValid) date = dt.toISODate();
  }
  if (date === null) return null;

  let kickoff: DateTime | null = null;
  const hora = partida.hora_realizacao?.trim();
  if (hora && /^\d{1,2}:\d{2}/.test(hora)) {
    const dt = DateTime.fromFormat(`${date} ${hora.slice(0, 5)}`, 'yyyy-MM-dd HH:mm', {
      zone: TIMEZONE,
    });
    if (dt.isValid) kickoff = dt;
  }

  return { date, kickoff };
}

export function normalizePartida(
  partida: Partida,
  round: string | null,
  config: CompetitionConfig,
  warn: (msg: string) => void,
): Match | null {
  const when = parseWhen(partida);
  if (when === null) {
    warn(
      `partida ${partida.partida_id} (${partida.time_mandante.nome_popular} x ` +
        `${partida.time_visitante.nome_popular}) sem data — ignorada`,
    );
    return null;
  }

  for (const nome of [partida.time_mandante.nome_popular, partida.time_visitante.nome_popular]) {
    if (!isKnownTeam(nome)) {
      warn(`time fora do teams.json: "${nome}" — usando slug automático`);
    }
  }

  const status = mapStatus(partida.status);
  const hasScore =
    partida.placar_mandante !== null &&
    partida.placar_mandante !== undefined &&
    partida.placar_visitante !== null &&
    partida.placar_visitante !== undefined;

  return {
    id: String(partida.partida_id),
    competition: config.slug,
    competitionName: config.name,
    season: config.season,
    round: partida.rodada != null ? String(partida.rodada) : round,
    home: resolveTeam(partida.time_mandante.nome_popular),
    away: resolveTeam(partida.time_visitante.nome_popular),
    kickoff: when.kickoff,
    date: when.date,
    venue: partida.estadio?.nome_popular?.trim() || null,
    status,
    broadcasters: [],
    score:
      hasScore && status === 'finished'
        ? { home: partida.placar_mandante!, away: partida.placar_visitante! }
        : null,
  };
}

// ── Provider ─────────────────────────────────────────────────────────────

export interface ApiFutebolOptions {
  baseUrl?: string;
  cacheDir?: string;
  /** TTL do cache em ms. Protege a quota mensal apertada no dev loop. */
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

interface CacheEnvelope {
  fetchedAt: string;
  payload: unknown;
}

export class ApiFutebolProvider implements FixtureProvider {
  readonly name = 'api-futebol';

  private readonly baseUrl: string;
  private readonly cacheDir: string;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly token: string,
    opts: ApiFutebolOptions = {},
  ) {
    if (!token) throw new Error('API_FUTEBOL_TOKEN não definido');
    this.baseUrl = opts.baseUrl ?? 'https://api.api-futebol.com.br/v1';
    this.cacheDir = opts.cacheDir ?? '.cache/api-futebol';
    this.cacheTtlMs = opts.cacheTtlMs ?? 12 * 60 * 60 * 1000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? ((msg) => console.warn(`[api-futebol] ${msg}`));
  }

  competitions(): Promise<Competition[]> {
    return Promise.resolve(
      COMPETITIONS.map((c) => ({
        id: String(c.providerId),
        slug: c.slug,
        name: c.name,
        season: c.season,
      })),
    );
  }

  async matches(competitionId: string, _season: number): Promise<Match[]> {
    const config = COMPETITIONS.find((c) => String(c.providerId) === competitionId);
    if (!config) {
      throw new Error(`competição desconhecida em data/competitions.json: ${competitionId}`);
    }

    const payload = await this.fetchJson(`/campeonatos/${config.providerId}/partidas`);
    const partidas = collectPartidas(payload);
    if (partidas.length === 0) {
      throw new Error(
        `nenhuma partida encontrada para ${config.slug} — shape da resposta mudou?`,
      );
    }

    const matches: Match[] = [];
    for (const { partida, round } of partidas) {
      const match = normalizePartida(partida, round, config, this.log);
      if (match) matches.push(match);
    }
    return matches;
  }

  private cachePath(endpoint: string): string {
    return join(this.cacheDir, endpoint.replace(/^\//, '').replace(/\//g, '_') + '.json');
  }

  private async fetchJson(endpoint: string): Promise<unknown> {
    const cacheFile = this.cachePath(endpoint);
    if (existsSync(cacheFile)) {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as CacheEnvelope;
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < this.cacheTtlMs) {
        this.log(`cache hit: ${endpoint} (${Math.round(age / 60000)}min)`);
        return cached.payload;
      }
    }

    const res = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`API-Futebol ${endpoint}: HTTP ${res.status} ${res.statusText}`);
    }
    const payload: unknown = await res.json();

    mkdirSync(this.cacheDir, { recursive: true });
    const envelope: CacheEnvelope = { fetchedAt: new Date().toISOString(), payload };
    writeFileSync(cacheFile, JSON.stringify(envelope, null, 2), 'utf8');
    return payload;
  }
}
