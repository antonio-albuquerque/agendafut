/* agendafut — SPA estática, tema "gradiente" (ver style.css): home com
   busca e listas em pílula; detalhe com assinar, último jogo, grade mensal
   e jogos do mês. Renderiza a partir de feeds.json e
   calendars/{kind}/{slug}.json; roteamento por hash para funcionar em
   qualquer subcaminho do GitHub Pages. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var cache = { feeds: null, data: {} };
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var DOW1 = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  var ACCENT = '#ff5a1f';
  // cor principal de cada time: tinge o gradiente do hero na página do time.
  // Clubes preto-e-branco usam um grafite, senão o hero vira cinza-lavado.
  var TEAM_COLORS = {
    'america-mg': '#12874f', 'athletico-pr': '#d0342c', 'atletico-mg': '#3a3f47', 'bahia': '#1a6cb5',
    'botafogo': '#3a3f47', 'ceara': '#2b2f36', 'corinthians': '#2b2f36', 'coritiba': '#0e6b5c',
    'cruzeiro': '#1355a8', 'flamengo': '#d02c2c', 'fluminense': '#8c1c3a', 'fortaleza': '#1f5fb0',
    'goias': '#0d8a44', 'gremio': '#2a9fd8', 'internacional': '#d81e2a', 'nautico': '#d13a45',
    'palmeiras': '#14804a', 'paysandu': '#1e4f9c', 'remo': '#2b5cb0', 'santa-cruz': '#cf3339',
    'santos': '#4a4f57', 'sao-paulo': '#cc2830', 'sport': '#c8342c', 'vasco': '#3a3f47', 'vitoria': '#d64230'
  };
  var query = '';
  // mês corrente da view de detalhe (zerado ao trocar de feed)
  var sel = { key: null, y: null, m: null };

  var SVG_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>';
  var SVG_CHEV_R = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>';
  var SVG_CHEV_L = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"></path></svg>';
  var SVG_CLOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>';
  var SVG_CAL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="4"></rect><path d="M8 3v4M16 3v4M3 10h18M12 13v6M9 16h6"></path></svg>';
  var SVG_COPY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="9" width="12" height="12" rx="3"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';
  var SVG_TV = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="3"></rect><path d="M8 2l4 4 4-4"></path></svg>';
  var SVG_CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function absUrl(path) { return new URL(path, window.location.href).href; }
  function webcalUrl(path) { return absUrl(path).replace(/^https?:/, 'webcal:'); }
  // sigla para times sem escudo em assets/logos: iniciais das palavras
  // ("Red Bull Bragantino" → RBB) ou as 3 primeiras letras ("Mirassol" → MIR)
  function initials(name) {
    var words = norm(name).replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    var s = words.length >= 2
      ? words.slice(0, 3).map(function (w) { return w[0]; }).join('')
      : (words[0] || '').slice(0, 3);
    return s.toUpperCase();
  }

  function fetchJson(path) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' em ' + path);
      return res.json();
    });
  }
  function getFeeds() {
    if (cache.feeds) return Promise.resolve(cache.feeds);
    return fetchJson('feeds.json').then(function (d) { cache.feeds = d; return d; });
  }
  function getFeed(kind, slug) {
    var key = kind + '/' + slug;
    if (cache.data[key]) return Promise.resolve(cache.data[key]);
    return fetchJson('calendars/' + kind + '/' + slug + '.json').then(function (d) {
      cache.data[key] = d;
      return d;
    });
  }

  function todayIso() {
    // data local do navegador; para agenda de jogos a diferença de fuso
    // do usuário é o comportamento esperado
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  // escudo em círculo escuro; sem arquivo em assets/logos cai para a sigla
  function circHtml(slug, name) {
    return '<span class="circ" data-ini="' + esc(initials(name)) + '">' +
      '<img class="crest" src="assets/logos/' + esc(slug) + '.png" alt="" loading="lazy" ' +
      'onerror="this.parentNode.textContent=this.parentNode.dataset.ini">' +
      '</span>';
  }
  function updatedHtml(feeds) {
    var gen = '…';
    if (feeds && feeds.generatedAt) {
      var g = new Date(feeds.generatedAt);
      gen = pad(g.getDate()) + '/' + pad(g.getMonth() + 1) + '/' + g.getFullYear();
    }
    return '<span class="updated">' + SVG_CLOCK + '<span>atualizado ' + esc(gen) + '</span></span>';
  }
  function wireCopyButtons(root) {
    root.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(absUrl(btn.dataset.copy)).then(function () {
          var label = btn.querySelector('.blabel') || btn;
          var old = label.textContent;
          label.textContent = 'Link copiado!';
          setTimeout(function () { label.textContent = old; }, 2000);
        });
      });
    });
  }

  /* ── Home ─────────────────────────────────────────────────── */

  function itemHtml(kind, f) {
    var isTeam = kind === 'time';
    return (
      '<a class="item' + (isTeam ? '' : ' comp') + '" href="#/' + kind + '/' + esc(f.slug) + '">' +
      (isTeam ? circHtml(f.slug, f.name) : '') +
      '<span class="item-name">' + esc(f.name) + '</span>' +
      '<span class="count">' + f.matchCount + ' jogos</span>' +
      '<span class="chev">' + SVG_CHEV_R + '</span>' +
      '</a>'
    );
  }
  function listsHtml(feeds) {
    var q = norm(query);
    function build(list, kind) {
      var out = list
        .filter(function (f) { return !q || norm(f.name).indexOf(q) >= 0; })
        .map(function (f) { return itemHtml(kind, f); })
        .join('');
      return out || '<p class="empty">Nada encontrado.</p>';
    }
    return {
      teams: build(feeds.teams, 'time'),
      comps: build(feeds.competitions, 'competicao')
    };
  }

  function renderHome() {
    document.title = 'agendafut — calendários do futebol brasileiro';
    getFeeds().then(function (feeds) {
      var lists = listsHtml(feeds);
      app.innerHTML =
        '<div class="page"><div class="hero"></div>' +
        '<div class="wrap home">' +
        '<div class="brandbar">' + updatedHtml(feeds) +
        '<h1 class="brand display">agendafut</h1>' +
        '<p class="lead">Os jogos do futebol brasileiro direto na sua agenda. ' +
        'Escolha o time e assine.</p>' +
        '</div>' +
        '<label class="search">' + SVG_SEARCH +
        '<input id="q" type="search" placeholder="Buscar time ou competição" ' +
        'value="' + esc(query) + '" autocomplete="off">' +
        '</label>' +
        '<div class="sect g-teams"><h2 class="glabel display">Times</h2>' +
        '<div class="list" id="list-teams">' + lists.teams + '</div></div>' +
        '<div class="sect g-comps"><h2 class="glabel display">Competições</h2>' +
        '<div class="list" id="list-comps">' + lists.comps + '</div></div>' +
        '<div class="sect g-howto"><h2 class="glabel display">Como assinar</h2><div class="list">' +
        '<div class="step"><span class="n display">01</span><p><strong>iPhone e Mac</strong> — ' +
        'toque em Assinar: o Calendário abre e acompanha novos jogos sozinho.</p></div>' +
        '<div class="step"><span class="n display">02</span><p><strong>Google Agenda</strong> — ' +
        'copie o link .ics e cole em Outras agendas → Assinar por URL.</p></div>' +
        '<div class="step"><span class="n display">03</span><p><strong>Outlook e Android</strong> — ' +
        'cole o link .ics em Adicionar calendário por URL.</p></div></div></div>' +
        '<p class="foot">Feeds gerados automaticamente · <a href="feeds.json">feeds.json</a></p>' +
        '</div></div>';

      var input = app.querySelector('#q');
      input.addEventListener('input', function () {
        query = input.value;
        var l = listsHtml(feeds);
        document.getElementById('list-teams').innerHTML = l.teams;
        document.getElementById('list-comps').innerHTML = l.comps;
      });
    }).catch(renderError);
  }

  /* ── Detalhe: último jogo, grade mensal e jogos do mês ────── */

  function matchLine(m) {
    if (m.status === 'finished' && m.score) {
      return esc(m.home) + ' <span class="score">' + m.score.home + ' x ' + m.score.away +
        '</span> ' + esc(m.away);
    }
    return esc(m.home) + ' x ' + esc(m.away);
  }
  function broadcastHtml(m) {
    // canais vêm do enriquecimento fail-soft; feeds antigos podem não ter o campo
    if (!m.broadcasters || !m.broadcasters.length || m.status === 'finished') return '';
    return '<span class="chip mtv">' + SVG_TV +
      '<span>' + esc(m.broadcasters.join(', ')) + '</span></span>';
  }
  function statusBadge(m) {
    if (m.status === 'postponed') return '<span class="chip badge warn">Adiado</span>';
    if (m.status === 'cancelled') return '<span class="chip badge danger">Cancelado</span>';
    if (m.time === null && m.status !== 'finished') return '<span class="chip badge">Horário a definir</span>';
    return '';
  }
  function defaultMonth(dates) {
    var pick = null;
    var today = todayIso();
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] >= today) { pick = dates[i]; break; }
    }
    if (!pick) pick = dates.length ? dates[dates.length - 1] : todayIso();
    return { y: Number(pick.slice(0, 4)), m: Number(pick.slice(5, 7)) - 1 };
  }
  function dateLabel(iso) {
    var d = new Date(iso + 'T12:00:00');
    return DOW[d.getDay()] + ' ' + pad(d.getDate()) + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  }

  // card do último jogo encerrado com placar (não há nada a mostrar antes da 1ª rodada)
  function lastMatchHtml(matches) {
    var last = null;
    matches.forEach(function (m) {
      if (m.status === 'finished' && m.score && (!last || m.date > last.date)) last = m;
    });
    if (!last) return '';
    return '<div class="lastcard">' +
      '<span class="chip">' + SVG_CHECK + '<span>Último jogo · ' + esc(dateLabel(last.date)) + '</span></span>' +
      '<div class="teams">' +
      '<div class="side">' + circHtml(last.homeSlug, last.home) + '<span>' + esc(last.home) + '</span></div>' +
      '<div class="big display">' + last.score.home + ' x ' + last.score.away + '</div>' +
      '<div class="side">' + circHtml(last.awaySlug, last.away) + '<span>' + esc(last.away) + '</span></div>' +
      '</div>' +
      '<span class="sub">' + esc(last.competition + (last.venue ? ' · ' + last.venue : '')) + '</span>' +
      '</div>';
  }

  function gridHtml(y, m, matchDays) {
    var first = new Date(y, m, 1, 12);
    var off = first.getDay();
    var today = todayIso();
    var html = '<div class="grid7 dows">' + DOW1.map(function (d) {
      return '<div class="dow">' + d + '</div>';
    }).join('') + '</div><div class="grid7">';
    for (var i = 0; i < 42; i++) {
      var d = new Date(y, m, 1 - off + i, 12);
      var iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      var inMonth = d.getMonth() === m;
      html += '<div class="cell' + (inMonth ? '' : ' out') + (iso === today ? ' today' : '') + '">' +
        '<span class="n">' + d.getDate() + '</span>' +
        '<span class="dot" style="background:' + (matchDays[iso] ? ACCENT : 'transparent') + '"></span>' +
        '</div>';
    }
    return html + '</div>';
  }

  function renderDetail(kind, slug) {
    var key = kind + '/' + slug;
    Promise.all([getFeeds(), getFeed(kind, slug)]).then(function (results) {
      var feeds = results[0];
      var data = results[1];
      var list = kind === 'team' ? feeds.teams : feeds.competitions;
      var ref = list.find(function (f) { return f.slug === slug; });
      if (!ref) throw new Error('feed não encontrado: ' + slug);

      document.title = data.name + ' — agendafut';

      var dates = data.matches.map(function (m) { return m.date; }).sort();
      if (sel.key !== key) {
        var def = defaultMonth(dates);
        sel = { key: key, y: def.y, m: def.m };
      }
      var ym = sel.y + '-' + pad(sel.m + 1);

      var matchDays = {};
      data.matches.forEach(function (mt) { matchDays[mt.date] = true; });
      // competições e times sem cor mapeada ficam com o gradiente padrão
      var teamColor = kind === 'team' ? TEAM_COLORS[slug] : null;
      var pageOpen = teamColor
        ? '<div class="page tinted" style="--team:' + teamColor + '">'
        : '<div class="page">';

      var monthMatches = data.matches
        .filter(function (mt) { return mt.date.slice(0, 7) === ym; })
        .sort(function (a, b) {
          if (a.date !== b.date) return a.date < b.date ? -1 : 1;
          if (a.time === b.time) return 0;
          if (a.time === null) return 1;
          if (b.time === null) return -1;
          return a.time < b.time ? -1 : 1;
        });
      var rows = monthMatches.map(function (mt) {
        var d = new Date(mt.date + 'T12:00:00');
        return '<div class="mrow">' +
          '<div class="mday"><span class="d display">' + pad(d.getDate()) + '</span>' +
          '<span class="dw">' + DOW[d.getDay()] + '</span></div>' +
          '<div class="duel">' + circHtml(mt.homeSlug, mt.home) +
          '<span class="vs">vs</span>' + circHtml(mt.awaySlug, mt.away) + '</div>' +
          '<div class="minfo"><span class="mt">' + matchLine(mt) + '</span>' +
          '<span class="ml">' + esc(mt.competition + (mt.venue ? ' · ' + mt.venue : '')) + '</span>' +
          '<div class="chips">' +
          (mt.time ? '<span class="chip mtime">' + esc(mt.time) + '</span>' : '') +
          broadcastHtml(mt) + statusBadge(mt) +
          '</div></div>' +
          '</div>';
      }).join('');

      app.innerHTML =
        pageOpen + '<div class="hero"></div>' +
        '<div class="wrap detail">' +
        '<div class="topbar">' +
        '<button class="iconbtn backbtn" aria-label="Voltar">' + SVG_CHEV_L + '</button>' +
        '<a class="brandpill" href="#">agendafut</a>' +
        '<span class="spacer"></span>' +
        '</div>' +
        '<div class="dhead">' +
        (kind === 'team' ? circHtml(slug, data.name) : '') +
        '<h2 class="display">' + esc(data.name) + '</h2>' +
        '<div class="tags">' +
        '<span class="chip tag">' + (kind === 'team' ? 'Time' : 'Competição') + '</span>' +
        '<span class="chip tag">' + ref.matchCount + ' jogos na temporada</span>' +
        '</div></div>' +
        '<div class="subs">' +
        '<a class="bigbtn primary" href="' + esc(webcalUrl(ref.path)) + '">' + SVG_CAL +
        ' <span>Assinar calendário</span></a>' +
        '<button class="bigbtn" data-copy="' + esc(ref.path) + '">' + SVG_COPY +
        ' <span class="blabel">Copiar link .ics</span></button>' +
        '</div>' +
        lastMatchHtml(data.matches) +
        '<div class="calcard">' +
        '<div class="mnav">' +
        '<button class="iconbtn mbtn" data-nav="-1" aria-label="Mês anterior">' + SVG_CHEV_L + '</button>' +
        '<h3 class="mlabel display">' + MONTHS[sel.m] + ' ' + sel.y + '</h3>' +
        '<button class="iconbtn mbtn" data-nav="1" aria-label="Próximo mês">' + SVG_CHEV_R + '</button>' +
        '</div>' +
        gridHtml(sel.y, sel.m, matchDays) +
        '</div>' +
        '<div class="sect g-month"><h2 class="glabel display">Jogos do mês</h2>' +
        (monthMatches.length
          ? '<div class="mlist">' + rows + '</div>'
          : '<p class="empty">Sem jogos neste mês.</p>') +
        '</div>' +
        '<p class="foot">Também no Google Agenda: copie o link .ics e cole em ' +
        'Outras agendas → Assinar por URL.</p>' +
        '</div></div>';

      wireCopyButtons(app);
      app.querySelector('.backbtn').addEventListener('click', function () {
        window.location.hash = '';
      });
      app.querySelectorAll('.mbtn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var m = sel.m + Number(btn.dataset.nav);
          if (m < 0) { sel.m = 11; sel.y--; }
          else if (m > 11) { sel.m = 0; sel.y++; }
          else sel.m = m;
          renderDetail(kind, slug);
        });
      });
    }).catch(renderError);
  }

  function renderError(err) {
    app.innerHTML =
      '<div class="page"><div class="hero"></div><div class="wrap">' +
      '<div class="topbar"><button class="iconbtn backbtn" aria-label="Voltar">' + SVG_CHEV_L + '</button>' +
      '<a class="brandpill" href="#">agendafut</a><span class="spacer"></span></div>' +
      '<p class="empty">Não foi possível carregar os dados. Tente recarregar a página.<br>' +
      '<small>' + esc(err && err.message ? err.message : String(err)) + '</small></p></div></div>';
    app.querySelector('.backbtn').addEventListener('click', function () {
      window.location.hash = '';
    });
  }

  /* ── Router ───────────────────────────────────────────────── */

  function route() {
    var m = /^#\/(time|competicao)\/([a-z0-9-]+)$/.exec(window.location.hash);
    if (m) {
      renderDetail(m[1] === 'time' ? 'team' : 'competition', m[2]);
    } else {
      renderHome();
    }
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();
})();
