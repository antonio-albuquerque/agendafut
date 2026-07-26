/**
 * Bloco VTIMEZONE de America/Sao_Paulo.
 *
 * Sem este bloco o Outlook desktop interpreta errado o TZID. Não usamos UTC
 * fixo porque o Brasil já teve horário de verão e pode voltar a ter — se
 * isso acontecer, este bloco precisa ganhar as regras DAYLIGHT novamente.
 *
 * Desde 2019 (decreto 9.772) não há DST: offset fixo -03:00.
 */
export const VTIMEZONE_LINES: readonly string[] = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Sao_Paulo',
  'X-LIC-LOCATION:America/Sao_Paulo',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:-0300',
  'TZOFFSETTO:-0300',
  'TZNAME:-03',
  'END:STANDARD',
  'END:VTIMEZONE',
];
