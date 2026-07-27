import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DateTime } from 'luxon';
import type { Match } from '../domain/types.js';
import { TIMEZONE } from '../domain/types.js';
import { buildUid } from '../ics/uid.js';
import type { CalendarEntry } from '../ics/builder.js';
import { summaryFor, descriptionFor } from '../ics/builder.js';

export interface EventState {
  sequence: number;
  /** hash do que exige bump de SEQUENCE: DTSTART, LOCATION, STATUS */
  seqHash: string;
  /** hash de tudo que é visível ao usuário (inclui placar, transmissão…) */
  contentHash: string;
  /** ISO UTC — preservado quando nada muda, para o .ics ficar byte-idêntico */
  lastModified: string;
  /**
   * Última transmissão conhecida. O scraper só enxerga ~10 dias à frente e
   * pode falhar; sem isso o "Transmissão:" sumiria da descrição a cada
   * soluço da fonte (flapping).
   */
  broadcasters?: string[];
}

export interface StateFile {
  version: 1;
  /**
   * `{competition}:{season}:{homeSlug}:{awaySlug}` → UID.
   * É o que preserva o UID original quando a partida muda de data:
   * o UID carrega a data ORIGINAL, e reencontramos o evento pelo par.
   */
  pairIndex: Record<string, string>;
  events: Record<string, EventState>;
}

export function emptyState(): StateFile {
  return { version: 1, pairIndex: {}, events: {} };
}

export function pairKey(match: Match): string {
  return `${match.competition}:${match.season}:${match.home.slug}:${match.away.slug}`;
}

function sha256(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** O que define DTSTART no .ics: horário com zona, ou dia inteiro. */
function dtstartRepr(match: Match): string {
  return match.kickoff !== null
    ? `timed:${match.kickoff.setZone(TIMEZONE).toISO()}`
    : `allday:${match.date}`;
}

/** Mudou → SEQUENCE + 1. Sem isso o Google Calendar ignora a atualização. */
function seqHashOf(match: Match): string {
  return sha256([dtstartRepr(match), match.venue, match.status]);
}

/** Mudou (mesmo sem seqHash mudar) → atualiza LAST-MODIFIED. */
function contentHashOf(match: Match): string {
  return sha256([
    dtstartRepr(match),
    match.venue,
    match.status,
    summaryFor(match),
    descriptionFor(match),
  ]);
}

export interface ReconcileResult {
  entries: CalendarEntry[];
  /** UIDs que mudaram neste build (novo, sequence bump ou conteúdo) */
  changed: string[];
}

/**
 * Para cada match: resolve o UID estável via pairIndex, compara hashes com o
 * estado anterior e decide sequence/lastModified. Muta `state` in place —
 * o chamador persiste depois.
 */
export function reconcile(
  state: StateFile,
  matches: Match[],
  now: DateTime,
): ReconcileResult {
  const nowIso = now.toUTC().toISO({ suppressMilliseconds: true });
  if (nowIso === null) throw new Error('timestamp "now" inválido');

  const entries: CalendarEntry[] = [];
  const changed: string[] = [];
  const usedThisRun = new Set<string>();

  for (const match of matches) {
    const key = pairKey(match);
    let uid = state.pairIndex[key];

    if (uid !== undefined && usedThisRun.has(uid)) {
      // Mesmo par de novo na mesma temporada (ex.: jogo desempate).
      // Raro: indexa separadamente pela data para não colidir.
      uid = state.pairIndex[`${key}:${match.date}`];
    }

    if (uid === undefined) {
      uid = buildUid(match.competition, match.date, match.home.slug, match.away.slug);
      if (usedThisRun.has(uid)) {
        throw new Error(`UID duplicado no mesmo build: ${uid}`);
      }
      const indexKey = state.pairIndex[key] === undefined ? key : `${key}:${match.date}`;
      state.pairIndex[indexKey] = uid;
    }
    usedThisRun.add(uid);

    const seqHash = seqHashOf(match);
    const contentHash = contentHashOf(match);
    const prev = state.events[uid];

    // Persistida mesmo sem mudança de hash: o enriquecimento lê daqui no
    // próximo build quando o scraper falhar ou o jogo sair do horizonte.
    const broadcasters =
      match.broadcasters.length > 0 ? { broadcasters: match.broadcasters } : {};

    let next: EventState;
    if (prev === undefined) {
      next = { sequence: 0, seqHash, contentHash, lastModified: nowIso, ...broadcasters };
      changed.push(uid);
    } else if (prev.seqHash !== seqHash) {
      next = { sequence: prev.sequence + 1, seqHash, contentHash, lastModified: nowIso, ...broadcasters };
      changed.push(uid);
    } else if (prev.contentHash !== contentHash) {
      // Reconstrói em vez de `...prev`: se a transmissão foi retirada
      // (match.broadcasters vazio), o campo antigo precisa SUMIR do estado,
      // senão o fallback do enriquecimento o ressuscita no próximo build.
      next = { sequence: prev.sequence, seqHash, contentHash, lastModified: nowIso, ...broadcasters };
      changed.push(uid);
    } else {
      // Nada mudou: preserva sequence E lastModified. Reescrever
      // LAST-MODIFIED sem mudança real polui o diff e engana clientes.
      next = prev;
    }

    state.events[uid] = next;
    entries.push({
      match,
      meta: { uid, sequence: next.sequence, lastModified: next.lastModified },
    });
  }

  return { entries, changed };
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function loadState(path: string): StateFile {
  if (!existsSync(path)) return emptyState();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StateFile;
  if (parsed.version !== 1) {
    throw new Error(`state.json versão desconhecida: ${String(parsed.version)}`);
  }
  return parsed;
}

/** Chaves ordenadas para o diff do commit do CI ficar legível. */
export function saveState(path: string, state: StateFile): void {
  const normalized: StateFile = {
    version: 1,
    pairIndex: sortRecord(state.pairIndex),
    events: sortRecord(state.events),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
}
