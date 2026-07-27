/**
 * Test forward de la breadth de constituants — hypothèse déclarée avant le run.
 *
 * ## VERDICT (2026-07-27) : FERMÉ
 *
 * Q5−Q1 = **−0,36 pt** à J+20 (p = 0,85, IC95 % [−0,69 ; +0,22]), signe inverse
 * de l'hypothèse et non significatif dans l'autre sens non plus. Surtout : les
 * trois variables donnent le même spread (résiduelle −0,36 / brute −0,38 /
 * momentum seul −0,30), donc la breadth n'apporte rien au-delà du prix de
 * l'ETF. Les 68-72 % de variance indépendante mesurés par
 * `breadth.analysis.test.ts` sont réels — ils ne portent simplement aucune
 * information sur le futur.
 *
 * La variante **intra-secteur**, déclarée après cet échec et tirée une seule
 * fois, ferme aussi : **−0,32 pt** (p = 0,87, IC95 % [−0,74 ; +0,21]). Retirer
 * toute la dérive sectorielle ne déplace l'écart que de 0,05 pt — le défaut de
 * spécification était réel et n'était pas la cause. Détail dans
 * `docs/BREADTH-CONSTITUANTS.md`.
 *
 * ## Ce qui est pré-enregistré
 *
 * **Hypothèse** : la breadth sectorielle (% de constituants au-dessus de leur
 * MA50), **résidualisée du momentum de l'ETF**, a un pouvoir prédictif sur la
 * performance relative à J+20. Directionnelle : une breadth plus forte que ce
 * que le prix implique annonce une meilleure performance relative.
 *
 * **Critère d'arrêt** : écart Q5−Q1 de la breadth résiduelle **< 0,20 pt** à
 * J+20 sur la passe primaire ⇒ fermé. Sans réglage, sans deuxième découpe.
 *
 * **Périmètre** : 2009 → 2021-12-31 pour l'émission (les fenêtres forward se
 * résolvent dans 2022Q1), secteurs à ≥ 90 constituants uniquement. La cartouche
 * hors échantillon ≥ 2022 n'est pas consultée comme période de test.
 *
 * ## Trois précautions que le POC précédent a rendues obligatoires
 *
 * 1. **Bêta glissant, pas plein échantillon.** Résidualiser avec un bêta estimé
 *    sur toute la série ferait fuiter le futur dans le régresseur. Estimé sur
 *    250 séances glissantes, comme `alignedResiduals` après correction.
 * 2. **Entrée à l'ouverture J+1.** La classification se lit sur la clôture de
 *    J, on ne peut pas entrer à ce prix. C'est cette correction qui avait fait
 *    apparaître le gap payé sur `accelerating`.
 * 3. **n effectif, pas n de lignes.** Des fenêtres J+20 quotidiennes se
 *    chevauchent et 5 secteurs sont corrélés. Le point estimé est calculé sur
 *    tout, mais l'incertitude vient d'un bootstrap par **bloc de dates**
 *    (stride 20, toutes les séries d'une date tirées ensemble), qui neutralise
 *    les deux effets à la fois.
 *
 *   SCANNER_BACKTEST_SNAPSHOT=... npx vitest run scripts/breadth.forward.test.ts
 */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { breadthDelta, breadthSeries, etfMomentum } from '../src/lib/breadth';
import { beta } from '../src/lib/scanner';
import { MARKET_TICKER, sectorEtf } from '../src/lib/universe';
import type { Bar } from '../src/lib/scanner';

interface Columns { t: number[]; o: number[]; v: number[]; c: number[]; vol: number[] }
interface Snapshot {
  format?: 'columns';
  universe: { ticker: string; sectorId: string | null; source: string }[];
  series: Record<string, Bar[] | Columns>;
}

function toBars(snapshot: Snapshot): Record<string, Bar[]> {
  if (snapshot.format !== 'columns') return snapshot.series as Record<string, Bar[]>;
  const out: Record<string, Bar[]> = {};
  for (const [ticker, col] of Object.entries(snapshot.series as Record<string, Columns>)) {
    out[ticker] = col.t.map((time, i) => ({
      time, open: col.o[i], value: col.v[i], close: col.c[i], volume: col.vol[i],
    }));
  }
  return out;
}

// ── Paramètres figés ─────────────────────────────────────────────────────────

const PRIMARY = ['xli', 'xlf', 'xlk', 'xly', 'xlv'];
const MA = 50;
const LOOKBACK = 20;
const BETA_WINDOW = 250;
const HORIZONS = [5, 20, 40];
const DECISION_HORIZON = 20;
const THRESHOLD = 0.20;
const EMISSION_END = Date.UTC(2021, 11, 31) / 1000;
const STRIDE = 20;
const BOOTSTRAP = 2000;

function mean(v: number[]): number {
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
}

function stdev(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Résidu de `y` sur `x` avec un bêta estimé sur les `window` observations qui
 * précèdent — jamais sur la série entière, qui contiendrait le futur.
 */
function rollingResidual(y: number[], x: number[], window: number): (number | null)[] {
  return y.map((value, i) => {
    if (i < window) return null;
    const k = beta(y.slice(i - window, i), x.slice(i - window, i));
    return value - k * x[i];
  });
}

/** Performance entre l'ouverture de J+1 et la clôture de J+1+horizon, en %. */
function perf(bars: Bar[], index: Map<number, number>, time: number, horizon: number): number | null {
  const i = index.get(time);
  if (i === undefined || i + 1 + horizon >= bars.length) return null;
  const entry = bars[i + 1].open;
  return entry > 0 ? ((bars[i + 1 + horizon].value - entry) / entry) * 100 : null;
}

interface Observation {
  time: number;
  sector: string;
  breadthRaw: number;
  momentum: number;
  breadthResid: number;
  forward: Record<number, number | null>;
}

/**
 * Variante intra-secteur, **déclarée après l'échec de la passe principale et
 * tirée une seule fois** (cf. en-tête). Les quintiles sont classés à
 * l'intérieur de chaque secteur, puis moyennés à poids égal entre secteurs.
 *
 * L'appartenance à un quintile ne peut donc plus corréler avec le secteur, et
 * la dérive sectorielle 2010-2021 s'annule : chaque secteur pèse autant dans Q1
 * que dans Q5. C'est la seule faiblesse de spécification identifiée sur la
 * passe principale.
 *
 * Un secteur sans observation exploitable est écarté plutôt que compté zéro —
 * sinon il tirerait tous les quintiles vers le bas de la même quantité, ce qui
 * ne changerait pas l'écart mais fausserait les niveaux affichés.
 */
function quintilesWithinSector(obs: Observation[], key: (o: Observation) => number, horizon: number) {
  const sectors = [...new Set(obs.map(o => o.sector))].sort();
  const perSector = sectors
    .map(s => quintiles(obs.filter(o => o.sector === s), key, horizon))
    .filter(q => q.n >= 5);
  if (!perSector.length) return { means: [0, 0, 0, 0, 0], spread: 0, n: 0 };
  const means = Array.from({ length: 5 }, (_, q) => mean(perSector.map(p => p.means[q])));
  return {
    means: means.map(m => Number(m.toFixed(3))),
    spread: means[4] - means[0],
    n: perSector.reduce((s, p) => s + p.n, 0),
  };
}

/** Moyenne de `forward` par quintile de `key`, et écart Q5−Q1. */
function quintiles(obs: Observation[], key: (o: Observation) => number, horizon: number) {
  const usable = obs.filter(o => o.forward[horizon] != null);
  const sorted = [...usable].sort((a, b) => key(a) - key(b));
  const size = Math.floor(sorted.length / 5);
  const means: number[] = [];
  for (let q = 0; q < 5; q++) {
    const slice = q === 4 ? sorted.slice(4 * size) : sorted.slice(q * size, (q + 1) * size);
    means.push(mean(slice.map(o => o.forward[horizon] as number)));
  }
  return { means: means.map(m => Number(m.toFixed(3))), spread: means[4] - means[0], n: usable.length };
}

/**
 * Bootstrap par bloc de dates : on tire des dates non chevauchantes avec
 * remise, en emportant les cinq secteurs de chaque date. Neutralise à la fois
 * le chevauchement des fenêtres et la corrélation transversale.
 */
function bootstrapSpread(
  obs: Observation[],
  key: (o: Observation) => number,
  horizon: number,
  seed: number,
  grouper: typeof quintiles = quintiles,
): { p: number; ci: [number, number] } {
  const dates = [...new Set(obs.map(o => o.time))].sort((a, b) => a - b);
  const kept = new Set(dates.filter((_, i) => i % STRIDE === 0));
  const byDate = new Map<number, Observation[]>();
  for (const o of obs) {
    if (!kept.has(o.time) || o.forward[horizon] == null) continue;
    byDate.set(o.time, [...(byDate.get(o.time) ?? []), o]);
  }
  const blocks = [...byDate.values()];
  const rng = mulberry32(seed);
  const spreads: number[] = [];
  for (let b = 0; b < BOOTSTRAP; b++) {
    const draw: Observation[] = [];
    for (let i = 0; i < blocks.length; i++) draw.push(...blocks[Math.floor(rng() * blocks.length)]);
    spreads.push(grouper(draw, key, horizon).spread);
  }
  spreads.sort((a, b) => a - b);
  const positive = spreads.filter(s => s > 0).length;
  return {
    p: Number((1 - positive / spreads.length).toFixed(4)),
    ci: [
      Number(spreads[Math.floor(0.025 * spreads.length)].toFixed(3)),
      Number(spreads[Math.floor(0.975 * spreads.length)].toFixed(3)),
    ],
  };
}

const snapshotPath = process.env.SCANNER_BACKTEST_SNAPSHOT;

describe.skipIf(!snapshotPath)('pouvoir prédictif de la breadth', () => {
  it('mesure l’apport incrémental au-delà du momentum de l’ETF', () => {
    const snapshot: Snapshot = JSON.parse(fs.readFileSync(snapshotPath!, 'utf8'));
    const series = toBars(snapshot);
    const spy = series[MARKET_TICKER];
    const spyIndex = new Map(spy.map((b, i) => [b.time, i]));

    const bySector = new Map<string, Bar[][]>();
    for (const entry of snapshot.universe) {
      if (entry.source === 'control' || !entry.sectorId) continue;
      if (!PRIMARY.includes(entry.sectorId)) continue;
      const bars = series[entry.ticker];
      if (!bars?.length) continue;
      bySector.set(entry.sectorId, [...(bySector.get(entry.sectorId) ?? []), bars]);
    }

    const observations: Observation[] = [];
    for (const [sector, members] of bySector) {
      const etfTicker = sectorEtf(sector)!;
      const etf = series[etfTicker];
      const etfIndex = new Map(etf.map((b, i) => [b.time, i]));
      const timeline = etf.map(b => b.time);

      const breadth = breadthSeries(members, timeline, MA);
      const rawAll = breadthDelta(breadth, LOOKBACK);
      const momAll = etfMomentum(etf, LOOKBACK);

      // Le résidu glissant a besoin de séries denses : on restreint aux indices
      // où les deux grandeurs existent, puis on reprojette sur les dates.
      const dense: { time: number; raw: number; mom: number }[] = [];
      for (let i = 0; i < timeline.length; i++) {
        const raw = rawAll[i];
        const mom = momAll[i];
        if (raw == null || mom == null) continue;
        dense.push({ time: timeline[i], raw, mom });
      }
      const resid = rollingResidual(dense.map(d => d.raw), dense.map(d => d.mom), BETA_WINDOW);

      for (let i = 0; i < dense.length; i++) {
        const r = resid[i];
        if (r == null || dense[i].time > EMISSION_END) continue;
        const forward: Record<number, number | null> = {};
        for (const h of HORIZONS) {
          const sectorPerf = perf(etf, etfIndex, dense[i].time, h);
          const marketPerf = perf(spy, spyIndex, dense[i].time, h);
          forward[h] = sectorPerf != null && marketPerf != null ? sectorPerf - marketPerf : null;
        }
        observations.push({
          time: dense[i].time,
          sector,
          breadthRaw: dense[i].raw,
          momentum: dense[i].mom,
          breadthResid: r,
          forward,
        });
      }
    }

    const variants: [string, (o: Observation) => number][] = [
      ['breadthResid', o => o.breadthResid],
      ['breadthRaw', o => o.breadthRaw],
      ['momentum', o => o.momentum],
    ];

    const results: Record<string, unknown>[] = [];
    for (const [name, key] of variants) {
      for (const h of HORIZONS) {
        const q = quintiles(observations, key, h);
        const decisive = name === 'breadthResid' && h === DECISION_HORIZON;
        results.push({
          variant: name,
          horizon: h,
          n: q.n,
          quintiles: q.means,
          spread: Number(q.spread.toFixed(3)),
          ...(decisive ? bootstrapSpread(observations, key, h, 20260727) : {}),
        });
      }
    }

    // Variante intra-secteur — déclarée avant ce tirage, tirée une seule fois.
    const withinSector: Record<string, unknown>[] = [];
    for (const [name, key] of variants) {
      for (const h of HORIZONS) {
        const q = quintilesWithinSector(observations, key, h);
        const decisive = name === 'breadthResid' && h === DECISION_HORIZON;
        withinSector.push({
          variant: name,
          horizon: h,
          n: q.n,
          quintiles: q.means,
          spread: Number(q.spread.toFixed(3)),
          ...(decisive
            ? bootstrapSpread(observations, key, h, 20260727, quintilesWithinSector)
            : {}),
        });
      }
    }

    const baseline: Record<string, number> = {};
    for (const h of HORIZONS) {
      const v = observations.map(o => o.forward[h]).filter((x): x is number => x != null);
      baseline[`J+${h}`] = Number(mean(v).toFixed(3));
      baseline[`sd J+${h}`] = Number(stdev(v).toFixed(2));
    }

    const decisive = (rows: Record<string, unknown>[]) =>
      rows.find(r => r.variant === 'breadthResid' && r.horizon === DECISION_HORIZON)!;
    const verdict = (rows: Record<string, unknown>[]) =>
      (decisive(rows).spread as number) >= THRESHOLD ? 'FRANCHIT' : 'FERME';

    const report = {
      preregistre: { hypothese: 'breadth résiduelle > momentum ETF', horizon: DECISION_HORIZON, seuil: THRESHOLD },
      perimetre: { secteurs: PRIMARY, ma: MA, lookback: LOOKBACK, betaWindow: BETA_WINDOW, emissionEnd: '2021-12-31' },
      observations: observations.length,
      dates: new Set(observations.map(o => o.time)).size,
      baseline,
      results,
      verdict: verdict(results),
      withinSector,
      verdictWithinSector: verdict(withinSector),
    };
    const out = process.env.BREADTH_REPORT;
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    expect(observations.length).toBeGreaterThan(0);
  }, 900_000);
});
