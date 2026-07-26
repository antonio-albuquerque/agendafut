export interface FeedRef {
  slug: string;
  name: string;
  /** feed iCal, ex.: 'calendars/team/palmeiras.ics' */
  path: string;
  /** dados para a UI, ex.: 'calendars/team/palmeiras.json' */
  jsonPath: string;
  matchCount: number;
}

export interface FeedsIndex {
  generatedAt: string;
  teams: FeedRef[];
  competitions: FeedRef[];
}

/**
 * Shell estático da SPA. Todo o conteúdo é renderizado no cliente por
 * assets/app.js a partir de feeds.json e calendars/*.json — o roteamento é
 * por hash (#/time/{slug}) para funcionar no GitHub Pages sem servidor.
 */
export function renderShell(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Calendários assináveis (webcal) com os jogos do futebol brasileiro">
<title>agendafut — calendários do futebol brasileiro</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div id="app"><p class="loading">Carregando…</p></div>
<noscript>
  <p>Esta página precisa de JavaScript. Os feeds continuam acessíveis
  diretamente: veja <a href="feeds.json">feeds.json</a> para a lista de
  calendários <code>.ics</code>.</p>
</noscript>
<script src="assets/app.js"></script>
</body>
</html>
`;
}
