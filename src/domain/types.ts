import type { DateTime } from 'luxon';

export type MatchStatus =
  | 'scheduled'
  | 'confirmed'
  | 'postponed'
  | 'cancelled'
  | 'finished';

export interface Team {
  /** Nome canônico de exibição, ex.: "Atlético-MG" */
  name: string;
  /** Slug canônico estável, ex.: "atletico-mg" */
  slug: string;
}

export interface Competition {
  /** Id na fonte de dados */
  id: string;
  /** Slug estável usado em UIDs e nomes de arquivo */
  slug: string;
  /** Nome de exibição, ex.: "Brasileirão Série A" */
  name: string;
  season: number;
}

export interface Match {
  /** Id da fonte, se houver. Nunca entra no UID. */
  id: string | null;
  /** Slug da competição, ex.: 'brasileirao-serie-a' */
  competition: string;
  /** Nome de exibição da competição */
  competitionName: string;
  season: number;
  /** '18' | 'oitavas' | null */
  round: string | null;
  home: Team;
  away: Team;
  /** null = data definida, horário TBD → evento de dia inteiro */
  kickoff: DateTime | null;
  /** 'YYYY-MM-DD' — sempre presente, na zona America/Sao_Paulo */
  date: string;
  venue: string | null;
  status: MatchStatus;
  broadcasters: string[];
  score: { home: number; away: number } | null;
}

export const TIMEZONE = 'America/Sao_Paulo';
