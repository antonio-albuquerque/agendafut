import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  collectPartidas,
  normalizePartida,
  parseWhen,
} from '../src/providers/apiFutebol.js';
import type { CompetitionConfig } from '../src/providers/apiFutebol.js';

const fixture: unknown = JSON.parse(
  readFileSync(
    new URL('../src/providers/fixtures/partidas-brasileirao.json', import.meta.url),
    'utf8',
  ),
);

const config: CompetitionConfig = {
  providerId: 10,
  slug: 'brasileirao-serie-a',
  name: 'Brasileirão Série A',
  season: 2026,
};

const noop = () => {};

describe('collectPartidas', () => {
  it('coleta partidas em qualquer profundidade e captura a rodada da chave', () => {
    const collected = collectPartidas(fixture);
    expect(collected).toHaveLength(3);
    const byId = new Map(collected.map((c) => [c.partida.partida_id, c]));
    expect(byId.get(9001)!.round).toBe('18');
    expect(byId.get(8950)!.round).toBe('17');
  });

  it('falha alto se um campo obrigatório sumir do schema', () => {
    const broken = { partidas: [{ time_mandante: { nome_popular: 'X' }, time_visitante: {} }] };
    expect(() => collectPartidas(broken)).toThrow();
  });
});

describe('parseWhen', () => {
  it('hora presente → kickoff na zona de São Paulo', () => {
    const [first] = collectPartidas(fixture);
    const when = parseWhen(first!.partida)!;
    expect(when.date).toBe('2026-07-30');
    expect(when.kickoff!.toISO()).toBe('2026-07-30T16:00:00.000-03:00');
  });

  it('hora null → kickoff null mesmo com meia-noite no campo ISO', () => {
    const collected = collectPartidas(fixture);
    const tbd = collected.find((c) => c.partida.partida_id === 9002)!;
    const when = parseWhen(tbd.partida)!;
    expect(when.date).toBe('2026-08-02');
    expect(when.kickoff).toBeNull();
  });

  it('sem data_realizacao usa a data do campo ISO', () => {
    const collected = collectPartidas(fixture);
    const finished = collected.find((c) => c.partida.partida_id === 8950)!;
    expect(parseWhen(finished.partida)!.date).toBe('2026-07-20');
  });
});

describe('normalizePartida', () => {
  it('normaliza times via aliases do teams.json', () => {
    const collected = collectPartidas(fixture);
    const tbd = collected.find((c) => c.partida.partida_id === 9002)!;
    const match = normalizePartida(tbd.partida, tbd.round, config, noop)!;
    expect(match.home).toEqual({ name: 'Atlético-MG', slug: 'atletico-mg' });
    expect(match.away).toEqual({ name: 'Grêmio', slug: 'gremio' });
    expect(match.kickoff).toBeNull();
    expect(match.venue).toBeNull();
    expect(match.status).toBe('scheduled');
  });

  it('jogo finalizado carrega placar', () => {
    const collected = collectPartidas(fixture);
    const finished = collected.find((c) => c.partida.partida_id === 8950)!;
    const match = normalizePartida(finished.partida, finished.round, config, noop)!;
    expect(match.status).toBe('finished');
    expect(match.score).toEqual({ home: 2, away: 2 });
    expect(match.round).toBe('17');
  });

  it('partida sem data alguma é descartada com aviso', () => {
    const warnings: string[] = [];
    const collected = collectPartidas(fixture);
    const partida = { ...collected[0]!.partida, data_realizacao: null, data_realizacao_iso: null };
    const match = normalizePartida(partida, '18', config, (msg) => warnings.push(msg));
    expect(match).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});
