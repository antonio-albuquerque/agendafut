import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';

const appJs = readFileSync(
  new URL('../src/site/static/app.js', import.meta.url),
  'utf8',
);

const feedsFixture = {
  generatedAt: '2026-07-26T00:00:00Z',
  teams: [
    { slug: 'palmeiras', name: 'Palmeiras', path: 'calendars/team/palmeiras.ics', jsonPath: 'calendars/team/palmeiras.json', matchCount: 3 },
  ],
  competitions: [
    { slug: 'paulista', name: 'Campeonato Paulista', path: 'calendars/competition/paulista.ics', jsonPath: 'calendars/competition/paulista.json', matchCount: 3 },
  ],
};

const palmeirasFixture = {
  kind: 'team',
  slug: 'palmeiras',
  name: 'Palmeiras',
  matches: [
    { date: '2026-07-30', time: '16:00', home: 'Palmeiras', away: 'Corinthians', homeSlug: 'palmeiras', awaySlug: 'corinthians', competition: 'Brasileirão Série A', competitionSlug: 'brasileirao-serie-a', venue: 'Allianz Parque', status: 'scheduled', score: null, broadcasters: ['Premiere', 'Record'] },
    { date: '2026-08-29', time: null, home: 'Grêmio', away: 'Palmeiras', homeSlug: 'gremio', awaySlug: 'palmeiras', competition: 'Brasileirão Série A', competitionSlug: 'brasileirao-serie-a', venue: null, status: 'scheduled', score: null, broadcasters: [] },
    { date: '2026-01-28', time: '21:30', home: 'Palmeiras', away: 'Santos', homeSlug: 'palmeiras', awaySlug: 'santos', competition: 'Campeonato Paulista', competitionSlug: 'paulista', venue: 'Allianz Parque', status: 'finished', score: { home: 2, away: 1 }, broadcasters: ['Globo'] },
  ],
};

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function bootApp() {
  const window = new Window({ url: 'https://example.test/agendafut/' });
  const routes: Record<string, unknown> = {
    'feeds.json': feedsFixture,
    'calendars/team/palmeiras.json': palmeirasFixture,
  };
  const fetchStub = vi.fn((path: string) =>
    Promise.resolve({
      ok: path in routes,
      status: path in routes ? 200 : 404,
      json: () => Promise.resolve(routes[path]),
    }),
  );
  // @ts-expect-error stub simplificado é suficiente para o app
  window.fetch = fetchStub;
  window.document.body.innerHTML = '<div id="app"></div>';
  window.eval(appJs);
  return { window, fetchStub };
}

async function flush(window: Window) {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function openDetail(window: Window, hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await flush(window);
  return window.document.getElementById('app')!;
}

/** navega a grade até "{mês} {ano}" via botões ‹ › (relógio do teste é o real) */
async function gotoMonth(window: Window, label: string) {
  const appEl = window.document.getElementById('app')!;
  for (let i = 0; i < 48; i++) {
    const cur = appEl.querySelector('.mlabel')!.textContent!;
    if (cur === label) return;
    const [cm = '', cy = ''] = cur.split(' ');
    const [tm = '', ty = ''] = label.split(' ');
    const curIdx = Number(cy) * 12 + MONTHS.indexOf(cm);
    const tgtIdx = Number(ty) * 12 + MONTHS.indexOf(tm);
    const nav = appEl.querySelectorAll('.mbtn')[tgtIdx > curIdx ? 1 : 0];
    (nav as unknown as { click(): void }).click();
    await flush(window);
  }
  throw new Error('mês não alcançado: ' + label);
}

describe('SPA', () => {
  it('home lista times e competições com busca', async () => {
    const { window } = bootApp();
    await flush(window);
    const appEl = window.document.getElementById('app')!;
    const html = appEl.innerHTML;
    expect(html).toContain('Palmeiras');
    expect(html).toContain('Campeonato Paulista');
    expect(html).toContain('3 jogos');
    expect(html).toContain('atualizado');
    expect(appEl.querySelector('.search input')).toBeTruthy();
    expect(appEl.querySelector('a[href="#/time/palmeiras"]')).toBeTruthy();
  });

  it('busca filtra times e competições sem acento', async () => {
    const { window } = bootApp();
    await flush(window);
    const appEl = window.document.getElementById('app')!;
    const input = appEl.querySelector('.search input') as unknown as { value: string; dispatchEvent(e: unknown): void };
    input.value = 'paulista';
    input.dispatchEvent(new window.Event('input'));
    await flush(window);
    expect(appEl.querySelector('#list-teams')!.innerHTML).toContain('Nada encontrado');
    expect(appEl.querySelector('#list-comps')!.innerHTML).toContain('Campeonato Paulista');

    input.value = 'PALMEIRAS';
    input.dispatchEvent(new window.Event('input'));
    await flush(window);
    expect(appEl.querySelector('#list-teams')!.innerHTML).toContain('Palmeiras');
    expect(appEl.querySelector('#list-comps')!.innerHTML).toContain('Nada encontrado');
  });

  it('rota #/time/{slug} renderiza grade mensal, assinar e jogos', async () => {
    const { window } = bootApp();
    const appEl = await openDetail(window, '#/time/palmeiras');

    const html = appEl.innerHTML;
    expect(html).toContain('webcal://example.test/agendafut/calendars/team/palmeiras.ics');
    expect(html).toContain('Assinar calendário');
    expect(appEl.querySelector('.calcard')).toBeTruthy();
    expect(appEl.querySelectorAll('.dow').length).toBe(7);
    expect(appEl.querySelectorAll('.cell').length).toBe(42);
    expect(appEl.querySelector('.backbtn')).toBeTruthy();
    expect(appEl.querySelector('.mlabel')!.textContent).toMatch(/^[a-zç]+ \d{4}$/);
  });

  it('navegar até janeiro mostra o jogo encerrado com placar', async () => {
    const { window } = bootApp();
    const appEl = await openDetail(window, '#/time/palmeiras');
    await gotoMonth(window, 'janeiro 2026');

    const html = appEl.innerHTML;
    expect(html).toContain('21:30');
    expect(html).toContain('2 x 1'); // placar do encerrado
    expect(html).toContain('Campeonato Paulista');
    // dia 28 tem jogo → célula marcada e clicável
    const marked = appEl.querySelectorAll('.cell.has');
    expect(marked.length).toBe(1);
    expect(marked[0]!.tagName).toBe('BUTTON');
    expect(marked[0]!.getAttribute('data-day')).toBe('2026-01-28');
    expect(appEl.querySelectorAll('button.cell').length).toBe(1); // dias sem jogo são inertes
  });

  it('clicar num dia filtra a lista; clicar de novo volta ao mês', async () => {
    const { window } = bootApp();
    const appEl = await openDetail(window, '#/time/palmeiras');
    await gotoMonth(window, 'janeiro 2026');

    const click = (el: Element | null) => (el as unknown as { click(): void }).click();
    click(appEl.querySelector('.cell[data-day="2026-01-28"]'));
    await flush(window);
    expect(appEl.querySelector('.cell.sel')!.getAttribute('data-day')).toBe('2026-01-28');
    expect(appEl.querySelector('.cell.sel')!.getAttribute('aria-pressed')).toBe('true');
    expect(appEl.querySelector('.g-month .glabel')!.textContent).toBe('Jogos de qua 28 jan');
    expect(appEl.querySelectorAll('.mrow').length).toBe(1);
    expect(appEl.querySelector('.clearday')).toBeTruthy();

    click(appEl.querySelector('.cell[data-day="2026-01-28"]'));
    await flush(window);
    expect(appEl.querySelector('.cell.sel')).toBeNull();
    expect(appEl.querySelector('.g-month .glabel')!.textContent).toBe('Jogos do mês');
    expect(appEl.querySelector('.clearday')).toBeNull();
  });

  it('chip "Ver mês inteiro" e troca de mês limpam o filtro por dia', async () => {
    const { window } = bootApp();
    const appEl = await openDetail(window, '#/time/palmeiras');
    await gotoMonth(window, 'janeiro 2026');
    const click = (el: Element | null) => (el as unknown as { click(): void }).click();

    click(appEl.querySelector('.cell[data-day="2026-01-28"]'));
    await flush(window);
    click(appEl.querySelector('.clearday'));
    await flush(window);
    expect(appEl.querySelector('.cell.sel')).toBeNull();
    expect(appEl.querySelectorAll('.mrow').length).toBe(1); // único jogo de janeiro

    click(appEl.querySelector('.cell[data-day="2026-01-28"]'));
    await flush(window);
    click(appEl.querySelectorAll('.mbtn')[1]!); // fevereiro
    await flush(window);
    expect(appEl.querySelector('.mlabel')!.textContent).toBe('fevereiro 2026');
    expect(appEl.querySelector('.cell.sel')).toBeNull();
    expect(appEl.querySelector('.clearday')).toBeNull();
    expect(appEl.innerHTML).toContain('Sem jogos neste mês.');
  });

  it('jogo agendado exibe canais de transmissão', async () => {
    const { window } = bootApp();
    const appEl = await openDetail(window, '#/time/palmeiras');
    await gotoMonth(window, 'julho 2026');

    const tv = appEl.querySelector('.mtv');
    expect(tv).toBeTruthy();
    expect(tv!.textContent).toContain('Premiere, Record');
  });

  it('jogo encerrado não exibe transmissão; sem canais não há linha', async () => {
    const { window } = bootApp();
    const appEl = await openDetail(window, '#/time/palmeiras');
    await gotoMonth(window, 'janeiro 2026'); // encerrado, com broadcasters no JSON
    expect(appEl.querySelector('.mtv')).toBeNull();

    await gotoMonth(window, 'agosto 2026'); // agendado, broadcasters vazio
    expect(appEl.querySelector('.mtv')).toBeNull();
  });

  it('jogo sem horário exibe badge "Horário a definir"', async () => {
    const { window } = bootApp();
    const appEl = await openDetail(window, '#/time/palmeiras');
    await gotoMonth(window, 'agosto 2026');

    expect(appEl.innerHTML).toContain('Horário a definir');
    expect(appEl.querySelector('.mtime')).toBeNull(); // sem chip de horário
  });

  it('feed inexistente mostra erro sem quebrar', async () => {
    const { window } = bootApp();
    const appEl = await openDetail(window, '#/time/nao-existe');
    expect(appEl.innerHTML).toContain('Não foi possível carregar os dados');
  });
});
