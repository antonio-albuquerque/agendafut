import { DateTime } from 'luxon';
import type { Match } from '../src/domain/types.js';
import { TIMEZONE } from '../src/domain/types.js';

/** Timestamp fixo para os goldens serem determinísticos. */
export const FIXED_NOW = DateTime.fromISO('2026-07-26T14:00:00Z', { zone: 'utc' });

export function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: '9001',
    competition: 'brasileirao-serie-a',
    competitionName: 'Brasileirão Série A',
    season: 2026,
    round: '18',
    home: { name: 'Palmeiras', slug: 'palmeiras' },
    away: { name: 'Corinthians', slug: 'corinthians' },
    kickoff: DateTime.fromISO('2026-07-30T16:00:00', { zone: TIMEZONE }),
    date: '2026-07-30',
    venue: 'Allianz Parque',
    status: 'scheduled',
    broadcasters: [],
    score: null,
    ...overrides,
  };
}
