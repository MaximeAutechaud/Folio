import {
  correlation,
  findClusters,
  type Bar,
  type BuildInputsDeps,
  type ClusterInput,
} from './scanner';
import { alignedResidualReturns } from './scannerPoc';

/**
 * Paramètres du moteur d'accélération.
 * La période 2024-2026 a déjà été vue par le POC cassure : ce comparatif reste
 * in-sample. La v2 retire les rangs des portes d'entrée après que la v1 a mesuré
 * qu'ils supprimaient 82 % du réservoir avant clustering.
 */
export const ACCELERATION_POC = {
  universe: {
    minPrice: 5,
    minMedianDollarVolume60: 10_000_000,
    minBars: 260,
  },
  regime: {
    emaBars: 50,
    emaSlopeLookback: 20,
    highBars: 120,
    maxDistanceToHighPct: -10,
  },
  acceleration: {
    shortBars: 10,
    mediumBars: 20,
    longBars: 40,
    minNormalizedAcceleration: 0.5,
    minTrueDays: 3,
    persistenceWindow: 5,
  },
  relativeStrength: {
    // Métriques de tri, plus filtres. Le scanner route de l'attention : un rang
    // moyen ne doit pas empêcher trois titres cohérents de former une piste.
    referenceAccelerationPercentile: 70,
    referenceResidualMomentumPercentile: 60,
  },
  liquidity: {
    baselineBars: 60,
    impulseWindow: 5,
    impulseMinDays: 2,
    impulseMinZ: 1.5,
    impulseRatio: 1.3,
    accumulationWindow: 10,
    accumulationMinDays: 4,
    accumulationMinZ: 0.8,
    accumulationRatio: 1.2,
    validityBars: 10,
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
    maxSize: 12,
    maxQualificationDispersion: 15,
    // Part du groupe qui accélère encore à la dernière séance. Mesuré sur
    // `passesNow` et non sur `trueDays`, qui est déjà une condition d'admission
    // et rendait donc ce critère toujours vrai.
    minAccelerationBreadth: 0.50,
    // Fraîcheur moyenne de la qualification de liquidité, sur l'échelle
    // `validityBars`. 0,50 = âge moyen inférieur à cinq séances.
    minLiquidityFreshness: 0.50,
  },
} as const;

export interface AccelerationCandidate {
  ticker: string;
  qualificationTime: number;
  trueDays: number;
  baseline: number;
  liquidityRatio: number;
  liquidityZ: number;
  liquidityAge: number;
  distToHighPct: number;
  /** Conditions d'accélération encore vraies à la dernière séance. */
  passesNow: boolean;
  normalizedAcceleration: number;
  rsMarketSlope20: number;
  rsSectorSlope20: number;
  residualMomentum20: number;
  accelerationPercentile: number;
  residualMomentumPercentile: number;
}

export interface AccelerationCluster {
  tickers: string[];
  sectors: string[];
  cohesion: number;
  averageMemberCorrelation: number;
  qualificationDispersionBars: number;
  accelerationBreadth: number;
  liquidityFreshness: number;
  score: number;
}

export interface AccelerationResult {
  /** Avant les deux filtres de rang transversal. Diagnostic de sélectivité. */
  rawCandidateCount: number;
  /**
   * Distribution de référence des percentiles. Les rangs sont calculés sur
   * l'univers éligible de la séance et non sur le seul réservoir qualifié,
   * sinon un jour à quatre candidats produit quatre percentiles proches de 100
   * et les scores ne sont plus comparables d'une séance à l'autre. Exposée
   * nominativement : c'est aussi l'urne du contrôle par tirage aléatoire.
   */
  referenceUniverse: string[];
  candidates: AccelerationCandidate[];
  clusters: AccelerationCluster[];
  dropped: string[];
}

function mean(v: number[]): number {
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function std(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

function slope(v: number[]): number {
  if (v.length < 2) return 0;
  const mx = (v.length - 1) / 2;
  const my = mean(v);
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < v.length; i++) {
    cov += (i - mx) * (v[i] - my);
    variance += (i - mx) ** 2;
  }
  return variance ? cov / variance : 0;
}

function ema(v: number[], bars: number, end = v.length): number | null {
  if (end < bars) return null;
  const start = end - bars;
  const k = 2 / (bars + 1);
  let out = v[start];
  for (let i = start + 1; i < end; i++) out = v[i] * k + out * (1 - k);
  return out;
}

function percentile(values: number[], value: number): number {
  return values.length ? values.filter(x => x <= value).length / values.length * 100 : 0;
}

function returns(v: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < v.length; i++) out.push(v[i - 1] ? (v[i] / v[i - 1] - 1) * 100 : 0);
  return out;
}

function byTime(bars: Bar[]): Map<number, Bar> {
  return new Map(bars.map(b => [b.time, b]));
}

function alignedValues(stock: Bar[], market: Bar[], sector: Bar[], endTime: number) {
  const mm = byTime(market);
  const sm = byTime(sector);
  const own: number[] = [];
  const marketValues: number[] = [];
  const sectorValues: number[] = [];
  for (const b of stock) {
    if (b.time > endTime) break;
    const m = mm.get(b.time);
    const s = sm.get(b.time);
    if (!m || !s) continue;
    own.push(b.value);
    marketValues.push(m.value);
    sectorValues.push(s.value);
  }
  return { own, market: marketValues, sector: sectorValues };
}

function accelerationAt(stock: Bar[], market: Bar[], sector: Bar[], endTime: number) {
  const p = ACCELERATION_POC;
  const x = alignedValues(stock, market, sector, endTime);
  if (x.own.length < p.universe.minBars) return null;
  const logPrice = x.own.map(Math.log);
  const dailyVol = std(returns(x.own).slice(-20));
  if (dailyVol <= 0) return null;
  // Pentes de log-prix converties en points de % par séance, puis normalisées
  // par la volatilité journalière récente.
  const short = slope(logPrice.slice(-p.acceleration.shortBars)) * 100;
  const long = slope(logPrice.slice(-p.acceleration.longBars)) * 100;
  const normalized = (short - long) / dailyVol;
  const rsMarket = x.own.map((v, i) => Math.log(v / x.market[i]));
  const rsSector = x.own.map((v, i) => Math.log(v / x.sector[i]));
  const rsMarketSlope20 = slope(rsMarket.slice(-p.acceleration.mediumBars));
  const rsSectorSlope20 = slope(rsSector.slice(-p.acceleration.mediumBars));
  return {
    normalized,
    rsMarketSlope20,
    rsSectorSlope20,
    passes: normalized >= p.acceleration.minNormalizedAcceleration
      && rsMarketSlope20 > 0
      && rsSectorSlope20 > 0,
  };
}

function recentLiquidity(bars: Bar[]) {
  const p = ACCELERATION_POC.liquidity;
  const dv = bars.map(b => b.value * b.volume);
  for (let age = 0; age < p.validityBars; age++) {
    const end = dv.length - age;
    const maxWindow = Math.max(p.impulseWindow, p.accumulationWindow);
    if (end < p.baselineBars + maxWindow) continue;
    const recent = dv.slice(end - maxWindow, end);
    const base = dv.slice(end - maxWindow - p.baselineBars, end - maxWindow);
    const med = median(base);
    const mad = median(base.map(x => Math.abs(x - med)));
    if (med <= 0 || mad <= 0) continue;
    const scale = 1.4826 * mad;
    const z = recent.map(x => (x - med) / scale);
    const impulse = recent.slice(-p.impulseWindow);
    const impulseRatio = mean(impulse) / med;
    const impulseOk = z.slice(-p.impulseWindow).filter(x => x >= p.impulseMinZ).length >= p.impulseMinDays
      && impulseRatio >= p.impulseRatio;
    const accumulationRatio = mean(recent) / med;
    const accumulationOk = z.filter(x => x >= p.accumulationMinZ).length >= p.accumulationMinDays
      && accumulationRatio >= p.accumulationRatio;
    if (impulseOk || accumulationOk) {
      return {
        baseline: med,
        ratio: impulseOk ? impulseRatio : accumulationRatio,
        z: Math.max(...z),
        age,
      };
    }
  }
  return null;
}

type RawCandidate = Omit<
  AccelerationCandidate, 'accelerationPercentile' | 'residualMomentumPercentile'
>;

/** Mesure transversale d'un instrument, indépendante des portes d'admission. */
interface Measured {
  ticker: string;
  stock: Bar[];
  sector: Bar[];
  current: NonNullable<ReturnType<typeof accelerationAt>>;
  residualMomentum20: number;
  /** Éligible à la distribution de référence des percentiles. */
  inReference: boolean;
}

/**
 * Socle investissable servant de dénominateur aux rangs transversaux : prix,
 * profondeur d'historique et dollar-volume médian courant. Volontairement
 * disjoint des portes d'admission, qui restent inchangées.
 */
function inReferenceUniverse(stock: Bar[]): boolean {
  const p = ACCELERATION_POC;
  if (stock.length < p.universe.minBars) return false;
  if (stock[stock.length - 1].value < p.universe.minPrice) return false;
  const dv = stock.slice(-p.liquidity.baselineBars).map(b => b.value * b.volume);
  return median(dv) >= p.universe.minMedianDollarVolume60;
}

function rawCandidate(
  ticker: string, stock: Bar[], market: Bar[], sector: Bar[],
  current: NonNullable<ReturnType<typeof accelerationAt>>,
  residualMomentum20: number,
): RawCandidate | null {
  const p = ACCELERATION_POC;
  if (stock.length < p.universe.minBars || stock[stock.length - 1].value < p.universe.minPrice) return null;
  const values = stock.map(b => b.value);
  const last = values[values.length - 1];
  const high = Math.max(...values.slice(-p.regime.highBars));
  const distToHighPct = (last / high - 1) * 100;
  if (distToHighPct < p.regime.maxDistanceToHighPct) return null;
  const emaNow = ema(values, p.regime.emaBars);
  const emaBefore = ema(values, p.regime.emaBars, values.length - p.regime.emaSlopeLookback);
  if (emaNow == null || emaBefore == null || last <= emaNow || emaNow <= emaBefore) return null;

  const liquidity = recentLiquidity(stock);
  if (!liquidity || liquidity.baseline < p.universe.minMedianDollarVolume60) return null;

  let trueDays = 0;
  let qualificationTime = 0;
  for (let age = p.acceleration.persistenceWindow - 1; age >= 0; age--) {
    const i = stock.length - 1 - age;
    const stat = accelerationAt(stock, market, sector, stock[i].time);
    if (stat?.passes) {
      trueDays++;
      if (trueDays === p.acceleration.minTrueDays) qualificationTime = stock[i].time;
    }
  }
  if (trueDays < p.acceleration.minTrueDays) return null;

  return {
    ticker,
    qualificationTime,
    trueDays,
    baseline: liquidity.baseline,
    liquidityRatio: liquidity.ratio,
    liquidityZ: liquidity.z,
    liquidityAge: liquidity.age,
    distToHighPct,
    passesNow: current.passes,
    normalizedAcceleration: current.normalized,
    rsMarketSlope20: current.rsMarketSlope20,
    rsSectorSlope20: current.rsSectorSlope20,
    residualMomentum20,
  };
}

function alignedCorrelation(
  a: { time: number; value: number }[],
  b: { time: number; value: number }[],
): number {
  const bm = new Map(b.map(x => [x.time, x.value]));
  const av: number[] = [];
  const bv: number[] = [];
  for (const x of a) {
    const y = bm.get(x.time);
    if (y != null) { av.push(x.value); bv.push(y); }
  }
  return av.length >= 20 ? correlation(av, bv) : 0;
}

export function runAccelerationPoc(
  series: Record<string, Bar[]>,
  isControl: (ticker: string) => boolean,
  deps: BuildInputsDeps,
): AccelerationResult {
  const market = series[deps.marketTicker] ?? [];
  const dropped: string[] = [];

  // Passe 1 : mesurer tout l'univers, admission comprise ou non. C'est cette
  // passe qui fournit le dénominateur des percentiles.
  const measured: Measured[] = [];
  for (const [ticker, stock] of Object.entries(series)) {
    if (isControl(ticker)) continue;
    const sectorId = deps.sectorOf(ticker);
    const etf = sectorId ? deps.etfOf(sectorId) : null;
    const sector = etf ? series[etf] ?? [] : [];
    if (!sectorId || market.length < 60 || sector.length < 60) {
      dropped.push(ticker);
      continue;
    }
    if (!stock.length) continue;
    const current = accelerationAt(stock, market, sector, stock[stock.length - 1].time);
    if (!current) continue;
    const residual = alignedResidualReturns(stock, market, sector);
    measured.push({
      ticker,
      stock,
      sector,
      current,
      residualMomentum20: residual.slice(-20).reduce((s, x) => s + x.value, 0),
      inReference: inReferenceUniverse(stock),
    });
  }

  const reference = measured.filter(m => m.inReference);
  const accelerations = reference.map(m => m.current.normalized);
  const momentums = reference.map(m => m.residualMomentum20);

  // Passe 2 : portes d'admission, inchangées.
  const raw: RawCandidate[] = [];
  for (const m of measured) {
    const c = rawCandidate(m.ticker, m.stock, market, m.sector, m.current, m.residualMomentum20);
    if (c) raw.push(c);
  }

  const candidates: AccelerationCandidate[] = raw.map(c => ({
    ...c,
    accelerationPercentile: percentile(accelerations, c.normalizedAcceleration),
    residualMomentumPercentile: percentile(momentums, c.residualMomentum20),
  }));

  const residuals = new Map<string, { time: number; value: number }[]>();
  const inputs: ClusterInput[] = [];
  for (const c of candidates) {
    const sectorId = deps.sectorOf(c.ticker)!;
    const etf = deps.etfOf(sectorId)!;
    const r = alignedResidualReturns(series[c.ticker], market, series[etf] ?? [])
      .slice(-ACCELERATION_POC.cluster.correlationBars);
    residuals.set(c.ticker, r);
    inputs.push({ ticker: c.ticker, sectorId, residuals: r.map(x => x.value) });
  }

  const baseClusters = findClusters(inputs, {
    minCorrelation: ACCELERATION_POC.cluster.minPairCorrelation,
    minCohesion: ACCELERATION_POC.cluster.minCohesion,
    minSize: ACCELERATION_POC.cluster.minSize,
    minSectors: 1,
  });
  const byTicker = new Map(candidates.map(c => [c.ticker, c]));
  const clusters: AccelerationCluster[] = [];
  for (const base of baseClusters) {
    if (base.tickers.length > ACCELERATION_POC.cluster.maxSize) continue;
    const pair: number[] = [];
    const memberAverages: number[] = [];
    for (let i = 0; i < base.tickers.length; i++) {
      const own: number[] = [];
      for (let j = 0; j < base.tickers.length; j++) {
        if (i === j) continue;
        const c = alignedCorrelation(residuals.get(base.tickers[i])!, residuals.get(base.tickers[j])!);
        own.push(c);
        if (j > i) pair.push(c);
      }
      memberAverages.push(mean(own));
    }
    if (memberAverages.some(x => x < ACCELERATION_POC.cluster.minMemberAverageCorrelation)) continue;
    const cohesion = mean(pair);
    if (cohesion < ACCELERATION_POC.cluster.minCohesion) continue;
    const members = base.tickers.map(t => byTicker.get(t)!);
    const times = members.map(m => m.qualificationTime).sort((a, b) => a - b);
    const reference = market.map(b => b.time);
    const dispersion = Math.abs(reference.indexOf(times[times.length - 1]) - reference.indexOf(times[0]));
    if (dispersion > ACCELERATION_POC.cluster.maxQualificationDispersion) continue;
    const accelerationBreadth = members.filter(m => m.passesNow).length / members.length;
    const liquidityFreshness = mean(
      members.map(m => 1 - m.liquidityAge / ACCELERATION_POC.liquidity.validityBars),
    );
    if (accelerationBreadth < ACCELERATION_POC.cluster.minAccelerationBreadth
      || liquidityFreshness < ACCELERATION_POC.cluster.minLiquidityFreshness) continue;
    const score = Math.round(
      mean(members.map(m => m.accelerationPercentile)) * 0.25
      + mean(members.map(m => m.residualMomentumPercentile)) * 0.20
      + Math.min(100, cohesion / 0.75 * 100) * 0.20
      + accelerationBreadth * 100 * 0.15
      + Math.min(100, mean(members.map(m => m.liquidityRatio)) / 2 * 100) * 0.10
      + mean(members.map(m => m.trueDays / ACCELERATION_POC.acceleration.persistenceWindow * 100)) * 0.10
    );
    clusters.push({
      tickers: [...base.tickers].sort(),
      sectors: base.sectors,
      cohesion,
      averageMemberCorrelation: mean(memberAverages),
      qualificationDispersionBars: dispersion,
      accelerationBreadth,
      liquidityFreshness,
      score,
    });
  }
  return {
    rawCandidateCount: raw.length,
    referenceUniverse: reference.map(m => m.ticker),
    candidates: candidates.sort((a, b) => b.accelerationPercentile - a.accelerationPercentile),
    clusters: clusters.sort((a, b) => b.score - a.score),
    dropped,
  };
}
