import type { Competition, Match } from '../domain/types.js';

/**
 * Abstração da fonte de dados. A cobertura de qualquer fonte única é
 * incompleta (estaduais, Séries C/D…) — trocar ou somar fontes tem que
 * ser barato, então nada fora de providers/ conhece detalhes de API.
 */
export interface FixtureProvider {
  name: string;
  competitions(): Promise<Competition[]>;
  matches(competitionId: string, season: number): Promise<Match[]>;
}
