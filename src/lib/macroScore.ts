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

// ── Fenêtres glissantes ──────────────────────────────────────────────────────
// Centralisées ici plutôt que dupliquées dans useMacroScore : le moteur
// d'alertes en a besoin pour recalculer le macro à une date de clôture passée,
// et deux implémentations divergeraient tôt ou tard.

export const DAY = 86400;
export type Point = { time: number; value: number };

function perfBetween(h: Point[]): number | null {
  if (h.length < 2) return null;
  const start = h[0].value;
  return start ? ((h[h.length - 1].value - start) / start) * 100 : null;
}

/**
 * Performance sur `windowDays`, la fenêtre se terminant `endDaysAgo` jours avant
 * `nowSec`. `nowSec` explicite permet de rejouer le calcul à une date passée —
 * indispensable pour que le log et une reconstruction donnent le même resultat.
 */
export function perfWindow(
  h: Point[], windowDays: number, endDaysAgo = 0, nowSec = Date.now() / 1000,
): number | null {
  if (h.length < 2) return null;
  const end = nowSec - endDaysAgo * DAY;
  const start = end - windowDays * DAY;
  return perfBetween(h.filter(p => p.time >= start && p.time <= end));
}

/** Dernière clôture connue à `daysAgo` jours avant `nowSec`. */
export function valueAt(
  h: Point[], daysAgo: number, nowSec = Date.now() / 1000,
): number | null {
  if (h.length === 0) return null;
  const target = nowSec - daysAgo * DAY;
  let v: number | null = null;
  for (const p of h) {
    if (p.time <= target) v = p.value;
    else break;
  }
  return v ?? h[0].value;
}

export interface MacroAsOf {
  score: number;
  scorePrev: number | null;
  trend: 'up' | 'down' | 'flat';
}

/**
 * Score macro tel qu'il était à `nowSec`, et sa tendance vs une semaine avant.
 * Mêmes fenêtres que le calcul live (`useMacroScore`), la seule différence
 * étant la date de référence : à `nowSec = maintenant` les deux coïncident.
 */
export function computeMacroAt(
  hist: Record<string, Point[]>, nowSec: number,
): MacroAsOf {
  const inputs = (back: number): MacroInputs => {
    const tnx = valueAt(hist['^TNX'] ?? [], back, nowSec);
    const irx = valueAt(hist['^IRX'] ?? [], back, nowSec);
    const spy = perfWindow(hist['SPY'] ?? [], 30, back, nowSec);
    const iwm = perfWindow(hist['IWM'] ?? [], 30, back, nowSec);
    return {
      vix: valueAt(hist['^VIX'] ?? [], back, nowSec),
      yieldCurve: tnx != null && irx != null ? tnx - irx : null,
      hyg1M: perfWindow(hist['HYG'] ?? [], 30, back, nowSec),
      gld1M: perfWindow(hist['GLD'] ?? [], 30, back, nowSec),
      copper1M: perfWindow(hist['HG=F'] ?? [], 30, back, nowSec),
      dxy1M: perfWindow(hist['DX-Y.NYB'] ?? [], 30, back, nowSec),
      iwmVsSpy: iwm != null && spy != null ? iwm - spy : null,
    };
  };

  const score = calcMacroScore(inputs(0));
  // Il faut ~37 jours d'historique pour qu'une fenêtre 1M finissant il y a une
  // semaine existe reellement (meme garde que useMacroScore).
  const earliest = hist['SPY']?.[0]?.time ?? Infinity;
  const scorePrev = (nowSec - earliest) / DAY >= 37 ? calcMacroScore(inputs(7)) : null;

  const trend: MacroAsOf['trend'] =
    scorePrev == null ? 'flat' :
    score - scorePrev >= 3 ? 'up' :
    score - scorePrev <= -3 ? 'down' : 'flat';

  return { score, scorePrev, trend };
}

export function regimeFromScore(score: number): Regime {
  return score >= 75 ? 'risk-on'     :
         score >= 55 ? 'favorable'   :
         score >= 40 ? 'neutral'     :
         score >= 25 ? 'unfavorable' :
         'risk-off';
}
