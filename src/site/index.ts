export interface FeedRef {
  slug: string;
  name: string;
  /** caminho relativo à raiz do site, ex.: 'calendars/team/palmeiras.ics' */
  path: string;
  matchCount: number;
}

export interface FeedsIndex {
  generatedAt: string;
  teams: FeedRef[];
  competitions: FeedRef[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function feedRow(feed: FeedRef): string {
  return `      <li class="feed">
        <span class="feed-name">${esc(feed.name)}</span>
        <span class="feed-actions">
          <a class="btn btn-primary" data-webcal="${esc(feed.path)}" href="${esc(feed.path)}">Assinar</a>
          <button class="btn" data-copy="${esc(feed.path)}">Copiar URL</button>
        </span>
      </li>`;
}

/**
 * Página estática de assinatura. webcal:// dá o clique único no iOS/macOS;
 * no Google Calendar o caminho é copiar a URL https e colar em
 * "Outros calendários → De URL" — as duas opções ficam explícitas.
 * URLs são resolvidas no cliente a partir de location.href, então a página
 * funciona em qualquer domínio/subcaminho (GitHub Pages incluso).
 */
export function renderIndexHtml(index: FeedsIndex): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agendafut — calendários do futebol brasileiro</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fafafa; --card: #fff;
          --muted: #666; --accent: #14713d; --border: #ddd; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #eee; --bg: #111; --card: #1c1c1c; --muted: #999;
            --accent: #2ea866; --border: #333; }
  }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 46rem; padding: 2rem 1rem 4rem;
         font: 16px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.2rem; margin-top: 2.5rem; }
  p.lead { color: var(--muted); }
  ul.feeds { list-style: none; padding: 0; }
  li.feed { display: flex; align-items: center; justify-content: space-between;
            gap: .75rem; padding: .6rem .8rem; margin: .4rem 0;
            background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
  .feed-name { font-weight: 600; }
  .feed-actions { display: flex; gap: .5rem; flex-shrink: 0; }
  .btn { font: inherit; font-size: .85rem; padding: .35rem .7rem; border-radius: 6px;
         border: 1px solid var(--border); background: var(--card); color: var(--fg);
         cursor: pointer; text-decoration: none; }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  details { margin-top: 1rem; background: var(--card); border: 1px solid var(--border);
            border-radius: 8px; padding: .8rem 1rem; }
  summary { cursor: pointer; font-weight: 600; }
  footer { margin-top: 3rem; font-size: .85rem; color: var(--muted); }
  code { background: var(--card); border: 1px solid var(--border);
         border-radius: 4px; padding: .1rem .3rem; }
</style>
</head>
<body>
<h1>⚽ agendafut</h1>
<p class="lead">Calendários assináveis com os jogos do futebol brasileiro.
Assine uma vez e os jogos aparecem — e se atualizam — direto na sua agenda.</p>

<details>
  <summary>Como assinar</summary>
  <p><strong>iPhone / Mac (Apple Calendar):</strong> toque em <em>Assinar</em>.
  O calendário abre direto no app.</p>
  <p><strong>Google Calendar / Android:</strong> toque em <em>Copiar URL</em>, depois no
  Google Calendar abra <em>Outros calendários → + → De URL</em> e cole o endereço.
  O Google atualiza feeds externos no ritmo dele (pode levar até um dia).</p>
</details>

<h2>Times</h2>
<ul class="feeds">
{{TEAMS}}
</ul>

<h2>Competições</h2>
<ul class="feeds">
{{COMPETITIONS}}
</ul>

<footer>
  <p>Gerado em {{GENERATED_AT}}. Dados de fontes públicas; horários sujeitos a
  alteração pela CBF. Este projeto não é afiliado a nenhum clube ou federação.</p>
  <p>Índice legível por máquina: <a href="feeds.json"><code>feeds.json</code></a></p>
</footer>

<script>
  function absoluteUrl(path) { return new URL(path, window.location.href).href; }
  document.querySelectorAll('[data-webcal]').forEach(function (a) {
    a.href = absoluteUrl(a.dataset.webcal).replace(/^https?:/, 'webcal:');
  });
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(absoluteUrl(btn.dataset.copy)).then(function () {
        var old = btn.textContent;
        btn.textContent = 'Copiado!';
        setTimeout(function () { btn.textContent = old; }, 1500);
      });
    });
  });
</script>
</body>
</html>
`
    .replace('{{TEAMS}}', index.teams.map(feedRow).join('\n'))
    .replace('{{COMPETITIONS}}', index.competitions.map(feedRow).join('\n'))
    .replace('{{GENERATED_AT}}', esc(index.generatedAt));
}
