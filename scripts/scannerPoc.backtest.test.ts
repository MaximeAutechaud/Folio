import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runBreakoutPoc } from '../src/lib/scannerPoc';
import { runAccelerationPoc } from '../src/lib/scannerAcceleration';
import { sectorEtf, MARKET_TICKER } from '../src/lib/universe';
import type { Bar } from '../src/lib/scanner';

interface Columns {
  t: number[];
  o: number[];
  v: number[];
  c: number[];
  vol: number[];
}

interface Snapshot {
  format?: 'columns';
  universe: { ticker: string; sectorId: string | null; source: string }[];
  series: Record<string, Bar[] | Columns>;
  errors: Record<string, string>;
}

/**
 * Les snapshots longs sont écrits en colonnes : sur quinze ans, un objet par
 * bougie dépasse les 400 Mo et met `JSON.parse` en limite de taille de chaîne.
 * Les snapshots courts restent au format historique.
 */
function toBars(snapshot: Snapshot): Record<string, Bar[]> {
  if (snapshot.format !== 'columns') return snapshot.series as Record<string, Bar[]>;
  const out: Record<string, Bar[]> = {};
  for (const [ticker, col] of Object.entries(snapshot.series as Record<string, Columns>)) {
    out[ticker] = col.t.map((time, i) => ({
      time,
      open: col.o[i],
      value: col.v[i],
      close: col.c[i],
      volume: col.vol[i],
    }));
  }
  return out;
}

const snapshotPath = process.env.SCANNER_BACKTEST_SNAPSHOT;
const mode = process.env.SCANNER_BACKTEST_MODE === 'acceleration' ? 'acceleration' : 'breakout';

interface CommonCluster {
  tickers: string[];
  score: number;
  cohesion: number;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Index temps → position, construit une fois par série. */
const barIndex = new WeakMap<Bar[], Map<number, number>>();
function indexOfTime(bars: Bar[], time: number): number {
  let index = barIndex.get(bars);
  if (!index) {
    index = new Map(bars.map((b, i) => [b.time, i]));
    barIndex.set(bars, index);
  }
  return index.get(time) ?? -1;
}

function perf(bars: Bar[], entryTime: number, horizon: number): number | null {
  const i = indexOfTime(bars, entryTime);
  if (i < 0 || i + 1 + horizon >= bars.length) return null;
  const entry = bars[i + 1].open;
  const exit = bars[i + 1 + horizon].value;
  return entry > 0 ? ((exit - entry) / entry) * 100 : null;
}

function clusterRelPerf(
  cluster: CommonCluster,
  series: Record<string, Bar[]>,
  signalTime: number,
  horizon: number,
): number | null {
  const member = cluster.tickers
    .map(t => perf(series[t] ?? [], signalTime, horizon))
    .filter((v): v is number => v != null);
  const spy = perf(series[MARKET_TICKER] ?? [], signalTime, horizon);
  const basket = mean(member);
  return basket != null && spy != null ? basket - spy : null;
}

/** Générateur reproductible : les contrôles doivent redonner le même chiffre. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(urn: string[], size: number, rng: () => number): string[] {
  if (urn.length <= size) return [...urn];
  const picked = new Set<number>();
  while (picked.size < size) picked.add(Math.floor(rng() * urn.length));
  return [...picked].map(i => urn[i]);
}

function overlap(a: string[], b: string[]): number {
  const aa = new Set(a);
  const bb = new Set(b);
  const intersection = [...aa].filter(x => bb.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function std(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

function forwardSummary(values: (number | null)[]) {
  const clean = values.filter((v): v is number => v != null);
  return {
    n: clean.length,
    mean: mean(clean),
    median: median(clean),
    // Sur quelques dizaines d'épisodes, la moyenne seule ne dit pas si un
    // groupe porte le résultat. L'écart-type est le minimum lisible.
    std: std(clean),
    winRate: clean.length ? clean.filter(x => x > 0).length / clean.length : null,
  };
}

describe.skipIf(!snapshotPath)(`backtest scanner POC ${mode} sur snapshot réel`, () => {
  // Le rejeu hors échantillon couvre ~3 600 séances contre 199 en in-sample.
  it('rejoue exactement le pipeline et rapporte les épisodes', { timeout: 3_600_000 }, () => {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath!, 'utf8')) as Snapshot;
    const series = toBars(snapshot);
    const sectorByTicker = new Map(snapshot.universe.map(x => [x.ticker, x.sectorId]));
    const controls = new Set(snapshot.universe.filter(x => x.source === 'control').map(x => x.ticker));
    const spy = series[MARKET_TICKER] ?? [];
    expect(spy.length).toBeGreaterThan(300);

    const sessions = spy.slice(260, -41);
    const previous = new Set<string>();
    const episodes: {
      date: string;
      time: number;
      cluster: CommonCluster;
      j20: number | null;
      j40: number | null;
      lastSeenSession: number;
      /** Urne du contrôle A : réservoir qualifié de la séance de détection. */
      pool: string[];
      /** Urne du contrôle B : univers éligible de la séance de détection. */
      universe: string[];
    }[] = [];
    let detectionDays = 0;
    let totalDailyClusters = 0;
    let totalCandidates = 0;
    let totalRawCandidates = 0;
    let totalReferenceUniverse = 0;

    // Fenêtre d'historique remise au moteur à chaque séance. Constante par
    // choix : le moteur ne regarde jamais au-delà de ~330 séances (260 de
    // profondeur minimale, 250 d'estimation des bêtas, 120 pour le plus haut),
    // et une fenêtre qui grandit ferait dépendre le résultat de la longueur du
    // snapshot. Rend aussi le coût par séance indépendant de la période.
    const WINDOW = 400;
    // Les séries sont croissantes : un curseur par ticker avance avec les
    // séances au lieu de refiltrer toute l'histoire à chaque fois. Sur quinze
    // ans le filtre complet coûterait des milliards d'opérations.
    const cursors = new Map<string, number>();
    for (const ticker of Object.keys(series)) cursors.set(ticker, 0);

    for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
      const session = sessions[sessionIndex];
      const truncated: Record<string, Bar[]> = {};
      for (const [ticker, bars] of Object.entries(series)) {
        let end = cursors.get(ticker)!;
        while (end < bars.length && bars[end].time <= session.time) end++;
        cursors.set(ticker, end);
        if (end) truncated[ticker] = bars.slice(Math.max(0, end - WINDOW), end);
      }
      const deps = {
        marketTicker: MARKET_TICKER,
        sectorOf: (t: string) => sectorByTicker.get(t) ?? null,
        etfOf: sectorEtf,
      };
      const result = mode === 'acceleration'
        ? runAccelerationPoc(truncated, t => controls.has(t), deps)
        : runBreakoutPoc(truncated, t => controls.has(t), deps);
      totalCandidates += result.candidates.length;
      totalRawCandidates += 'rawCandidateCount' in result ? result.rawCandidateCount : result.candidates.length;
      totalReferenceUniverse += 'referenceUniverse' in result ? result.referenceUniverse.length : 0;
      totalDailyClusters += result.clusters.length;
      if (result.clusters.length) detectionDays++;

      const pool = result.candidates.map(c => c.ticker);
      const universe = 'referenceUniverse' in result ? result.referenceUniverse : pool;

      const current = new Set<string>();
      for (const cluster of result.clusters) {
        const signature = cluster.tickers.join(',');
        current.add(signature);
        // Une narrative évolue : un membre entre ou sort sans que le phénomène
        // redevienne un nouvel épisode. Fusion si Jaccard >= 50 % et si le
        // groupe a été vu dans les cinq dernières séances.
        const continuation = episodes
          .filter(e => sessionIndex - e.lastSeenSession <= 5)
          .map(e => ({ episode: e, overlap: overlap(e.cluster.tickers, cluster.tickers) }))
          .sort((a, b) => b.overlap - a.overlap)[0];
        if (continuation && continuation.overlap >= 0.5) {
          continuation.episode.lastSeenSession = sessionIndex;
          continue;
        }
        if (previous.has(signature)) continue;
        episodes.push({
          date: new Date(session.time * 1000).toISOString().slice(0, 10),
          time: session.time,
          cluster,
          j20: clusterRelPerf(cluster, series, session.time, 20),
          j40: clusterRelPerf(cluster, series, session.time, 40),
          lastSeenSession: sessionIndex,
          pool,
          universe,
        });
      }
      previous.clear();
      for (const signature of current) previous.add(signature);
    }

    // ── Contrôles par tirage aléatoire apparié ────────────────────────────
    // Le backtest mesure la sortie de deux étapes empilées : un filtre
    // d'accélération, puis un regroupement par corrélation résiduelle. Les
    // contrôles rejouent les mêmes dates de détection avec des paniers de même
    // taille tirés au hasard, pour attribuer le résultat à l'une ou l'autre.
    //   A → urne = réservoir qualifié       : le clustering sélectionne-t-il ?
    //   A' → même urne, membres de la grappe retirés : variante sans contamination
    //   B → urne = univers éligible         : le filtre sélectionne-t-il ?
    // Le tirage réutilisant les mêmes dates, la date de détection n'est pas
    // créditée au scanner : B mesure ce que valait « être investi ces jours-là ».
    const DRAWS = 10_000;
    const perfCache = new Map<string, number | null>();
    function cachedPerf(ticker: string, time: number, horizon: number): number | null {
      const key = `${ticker}|${time}|${horizon}`;
      if (!perfCache.has(key)) perfCache.set(key, perf(series[ticker] ?? [], time, horizon));
      return perfCache.get(key)!;
    }
    function basketRelPerf(tickers: string[], time: number, horizon: number): number | null {
      const member = tickers
        .map(t => cachedPerf(t, time, horizon))
        .filter((v): v is number => v != null);
      const spy = cachedPerf(MARKET_TICKER, time, horizon);
      const basket = mean(member);
      return basket != null && spy != null ? basket - spy : null;
    }

    function control(urnOf: (e: typeof episodes[number]) => string[], seed: number) {
      const horizons = [20, 40] as const;
      const out: Record<string, unknown> = {};
      for (const horizon of horizons) {
        const observed = mean(
          episodes.map(e => (horizon === 20 ? e.j20 : e.j40)).filter((v): v is number => v != null),
        );
        // Une « stratégie synthétique » = un tirage par épisode, agrégé comme
        // l'est le scanner. Sa distribution donne le p-value empirique.
        const rng = mulberry32(seed);
        const syntheticMeans: number[] = [];
        const perEpisode: number[] = [];
        let beatenPerEpisode = 0;
        let comparablePerEpisode = 0;
        for (let d = 0; d < DRAWS; d++) {
          const drawn: number[] = [];
          for (const e of episodes) {
            const urn = urnOf(e);
            if (urn.length < 2) continue;
            const v = basketRelPerf(sample(urn, e.cluster.tickers.length, rng), e.time, horizon);
            if (v == null) continue;
            drawn.push(v);
            perEpisode.push(v);
            const own = horizon === 20 ? e.j20 : e.j40;
            if (own != null) {
              comparablePerEpisode++;
              if (own > v) beatenPerEpisode++;
            }
          }
          const m = mean(drawn);
          if (m != null) syntheticMeans.push(m);
        }
        const atLeastAsGood = observed == null
          ? null
          : syntheticMeans.filter(x => x >= observed).length / syntheticMeans.length;
        out[`j${horizon}`] = {
          observed,
          randomMean: mean(perEpisode),
          randomStd: std(syntheticMeans),
          // Part des tirages individuels que la grappe du jour a battus.
          clusterBeatsDrawRate: comparablePerEpisode ? beatenPerEpisode / comparablePerEpisode : null,
          // Part des stratégies synthétiques au moins aussi bonnes que le scanner.
          pValue: atLeastAsGood,
        };
      }
      return out;
    }

    const randomControls = {
      draws: DRAWS,
      averagePoolSize: mean(episodes.map(e => e.pool.length)),
      averageUniverseSize: mean(episodes.map(e => e.universe.length)),
      A_qualifiedPool: control(e => e.pool, 12345),
      A_qualifiedPoolExcludingCluster: control(
        e => e.pool.filter(t => !e.cluster.tickers.includes(t)),
        12345,
      ),
      B_eligibleUniverse: control(e => e.universe, 12345),
    };

    const candidates = episodes.filter(e => e.cluster.score >= 65);
    const confirmed = episodes.filter(e => e.cluster.score >= 80);
    const report = {
      source: {
        instruments: Object.keys(series).length,
        unresolved: Object.keys(snapshot.errors).length,
        spyBars: spy.length,
        from: new Date(spy[0].time * 1000).toISOString().slice(0, 10),
        to: new Date(spy[spy.length - 1].time * 1000).toISOString().slice(0, 10),
      },
      replay: {
        sessions: sessions.length,
        detectionDays,
        totalDailyClusters,
        averageCandidatesPerSession: sessions.length ? totalCandidates / sessions.length : 0,
        averageRawCandidatesPerSession: sessions.length ? totalRawCandidates / sessions.length : 0,
        averageReferenceUniversePerSession: sessions.length ? totalReferenceUniverse / sessions.length : 0,
        episodes: episodes.length,
      },
      clusters: {
        averageSize: mean(episodes.map(e => e.cluster.tickers.length)),
        medianSize: median(episodes.map(e => e.cluster.tickers.length)),
        averageScore: mean(episodes.map(e => e.cluster.score)),
        averageCohesion: mean(episodes.map(e => e.cluster.cohesion)),
        confirmed: episodes.filter(e => e.cluster.score >= 80).length,
        candidate: episodes.filter(e => e.cluster.score >= 65 && e.cluster.score < 80).length,
        observation: episodes.filter(e => e.cluster.score < 65).length,
      },
      forward: {
        all: {
          j20: forwardSummary(episodes.map(e => e.j20)),
          j40: forwardSummary(episodes.map(e => e.j40)),
        },
        score65: {
          j20: forwardSummary(candidates.map(e => e.j20)),
          j40: forwardSummary(candidates.map(e => e.j40)),
        },
        score80: {
          j20: forwardSummary(confirmed.map(e => e.j20)),
          j40: forwardSummary(confirmed.map(e => e.j40)),
        },
      },
      randomControls,
      episodes: episodes.map(e => ({
        date: e.date,
        tickers: e.cluster.tickers,
        score: e.cluster.score,
        cohesion: e.cluster.cohesion,
        j20: e.j20,
        j40: e.j40,
      })),
    };
    // `console.log` est intercepté par le runner : le rapport complet ne
    // survit pas à la sortie. On l'écrit quand un chemin est fourni.
    const out = process.env.SCANNER_BACKTEST_REPORT;
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(`SCANNER_POC_BACKTEST_${mode.toUpperCase()}=${JSON.stringify(report)}`);
    expect(report.replay.sessions).toBeGreaterThan(0);
  });
});
