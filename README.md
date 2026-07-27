# ⚽ agendafut

Feeds iCal assináveis (`webcal://`) com os jogos dos 25 maiores times do futebol
brasileiro. Gerador 100% estático: GitHub Actions roda um cron diário, gera os
`.ics` e publica no GitHub Pages. Sem servidor, sem banco, sem custo.

**Assine em:** https://antonio-albuquerque.github.io/agendafut/

## Como funciona

```
ESPN (JSON público) ──▶ normalização (zod) ──▶ reconciliação de SEQUENCE (data/state.json)
                                                      │
                                                      ▼
                                    dist/calendars/{team,competition}/*.ics
                                    dist/index.html · dist/feeds.json
```

- **Um feed por time** (todos os jogos, todas as competições) para os 25 times de
  `data/featured-teams.json`, e **um por competição** para as 12 ligas de
  `data/leagues.json`.
- O site é uma SPA estática (`src/site/static/`): selecionar um time/competição
  abre um calendário responsivo (strip de meses e dias, painel do dia com os
  jogos) alimentado pelos `calendars/**/*.json` gerados junto com os `.ics`.
  Roteamento por hash (`#/time/{slug}`) para funcionar no Pages sem servidor.
- Fonte: a API JSON pública da ESPN (`site.api.espn.com`) — sem autenticação, sem
  quota, sem scraping de HTML. Cobre Séries A/B/C, Copa do Brasil, Libertadores,
  Sudamericana, Recopa, Copa do Nordeste e os estaduais SP/RJ/RS/MG.
  *Limitação conhecida: a ESPN não expõe Baiano, Pernambucano, Cearense, Goiano
  nem Paraense — quando houver fonte melhor, é só somar outro `FixtureProvider`.*
- Jogo sem horário definido (`timeValid: false` na ESPN) vira **evento de dia
  inteiro** e migra para evento com horário quando a CBF detalhar a rodada —
  mesmo UID, `SEQUENCE` incrementado.
- Jogo adiado/cancelado permanece no feed (`TENTATIVE`/`CANCELLED`); placar entra
  no `SUMMARY` dos encerrados.
- Canais de transmissão entram na `DESCRIPTION` (`Transmissão: Globo, Premiere…`),
  raspados das páginas de liga do futebolnatv.com.br (~10 dias de horizonte;
  `data/broadcast-leagues.json` mapeia liga → URL — `pnpm harvest:fntv` descobre
  URLs novas). Falha do scraper nunca derruba o build: o último valor visto fica
  persistido no `data/state.json`.
- O Google Calendar faz polling de feeds externos no ritmo dele (8–24h+); o cron
  diário é suficiente. O valor está na corretude do `.ics`, não na frequência.

## Setup

```bash
pnpm install
pnpm test                 # golden tests do serializador ICS + reconciliação
pnpm run typecheck
```

### Rodando local

```bash
# offline, com fixture gravada (sem rede; sem FNTV_FIXTURE o scrape é pulado):
ESPN_FIXTURE=src/providers/fixtures/espn-bra1.json pnpm run build

# offline incluindo transmissões:
ESPN_FIXTURE=src/providers/fixtures/espn-bra1.json \
FNTV_FIXTURE=src/providers/fixtures/fntv-serie-b.html pnpm run build

# contra a ESPN real:
pnpm run fetch -- --league brasileirao-serie-a   # inspeciona dados normalizados
pnpm run build                                   # gera dist/ e atualiza data/state.json
```

Respostas da API ficam em `.cache/` com TTL de 6h para o dev loop.

## Deploy (GitHub Pages)

Já configurado: push na `main` ou o cron diário (06:00 BRT) rodam o workflow
`build`, que commita `data/state.json` (mantendo o cron vivo) e só publica se a
fonte respondeu com dados.

Depois de qualquer mudança estrutural: **assine o próprio feed no celular e
valide por uma semana real antes de divulgar.**

## Estrutura

| Caminho | O quê |
|---|---|
| `src/ics/` | Serializador RFC 5545: UID estável, SEQUENCE, VTIMEZONE, folding |
| `src/state/sequence.ts` | Reconciliação: hash → bump de SEQUENCE, índice de adiamentos |
| `src/providers/espn.ts` | Provider ESPN (zod + cache); interface em `provider.ts` |
| `data/featured-teams.json` | Os 25 times com feed próprio (slug + espnId) |
| `data/leagues.json` | Ligas cobertas; `required: true` → vazio aborta o build |
| `data/teams.json` | Nomes canônicos + aliases (fontes divergem: "CAM", "Atlético-MG"…) |
| `data/state.json` | Estado de SEQUENCE, commitado pelo CI |
| `test/golden/` | `.ics` esperados; regenerar com `UPDATE_GOLDEN=1 pnpm test` |

As regras invariantes do formato estão em [CLAUDE.md](CLAUDE.md).

## Nota legal

Datas, horários e placares de partidas são fatos públicos. O projeto não
reproduz escudos, logos nem texto editorial. Dados obtidos da API pública da
ESPN; as requisições se identificam via User-Agent com link deste repositório.
Não afiliado a ESPN, CBF, CONMEBOL, clubes ou federações.
