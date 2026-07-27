/* agendafut — SPA estática. Implementa o design AgendaFut.dc.html
   (variante Nocturne) do projeto Claude Design: home com busca,
   listas com barra de cor do time, e detalhe com grade mensal.
   Renderiza a partir de feeds.json e calendars/{kind}/{slug}.json;
   roteamento por hash para funcionar em qualquer subcaminho do
   GitHub Pages. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var cache = { feeds: null, data: {} };
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  // cores por time (do design; barra de cor nas listas e pontos na grade)
  var COLORS = {
    'america-mg': '#12874f', 'athletico-pr': '#d0342c', 'atletico-mg': '#787d86', 'bahia': '#1a6cb5',
    'botafogo': '#6e7278', 'ceara': '#5c6470', 'corinthians': '#8a9099', 'coritiba': '#0e6b5c',
    'cruzeiro': '#1355a8', 'flamengo': '#d02c2c', 'fluminense': '#8c1c3a', 'fortaleza': '#3b6cb4',
    'goias': '#0d8a44', 'gremio': '#2a9fd8', 'internacional': '#d81e2a', 'nautico': '#d13a45',
    'palmeiras': '#14804a', 'paysandu': '#1e4f9c', 'remo': '#2b5cb0', 'santa-cruz': '#cf3339',
    'santos': '#8b929c', 'sao-paulo': '#cc2830', 'sport': '#c8342c', 'vasco': '#7c828a', 'vitoria': '#d64230'
  };
  var ACCENT = '#9184d9';
  var query = '';
  // mês corrente da view de detalhe (zerado ao trocar de feed)
  var sel = { key: null, y: null, m: null };

  var SVG_SEARCH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>';
  var SVG_CHEV_R = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 6l6 6-6 6"></path></svg>';
  var SVG_CHEV_L = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 6l-6 6 6 6"></path></svg>';
  var SVG_CAL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18M12 13v6M9 16h6"></path></svg>';
  var SVG_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';

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
  function feedColor(kind, slug) {
    return (kind === 'time' || kind === 'team') && COLORS[slug] ? COLORS[slug] : ACCENT;
  }
  function crestHtml(kind, slug) {
    // só times têm escudo em assets/logos; se faltar o arquivo o img se remove
    if (kind !== 'time' && kind !== 'team') return '';
    return '<img class="crest" src="assets/logos/' + esc(slug) + '.png" alt="" ' +
      'loading="lazy" onerror="this.remove()">';
  }
  function brandbarHtml(feeds) {
    var gen = '…';
    if (feeds && feeds.generatedAt) {
      var g = new Date(feeds.generatedAt);
      gen = pad(g.getDate()) + '/' + pad(g.getMonth() + 1) + '/' + g.getFullYear();
    }
    return '<div class="brandbar">' +
      '<a class="brand" href="#">agendafut</a>' +
      '<span class="dash"></span>' +
      '<span class="updated">atualizado ' + esc(gen) + '</span>' +
      '</div>';
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
    return (
      '<a class="item" href="#/' + kind + '/' + esc(f.slug) + '">' +
      '<span class="cbar" style="background:' + feedColor(kind, f.slug) + '"></span>' +
      crestHtml(kind, f.slug) +
      '<span class="item-name">' + esc(f.name) + '</span>' +
      '<span class="chip">' + f.matchCount + ' jogos</span>' +
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
        '<div class="wrap home">' +
        brandbarHtml(feeds) +
        '<p class="lead">Calendários assináveis com os jogos do futebol brasileiro. ' +
        'Escolha seu time e receba os jogos direto na sua agenda.</p>' +
        '<label class="search">' + SVG_SEARCH +
        '<input id="q" type="search" placeholder="Buscar time ou competição…" ' +
        'value="' + esc(query) + '" autocomplete="off">' +
        '</label>' +
        '<div class="group g-teams"><div class="glabel">Times</div>' +
        '<div class="list" id="list-teams">' + lists.teams + '</div></div>' +
        '<div class="hr"></div>' +
        '<div class="group g-comps"><div class="glabel">Competições</div>' +
        '<div class="list" id="list-comps">' + lists.comps + '</div></div>' +
        '<div class="hr"></div>' +
        '<div class="group g-howto"><div class="glabel">Como assinar</div>' +
        '<div class="step"><span class="n">1</span><span><strong>iPhone e Mac</strong> — ' +
        'toque em Assinar: o Calendário abre e acompanha novos jogos automaticamente.</span></div>' +
        '<div class="step"><span class="n">2</span><span><strong>Google Agenda</strong> — ' +
        'copie o link .ics e cole em Outras agendas → Assinar por URL.</span></div>' +
        '<div class="step"><span class="n">3</span><span><strong>Outlook e Android</strong> — ' +
        'cole o link .ics na opção Adicionar calendário por URL.</span></div></div>' +
        '<div class="foot">Feeds gerados automaticamente · <a href="feeds.json">feeds.json</a></div>' +
        '</div>';

      var input = app.querySelector('#q');
      input.addEventListener('input', function () {
        query = input.value;
        var l = listsHtml(feeds);
        document.getElementById('list-teams').innerHTML = l.teams;
        document.getElementById('list-comps').innerHTML = l.comps;
      });
    }).catch(renderError);
  }

  /* ── Detalhe: grade mensal + jogos do mês ─────────────────── */

  function matchLine(m) {
    if (m.status === 'finished' && m.score) {
      return esc(m.home) + ' <span class="score">' + m.score.home + ' x ' + m.score.away +
        '</span> ' + esc(m.away);
    }
    return esc(m.home) + ' x ' + esc(m.away);
  }
  function statusBadge(m) {
    if (m.status === 'postponed') return '<span class="badge warn">Adiado</span>';
    if (m.status === 'cancelled') return '<span class="badge danger">Cancelado</span>';
    if (m.time === null && m.status !== 'finished') return '<span class="badge">Horário a definir</span>';
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

  function gridHtml(y, m, matchDays, color) {
    var first = new Date(y, m, 1, 12);
    var off = first.getDay();
    var today = todayIso();
    var html = '<div class="grid7 dows">' + DOW.map(function (d) {
      return '<div class="dow">' + d + '</div>';
    }).join('') + '</div><div class="grid7">';
    for (var i = 0; i < 42; i++) {
      var d = new Date(y, m, 1 - off + i, 12);
      var iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      var inMonth = d.getMonth() === m;
      html += '<div class="cell' + (inMonth ? '' : ' out') + (iso === today ? ' today' : '') + '">' +
        '<span>' + d.getDate() + '</span>' +
        '<span class="dot" style="background:' + (matchDays[iso] ? color : 'transparent') + '"></span>' +
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
      var color = feedColor(kind, slug);

      var matchDays = {};
      data.matches.forEach(function (mt) { matchDays[mt.date] = true; });

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
          '<div class="mday"><div class="d">' + pad(d.getDate()) + '</div>' +
          '<div class="dw">' + DOW[d.getDay()] + '</div></div>' +
          '<div class="minfo"><div class="mt">' + matchLine(mt) + statusBadge(mt) + '</div>' +
          '<div class="ml">' + esc(mt.competition + (mt.venue ? ' · ' + mt.venue : '')) + '</div></div>' +
          '<div class="mtime">' + (mt.time ? esc(mt.time) : '—') + '</div>' +
          '</div>';
      }).join('');

      app.innerHTML =
        '<div class="wrap detail">' +
        brandbarHtml(feeds) +
        '<button class="backbtn">' + SVG_CHEV_L + ' Voltar</button>' +
        '<div class="dhead">' +
        '<span class="cbar big" style="background:' + color + '"></span>' +
        crestHtml(kind, slug) +
        '<h2>' + esc(data.name) + '</h2>' +
        '<span class="tag">' + (kind === 'team' ? 'Time' : 'Competição') + '</span>' +
        '</div>' +
        '<div class="subs">' +
        '<a class="bigbtn primary" href="' + esc(webcalUrl(ref.path)) + '">' + SVG_CAL +
        ' Assinar calendário</a>' +
        '<button class="bigbtn" data-copy="' + esc(ref.path) + '">' + SVG_COPY +
        ' <span class="blabel">Copiar link .ics</span></button>' +
        '</div>' +
        '<div class="calcard">' +
        '<div class="mnav">' +
        '<button class="mbtn" data-nav="-1">' + SVG_CHEV_L + '</button>' +
        '<div class="mlabel">' + MONTHS[sel.m] + ' ' + sel.y + '</div>' +
        '<button class="mbtn" data-nav="1">' + SVG_CHEV_R + '</button>' +
        '</div>' +
        gridHtml(sel.y, sel.m, matchDays, color) +
        '</div>' +
        (monthMatches.length
          ? '<div class="mlist">' + rows + '</div>'
          : '<p class="empty">Sem jogos neste mês.</p>') +
        '<div class="foot">Também no Google Agenda: copie o link .ics e cole em ' +
        'Outras agendas → Assinar por URL.</div>' +
        '</div>';

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
      '<div class="wrap">' +
      '<div class="brandbar"><a class="brand" href="#">agendafut</a><span class="dash"></span></div>' +
      '<button class="backbtn">' + SVG_CHEV_L + ' Voltar</button>' +
      '<p class="empty">Não foi possível carregar os dados. Tente recarregar a página.<br>' +
      '<small>' + esc(err && err.message ? err.message : String(err)) + '</small></p></div>';
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
