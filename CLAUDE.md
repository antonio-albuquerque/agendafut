# agendafut — regras não-negociáveis

Gerador estático de feeds iCal (webcal) do futebol brasileiro. GitHub Actions + Pages,
sem servidor. Estas invariantes são as que se perdem em refactors — não relaxe nenhuma:

1. **UID determinístico e estável.** Deriva SÓ de competição + data ORIGINAL + times
   (`src/ics/uid.ts`). Nunca inclua horário, rodada, estádio ou id da fonte no UID.
   Partida adiada mantém o UID original via `pairIndex` no `data/state.json`.
   O sufixo `@futebol.agendafut` nunca muda depois do primeiro deploy.

2. **SEQUENCE incrementa a cada mudança visível ao usuário** — DTSTART,
   LOCATION, STATUS, SUMMARY (placar) e DESCRIPTION (transmissão)
   (`src/state/sequence.ts`). O Google Calendar descarta QUALQUER atualização
   de evento já sincronizado se o SEQUENCE não for maior que o último visto —
   inclusive mudança só de descrição (aprendido em 2026-08: assinantes ficaram
   sem os canais). LAST-MODIFIED acompanha o bump.

3. **TZID=America/Sao_Paulo + bloco VTIMEZONE completo** em todo VCALENDAR.
   Nunca converta horários para UTC fixo — o Brasil pode voltar a ter DST.
   Aritmética de datas sempre com luxon e zona explícita, nunca `Date` nativo.

4. **Nunca publicar feed vazio.** Coleta é best-effort por liga: fetch falho ou
   0 eventos reusa o último snapshot bom (`data/snapshots.json`, commitado pelo
   CI; a ESPN já sumiu com uma liga inteira por um dia). Liga `required` sem
   dados novos NEM snapshot → o build lança erro e nada em `dist/` é tocado.
   Feed vazio publicado apaga a agenda dos assinantes.

5. **Jogo cancelado/adiado permanece no feed** (`STATUS:CANCELLED`/`TENTATIVE`).
   Sumir do feed deixa evento órfão em quem já sincronizou.

6. **Determinismo:** build 2x sem mudança na fonte → `.ics` byte-idêntico
   (DTSTAMP = LAST-MODIFIED, preservados quando nada muda). Há teste disso;
   se quebrar, o problema é seu, não do teste.

7. **Line folding em 75 OCTETOS** (não caracteres) e escape de `,` `;` `\`
   em SUMMARY/LOCATION/DESCRIPTION. Testado com nomes acentuados.

Outras convenções:
- Golden tests em `test/golden/` — regenerar só com `UPDATE_GOLDEN=1 pnpm test` e revisar o diff.
- Toda resposta de API valida com zod; falhar alto > gerar `.ics` com `undefined`.
- Nome de time novo/divergente entra em `data/teams.json` (aliases), nunca hardcoded.
- Fonte: API JSON pública da ESPN (`site.api.espn.com`), sem token. Ligas em
  `data/leagues.json` (`required: true` → zero eventos aborta o build); os 25 times
  com feed próprio em `data/featured-teams.json` (matching por `espnId`, não por nome).
- `timeValid: false` na ESPN = horário placeholder → evento de dia inteiro, nunca
  confie no horário desses eventos.
- Smoke test offline: `ESPN_FIXTURE=src/providers/fixtures/espn-bra1.json pnpm run build`
  (só ESPN_FIXTURE → scrape de transmissões é pulado; adicione
  `FNTV_FIXTURE=src/providers/fixtures/fntv-serie-b.html` para cobrir o enriquecimento).
- Transmissões: scrape do futebolnatv.com.br (`data/broadcast-leagues.json` mapeia
  liga → URL; `pnpm harvest:fntv` descobre URLs). É enriquecimento fail-soft — falha
  NUNCA derruba o build; último valor visto persiste em `state.json` (sem flapping).
  Mudança de canal bumpa SEQUENCE como qualquer mudança visível (invariante 2).
