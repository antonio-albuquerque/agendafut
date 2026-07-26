import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { EspnProvider } from '../providers/espn.js';

/**
 * Dev loop: busca (com cache) e grava o JSON normalizado em .cache/ para
 * inspeção e para virar fixture de teste.
 *
 *   pnpm run fetch -- --league brasileirao-serie-a
 *   pnpm run fetch                       # todas as ligas configuradas
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      league: { type: 'string', short: 'l' },
    },
  });

  const provider = new EspnProvider();
  const competitions = await provider.competitions();
  const selected = values.league
    ? competitions.filter((c) => c.slug === values.league)
    : competitions;

  if (selected.length === 0) {
    const available = competitions.map((c) => c.slug).join(', ');
    throw new Error(`liga "${values.league}" não encontrada. Opções: ${available}`);
  }

  mkdirSync('.cache', { recursive: true });
  for (const competition of selected) {
    const matches = await provider.matches(competition.id, competition.season);
    const out = `.cache/normalized-${competition.slug}.json`;
    writeFileSync(
      out,
      JSON.stringify(
        matches.map((m) => ({ ...m, kickoff: m.kickoff?.toISO() ?? null })),
        null,
        2,
      ) + '\n',
      'utf8',
    );
    const withTime = matches.filter((m) => m.kickoff !== null).length;
    console.log(
      `${competition.slug}: ${matches.length} partidas (${withTime} com horário) → ${out}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error('[fetch] FALHOU:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
