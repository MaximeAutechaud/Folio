export type Phase = 'accumulation' | 'awareness' | 'momentum' | 'overheat' | 'blowoff';

export interface PhaseConfig {
  label: string;
  color: string;
  range: [number, number];
}

export const PHASES: Record<Phase, PhaseConfig> = {
  accumulation: { label: 'Accumulation', color: '#3b82f6', range: [0, 35] },
  awareness:    { label: 'Awareness',    color: '#10b981', range: [35, 60] },
  momentum:     { label: 'Momentum',     color: '#f59e0b', range: [60, 75] },
  overheat:     { label: 'Surchauffe',   color: '#f97316', range: [75, 88] },
  blowoff:      { label: 'Blow-off',     color: '#ef4444', range: [88, 100] },
};

export function scoreToPhase(score: number): Phase {
  if (score < 35) return 'accumulation';
  if (score < 60) return 'awareness';
  if (score < 75) return 'momentum';
  if (score < 88) return 'overheat';
  return 'blowoff';
}

export interface ScoreBreakdown {
  momentum:     { score: number | null; raw: number | null };
  technical:    { score: number | null; pctAboveMA200: number | null; avgRSI: number | null };
  sentiment:    { score: number | null };
  fundamentals: { score: number | null };
  composite: number;
  availableWeight: number;
}

type ScoreParams = {
  momentum30d: number | null;
  pctAboveMA200: number | null;
  avgRSI: number | null;
  sentimentScore: number | null;
  fundamentalsScore: number | null;
};

export function computeScoreBreakdown(params: ScoreParams): ScoreBreakdown {
  const { momentum30d, pctAboveMA200, avgRSI, sentimentScore, fundamentalsScore } = params;
  let total = 0, weight = 0;

  const momentumScore = momentum30d != null
    ? Math.round(Math.min(Math.max((momentum30d + 30) / 60 * 100, 0), 100))
    : null;
  if (momentumScore != null) { total += momentumScore * 0.30; weight += 0.30; }

  let techScore: number | null = null;
  if (pctAboveMA200 != null || avgRSI != null) {
    if (pctAboveMA200 != null && avgRSI != null)   techScore = Math.round(pctAboveMA200 * 0.5 + avgRSI * 0.5);
    else if (pctAboveMA200 != null)                techScore = Math.round(pctAboveMA200);
    else if (avgRSI != null)                       techScore = Math.round(avgRSI);
    if (techScore != null) { total += techScore * 0.20; weight += 0.20; }
  }

  const sentScore = sentimentScore != null ? Math.round(sentimentScore) : null;
  if (sentScore != null) { total += sentScore * 0.25; weight += 0.25; }

  const fundScore = fundamentalsScore != null ? Math.round(fundamentalsScore) : null;
  if (fundScore != null) { total += fundScore * 0.25; weight += 0.25; }

  return {
    momentum:     { score: momentumScore, raw: momentum30d },
    technical:    { score: techScore, pctAboveMA200, avgRSI },
    sentiment:    { score: sentScore },
    fundamentals: { score: fundScore },
    composite: weight > 0 ? Math.round(total / weight) : 50,
    availableWeight: weight,
  };
}

export function computeCompositeScore(params: ScoreParams): number {
  return computeScoreBreakdown(params).composite;
}
