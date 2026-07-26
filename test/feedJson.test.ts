import { describe, expect, it } from 'vitest';
import { buildFeedJson } from '../src/site/feedJson.js';
import { buildUid } from '../src/ics/uid.js';
import type { CalendarEntry } from '../src/ics/builder.js';
import type { Match } from '../src/domain/types.js';
import { FIXED_NOW, makeMatch } from './helpers.js';

function entryFor(match: Match): CalendarEntry {
  return {
    match,
    meta: {
      uid: buildUid(match.competition, match.date, match.home.slug, match.away.slug),
      sequence: 0,
      lastModified: FIXED_NOW.toISO({ suppressMilliseconds: true })!,
    },
  };
}

describe('buildFeedJson', () => {
  it('projeta partidas com horário local de São Paulo', () => {
    const json = buildFeedJson('team', 'palmeiras', 'Palmeiras', [entryFor(makeMatch())]);
    expect(json.kind).toBe('team');
    expect(json.name).toBe('Palmeiras');
    expect(json.matches[0]).toMatchObject({
      date: '2026-07-30',
      time: '16:00',
      home: 'Palmeiras',
      away: 'Corinthians',
      competition: 'Brasileirão Série A',
      venue: 'Allianz Parque',
      status: 'scheduled',
      score: null,
    });
  });

  it('jogo sem horário → time null', () => {
    const json = buildFeedJson('team', 'x', 'X', [entryFor(makeMatch({ kickoff: null }))]);
    expect(json.matches[0]!.time).toBeNull();
  });

  it('ordena por data e inclui placar de encerrados', () => {
    const later = makeMatch({ date: '2026-08-10', status: 'finished', score: { home: 1, away: 0 } });
    const earlier = makeMatch({ date: '2026-08-01' });
    const json = buildFeedJson('competition', 'x', 'X', [entryFor(later), entryFor(earlier)]);
    expect(json.matches.map((m) => m.date)).toEqual(['2026-08-01', '2026-08-10']);
    expect(json.matches[1]!.score).toEqual({ home: 1, away: 0 });
  });
});
