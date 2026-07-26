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
    { date: '2026-07-30', time: '16:00', home: 'Palmeiras', away: 'Corinthians', homeSlug: 'palmeiras', awaySlug: 'corinthians', competition: 'Brasileirão Série A', competitionSlug: 'brasileirao-serie-a', venue: 'Allianz Parque', status: 'scheduled', score: null },
    { date: '2026-08-29', time: null, home: 'Grêmio', away: 'Palmeiras', homeSlug: 'gremio', awaySlug: 'palmeiras', competition: 'Brasileirão Série A', competitionSlug: 'brasileirao-serie-a', venue: null, status: 'scheduled', score: null },
    { date: '2026-01-28', time: '21:30', home: 'Palmeiras', away: 'Santos', homeSlug: 'palmeiras', awaySlug: 'santos', competition: 'Campeonato Paulista', competitionSlug: 'paulista', venue: 'Allianz Parque', status: 'finished', score: { home: 2, away: 1 } },
  ],
};

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

describe('SPA', () => {
  it('home lista times e competições com botões de assinar', async () => {
    const { window } = bootApp();
    await flush(window);
    const html = window.document.getElementById('app')!.innerHTML;
    expect(html).toContain('Palmeiras');
    expect(html).toContain('Campeonato Paulista');
    expect(html).toContain('webcal://example.test/agendafut/calendars/team/palmeiras.ics');
    expect(html).toContain('3 jogos');
  });

  it('rota #/time/{slug} renderiza o calendário com meses, dias e jogos', async () => {
    const { window } = bootApp();
    await flush(window);
    window.location.hash = '#/time/palmeiras';
    window.dispatchEvent(new window.Event('hashchange'));
    await flush(window);

    const appEl = window.document.getElementById('app')!;
    const html = appEl.innerHTML;
    // sem jogo futuro no relógio real de 2026? relógio do teste é o real do
    // sistema — só valida a estrutura, não a seleção específica
    expect(html).toContain('class="cal"');
    expect(appEl.querySelectorAll('.month').length).toBe(12);
    expect(appEl.querySelectorAll('.month:not(.off)').length).toBe(3); // jan, jul, ago
    expect(appEl.querySelectorAll('.dayn').length).toBeGreaterThanOrEqual(28);
    expect(appEl.querySelector('.dayn.sel')).toBeTruthy();
    expect(appEl.querySelector('.ematch')).toBeTruthy();
    expect(html).toContain('← nada'.slice(0, 1)); // botão voltar presente
  });

  it('selecionar um mês mostra o primeiro dia com jogo e o card do jogo', async () => {
    const { window } = bootApp();
    await flush(window);
    window.location.hash = '#/time/palmeiras';
    window.dispatchEvent(new window.Event('hashchange'));
    await flush(window);

    const appEl = window.document.getElementById('app')!;
    const jan = [...appEl.querySelectorAll('.month')].find((b) => b.textContent === 'Jan')!;
    (jan as unknown as { click(): void }).click();
    await flush(window);

    const html = appEl.innerHTML;
    expect(appEl.querySelector('.month.sel')!.textContent).toBe('Jan');
    expect(appEl.querySelector('.dayn.sel')!.textContent).toBe('28');
    expect(html).toContain('quarta-feira'); // 2026-01-28
    expect(html).toContain('21:30');
    expect(html).toContain('2 x 1'); // placar do encerrado
    expect(html).toContain('Campeonato Paulista');
  });

  it('jogo sem horário exibe badge "Horário a definir"', async () => {
    const { window } = bootApp();
    await flush(window);
    window.location.hash = '#/time/palmeiras';
    window.dispatchEvent(new window.Event('hashchange'));
    await flush(window);

    const appEl = window.document.getElementById('app')!;
    const ago = [...appEl.querySelectorAll('.month')].find((b) => b.textContent === 'Ago')!;
    (ago as unknown as { click(): void }).click();
    await flush(window);

    expect(appEl.innerHTML).toContain('Horário a definir');
    expect(appEl.querySelector('.etime.tbd')).toBeTruthy();
  });

  it('feed inexistente mostra erro sem quebrar', async () => {
    const { window } = bootApp();
    await flush(window);
    window.location.hash = '#/time/nao-existe';
    window.dispatchEvent(new window.Event('hashchange'));
    await flush(window);
    expect(window.document.getElementById('app')!.innerHTML).toContain('Erro');
  });
});
