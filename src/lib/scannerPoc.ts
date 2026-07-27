import {
  correlation,
  residualize,
  type Bar,
  type BuildInputsDeps,
} from './scanner';

/**
 * POC central pré-enregistré du scanner de cassures.
 *
 * Les seuils sont des priors d'ingénierie, pas des paramètres optimisés. Le but
 * est de vérifier qu'ils produisent des groupes rares, compacts et précoces
 * avant toute étude de performance.
 */
export const BREAKOUT_POC = {
  universe: {
    minPrice: 5,
    minMedianDollarVolume60: 10_000_000,
    minBars: 260,
  },
  breakout: {
    pivotBars: 120,
    maxBarsSinceBreakout: 10,
    baseBars: 120,
    maxBaseDepthPct: 35,
    emaBars: 50,
    emaSlopeLookback: 20,
    maxExtensionRangeUnits: 2,
    rejectExtensionRangeUnits: 3,
  },
  liquidity: {
    baselineBars: 60,
    impulseWindow: 5,
    impulseMinDays: 2,
    impulseMinZ: 1.5,
    impulseCumulativeRatio: 1.4,
    accumulationWindow: 10,
    accumulationMinDays: 4,
    accumulationMinZ: 1.0,
    accumulationCumulativeRatio: 1.3,
  },
  relativeStrength: {
    shortBars: 10,
    mediumBars: 20,
    longBars: 40,
    minResidualRankPercentile: 70,
    minRankImprovement: 15,
  },
  pool: {
    bars: 15,
  },
  cluster: {
    correlationBars: 60,
    minPairCorrelation: 0.40,
    minCohesion: 0.45,
    minMemberAverageCorrelation: 0.25,
    minSize: 3,
    confirmedSize: 4,
    maxSize: 12,
    maxBreakoutDispersionBars: 15,
    minBreakoutBreadth: 0.50,
    minLiquidityBreadth: 0.67,
  },
  alertScore: 65,
  confirmedScore: 80,
} as const;

export interface BreakoutCandidate {
  ticker: string;
  breakoutTime: number;
  barsSinceBreakout: number;
  baseline: number;
  liquidityZ: number;
  liquidityRatio: number;
  liquidityMode: 'impulse' | 'accumulation';
  distToHigh: number;
  extensionRangeUnits: number;
  extended: boolean;
  baseDepthPct: number;
  rsMarketSlope20: number;
  rsSectorSlope20: number;
  rsAcceleration: number;
  residualMomentum20: number;
  residualRankPercentile: number;
  rankImprovement: number;
}

export interface BreakoutCluster {
  tickers: string[];
  sectors: string[];
  cohesion: number;
  breakoutBreadth: number;
  liquidityBreadth: number;
  breakoutDispersionBars: number;
  averageMemberCorrelation: number;
  score: number;
  status: 'observation' | 'candidate' | 'confirmed';
}

export interface BreakoutPocResult {
  candidates: BreakoutCandidate[];
  clusters: BreakoutCluster[];
  dropped: string[];
}

interface AlignedPoint {
  time: number;
  stock: number;
  market: number;
  sector: number;
  marketIndex: number;
  sectorIndex: number;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function ema(values: number[], bars: number, end = values.length): number | null {
  if (end < bars) return null;
  const start = end - bars;
  const k = 2 / (bars + 1);
  let out = mean(values.slice(start, start + bars));
  // La fenêtre fait exactement `bars` valeurs : cette forme équivaut ici à une
  // moyenne exponentielle initialisée sur la première valeur puis lissée.
  out = values[start];
  for (let i = start + 1; i < end; i++) out = values[i] * k + out * (1 - k);
  return out;
}

function slope(values: number[]): number {
  if (values.length < 2) return 0;
  const mx = (values.length - 1) / 2;
  const my = mean(values);
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < values.length; i++) {
    const dx = i - mx;
    cov += dx * (values[i] - my);
    variance += dx * dx;
  }
  return variance ? cov / variance : 0;
}

function percentileRank(values: number[], value: number): number {
  if (!values.length) return 0;
  return (values.filter(v => v <= value).length / values.length) * 100;
}

function alignThree(stock: Bar[], market: Bar[], sector: Bar[]): AlignedPoint[] {
  const marketByTime = new Map(market.map((b, index) => [b.time, { value: b.value, index }]));
  const sectorByTime = new Map(sector.map((b, index) => [b.time, { value: b.value, index }]));
  const out: AlignedPoint[] = [];
  for (const b of stock) {
    const m = marketByTime.get(b.time);
    const s = sectorByTime.get(b.time);
    if (m != null && s != null) {
      out.push({
        time: b.time,
        stock: b.value,
        market: m.value,
        sector: s.value,
        marketIndex: m.index,
        sectorIndex: s.index,
      });
    }
  }
  return out;
}

function alignedResiduals(points: AlignedPoint[]): { time: number; value: number }[] {
  if (points.length < 3) return [];
  const stock: number[] = [];
  const market: number[] = [];
  const sector: number[] = [];
  const times: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    // Une bougie manquante crée sinon un rendement titre sur deux séances
    // comparé à un rendement benchmark sur une seule. Les deux index doivent
    // avancer exactement d'une séance pour que l'intervalle soit identique.
    if (cur.marketIndex !== prev.marketIndex + 1 || cur.sectorIndex !== prev.sectorIndex + 1) continue;
    stock.push(((cur.stock - prev.stock) / prev.stock) * 100);
    market.push(((cur.market - prev.market) / prev.market) * 100);
    sector.push(((cur.sector - prev.sector) / prev.sector) * 100);
    times.push(cur.time);
  }
  const residuals = residualize(stock, market, sector);
  return residuals.map((value, i) => ({ time: times[i], value }));
}

/** Rendements résiduels joints par timestamp, exposés pour la non-régression. */
export function alignedResidualReturns(
  stock: Bar[], market: Bar[], sector: Bar[],
): { time: number; value: number }[] {
  return alignedResiduals(alignThree(stock, market, sector));
}

function breakoutIndex(values: number[], pivotBars: number, maxAge: number): number {
  const from = Math.max(pivotBars, values.length - 1 - maxAge);
  for (let i = from; i < values.length; i++) {
    const pivot = Math.max(...values.slice(i - pivotBars, i));
    const previousPivot = i > pivotBars
      ? Math.max(...values.slice(i - pivotBars - 1, i - 1))
      : pivot;
    if (values[i] > pivot && values[i - 1] <= previousPivot) return i;
  }
  return -1;
}

function liquiditySignal(bars: Bar[]): {
  baseline: number;
  z: number;
  ratio: number;
  mode: 'impulse' | 'accumulation';
} | null {
  const p = BREAKOUT_POC.liquidity;
  const maxWindow = Math.max(p.impulseWindow, p.accumulationWindow);
  if (bars.length < p.baselineBars + maxWindow) return null;
  const dv = bars.map(b => b.value * b.volume);
  const recent = dv.slice(-maxWindow);
  const base = dv.slice(-(p.baselineBars + maxWindow), -maxWindow);
  const med = median(base);
  const mad = median(base.map(v => Math.abs(v - med)));
  if (med <= 0 || mad <= 0) return null;
  const scale = 1.4826 * mad;
  const z = recent.map(v => (v - med) / scale);

  const impulseDv = recent.slice(-p.impulseWindow);
  const impulseZ = z.slice(-p.impulseWindow);
  const impulseRatio = mean(impulseDv) / med;
  const impulse = impulseZ.filter(v => v >= p.impulseMinZ).length >= p.impulseMinDays
    && impulseRatio >= p.impulseCumulativeRatio;

  const accumulationRatio = mean(recent) / med;
  const accumulation = z.filter(v => v >= p.accumulationMinZ).length >= p.accumulationMinDays
    && accumulationRatio >= p.accumulationCumulativeRatio;

  if (!impulse && !accumulation) return null;
  const mode = impulse ? 'impulse' : 'accumulation';
  return {
    baseline: med,
    z: Math.max(...(impulse ? impulseZ : z)),
    ratio: impulse ? impulseRatio : accumulationRatio,
    mode,
  };
}

function evaluateCandidate(
  ticker: string,
  bars: Bar[],
  market: Bar[],
  sector: Bar[],
): Omit<BreakoutCandidate, 'residualRankPercentile' | 'rankImprovement'> | null {
  const u = BREAKOUT_POC.universe;
  const b = BREAKOUT_POC.breakout;
  if (bars.length < u.minBars || bars[bars.length - 1].value < u.minPrice) return null;

  const liq = liquiditySignal(bars);
  if (!liq || liq.baseline < u.minMedianDollarVolume60) return null;

  const values = bars.map(x => x.value);
  // Le réservoir conserve quinze séances de propagation. Les dix premières
  // comptent comme cassure fraîche ; les cinq suivantes peuvent fournir le
  // contexte du cluster sans gonfler sa breadth de fraîcheur.
  const iBreak = breakoutIndex(values, b.pivotBars, BREAKOUT_POC.pool.bars);
  if (iBreak < 0) return null;
  const age = values.length - 1 - iBreak;

  const base = values.slice(iBreak - b.baseBars, iBreak);
  const hi = Math.max(...base);
  const lo = Math.min(...base);
  const baseDepthPct = hi > 0 ? ((hi - lo) / hi) * 100 : Infinity;
  if (baseDepthPct > b.maxBaseDepthPct) return null;

  const emaNow = ema(values, b.emaBars);
  const emaBefore = ema(values, b.emaBars, values.length - b.emaSlopeLookback);
  const last = values[values.length - 1];
  if (emaNow == null || emaBefore == null || last <= emaNow || emaNow <= emaBefore) return null;

  const pivotAtBreakout = Math.max(...values.slice(iBreak - b.pivotBars, iBreak));
  const absoluteMoves = values.slice(-21).slice(1).map((v, i) => Math.abs(v - values[values.length - 21 + i]));
  const closeRange20 = mean(absoluteMoves);
  const extensionRangeUnits = closeRange20 > 0 ? (last - pivotAtBreakout) / closeRange20 : Infinity;

  const aligned = alignThree(bars, market, sector);
  if (aligned.length < b.pivotBars) return null;
  const rsMarket = aligned.map(x => x.stock / x.market);
  const rsSector = aligned.map(x => x.stock / x.sector);
  const rsMarketSlope20 = slope(rsMarket.slice(-BREAKOUT_POC.relativeStrength.mediumBars));
  const rsSectorSlope20 = slope(rsSector.slice(-BREAKOUT_POC.relativeStrength.mediumBars));
  const shortSlope = slope(rsSector.slice(-BREAKOUT_POC.relativeStrength.shortBars));
  const longSlope = slope(rsSector.slice(-BREAKOUT_POC.relativeStrength.longBars));
  const rsAcceleration = shortSlope - longSlope;
  if (rsMarketSlope20 <= 0 || rsSectorSlope20 <= 0 || rsAcceleration <= 0) return null;

  const residual = alignedResiduals(aligned);
  if (residual.length < BREAKOUT_POC.relativeStrength.mediumBars) return null;
  const residualMomentum20 = residual.slice(-BREAKOUT_POC.relativeStrength.mediumBars)
    .reduce((s, x) => s + x.value, 0);
  if (residualMomentum20 <= 0) return null;

  const high252 = Math.max(...values.slice(-252));
  return {
    ticker,
    breakoutTime: bars[iBreak].time,
    barsSinceBreakout: age,
    baseline: liq.baseline,
    liquidityZ: liq.z,
    liquidityRatio: liq.ratio,
    liquidityMode: liq.mode,
    distToHigh: high252 > 0 ? ((last - high252) / high252) * 100 : 0,
    extensionRangeUnits,
    extended: extensionRangeUnits > b.maxExtensionRangeUnits,
    baseDepthPct,
    rsMarketSlope20,
    rsSectorSlope20,
    rsAcceleration,
    residualMomentum20,
  };
}

function rankCandidates(
  raw: Omit<BreakoutCandidate, 'residualRankPercentile' | 'rankImprovement'>[],
): BreakoutCandidate[] {
  const momentum = raw.map(c => c.residualMomentum20);
  // Le POC n'a pas encore une série historique du rang transversal par titre.
  // `rankImprovement` emploie donc l'accélération de RS, classée transversalement,
  // comme proxy honnêtement nommé dans l'UI.
  const acceleration = raw.map(c => c.rsAcceleration);
  return raw.map(c => ({
    ...c,
    residualRankPercentile: percentileRank(momentum, c.residualMomentum20),
    rankImprovement: percentileRank(acceleration, c.rsAcceleration),
  })).filter(c =>
    c.residualRankPercentile >= BREAKOUT_POC.relativeStrength.minResidualRankPercentile
    && c.rankImprovement >= BREAKOUT_POC.relativeStrength.minRankImprovement
  );
}

function scoreCluster(
  members: BreakoutCandidate[],
  cohesion: number,
  averageMemberCorrelation: number,
  dispersion: number,
): number {
  const p = BREAKOUT_POC;
  const cohesionScore = clamp01((cohesion - p.cluster.minCohesion) / (0.75 - p.cluster.minCohesion));
  const breakoutBreadth = members.filter(m => m.barsSinceBreakout <= p.breakout.maxBarsSinceBreakout).length / members.length;
  const liquidityBreadth = members.filter(m => m.liquidityRatio >= 1.3).length / members.length;
  const liquidityScore = clamp01((mean(members.map(m => m.liquidityRatio)) - 1.3) / 0.7);
  const rankScore = clamp01((mean(members.map(m => m.residualRankPercentile)) - 70) / 30);
  const freshnessScore = clamp01(1 - dispersion / p.cluster.maxBreakoutDispersionBars);
  const compressionScore = clamp01(1 - mean(members.map(m => m.baseDepthPct)) / p.breakout.maxBaseDepthPct);
  const trendScore = clamp01(mean(members.map(m => m.rankImprovement)) / 100);
  return Math.round(
    cohesionScore * 25
    + breakoutBreadth * 20
    + liquidityScore * 20
    + rankScore * 15
    + freshnessScore * 10
    + compressionScore * 5
    + trendScore * 5
    + clamp01((averageMemberCorrelation - 0.25) / 0.5) * 0 // diagnostic, pas poids additionnel
    + liquidityBreadth * 0
  );
}

export function runBreakoutPoc(
  series: Record<string, Bar[]>,
  isControl: (ticker: string) => boolean,
  deps: BuildInputsDeps,
): BreakoutPocResult {
  const market = series[deps.marketTicker] ?? [];
  const dropped: string[] = [];
  const raw: Omit<BreakoutCandidate, 'residualRankPercentile' | 'rankImprovement'>[] = [];

  for (const [ticker, bars] of Object.entries(series)) {
    if (isControl(ticker)) continue;
    const sectorId = deps.sectorOf(ticker);
    const etf = sectorId ? deps.etfOf(sectorId) : null;
    const sector = etf ? series[etf] ?? [] : [];
    if (!sectorId || market.length < 60 || sector.length < 60) {
      dropped.push(ticker);
      continue;
    }
    const candidate = evaluateCandidate(ticker, bars, market, sector);
    if (candidate) raw.push(candidate);
  }

  const candidates = rankCandidates(raw);
  const byTicker = new Map(candidates.map(c => [c.ticker, c]));
  const residualByTicker = new Map<string, { time: number; value: number }[]>();
  for (const c of candidates) {
    const sectorId = deps.sectorOf(c.ticker)!;
    const etf = deps.etfOf(sectorId)!;
    residualByTicker.set(
      c.ticker,
      alignedResidualReturns(series[c.ticker], market, series[etf] ?? [])
        .slice(-BREAKOUT_POC.cluster.correlationBars),
    );
  }

  const n = candidates.length;
  const corr = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = residualByTicker.get(candidates[i].ticker) ?? [];
      const b = residualByTicker.get(candidates[j].ticker) ?? [];
      const bByTime = new Map(b.map(x => [x.time, x.value]));
      const av: number[] = [];
      const bv: number[] = [];
      for (const x of a) {
        const y = bByTime.get(x.time);
        if (y != null) { av.push(x.value); bv.push(y); }
      }
      const value = av.length >= 20 ? correlation(av, bv) : 0;
      corr[i][j] = value;
      corr[j][i] = value;
    }
  }

  const seen = new Array(n).fill(false);
  const clusters: BreakoutCluster[] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const group: number[] = [];
    const queue = [i];
    seen[i] = true;
    while (queue.length) {
      const cur = queue.shift()!;
      group.push(cur);
      for (let j = 0; j < n; j++) {
        if (!seen[j] && corr[cur][j] >= BREAKOUT_POC.cluster.minPairCorrelation) {
          seen[j] = true;
          queue.push(j);
        }
      }
    }
    if (group.length < BREAKOUT_POC.cluster.minSize || group.length > BREAKOUT_POC.cluster.maxSize) continue;

    const memberAverage = group.map(a =>
      mean(group.filter(b => b !== a).map(b => corr[a][b]))
    );
    if (memberAverage.some(v => v < BREAKOUT_POC.cluster.minMemberAverageCorrelation)) continue;
    const pairValues: number[] = [];
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) pairValues.push(corr[group[a]][group[b]]);
    }
    const cohesion = mean(pairValues);
    if (cohesion < BREAKOUT_POC.cluster.minCohesion) continue;

    const members = group.map(k => byTicker.get(candidates[k].ticker)!);
    const times = members.map(m => m.breakoutTime).sort((a, b) => a - b);
    const uniqueTradingTimes = [...new Set(
      members.flatMap(m => (series[m.ticker] ?? []).map(x => x.time))
    )].sort((a, b) => a - b);
    const first = uniqueTradingTimes.indexOf(times[0]);
    const last = uniqueTradingTimes.indexOf(times[times.length - 1]);
    const dispersion = first >= 0 && last >= 0 ? last - first : Infinity;
    if (dispersion > BREAKOUT_POC.cluster.maxBreakoutDispersionBars) continue;

    const breakoutBreadth = members.filter(m => m.barsSinceBreakout <= BREAKOUT_POC.breakout.maxBarsSinceBreakout).length / members.length;
    const liquidityBreadth = members.filter(m => m.liquidityRatio >= 1.3).length / members.length;
    if (breakoutBreadth < BREAKOUT_POC.cluster.minBreakoutBreadth
      || liquidityBreadth < BREAKOUT_POC.cluster.minLiquidityBreadth) continue;

    const averageMemberCorrelation = mean(memberAverage);
    const score = scoreCluster(members, cohesion, averageMemberCorrelation, dispersion);
    const status = score >= BREAKOUT_POC.confirmedScore
      ? 'confirmed'
      : score >= BREAKOUT_POC.alertScore ? 'candidate' : 'observation';
    clusters.push({
      tickers: members.map(m => m.ticker).sort(),
      sectors: [...new Set(members.map(m => deps.sectorOf(m.ticker)).filter((s): s is string => !!s))].sort(),
      cohesion,
      breakoutBreadth,
      liquidityBreadth,
      breakoutDispersionBars: dispersion,
      averageMemberCorrelation,
      score,
      status,
    });
  }

  return {
    candidates: candidates.sort((a, b) => b.residualRankPercentile - a.residualRankPercentile),
    clusters: clusters.sort((a, b) => b.score - a.score),
    dropped,
  };
}
