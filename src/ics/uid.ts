/**
 * Domínio usado nos UIDs. NUNCA mude este valor depois do primeiro deploy:
 * UIDs diferentes = eventos duplicados no calendário de todo assinante.
 */
export const UID_DOMAIN = 'futebol.agendafut';

/**
 * UID determinístico e estável. Deriva APENAS de dados que não mudam:
 * competição, data original da partida e os dois times.
 * Horário, rodada, estádio e id da fonte ficam de fora — todos podem mudar.
 *
 * Se a partida for adiada para outra data, o UID original (com a data
 * original) é preservado via índice de pares no state.json — este builder
 * só é chamado para partidas ainda não indexadas.
 */
export function buildUid(
  competitionSlug: string,
  date: string,
  homeSlug: string,
  awaySlug: string,
): string {
  return `${competitionSlug}-${date}-${homeSlug}-vs-${awaySlug}@${UID_DOMAIN}`;
}
