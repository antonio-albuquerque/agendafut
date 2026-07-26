# ⚽ agendafut

Feeds iCal assináveis (`webcal://`) com os jogos do futebol brasileiro.
Gerador 100% estático: GitHub Actions roda um cron diário, gera os `.ics` e publica
no GitHub Pages. Sem servidor, sem banco, sem custo.

## Como funciona

```
API-Futebol ──▶ normalização (zod) ──▶ reconciliação de SEQUENCE (data/state.json)
                                              │
                                              ▼
                            dist/calendars/{team,competition}/*.ics
                            dist/index.html · dist/feeds.json
```

- **Um feed por time** (todos os jogos, todas as competições) e **um por competição**.
- Jogo sem horário definido vira **evento de dia inteiro** e migra para evento com
  horário quando a CBF detalhar a rodada — mesmo UID, `SEQUENCE` incrementado.
- Jogo adiado/cancelado permanece no feed (`TENTATIVE`/`CANCELLED`).
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
# offline, com fixture (não gasta quota):
API_FUTEBOL_FIXTURE=src/providers/fixtures/partidas-brasileirao.json pnpm run build

# com a API real:
export API_FUTEBOL_TOKEN=seu-token   # https://api-futebol.com.br
pnpm run fetch -- --competition brasileirao-serie-a   # inspeciona dados normalizados
pnpm run build                                        # gera dist/
```

Respostas da API ficam em `.cache/` com TTL de 12h para o dev loop não queimar a
quota mensal (apertada no plano gratuito).

> **Antes do primeiro build real:** confira os `providerId` em `data/competitions.json`
> contra `GET /v1/campeonatos` da sua conta — os ids variam por plano/temporada.

## Deploy (GitHub Pages)

1. Crie o repositório no GitHub e faça push da `main`.
2. Em *Settings → Secrets → Actions*, crie `API_FUTEBOL_TOKEN`.
3. Em *Settings → Pages*, selecione **GitHub Actions** como source.
4. Rode o workflow `build` manualmente (*Actions → build → Run workflow*).

O workflow roda todo dia às 06:00 BRT, commita `data/state.json` (o que também
mantém o cron vivo) e só publica se o provider respondeu com dados.

Depois do primeiro deploy: **assine o próprio feed no celular e valide por uma
semana real antes de divulgar.**

## Estrutura

| Caminho | O quê |
|---|---|
| `src/ics/` | Serializador RFC 5545: UID estável, SEQUENCE, VTIMEZONE, folding |
| `src/state/sequence.ts` | Reconciliação: hash → bump de SEQUENCE, índice de adiamentos |
| `src/providers/` | `FixtureProvider` + implementação API-Futebol (zod + cache) |
| `data/teams.json` | Nomes canônicos + aliases (fontes divergem: "CAM", "Atlético-MG"…) |
| `data/state.json` | Estado de SEQUENCE, commitado pelo CI |
| `test/golden/` | `.ics` esperados; regenerar com `UPDATE_GOLDEN=1 pnpm test` |

As regras invariantes do formato estão em [CLAUDE.md](CLAUDE.md).

## Nota legal

Datas e horários de partidas são fatos públicos. O projeto não reproduz escudos,
logos nem texto editorial; dados vêm da [API-Futebol](https://api-futebol.com.br).
Não afiliado a CBF, clubes ou federações.
