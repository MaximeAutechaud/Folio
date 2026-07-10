import { describe, it, expect } from 'vitest';
import { evaluateEntryChecks, type EntryCheckInput } from './entryChecks';

function input(overrides: Partial<EntryCheckInput> = {}): EntryCheckInput {
  return {
    hasStop: true,
    riskPct: null,
    riskBudgetPct: 1,
    positionWeightPct: null,
    macroRegime: null,
    ...overrides,
  };
}

const ids = (i: EntryCheckInput) => evaluateEntryChecks(i).map(w => w.id);

describe('evaluateEntryChecks', () => {
  it('aucun warning quand tout est propre', () => {
    expect(evaluateEntryChecks(input({ riskPct: 0.5, positionWeightPct: 10, macroRegime: 'favorable' }))).toEqual([]);
  });

  it('no-stop : absence de stop loss', () => {
    expect(ids(input({ hasStop: false }))).toContain('no-stop');
  });

  it('risk-over-budget : strictement supérieur au budget (égal = OK)', () => {
    expect(ids(input({ riskPct: 1.5, riskBudgetPct: 1 }))).toContain('risk-over-budget');
    expect(ids(input({ riskPct: 1, riskBudgetPct: 1 }))).not.toContain('risk-over-budget');
    expect(ids(input({ riskPct: null }))).not.toContain('risk-over-budget');
  });

  it('concentration : strictement au-dessus de 25% du portefeuille', () => {
    expect(ids(input({ positionWeightPct: 30 }))).toContain('concentration');
    expect(ids(input({ positionWeightPct: 25 }))).not.toContain('concentration');
    expect(ids(input({ positionWeightPct: null }))).not.toContain('concentration');
  });

  it('macro-unfavorable : seulement pour unfavorable et risk-off', () => {
    expect(ids(input({ macroRegime: 'risk-off' }))).toContain('macro-unfavorable');
    expect(ids(input({ macroRegime: 'unfavorable' }))).toContain('macro-unfavorable');
    for (const ok of ['risk-on', 'favorable', 'neutral', null] as const) {
      expect(ids(input({ macroRegime: ok }))).not.toContain('macro-unfavorable');
    }
  });

  it('les warnings s accumulent', () => {
    const all = ids(input({
      hasStop: false,
      riskPct: 2, riskBudgetPct: 1,
      positionWeightPct: 40,
      macroRegime: 'risk-off',
    }));
    expect(all).toEqual(['no-stop', 'risk-over-budget', 'concentration', 'macro-unfavorable']);
  });
});
