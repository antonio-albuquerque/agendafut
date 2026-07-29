import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyLeagueResult,
  deserializeMatch,
  emptySnapshots,
  loadSnapshots,
  saveSnapshots,
  serializeMatch,
} from '../src/state/snapshots.js';
import { emptyState, reconcile } from '../src/state/sequence.js';
import { buildCalendar } from '../src/ics/builder.js';
import { FIXED_NOW, makeMatch } from './helpers.js';

const NOW_ISO = FIXED_NOW.toISO({ suppressMilliseconds: true })!;
const LATER_ISO = FIXED_NOW.plus({ days: 1 }).toISO({ suppressMilliseconds: true })!;

const requiredLeague = { slug: 'brasileirao-serie-a', required: true };
const optionalLeague = { slug: 'carioca', required: false };

const noop = () => {};

describe('serialização round-trip', () => {
  it('deserialize(serialize) preserva todos os campos, inclusive kickoff com zona', () => {
    const match = makeMatch({ broadcasters: ['Premiere'], score: { home: 2, away: 1 }, status: 'finished' });
    const restored = deserializeMatch(serializeMatch(match));
    expect(restored.kickoff!.toISO()).toBe(match.kickoff!.toISO());
    expect(restored.kickoff!.zoneName).toBe('America/Sao_Paulo');
    expect({ ...restored, kickoff: null }).toEqual({ ...match, kickoff: null });
  });

  it('kickoff null (dia inteiro) round-tripa', () => {
    const match = makeMatch({ kickoff: null });
    expect(deserializeMatch(serializeMatch(match)).kickoff).toBeNull();
  });

  it('partidas do snapshot passam pelo reconcile sem bump de sequence nem mudar o .ics', () => {
    const state = emptyState();
    const matches = [makeMatch()];
    const first = reconcile(state, matches, FIXED_NOW);
    const icsFirst = buildCalendar({ name: 'x' }, first.entries);

    // build seguinte usando o snapshot no lugar dos dados frescos
    const fromSnapshot = matches.map((m) => deserializeMatch(serializeMatch(m)));
    const second = reconcile(state, fromSnapshot, FIXED_NOW.plus({ days: 1 }));
    expect(second.changed).toHaveLength(0);
    expect(buildCalendar({ name: 'x' }, second.entries)).toBe(icsFirst);
  });
});

describe('applyLeagueResult', () => {
  it('fetch ok grava snapshot e devolve os dados frescos', () => {
    const snapshots = emptySnapshots();
    const fresh = [makeMatch()];
    const result = applyLeagueResult(snapshots, requiredLeague, fresh, NOW_ISO, noop);
    expect(result).toEqual({ matches: fresh, usedSnapshot: false });
    expect(snapshots.leagues['brasileirao-serie-a']!.matches).toHaveLength(1);
  });

  it('dados inalterados preservam fetchedAt (arquivo byte-estável entre builds)', () => {
    const snapshots = emptySnapshots();
    applyLeagueResult(snapshots, requiredLeague, [makeMatch()], NOW_ISO, noop);
    applyLeagueResult(snapshots, requiredLeague, [makeMatch()], LATER_ISO, noop);
    expect(snapshots.leagues['brasileirao-serie-a']!.fetchedAt).toBe(NOW_ISO);
  });

  it('dados mudaram → snapshot substituído e fetchedAt atualizado', () => {
    const snapshots = emptySnapshots();
    applyLeagueResult(snapshots, requiredLeague, [makeMatch()], NOW_ISO, noop);
    applyLeagueResult(snapshots, requiredLeague, [makeMatch({ venue: 'Arena Barueri' })], LATER_ISO, noop);
    const snap = snapshots.leagues['brasileirao-serie-a']!;
    expect(snap.fetchedAt).toBe(LATER_ISO);
    expect(snap.matches[0]!.venue).toBe('Arena Barueri');
  });

  it('fetch falhou → reusa o snapshot em vez de derrubar o build', () => {
    const snapshots = emptySnapshots();
    applyLeagueResult(snapshots, requiredLeague, [makeMatch()], NOW_ISO, noop);
    const warnings: string[] = [];
    const result = applyLeagueResult(snapshots, requiredLeague, null, LATER_ISO, (m) => warnings.push(m));
    expect(result.usedSnapshot).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.home.slug).toBe('palmeiras');
    expect(warnings).toHaveLength(1);
  });

  it('0 eventos com snapshot existente → reusa (ESPN já sumiu com liga inteira)', () => {
    const snapshots = emptySnapshots();
    applyLeagueResult(snapshots, requiredLeague, [makeMatch()], NOW_ISO, noop);
    const result = applyLeagueResult(snapshots, requiredLeague, [], LATER_ISO, noop);
    expect(result.usedSnapshot).toBe(true);
    expect(result.matches).toHaveLength(1);
    // o snapshot não é apagado pelo resultado vazio
    expect(snapshots.leagues['brasileirao-serie-a']!.matches).toHaveLength(1);
  });

  it('liga required sem dados e sem snapshot → aborta (nunca publicar feed vazio)', () => {
    expect(() => applyLeagueResult(emptySnapshots(), requiredLeague, null, NOW_ISO, noop)).toThrow(/snapshot/);
    expect(() => applyLeagueResult(emptySnapshots(), requiredLeague, [], NOW_ISO, noop)).toThrow(/snapshot/);
  });

  it('liga opcional sem dados e sem snapshot → segue sem partidas', () => {
    const result = applyLeagueResult(emptySnapshots(), optionalLeague, [], NOW_ISO, noop);
    expect(result).toEqual({ matches: [], usedSnapshot: false });
  });
});

describe('persistência', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agendafut-snap-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('arquivo ausente → snapshots vazios', () => {
    expect(loadSnapshots(join(dir, 'nope.json'), noop)).toEqual(emptySnapshots());
  });

  it('save/load round-tripa e serializa com chaves ordenadas', () => {
    const path = join(dir, 'snapshots.json');
    const snapshots = emptySnapshots();
    applyLeagueResult(snapshots, { slug: 'zeta', required: false }, [makeMatch({ competition: 'zeta' })], NOW_ISO, noop);
    applyLeagueResult(snapshots, { slug: 'alfa', required: false }, [makeMatch({ competition: 'alfa' })], NOW_ISO, noop);
    saveSnapshots(path, snapshots);

    expect(loadSnapshots(path, noop)).toEqual(snapshots);
    const raw = readFileSync(path, 'utf8');
    expect(raw.indexOf('"alfa"')).toBeLessThan(raw.indexOf('"zeta"'));
  });

  it('arquivo corrompido → avisa e volta vazio, sem derrubar o build', () => {
    const path = join(dir, 'snapshots.json');
    writeFileSync(path, JSON.stringify({ version: 1, leagues: { x: { oops: true } } }), 'utf8');
    const warnings: string[] = [];
    expect(loadSnapshots(path, (m) => warnings.push(m))).toEqual(emptySnapshots());
    expect(warnings).toHaveLength(1);
  });
});
