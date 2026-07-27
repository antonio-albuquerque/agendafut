/**
 * Normalização canônica de nomes de canal antes de armazenar/renderizar:
 * colapsa espaços, dedup case-insensitive e ordena por code unit. Não usar
 * localeCompare — a ordem varia com a build de ICU e quebraria o build
 * byte-idêntico entre máquinas.
 */
export function normalizeChannels(names: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (name === '') continue;
    const key = name.toUpperCase();
    const existing = byKey.get(key);
    if (existing === undefined || name < existing) {
      byKey.set(key, name);
    }
  }
  return [...byKey.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
