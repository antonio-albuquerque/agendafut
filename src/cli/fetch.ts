import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ApiFutebolProvider } from '../providers/apiFutebol.js';

/**
 * Dev loop: busca (com cache) e grava o JSON normalizado em .cache/ para
 * inspeção e para virar fixture de teste.
 *
 *   pnpm run fetch -- --competition brasileirao-serie-a
 *   pnpm run fetch                       # todas as competições configuradas
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      competition: { type: 'string', short: 'c' },
    },
  });

  const token = process.env.API_FUTEBOL_TOKEN;
  if (!token) throw new Error('API_FUTEBOL_TOKEN não definido no ambiente');

  const provider = new ApiFutebolProvider(token);
  const competitions = await provider.competitions();
  const selected = values.competition
    ? competitions.filter((c) => c.slug === values.competition)
    : competitions;

  if (selected.length === 0) {
    const available = competitions.map((c) => c.slug).join(', ');
    throw new Error(`competição "${values.competition}" não encontrada. Opções: ${available}`);
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
