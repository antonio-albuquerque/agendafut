/* agendafut — SPA estática. Renderiza a partir de feeds.json e
   calendars/{kind}/{slug}.json; roteamento por hash para funcionar em
   qualquer subcaminho do GitHub Pages. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var cache = { feeds: null, data: {} };
  var MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  // seleção corrente da view de detalhe (zerada ao trocar de feed)
  var sel = { key: null, ym: null, day: null };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
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

  function subscribeButtons(icsPath) {
    return (
      '<span class="actions">' +
      '<a class="btn btn-primary" href="' + esc(webcalUrl(icsPath)) + '">Assinar</a>' +
      '<button class="btn" data-copy="' + esc(icsPath) + '">Copiar URL</button>' +
      '</span>'
    );
  }
  function wireCopyButtons(root) {
    root.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(absUrl(btn.dataset.copy)).then(function () {
          var old = btn.textContent;
          btn.textContent = 'Copiado!';
          setTimeout(function () { btn.textContent = old; }, 1500);
        });
      });
    });
  }

  /* ── Home ─────────────────────────────────────────────────── */

  function crestHtml(kind, slug) {
    // só times têm escudo em assets/logos; se faltar o arquivo o img se remove
    if (kind !== 'time' && kind !== 'team') return '';
    return '<img class="crest" src="assets/logos/' + esc(slug) + '.png" alt="" ' +
      'loading="lazy" onerror="this.remove()">';
  }

  function rowHtml(kind, feed) {
    return (
      '<div class="row">' +
      '<a class="row-link" href="#/' + kind + '/' + esc(feed.slug) + '">' +
      crestHtml(kind, feed.slug) +
      '<span class="row-name">' + esc(feed.name) + '</span>' +
      '<span class="row-count">' + feed.matchCount + ' jogos</span>' +
      '</a>' +
      subscribeButtons(feed.path) +
      '</div>'
    );
  }

  function renderHome() {
    document.title = 'agendafut — calendários do futebol brasileiro';
    getFeeds().then(function (feeds) {
      app.innerHTML =
        '<div class="wrap">' +
        '<h1 class="brand">⚽ agendafut</h1>' +
        '<p class="lead">Calendários assináveis com os jogos do futebol brasileiro. ' +
        'Assine uma vez e os jogos aparecem — e se atualizam — direto na sua agenda.</p>' +
        '<details class="howto"><summary>Como assinar</summary>' +
        '<p><strong>iPhone / Mac:</strong> toque em <em>Assinar</em> — abre direto no Apple Calendar.</p>' +
        '<p><strong>Google Calendar / Android:</strong> toque em <em>Copiar URL</em> e cole em ' +
        '<em>Outros calendários → + → De URL</em>. O Google atualiza feeds externos no ritmo dele ' +
        '(pode levar até um dia).</p></details>' +
        '<h2 class="section">Times</h2>' +
        '<div class="rows">' +
        feeds.teams.map(function (f) { return rowHtml('time', f); }).join('') +
        '</div>' +
        '<h2 class="section">Competições</h2>' +
        '<div class="rows">' +
        feeds.competitions.map(function (f) { return rowHtml('competicao', f); }).join('') +
        '</div>' +
        '<footer><p>Dados de fontes públicas; horários sujeitos a alteração. ' +
        'Não afiliado a clubes ou federações. ' +
        '<a href="feeds.json">feeds.json</a></p></footer>' +
        '</div>';
      wireCopyButtons(app);
    }).catch(renderError);
  }

  /* ── Detalhe: calendário ──────────────────────────────────── */

  function groupByDate(matches) {
    var map = {};
    matches.forEach(function (m) {
      (map[m.date] = map[m.date] || []).push(m);
    });
    return map;
  }
  function todayIso() {
    // data local do navegador; para agenda de jogos a diferença de fuso
    // do usuário é o comportamento esperado
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function defaultDate(dates) {
    var today = todayIso();
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] >= today) return dates[i];
    }
    return dates[dates.length - 1];
  }
  function weekdayName(iso) {
    var d = new Date(iso + 'T12:00:00');
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(d);
  }

  function statusBadge(m) {
    if (m.status === 'postponed') return '<span class="badge warn">Adiado</span>';
    if (m.status === 'cancelled') return '<span class="badge danger">Cancelado</span>';
    if (m.time === null && m.status !== 'finished') return '<span class="badge">Horário a definir</span>';
    return '';
  }
  function matchLine(m) {
    if (m.status === 'finished' && m.score) {
      return esc(m.home) + ' <span class="score">' + m.score.home + ' x ' + m.score.away +
        '</span> ' + esc(m.away);
    }
    return esc(m.home) + ' x ' + esc(m.away);
  }
  function eventHtml(m, kind) {
    var time = m.time
      ? '<div class="etime">' + esc(m.time) + '</div>'
      : '<div class="etime tbd">—</div>';
    var comp = kind === 'team' ? esc(m.competition) : esc(m.competition);
    return (
      '<div class="event">' + time +
      '<div class="ecard ' + esc(m.status) + '">' +
      '<div class="ecomp">' + comp + '</div>' +
      '<div class="ematch">' + matchLine(m) + statusBadge(m) + '</div>' +
      (m.venue ? '<div class="evenue">' + esc(m.venue) + '</div>' : '') +
      '</div></div>'
    );
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

      var byDate = groupByDate(data.matches);
      var dates = Object.keys(byDate).sort();
      if (sel.key !== key) {
        var d = defaultDate(dates);
        sel = { key: key, ym: d.slice(0, 7), day: d };
      }

      // meses (com ano) que têm jogos, em ordem
      var months = [];
      dates.forEach(function (d) {
        var ym = d.slice(0, 7);
        if (months.indexOf(ym) === -1) months.push(ym);
      });
      if (months.indexOf(sel.ym) === -1) sel.ym = months[0];
      var mi = months.indexOf(sel.ym);
      var year = sel.ym.slice(0, 4);

      // dias do mês selecionado
      var daysInMonth = new Date(Number(year), Number(sel.ym.slice(5, 7)), 0).getDate();
      var dayButtons = '';
      for (var day = 1; day <= daysInMonth; day++) {
        var iso = sel.ym + '-' + String(day).padStart(2, '0');
        var has = !!byDate[iso];
        dayButtons +=
          '<button class="dayn' + (has ? '' : ' off') + (iso === sel.day ? ' sel' : '') +
          '" data-date="' + iso + '"' + (has ? '' : ' disabled') + '>' + day + '</button>';
      }

      var monthButtons = MONTHS.map(function (label, idx) {
        var ym = year + '-' + String(idx + 1).padStart(2, '0');
        var has = months.indexOf(ym) !== -1;
        return '<button class="month' + (has ? '' : ' off') + (ym === sel.ym ? ' sel' : '') +
          '" data-ym="' + ym + '"' + (has ? '' : ' disabled') + '>' + label + '</button>';
      }).join('');

      var dayMatches = (byDate[sel.day] || []).slice().sort(function (a, b) {
        if (a.time === b.time) return 0;
        if (a.time === null) return 1;
        if (b.time === null) return -1;
        return a.time < b.time ? -1 : 1;
      });
      var panel = sel.day && byDate[sel.day]
        ? '<div class="daytitle"><h2 class="wd">' + esc(weekdayName(sel.day)) + '</h2>' +
          '<span class="dn">' + Number(sel.day.slice(8, 10)) + '</span></div>' +
          '<div class="events">' +
          dayMatches.map(function (m) { return eventHtml(m, kind); }).join('') +
          '</div>'
        : '<p class="noevents">Sem jogos neste dia.</p>';

      app.innerHTML =
        '<div class="wrap">' +
        '<div class="topbar">' +
        '<button class="back" aria-label="Voltar">←</button>' +
        crestHtml(kind, slug) +
        '<h1>' + esc(data.name) + '</h1>' +
        subscribeButtons(ref.path) +
        '</div>' +
        '<div class="cal">' +
        '<div class="cal-head">' +
        '<span class="yearnav">' +
        '<span class="year">' + esc(year) + '</span>' +
        '<button class="nav" data-nav="-1"' + (mi <= 0 ? ' disabled' : '') + '>‹</button>' +
        '<button class="nav" data-nav="1"' + (mi >= months.length - 1 ? ' disabled' : '') + '>›</button>' +
        '</span>' +
        '<div class="months">' + monthButtons + '</div>' +
        '</div>' +
        '<div class="days">' + dayButtons + '</div>' +
        panel +
        '</div></div>';

      wireCopyButtons(app);
      app.querySelector('.back').addEventListener('click', function () {
        window.location.hash = '';
      });
      app.querySelectorAll('.month:not(.off)').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectMonth(kind, slug, btn.dataset.ym, byDate);
        });
      });
      app.querySelectorAll('.nav:enabled').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var next = months[months.indexOf(sel.ym) + Number(btn.dataset.nav)];
          if (next) selectMonth(kind, slug, next, byDate);
        });
      });
      app.querySelectorAll('.dayn:not(.off)').forEach(function (btn) {
        btn.addEventListener('click', function () {
          sel.day = btn.dataset.date;
          renderDetail(kind, slug);
        });
      });
      ['.dayn.sel', '.month.sel'].forEach(function (selector) {
        var el = app.querySelector(selector);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ inline: 'center', block: 'nearest' });
        }
      });
    }).catch(renderError);
  }

  function selectMonth(kind, slug, ym, byDate) {
    sel.ym = ym;
    // primeiro dia com jogo no mês
    var first = null;
    Object.keys(byDate).sort().some(function (d) {
      if (d.slice(0, 7) === ym) { first = d; return true; }
      return false;
    });
    sel.day = first;
    renderDetail(kind, slug);
  }

  function renderError(err) {
    app.innerHTML =
      '<div class="wrap"><div class="topbar">' +
      '<button class="back" aria-label="Voltar">←</button><h1>Erro</h1></div>' +
      '<p class="noevents">' + esc(err && err.message ? err.message : String(err)) + '</p></div>';
    var back = app.querySelector('.back');
    if (back) back.addEventListener('click', function () { window.location.hash = ''; });
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
