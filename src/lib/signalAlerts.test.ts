import { describe, it, expect } from 'vitest';
import {
  parseSignalFilter, serializeSignalFilter, detectNewSignals, formatSignalMessage,
  WATCHABLE_SIGNALS, type ScopeSignal,
} from './signalAlerts';

function scope(scopeId: string, signal: ScopeSignal['signal'], score = 70): ScopeSignal {
  return { scopeId, label: scopeId.toUpperCase(), signal, score };
}

describe('parseSignalFilter', () => {
  it('null ou vide = tous les signaux (regles anterieures a la colonne)', () => {
    expect(parseSignalFilter(null)).toEqual([...WATCHABLE_SIGNALS]);
    expect(parseSignalFilter('')).toEqual([...WATCHABLE_SIGNALS]);
  });

  it('lit une liste CSV et tolere les espaces', () => {
    expect(parseSignalFilter('reversal, dip')).toEqual(['reversal', 'dip']);
  });

  it('ignore les valeurs inconnues plutot que de casser la regle', () => {
    expect(parseSignalFilter('reversal,licorne')).toEqual(['reversal']);
  });

  it('une liste entierement invalide retombe sur tous les signaux', () => {
    expect(parseSignalFilter('licorne,dragon')).toEqual([...WATCHABLE_SIGNALS]);
  });
});

describe('serializeSignalFilter', () => {
  it('tout coche = null, pour suivre un futur ajout de signal', () => {
    expect(serializeSignalFilter([...WATCHABLE_SIGNALS])).toBeNull();
  });

  it('rien de coche = null plutot qu une regle qui ne declenche jamais', () => {
    expect(serializeSignalFilter([])).toBeNull();
  });

  it('conserve l ordre canonique, pas celui de la saisie', () => {
    expect(serializeSignalFilter(['dip', 'reversal'])).toBe('reversal,dip');
  });

  it('aller-retour stable', () => {
    expect(parseSignalFilter(serializeSignalFilter(['reversal', 'dip']))).toEqual(['reversal', 'dip']);
  });
});

describe('detectNewSignals', () => {
  const wanted = ['reversal', 'dip'] as const;

  it('signal apparu sur un scope qui n en portait aucun', () => {
    const out = detectNewSignals([scope('xlk', 'reversal')], {}, [...wanted]);
    expect(out).toHaveLength(1);
    expect(out[0].signal).toBe('reversal');
    expect(out[0].previous).toBeNull();
  });

  it('signal identique a la veille : pas une detection', () => {
    expect(detectNewSignals([scope('xlk', 'reversal')], { xlk: 'reversal' }, [...wanted])).toEqual([]);
  });

  it('changement de signal : detection avec le precedent', () => {
    const out = detectNewSignals([scope('xlk', 'reversal')], { xlk: 'dip' }, [...wanted]);
    expect(out[0].previous).toBe('dip');
  });

  it('signal hors filtre ignore', () => {
    expect(detectNewSignals([scope('xlk', 'accelerating')], {}, [...wanted])).toEqual([]);
  });

  it('scope sans signal ignore', () => {
    expect(detectNewSignals([scope('xlk', null)], {}, [...wanted])).toEqual([]);
  });

  it('un scope deja notifie aujourd hui ne repasse pas', () => {
    const out = detectNewSignals([scope('xlk', 'reversal')], {}, [...wanted], new Set(['xlk']));
    expect(out).toEqual([]);
  });

  it('la deduplication est par scope, pas globale', () => {
    const out = detectNewSignals(
      [scope('xlk', 'reversal'), scope('xle', 'dip')], {}, [...wanted], new Set(['xlk']),
    );
    expect(out.map((d) => d.scopeId)).toEqual(['xle']);
  });

  it('un signal precedent hors liste connue est traite comme absent', () => {
    const out = detectNewSignals([scope('xlk', 'reversal')], { xlk: 'obsolete' }, [...wanted]);
    expect(out[0].previous).toBeNull();
  });

  it('plusieurs secteurs detectes en une passe', () => {
    const out = detectNewSignals(
      [scope('xlk', 'reversal'), scope('xle', 'dip'), scope('xlv', 'exhaustion')],
      { xle: 'reversal' },
      [...wanted],
    );
    expect(out.map((d) => d.scopeId).sort()).toEqual(['xle', 'xlk']);
  });
});

describe('formatSignalMessage', () => {
  it('sans signal precedent', () => {
    expect(formatSignalMessage({
      scopeId: 'xlk', label: 'Technologie', signal: 'reversal', score: 72, previous: null,
    })).toBe('Technologie · Reversal — score 72/100');
  });

  it('avec transition', () => {
    expect(formatSignalMessage({
      scopeId: 'xlk', label: 'Technologie', signal: 'reversal', score: 72, previous: 'dip',
    })).toBe('Technologie · Reversal (depuis Dip) — score 72/100');
  });

  it('exhaustion est annonce comme un evitement', () => {
    expect(formatSignalMessage({
      scopeId: 'xle', label: 'Energie', signal: 'exhaustion', score: 40, previous: null,
    })).toContain("signal d'évitement");
  });
});
