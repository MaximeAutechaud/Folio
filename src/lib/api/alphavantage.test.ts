import { describe, it, expect } from 'vitest';
import { avNumber } from './alphavantage';

describe('avNumber', () => {
  it('parse une valeur numerique valide', () => {
    expect(avNumber('18.98')).toBeCloseTo(18.98, 9);
  });

  it('traite la chaine "None" comme une absence, pas comme NaN', () => {
    expect(avNumber('None')).toBeNull();
  });

  it('traite "-" comme une absence', () => {
    expect(avNumber('-')).toBeNull();
  });

  it('traite un champ omis comme une absence', () => {
    expect(avNumber(undefined)).toBeNull();
  });

  it('rejette une chaine non numerique sans la laisser filtrer en NaN', () => {
    expect(avNumber('n/a')).toBeNull();
  });
});
