import { readFileSync } from 'node:fs';
import type { Team } from './types.js';

/**
 * Normalização genérica de nome → slug estável.
 * Remove acentos, minúsculas, tudo que não é [a-z0-9] vira hífen.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface CanonicalTeam {
  slug: string;
  name: string;
  aliases: string[];
}

const teams = JSON.parse(
  readFileSync(new URL('../../data/teams.json', import.meta.url), 'utf8'),
) as CanonicalTeam[];

/** alias normalizado → time canônico */
const aliasIndex = new Map<string, CanonicalTeam>();
for (const team of teams) {
  for (const alias of [team.name, team.slug, ...team.aliases]) {
    const key = slugify(alias);
    const existing = aliasIndex.get(key);
    if (existing && existing.slug !== team.slug) {
      throw new Error(
        `Alias ambíguo em teams.json: "${alias}" mapeia para "${existing.slug}" e "${team.slug}"`,
      );
    }
    aliasIndex.set(key, team);
  }
}

/**
 * Resolve um nome vindo de qualquer fonte para o time canônico.
 * Fontes divergem ("Atlético-MG", "Atletico Mineiro", "CAM"); o teams.json
 * concentra os aliases. Nome desconhecido cai no slug automático — o slug
 * resultante ainda é determinístico, mas vale adicionar o alias ao teams.json.
 */
export function resolveTeam(rawName: string): Team {
  const canonical = aliasIndex.get(slugify(rawName));
  if (canonical) {
    return { name: canonical.name, slug: canonical.slug };
  }
  return { name: rawName.trim(), slug: slugify(rawName) };
}

/** true se o nome resolveu para um time do teams.json */
export function isKnownTeam(rawName: string): boolean {
  return aliasIndex.has(slugify(rawName));
}
