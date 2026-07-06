import type { MacroProfile } from './sectors';

export type ScoreLabel  = 'hot' | 'warming' | 'neutral' | 'cooling';
export type SectorSignal = 'reversal' | 'exhaustion' | 'accelerating' | 'dip' | null;

export interface SectorScore {
  total: number;
  label: ScoreLabel;
  rsSlope: number;
  rsiEntry: number;
  drawdown: number;
  macroAlign: number;
  signal: SectorSignal;
  ma50Above: boolean | null;
}

export interface ScoreInput {
  relPerf1W: number | null;
  relPerf1M: number | null;
  relPerf3M: number | null;
  rsi: number | null;
  drawdown3M: number | null;
  drawdown6M: number | null;
  ma50Above: boolean | null;
  macroProfile: MacroProfile;
  macroScore: number;
  macroTrend: 'up' | 'down' | 'flat';
}

function calcRsSlopeScore(
  r1W: number | null,
  r1M: number | null,
  r3M: number | null,
): { score: number; shortAccel: number; reversal: boolean } {
  // shortAccel: this week's RS vs avg weekly pace of 1M
  const shortAccel = r1W != null && r1M != null ? r1W - r1M / 4 : 0;
  // medAccel: this month's RS vs avg monthly pace of 3M
  const medAccel   = r1M != null && r3M != null ? r1M - r3M / 3 : null;

  const combined =
    medAccel != null ? shortAccel * 0.6 + medAccel * 0.4 : shortAccel;

  // Normalize clamp [-5, +5] → [0, 100]
  const raw = Math.max(0, Math.min(100, (combined + 5) / 10 * 100));

  // Reversal: lagging 3M but outperforming this week
  const reversal = r3M != null && r1W != null && r3M < -1.5 && r1W > 0.5;
  const score = reversal ? Math.min(100, raw + 20) : raw;

  return { score: Math.round(score), shortAccel, reversal };
}

function calcRsiScore(rsi: number | null): number {
  if (rsi == null) return 50;
  if (rsi < 30) return 45;   // potential falling knife
  if (rsi < 40) return 85;   // recovering from oversold — great entry
  if (rsi < 55) return 100;  // sweet spot
  if (rsi < 65) return 75;   // healthy but getting extended
  if (rsi < 72) return 45;   // extended
  if (rsi < 80) return 20;   // overbought
  return 5;                   // very overbought
}

function calcDrawdownScore(dist: number | null): number {
  if (dist == null) return 50;
  if (dist >= -1)  return 50;   // at the high — extended, not ideal entry
  if (dist >= -3)  return 70;   // near high, some room
  if (dist >= -8)  return 100;  // ideal dip in uptrend
  if (dist >= -15) return 80;   // healthy pullback
  if (dist >= -22) return 35;   // deep correction
  return 10;                    // breakdown territory
}

function calcMacroAlignScore(
  profile: MacroProfile,
  macroScore: number,
  macroTrend: 'up' | 'down' | 'flat',
): number {
  if (profile === 'risk_on') {
    if (macroScore >= 65 && macroTrend === 'up') return 100;
    if (macroScore >= 55) return 75;
    if (macroScore >= 45) return 50;
    if (macroScore >= 35) return 25;
    return 10;
  }
  if (profile === 'defensive') {
    if (macroScore <= 35 && macroTrend === 'down') return 100;
    if (macroScore <= 45) return 75;
    if (macroScore <= 55) return 50;
    if (macroScore <= 65) return 25;
    return 10;
  }
  // neutral: slight lean based on macro direction
  return macroScore >= 50 ? 58 : 42;
}

// Profil macro d'une narrative-ETF : hérité du secteur parent, sauf quand la
// thèse du thème diverge du cycle de son secteur GICS. Sans override correct,
// macroAlign (15% du score) pénalise systématiquement le thème au mauvais moment.
export const NARRATIVE_MACRO_OVERRIDES: Record<string, MacroProfile> = {
  GDX: 'defensive', // minières d'or — montent en risk-off, à l'inverse de XLB (risk_on)
  NLR: 'neutral',   // nucléaire — demande structurelle datacenter, peu corrélé au cycle
};

export function narrativeMacroProfile(refEtf: string, parentProfile: MacroProfile): MacroProfile {
  return NARRATIVE_MACRO_OVERRIDES[refEtf] ?? parentProfile;
}

export function calcSectorScore(input: ScoreInput): SectorScore {
  const { score: rsSlopeScore, shortAccel, reversal } = calcRsSlopeScore(
    input.relPerf1W, input.relPerf1M, input.relPerf3M,
  );

  const rsi = input.rsi;

  // ── Signal detection (priority order) ──────────────────────────────────────

  // Exhaustion: was strong 3M, RS now decelerating, RSI still elevated
  const isExhaustion =
    (input.relPerf3M ?? 0) > 3 &&
    shortAccel < -0.5 &&
    (rsi ?? 50) > 62;

  // Reversal: lagging 3M, outperforming this week
  const isReversal = reversal && !isExhaustion;

  // Dip in uptrend: RS still improving, meaningful pullback, not overbought
  const isDip =
    !isExhaustion &&
    !isReversal &&
    shortAccel > 0 &&
    (input.drawdown3M ?? 0) <= -3 &&
    (input.drawdown3M ?? 0) >= -15 &&
    (rsi ?? 50) < 65;

  // Accelerating: RS clearly picking up speed, RSI not extended
  const isAccelerating =
    !isExhaustion &&
    !isReversal &&
    !isDip &&
    shortAccel > 1.0 &&
    (input.relPerf1W ?? 0) > 0.5 &&
    (rsi ?? 50) < 65;

  const signal: SectorSignal =
    isExhaustion   ? 'exhaustion'   :
    isReversal     ? 'reversal'     :
    isDip          ? 'dip'          :
    isAccelerating ? 'accelerating' :
    null;

  // ── Sub-scores ──────────────────────────────────────────────────────────────

  const ma50Above = input.ma50Above;

  const rsiBase = calcRsiScore(rsi);
  // Boost RSI score when reversal + RSI still recovering from oversold
  // Weaken the boost if price is still under MA50 (bounce in downtrend = less reliable)
  const reversalBoost = isReversal && rsi != null && rsi < 45
    ? (ma50Above === false ? 8 : 15)
    : 0;
  const rsiEntry = Math.min(100, rsiBase + reversalBoost);

  // Blend 3M (entry timing) with 6M (trend context), 60/40: a bounce inside a
  // 6M downtrend gets a deeply negative 6M distance → low 6M sub-score → the
  // blend stays modest instead of scoring 100 on the 3M rebound alone.
  const drawdownRaw =
    calcDrawdownScore(input.drawdown3M) * 0.6 +
    calcDrawdownScore(input.drawdown6M) * 0.4;
  // Dip score depends on two conditions:
  // 1. RS must be improving (not decelerating)
  // 2. Price should be above MA50 — dip below MA50 is a broken-support warning, not a buy
  const drawdown = Math.round(
    shortAccel < -0.5   ? drawdownRaw * 0.4 :  // RS decelerating: heavy discount
    ma50Above === false ? drawdownRaw * 0.6 :  // Under MA50: moderate discount
    drawdownRaw,                                // Clean dip in uptrend: full score
  );

  const macroAlign = calcMacroAlignScore(input.macroProfile, input.macroScore, input.macroTrend);

  // ── Total ───────────────────────────────────────────────────────────────────

  const rawTotal = Math.round(
    rsSlopeScore * 0.40 +
    rsiEntry     * 0.25 +
    drawdown     * 0.20 +
    macroAlign   * 0.15,
  );
  // Exhaustion penalty: cap the enthusiasm even if other metrics look ok
  const total = Math.max(0, Math.min(100, rawTotal + (isExhaustion ? -15 : 0)));

  const label: ScoreLabel =
    total >= 70 ? 'hot'     :
    total >= 52 ? 'warming' :
    total >= 38 ? 'neutral' :
    'cooling';

  return { total, label, rsSlope: rsSlopeScore, rsiEntry, drawdown, macroAlign, signal, ma50Above };
}
