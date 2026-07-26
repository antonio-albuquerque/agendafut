import type { CalendarEntry } from '../ics/builder.js';
import { TIMEZONE } from '../domain/types.js';
import type { MatchStatus } from '../domain/types.js';

export interface FeedMatchJson {
  /** 'YYYY-MM-DD' na zona de São Paulo */
  date: string;
  /** 'HH:mm' local, ou null quando o horário ainda não foi definido */
  time: string | null;
  home: string;
  away: string;
  homeSlug: string;
  awaySlug: string;
  competition: string;
  competitionSlug: string;
  venue: string | null;
  status: MatchStatus;
  score: { home: number; away: number } | null;
}

export interface FeedJson {
  kind: 'team' | 'competition';
  slug: string;
  name: string;
  matches: FeedMatchJson[];
}

/**
 * Projeção dos eventos de um feed para o JSON consumido pela UI do site.
 * Mesma ordenação do .ics (data, depois UID) para o diff ser estável.
 */
export function buildFeedJson(
  kind: 'team' | 'competition',
  slug: string,
  name: string,
  entries: CalendarEntry[],
): FeedJson {
  const sorted = [...entries].sort((a, b) => {
    const byDate = a.match.date.localeCompare(b.match.date);
    if (byDate !== 0) return byDate;
    return a.meta.uid.localeCompare(b.meta.uid);
  });

  return {
    kind,
    slug,
    name,
    matches: sorted.map(({ match }) => ({
      date: match.date,
      time: match.kickoff ? match.kickoff.setZone(TIMEZONE).toFormat('HH:mm') : null,
      home: match.home.name,
      away: match.away.name,
      homeSlug: match.home.slug,
      awaySlug: match.away.slug,
      competition: match.competitionName,
      competitionSlug: match.competition,
      venue: match.venue,
      status: match.status,
      score: match.score,
    })),
  };
}
