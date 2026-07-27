import { DateTime } from 'luxon';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { TIMEZONE } from '../domain/types.js';

/**
 * Scraper das páginas de liga do futebolnatv.com.br ("Próximos jogos",
 * ~10 dias de horizonte). Fonte de ENRIQUECIMENTO: nada aqui pode derrubar
 * o build — quem chama trata falha caindo no estado persistido.
 */

export interface ScrapedGame {
  /** YYYY-MM-DD em America/Sao_Paulo, resolvido do header ("Hoje", "Sex, 07/08"…) */
  date: string;
  /** HH:mm exibido no site (horário de Brasília) — só para sanity check, nunca chave */
  time: string | null;
  homeRaw: string;
  awayRaw: string;
  round: string | null;
  channels: string[];
}

const ScrapedGameSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  homeRaw: z.string().min(1),
  awayRaw: z.string().min(1),
  round: z.string().nullable(),
  // Vazio é significativo: card listado sem canal = transmissão retirada/não
  // anunciada — o orquestrador usa isso para LIMPAR canais persistidos.
  channels: z.array(z.string().min(1)),
});

// Seletores concentrados aqui: se o site mudar o markup, o conserto é 1 linha.
// Preferimos ids semânticos (jogo-card-team-a-*) e tags (h3, time, article)
// a classes Tailwind, que mudam a cada redesign.
const SELECTORS = {
  dateGroupHeader: 'h3',
  card: 'article',
  teamHome: '[id^="jogo-card-team-a-"] img[alt]',
  teamAway: '[id^="jogo-card-team-b-"] img[alt]',
  kickoff: 'time',
  channelIcon: '.hero-tv',
} as const;

const HEADER_DDMM = /(\d{1,2})\/(\d{1,2})/;

/**
 * "Hoje" / "Amanhã" / "Sex, 07/08" → ISO date. dd/MM não traz ano: usa o de
 * `today` e, se cair mais de 2 dias no passado, assume o ano seguinte
 * (página de dezembro listando "02/01"). Inválido → null.
 */
export function resolveDateHeader(label: string, today: DateTime): string | null {
  const text = label.replace(/\s+/g, ' ').trim();
  const base = today.setZone(TIMEZONE).startOf('day');
  if (/^hoje$/i.test(text)) return base.toISODate();
  if (/^amanh[ãa]$/i.test(text)) return base.plus({ days: 1 }).toISODate();

  const ddmm = HEADER_DDMM.exec(text);
  if (!ddmm) return null;
  const [, dd, mm] = ddmm;
  let candidate = DateTime.fromObject(
    { day: Number(dd), month: Number(mm), year: base.year },
    { zone: TIMEZONE },
  );
  if (candidate.isValid && candidate < base.minus({ days: 2 })) {
    candidate = candidate.plus({ years: 1 });
  }
  return candidate.isValid ? candidate.toISODate() : null;
}

export function parseLeaguePage(
  html: string,
  today: DateTime,
  warn: (msg: string) => void,
): ScrapedGame[] {
  // Nunca executar JS/CSS de HTML raspado.
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  try {
    window.document.write(html);
    const document = window.document;

    const games: ScrapedGame[] = [];
    let cardsSeen = 0;
    let parseFailures = 0;
    for (const header of document.querySelectorAll(SELECTORS.dateGroupHeader)) {
      const date = resolveDateHeader(header.textContent ?? '', today);
      if (date === null) continue; // h3 que não é header de data (ou data inválida)

      // O grupo é o ancestral comum: header + container de cards.
      const group = header.parentElement;
      if (!group) continue;

      for (const card of group.querySelectorAll(SELECTORS.card)) {
        cardsSeen += 1;
        const homeRaw = card.querySelector(SELECTORS.teamHome)?.getAttribute('alt')?.trim() ?? '';
        const awayRaw = card.querySelector(SELECTORS.teamAway)?.getAttribute('alt')?.trim() ?? '';
        const timeText = card.querySelector(SELECTORS.kickoff)?.textContent?.trim() ?? '';
        const time = /^\d{1,2}:\d{2}$/.test(timeText) ? timeText.padStart(5, '0') : null;
        const round = /Rodada\s+(\d+)/.exec(card.textContent ?? '')?.[1] ?? null;
        const channels = [...card.querySelectorAll(SELECTORS.channelIcon)]
          .map((icon) => icon.nextElementSibling?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
          .filter((name) => name !== '');

        const parsed = ScrapedGameSchema.safeParse({ date, time, homeRaw, awayRaw, round, channels });
        if (!parsed.success) {
          parseFailures += 1;
          warn(`card ilegível em ${date} (${homeRaw || '?'} x ${awayRaw || '?'}) — pulando`);
          continue;
        }
        games.push(parsed.data);
      }
    }

    if (games.length === 0) {
      // Liga sem próximos jogos ≠ markup quebrado. A âncora é o heading
      // "Próximos jogos": presente e sem nenhum card → vazio legítimo
      // (pausa de calendário); ausente, ou com cards que não parseiam →
      // falha alto para o orquestrador usar o estado persistido.
      const structureOk = [...document.querySelectorAll('h2')].some((h) =>
        (h.textContent ?? '').includes('Próximos jogos'),
      );
      if (structureOk && parseFailures === 0) {
        // Nenhum card, ou só cards sem canal anunciado: vazio legítimo.
        warn('sem próximos jogos com transmissão listados — liga em pausa?');
        return [];
      }
      throw new Error(
        cardsSeen > 0
          ? `nenhum dos ${cardsSeen} cards parseou — markup mudou?`
          : 'estrutura da página não reconhecida — markup mudou?',
      );
    }
    return games;
  } finally {
    window.close();
  }
}

// ── Client ───────────────────────────────────────────────────────────────

// UA de browser: o site não bloqueia, mas serve variantes distintas a bots.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export interface FntvOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class FntvClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: FntvOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async leagueGames(url: string, today: DateTime, warn: (msg: string) => void): Promise<ScrapedGame[]> {
    const res = await this.fetchImpl(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`futebolnatv ${url}: HTTP ${res.status} ${res.statusText}`);
    }
    return parseLeaguePage(await res.text(), today, warn);
  }
}
