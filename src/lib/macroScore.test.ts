import { describe, it, expect } from 'vitest';
import { calcMacroScore, norm, regimeFromScore, MACRO_WEIGHTS, type MacroInputs } from './macroScore';

function inputs(overrides: Partial<MacroInputs> = {}): MacroInputs {
  return {
    vix: null, yieldCurve: null, hyg1M: null, gld1M: null,
    copper1M: null, iwmVsSpy: null, dxy1M: null,
    ...overrides,
  };
}

describe('norm', () => {
  it('interpole linéairement entre low et high', () => {
    expect(norm(0, -1, 1)).toBe(0.5);
    expect(norm(1, -1, 1)).toBe(1);
    expect(norm(-1, -1, 1)).toBe(0);
  });

  it('clamp hors bornes', () => {
    expect(norm(10, -1, 1)).toBe(1);
    expect(norm(-10, -1, 1)).toBe(0);
  });

  it('échelle inversée (low > high) : valeur basse = score haut', () => {
    // Pattern VIX : norm(x, 35, 15) — VIX 15 = calme = 1, VIX 35 = stress = 0
    expect(norm(15, 35, 15)).toBe(1);
    expect(norm(35, 35, 15)).toBe(0);
    expect(norm(25, 35, 15)).toBe(0.5);
    expect(norm(50, 35, 15)).toBe(0); // clampé
  });
});

describe('calcMacroScore', () => {
  it('les pondérations somment à 1', () => {
    const sum = Object.values(MACRO_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('tous les indicateurs null → 50 (neutre)', () => {
    expect(calcMacroScore(inputs())).toBe(50);
  });

  it('conditions max risk-on → 100', () => {
    expect(calcMacroScore(inputs({
      vix: 15, yieldCurve: 1, hyg1M: 3, iwmVsSpy: 3,
      dxy1M: -3, copper1M: 5, gld1M: -3,
    }))).toBe(100);
  });

  it('conditions max risk-off → 0', () => {
    expect(calcMacroScore(inputs({
      vix: 35, yieldCurve: -1, hyg1M: -3, iwmVsSpy: -3,
      dxy1M: 3, copper1M: -5, gld1M: 5,
    }))).toBe(0);
  });

  it('un seul indicateur au max, le reste neutre à 50', () => {
    // VIX parfait : 100×0.25 + 50×0.75 = 62.5 → 63
    expect(calcMacroScore(inputs({ vix: 15 }))).toBe(63);
  });

  it('échelles inversées : VIX bas, DXY bas et or bas améliorent le score', () => {
    const base = calcMacroScore(inputs());
    expect(calcMacroScore(inputs({ vix: 18 }))).toBeGreaterThan(base);
    expect(calcMacroScore(inputs({ vix: 32 }))).toBeLessThan(base);
    expect(calcMacroScore(inputs({ dxy1M: -2 }))).toBeGreaterThan(base);
    expect(calcMacroScore(inputs({ dxy1M: 2 }))).toBeLessThan(base);
    expect(calcMacroScore(inputs({ gld1M: -2 }))).toBeGreaterThan(base);
    expect(calcMacroScore(inputs({ gld1M: 4 }))).toBeLessThan(base);
  });

  it('échelles directes : courbe, HYG, IWM/SPY, cuivre en hausse améliorent le score', () => {
    const base = calcMacroScore(inputs());
    expect(calcMacroScore(inputs({ yieldCurve: 0.8 }))).toBeGreaterThan(base);
    expect(calcMacroScore(inputs({ hyg1M: 2 }))).toBeGreaterThan(base);
    expect(calcMacroScore(inputs({ iwmVsSpy: 2 }))).toBeGreaterThan(base);
    expect(calcMacroScore(inputs({ copper1M: 4 }))).toBeGreaterThan(base);
  });

  it('reste borné [0, 100] sur des valeurs extrêmes', () => {
    const extreme = calcMacroScore(inputs({
      vix: 90, yieldCurve: -5, hyg1M: -20, iwmVsSpy: -20,
      dxy1M: 15, copper1M: -30, gld1M: 25,
    }));
    expect(extreme).toBe(0);
  });
});

describe('regimeFromScore', () => {
  it('seuils exacts : 75 / 55 / 40 / 25', () => {
    expect(regimeFromScore(75)).toBe('risk-on');
    expect(regimeFromScore(74)).toBe('favorable');
    expect(regimeFromScore(55)).toBe('favorable');
    expect(regimeFromScore(54)).toBe('neutral');
    expect(regimeFromScore(40)).toBe('neutral');
    expect(regimeFromScore(39)).toBe('unfavorable');
    expect(regimeFromScore(25)).toBe('unfavorable');
    expect(regimeFromScore(24)).toBe('risk-off');
    expect(regimeFromScore(0)).toBe('risk-off');
    expect(regimeFromScore(100)).toBe('risk-on');
  });
});
