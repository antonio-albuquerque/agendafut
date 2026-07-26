# agendafut — regras não-negociáveis

Gerador estático de feeds iCal (webcal) do futebol brasileiro. GitHub Actions + Pages,
sem servidor. Estas invariantes são as que se perdem em refactors — não relaxe nenhuma:

1. **UID determinístico e estável.** Deriva SÓ de competição + data ORIGINAL + times
   (`src/ics/uid.ts`). Nunca inclua horário, rodada, estádio ou id da fonte no UID.
   Partida adiada mantém o UID original via `pairIndex` no `data/state.json`.
   O sufixo `@futebol.agendafut` nunca muda depois do primeiro deploy.

2. **SEQUENCE incrementa a cada mudança de DTSTART, LOCATION ou STATUS**
   (`src/state/sequence.ts`). Sem isso o Google Calendar ignora a atualização.
   Mudança só de conteúdo (placar) atualiza LAST-MODIFIED sem bump.

3. **TZID=America/Sao_Paulo + bloco VTIMEZONE completo** em todo VCALENDAR.
   Nunca converta horários para UTC fixo — o Brasil pode voltar a ter DST.
   Aritmética de datas sempre com luxon e zona explícita, nunca `Date` nativo.

4. **Nunca publicar feed vazio.** Provider falhou ou 0 partidas → o build lança erro
   e nada em `dist/` é tocado. Feed vazio publicado apaga a agenda dos assinantes.

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
- Token via env `API_FUTEBOL_TOKEN`; smoke test offline: `API_FUTEBOL_FIXTURE=<json> pnpm run build`.
