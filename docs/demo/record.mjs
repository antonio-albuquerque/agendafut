import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'https://antonio-albuquerque.github.io/agendafut/';
const OUT = process.env.OUT || 'out';
const W = Number(process.env.W || 1280), H = Number(process.env.H || 720);
const Z = Number(process.env.Z || 1);           // CSS zoom: layout = W/Z × H/Z
const LW = W / Z, LH = H / Z;                   // layout size in CSS px
const PHONE = LW < 600;
const QUICK = !!process.env.QUICK;
const sleep = (ms) => new Promise(r => setTimeout(r, QUICK ? Math.min(ms, 150) : ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  permissions: ['clipboard-read', 'clipboard-write'],
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
const page = await ctx.newPage();

// overlay: cursor + caption bar + end card, attached to <body> (the app re-renders #app)
const OVERLAY = `
(() => {
  document.documentElement.style.zoom = '${Z}';
  if (document.getElementById('demo-cursor')) return;
  const st = document.createElement('style');
  st.textContent = \`
    #demo-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:99999;pointer-events:none;
      transform:translate(-4px,-2px);transition:left .55s cubic-bezier(.3,.7,.2,1),top .55s cubic-bezier(.3,.7,.2,1);
      filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
    #demo-ripple{position:fixed;width:44px;height:44px;border-radius:50%;border:3px solid #fff;z-index:99998;
      pointer-events:none;opacity:0;transform:translate(-50%,-50%) scale(.3)}
    #demo-ripple.go{animation:demo-rip .5s ease-out}
    @keyframes demo-rip{0%{opacity:.9;transform:translate(-50%,-50%) scale(.3)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}
    #demo-cap{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(12px);z-index:99997;
      max-width:${PHONE ? Math.round(LW*0.88) : 760}px;padding:14px 26px;border-radius:999px;background:rgba(10,8,8,.82);
      backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;font:600 ${PHONE ? 15 : 21}px/1.3 Inter,system-ui,sans-serif;
      text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.14);
      opacity:0;transition:opacity .35s,transform .35s;pointer-events:none}
    #demo-cap.on{opacity:1;transform:translateX(-50%) translateY(0)}
    #demo-cap b{color:#ff8a4c;font-weight:700}
    #demo-card{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:18px;background:radial-gradient(1200px 700px at 50% 20%,#8a1211 0%,#0d0b0b 70%);color:#fff;
      font-family:Inter,system-ui,sans-serif;opacity:0;transition:opacity .6s;pointer-events:none}
    #demo-card.on{opacity:1}
    #demo-card .t{font:400 ${PHONE ? 72 : 150}px/0.9 "Bebas Neue",Impact,sans-serif;text-transform:uppercase;letter-spacing:.01em}
    #demo-card .s{font-size:${PHONE ? 17 : 26}px;font-weight:500;opacity:.9}
    #demo-card .u{margin-top:10px;font-size:${PHONE ? 13 : 22}px;max-width:${Math.round(LW*0.9)}px;padding:12px 26px;border-radius:999px;background:rgba(255,255,255,.12);
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
  \`;
  document.head.appendChild(st);
  const c = document.createElement('div'); c.id = 'demo-cursor';
  c.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 3l14 9-6.2 1.2L16 20l-2.6 1.3-3.2-6.8L5 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  c.style.left = '${LW/2}px'; c.style.top = '${LH*0.7}px';
  document.body.appendChild(c);
  const r = document.createElement('div'); r.id = 'demo-ripple'; document.body.appendChild(r);
  const cap = document.createElement('div'); cap.id = 'demo-cap'; document.body.appendChild(cap);
  const card = document.createElement('div'); card.id = 'demo-card'; document.body.appendChild(card);
})();`;
await page.addInitScript(OVERLAY);
const ensureOverlay = () => page.evaluate(OVERLAY);

async function moveTo(x, y, ms = 600) {
  await page.evaluate(([x, y]) => { const c = document.getElementById('demo-cursor'); c.style.left = x + 'px'; c.style.top = y + 'px'; }, [x, y]);
  await page.mouse.move(x * Z, y * Z, { steps: 12 });
  await sleep(ms);
}
// bounding box in CSS px of the (zoomed) layout
async function box(el) {
  const b = await el.boundingBox();
  return { x: b.x / Z, y: b.y / Z, width: b.width / Z, height: b.height / Z };
}
async function center(selector, dx = 0, dy = 0) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible' });
  let b = await box(el);
  if (b.y < 70 || b.y + b.height > LH - 90) {
    // bring the target on screen (smooth) before pointing at it
    const y = await page.evaluate(() => window.scrollY);
    await scrollTo(Math.max(0, y + b.y - Math.min(160, Math.max(60, (LH - b.height) / 3))), 1000);
    b = await box(el);
  }
  return { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy };
}
async function hover(selector, pause = 700) {
  const p = await center(selector); await moveTo(p.x, p.y, pause);
}
async function click(selector, { pause = 900, navigate = true } = {}) {
  const p = await center(selector);
  await moveTo(p.x, p.y, 350);
  await page.evaluate(([x, y]) => { const r = document.getElementById('demo-ripple'); r.style.left = x + 'px'; r.style.top = y + 'px'; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }, [p.x, p.y]);
  if (navigate) await page.mouse.click(p.x * Z, p.y * Z);
  await sleep(pause);
}
async function caption(html, hold = 0) {
  await page.evaluate((h) => {
    const c = document.getElementById('demo-cap');
    c.classList.remove('on');
    setTimeout(() => { c.innerHTML = h; if (h) c.classList.add('on'); }, 360);
  }, html);
  await sleep(450 + hold);
}
async function scrollTo(y, ms = 1100) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y);
  await sleep(ms);
}
async function scrollIntoView(selector, offset = 90, ms = 1100) {
  const b = await box(page.locator(selector).first());
  const y = await page.evaluate(() => window.scrollY);
  await scrollTo(Math.max(0, y + b.y - offset), ms);
}
async function typeSlow(selector, text) {
  await page.locator(selector).first().click();
  for (const ch of text) { await page.keyboard.type(ch); await sleep(140 + Math.random() * 120); }
}
async function settled() {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await ensureOverlay();
}

// ── 1. Home ───────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.locator('.item').first().waitFor();
await settled();
await sleep(600);
await caption('<b>agendafut</b> — os jogos do futebol brasileiro direto na sua agenda', 2600);

await caption('Escolha um dos <b>25 times</b> ou uma das <b>12 competições</b>', 300);
await hover('#list-teams .item >> nth=2', 500);
await hover('#list-teams .item >> nth=7', 500);
await hover('#list-comps .item >> nth=1', 900);

// ── 2. Busca ──────────────────────────────────────────────────
await caption('Ou <b>busque</b> pelo nome…', 200);
await hover('#q', 300);
await typeSlow('#q', 'palm');
await sleep(900);

// ── 3. Página do time ─────────────────────────────────────────
await caption('Abra a página do time', 200);
await click('#list-teams .item[href="#/time/palmeiras"]', { pause: 400 });
await page.locator('.bigbtn.primary').waitFor();
await settled();
await sleep(500);
await caption('Página do <b>Palmeiras</b>: temporada inteira, todas as competições', 2200);

await caption('<b>iPhone e Mac:</b> toque em Assinar — o Calendário acompanha os jogos sozinho', 200);
await click('.bigbtn.primary', { navigate: false, pause: 2200 });

await caption('<b>Google Agenda, Outlook, Android:</b> copie o link .ics e assine por URL', 200);
await click('.bigbtn[data-copy]', { pause: 2200 });

// ── 4. Último jogo + grade ────────────────────────────────────
const hasLast = await page.locator('.lastcard').count();
if (hasLast) {
  await caption('O <b>último resultado</b> fica em destaque', 200);
  await hover('.lastcard .big', 1800);
}

await caption('Na <b>grade do mês</b>, os dias marcados têm jogo', 200);
await scrollIntoView('.calcard', 80);
await hover('.mlabel', 1200);

const dayBtn = page.locator('.cell[data-day]');
const nDays = await dayBtn.count();
if (nDays) {
  await caption('Toque em um dia para ver <b>só os jogos dele</b>', 200);
  // prefer the first upcoming match day (future rows show the broadcast chip)
  const today = await page.evaluate(() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); });
  const days = await dayBtn.evaluateAll(els => els.map(e => e.dataset.day));
  const pick = days.find(d => d > today) || days[days.length - 1];
  await click(`.cell[data-day="${pick}"]`, { pause: 1200 });
  await caption('Horário, estádio e <b>canal de transmissão</b> de cada partida', 200);
  await scrollIntoView('.ghead', 110, 1000);
  await hover('.mrow .chips', 2200);
  await caption('Volte à lista do mês inteiro…', 200);
  await click('.clearday', { pause: 1400 });
}

await caption('…ou navegue pelos <b>próximos meses</b>', 200);
await click('.mbtn[data-nav="1"]', { pause: 1600 });
await hover('.mrow >> nth=0', 400);
await hover('.mrow >> nth=1', 1000);

// ── 5. Competição ─────────────────────────────────────────────
await caption('Também há um calendário para <b>cada competição</b>', 200);
await scrollTo(0, 700);
await click('.backbtn', { pause: 400 });
await page.locator('#q').waitFor();
await page.evaluate(() => { const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); });
await page.locator('#list-comps .item').first().waitFor();
await settled();
await scrollIntoView('.g-comps', 60);
await click('#list-comps .item[href="#/competicao/brasileirao-serie-a"]', { pause: 400 });
await page.locator('.bigbtn.primary').waitFor();
await settled();
await sleep(400);
await caption('<b>Brasileirão Série A</b>: todas as rodadas em um só feed', 200);
await hover('.bigbtn.primary', 1000);
await scrollIntoView('.calcard', 80);
await hover('.mrow >> nth=2', 2000);

// ── 6. Encerramento ───────────────────────────────────────────
await caption('', 0);
await page.evaluate((base) => {
  const c = document.getElementById('demo-card');
  const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
  c.innerHTML = '<div class="t">agendafut</div><div class="s">Escolha o time. Assine. Pronto.</div><div class="u">' + host + '</div>';
  c.classList.add('on');
}, BASE);
await sleep(3600);

await ctx.close();
await browser.close();
const files = fs.readdirSync(OUT).filter(f => f.endsWith('.webm')).map(f => path.join(OUT, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
fs.renameSync(files[0], path.join(OUT, 'raw.webm'));
console.log('ok', path.join(OUT, 'raw.webm'));
