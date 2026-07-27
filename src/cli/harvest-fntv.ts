/**
 * Colhe as URLs de liga do futebolnatv.com.br (hashes não adivinháveis) para
 * popular data/broadcast-leagues.json à mão. Não faz parte do build: rodar
 * `pnpm harvest:fntv` quando uma competição nova precisar de transmissões.
 *
 * Caminho: /jogos-hoje e /jogos-amanha → páginas de jogo (/aovivo/*.html) →
 * JSON-LD BreadcrumbList, cujo 2º item é a URL da liga.
 */
import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { slugify } from '../domain/slug.js';
import { fetchPage } from '../providers/futebolnatv.js';

const BASE = 'https://www.futebolnatv.com.br';

interface LeagueRow {
  slug: string;
  name: string;
}

const LEAGUES = JSON.parse(
  readFileSync(new URL('../../data/leagues.json', import.meta.url), 'utf8'),
) as LeagueRow[];

const MAPPING_PATH = new URL('../../data/broadcast-leagues.json', import.meta.url);
const existing: Array<{ slug: string; url: string }> = existsSync(MAPPING_PATH)
  ? (JSON.parse(readFileSync(MAPPING_PATH, 'utf8')) as Array<{ slug: string; url: string }>)
  : [];
const existingUrls = new Set(existing.map((e) => e.url));

interface Breadcrumb {
  '@type'?: string;
  itemListElement?: Array<{ item?: string; name?: string }>;
}

function ligaFromGamePage(html: string): { url: string; name: string } | null {
  for (const raw of html.matchAll(
    /<script type="application\/ld\+json">(.*?)<\/script>/gs,
  )) {
    let parsed: Breadcrumb;
    try {
      parsed = JSON.parse(raw[1]!) as Breadcrumb;
    } catch {
      continue;
    }
    if (parsed['@type'] !== 'BreadcrumbList') continue;
    const liga = parsed.itemListElement?.find((i) => i.item?.includes('/liga/'));
    if (liga?.item && liga.name) return { url: liga.item, name: liga.name };
  }
  return null;
}

async function main(): Promise<void> {
  const gameUrls = new Set<string>();
  for (const page of ['/jogos-ontem', '/jogos-hoje', '/jogos-amanha']) {
    const html = await fetchPage(`${BASE}${page}`);
    for (const m of html.matchAll(/href="(\/aovivo\/[^"]+\.html)"/g)) {
      gameUrls.add(m[1]!);
    }
  }
  console.log(`${gameUrls.size} páginas de jogo encontradas\n`);

  const found = new Map<string, string>(); // url → nome no site
  for (const path of gameUrls) {
    await sleep(500); // educação com o site
    try {
      const liga = ligaFromGamePage(await fetchPage(`${BASE}${path}`));
      if (liga) found.set(liga.url, liga.name);
    } catch (err) {
      console.warn(`falha em ${path}: ${String(err)}`);
    }
  }

  console.log('liga no site → sugestão para data/broadcast-leagues.json:\n');
  for (const [url, name] of [...found].sort(([, a], [, b]) => a.localeCompare(b))) {
    // /liga/<slug-do-site>-<hash de 10 chars> → compara o slug sem o hash
    const siteSlug = (url.split('/liga/')[1] ?? '').replace(/-[a-z0-9]{10}$/, '');
    const guess = LEAGUES.find(
      (l) => slugify(l.name) === slugify(name) || siteSlug === l.slug,
    );
    const status = existingUrls.has(url)
      ? 'já mapeada'
      : (guess ? `→ { "slug": "${guess.slug}", "url": "${url}" }` : 'sem liga correspondente em leagues.json');
    console.log(`  ${name}\n    ${url}\n    ${status}\n`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
