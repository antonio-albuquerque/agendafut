import { describe, expect, it } from 'vitest';
import { slugify, resolveTeam, isKnownTeam } from '../src/domain/slug.js';

describe('slugify', () => {
  it('remove acentos', () => {
    expect(slugify('Grêmio')).toBe('gremio');
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(slugify('Criciúma')).toBe('criciuma');
  });

  it('normaliza separadores e caixa', () => {
    expect(slugify('Atlético-MG')).toBe('atletico-mg');
    expect(slugify('  Red   Bull Bragantino ')).toBe('red-bull-bragantino');
    expect(slugify('Botafogo/RJ')).toBe('botafogo-rj');
  });

  it('não deixa hífens nas pontas', () => {
    expect(slugify('-Inter-')).toBe('inter');
  });
});

describe('resolveTeam', () => {
  it('resolve aliases de fontes diferentes para o mesmo time canônico', () => {
    for (const alias of ['Atlético-MG', 'Atletico Mineiro', 'CAM', 'Galo']) {
      const team = resolveTeam(alias);
      expect(team.slug).toBe('atletico-mg');
      expect(team.name).toBe('Atlético-MG');
    }
  });

  it('distingue Athletico-PR de Atlético-MG e Atlético-GO', () => {
    expect(resolveTeam('Athletico Paranaense').slug).toBe('athletico-pr');
    expect(resolveTeam('Atlético Goianiense').slug).toBe('atletico-go');
  });

  it('time desconhecido cai no slug automático determinístico', () => {
    const team = resolveTeam('Real Brasília FC');
    expect(team.slug).toBe('real-brasilia-fc');
    expect(team.name).toBe('Real Brasília FC');
    expect(isKnownTeam('Real Brasília FC')).toBe(false);
  });
});
