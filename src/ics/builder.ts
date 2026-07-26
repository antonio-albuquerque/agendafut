import { DateTime } from 'luxon';
import type { Match, MatchStatus } from '../domain/types.js';
import { TIMEZONE } from '../domain/types.js';
import { VTIMEZONE_LINES } from './vtimezone.js';

/** Duração assumida de uma partida com horário definido. */
const MATCH_DURATION_HOURS = 2;

export interface EventMeta {
  uid: string;
  /** Incrementa a cada mudança de DTSTART/LOCATION/STATUS — ver state/sequence.ts */
  sequence: number;
  /** ISO UTC. Também usado como DTSTAMP para o output ser determinístico. */
  lastModified: string;
}

export interface CalendarEntry {
  match: Match;
  meta: EventMeta;
}

export interface CalendarOptions {
  /** X-WR-CALNAME, ex.: "Palmeiras — todos os jogos" */
  name: string;
}

const CRLF = '\r\n';

/**
 * Escape de valor de texto conforme RFC 5545 §3.3.11.
 * Ordem importa: backslash primeiro.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Line folding em 75 OCTETOS (não caracteres) conforme RFC 5545 §3.1.
 * Continuações começam com um espaço e cabem em 74 octetos úteis.
 * O corte nunca parte um caractere multi-byte no meio.
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;

  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75; // primeira linha: 75; continuações: 74 (o espaço ocupa 1)

  for (const char of line) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (currentBytes + charBytes > limit) {
      out.push(current);
      current = ' ';
      currentBytes = 1;
      limit = 75;
    }
    current += char;
    currentBytes += charBytes;
  }
  out.push(current);
  return out.join(CRLF);
}

function icsStatus(status: MatchStatus): 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' {
  switch (status) {
    case 'cancelled':
      return 'CANCELLED';
    case 'postponed':
      // Adiado sem nova data: mantém a data original como TENTATIVE e
      // explica na DESCRIPTION. Sumir do feed deixa evento órfão.
      return 'TENTATIVE';
    default:
      return 'CONFIRMED';
  }
}

function formatLocal(dt: DateTime): string {
  return dt.setZone(TIMEZONE).toFormat("yyyyMMdd'T'HHmmss");
}

function formatUtc(iso: string): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) throw new Error(`Data inválida: ${iso}`);
  return dt.toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function formatDateValue(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date inválida: ${date}`);
  return date.replaceAll('-', '');
}

function nextDay(date: string): string {
  const dt = DateTime.fromISO(date, { zone: TIMEZONE });
  if (!dt.isValid) throw new Error(`date inválida: ${date}`);
  return dt.plus({ days: 1 }).toISODate()!;
}

export function summaryFor(match: Match): string {
  if (match.status === 'finished' && match.score) {
    return `${match.home.name} ${match.score.home} x ${match.score.away} ${match.away.name}`;
  }
  return `${match.home.name} x ${match.away.name}`;
}

function roundLabel(round: string | null): string | null {
  if (round === null || round === '') return null;
  if (/^\d+$/.test(round)) return `Rodada ${round}`;
  return round.charAt(0).toUpperCase() + round.slice(1);
}

export function descriptionFor(match: Match): string {
  const header = [match.competitionName, roundLabel(match.round)]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const lines = [header];
  if (match.status === 'postponed') {
    lines.push('Partida adiada — nova data a confirmar.');
  } else if (match.status === 'cancelled') {
    lines.push('Partida cancelada.');
  } else if (match.kickoff === null) {
    lines.push('Horário a definir.');
  }
  if (match.broadcasters.length > 0) {
    lines.push(`Transmissão: ${match.broadcasters.join(', ')}`);
  }
  return lines.join('\n');
}

function eventLines(entry: CalendarEntry): string[] {
  const { match, meta } = entry;
  const lines: string[] = ['BEGIN:VEVENT'];

  lines.push(`UID:${meta.uid}`);
  // DTSTAMP determinístico (= LAST-MODIFIED) para builds sem mudança real
  // produzirem .ics byte-idêntico.
  lines.push(`DTSTAMP:${formatUtc(meta.lastModified)}`);

  if (match.kickoff !== null) {
    const start = match.kickoff.setZone(TIMEZONE);
    if (!start.isValid) throw new Error(`kickoff inválido em ${meta.uid}`);
    const end = start.plus({ hours: MATCH_DURATION_HOURS });
    lines.push(`DTSTART;TZID=${TIMEZONE}:${formatLocal(start)}`);
    lines.push(`DTEND;TZID=${TIMEZONE}:${formatLocal(end)}`);
  } else {
    // Data definida, horário TBD → evento de dia inteiro. Quando o horário
    // sair, o mesmo UID migra para evento com horário e SEQUENCE incrementa.
    lines.push(`DTSTART;VALUE=DATE:${formatDateValue(match.date)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateValue(nextDay(match.date))}`);
  }

  lines.push(`SUMMARY:${escapeText(summaryFor(match))}`);
  if (match.venue !== null && match.venue !== '') {
    lines.push(`LOCATION:${escapeText(match.venue)}`);
  }
  lines.push(`DESCRIPTION:${escapeText(descriptionFor(match))}`);
  lines.push(`STATUS:${icsStatus(match.status)}`);
  lines.push(`SEQUENCE:${meta.sequence}`);
  lines.push(`LAST-MODIFIED:${formatUtc(meta.lastModified)}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Serializa um calendário completo. Determinístico: mesma entrada (incluindo
 * meta.lastModified) → mesmos bytes. Eventos ordenados por data e UID.
 */
export function buildCalendar(opts: CalendarOptions, entries: CalendarEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    const byDate = a.match.date.localeCompare(b.match.date);
    if (byDate !== 0) return byDate;
    return a.meta.uid.localeCompare(b.meta.uid);
  });

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//agendafut//feeds//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    `X-WR-TIMEZONE:${TIMEZONE}`,
    'X-PUBLISHED-TTL:PT12H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    ...VTIMEZONE_LINES,
  ];
  for (const entry of sorted) {
    lines.push(...eventLines(entry));
  }
  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join(CRLF) + CRLF;
}
