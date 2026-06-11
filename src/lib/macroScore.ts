export type Regime = 'risk-on' | 'favorable' | 'neutral' | 'unfavorable' | 'risk-off';

export interface MacroInputs {
  vix: number | null;
  yieldCurve: number | null;
  hyg1M: number | null;
  gld1M: number | null;
  copper1M: number | null;
  iwmVsSpy: number | null;
  dxy1M: number | null;
}

export const MACRO_WEIGHTS = {
  vix: 0.25, curve: 0.20, hyg: 0.15, iwm: 0.15, dxy: 0.10, copper: 0.10, gold: 0.05,
} as const;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function norm(x: number, low: number, high: number): number {
  return clamp01((x - low) / (high - low));
}

export function calcMacroScore(inputs: MacroInputs): number {
  const { vix, yieldCurve, hyg1M, gld1M, copper1M, iwmVsSpy, dxy1M } = inputs;
  const W = MACRO_WEIGHTS;
  return Math.round(
    (vix        != null ? norm(vix,        35, 15) * 100 : 50) * W.vix    +
    (yieldCurve != null ? norm(yieldCurve, -1,  1) * 100 : 50) * W.curve  +
    (hyg1M      != null ? norm(hyg1M,      -3,  3) * 100 : 50) * W.hyg   +
    (iwmVsSpy   != null ? norm(iwmVsSpy,   -3,  3) * 100 : 50) * W.iwm   +
    (dxy1M      != null ? norm(dxy1M,       3, -3) * 100 : 50) * W.dxy   +
    (copper1M   != null ? norm(copper1M,   -5,  5) * 100 : 50) * W.copper +
    (gld1M      != null ? norm(gld1M,       5, -3) * 100 : 50) * W.gold
  );
}

export function regimeFromScore(score: number): Regime {
  return score >= 75 ? 'risk-on'     :
         score >= 55 ? 'favorable'   :
         score >= 40 ? 'neutral'     :
         score >= 25 ? 'unfavorable' :
         'risk-off';
}
