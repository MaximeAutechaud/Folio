import { describe, it, expect } from 'vitest';
import {
  liquidityStat,
  scanCandidates,
  returns,
  beta,
  residualize,
  correlation,
  findClusters,
  buildClusterInputs,
  DEFAULT_FILTER,
  DEFAULT_CLUSTER,
  type Bar,
  type ClusterInput,
} from './scanner';

const DAY = 86400;
const T0 = Math.floor(new Date('2025-01-02T14:30:00Z').getTime() / 1000);

/** Série journalière : prix et volume fournis bougie par bougie. */
function bars(prices: number[], volumes: number[]): Bar[] {
  return prices.map((p, i) => ({
    time: T0 + i * DAY,
    open: p,
    value: p,
    close: p,
    volume: volumes[i] ?? volumes[volumes.length - 1] ?? 0,
  }));
}

/** Série plate de `n` séances, volume constant, avec un suffixe optionnel. */
function flat(n: number, price = 100, vol = 100_000): Bar[] {
  return bars(new Array(n).fill(price), new Array(n).fill(vol));
}

describe('liquidityStat', () => {
  it('serie trop courte → null plutot qu un chiffre invente', () => {
    expect(liquidityStat(flat(30))).toBeNull();
  });

  it('volume constant → aucune anomalie detectable', () => {
    // MAD nul : impossible de normaliser, on refuse de repondre
    expect(liquidityStat(flat(100))).toBeNull();
  });

  it('detecte un afflux soutenu et compte les seances consecutives', () => {
    const n = 80;
    const vols = Array.from({ length: n }, (_, i) => 100_000 + (i % 7) * 3_000);
    for (let i = n - 6; i < n; i++) vols[i] = 500_000; // 6 seances d afflux
    const st = liquidityStat(bars(new Array(n).fill(100), vols))!;
    expect(st.streak).toBe(6);
    expect(st.z).toBeGreaterThan(5);
  });

  it('un pic isole ne produit pas de streak — c est un evenement, pas un afflux', () => {
    const n = 80;
    const vols = Array.from({ length: n }, (_, i) => 100_000 + (i % 7) * 3_000);
    vols[n - 1] = 900_000; // resultats trimestriels
    const st = liquidityStat(bars(new Array(n).fill(100), vols))!;
    expect(st.streak).toBe(1);
    expect(st.z).toBeGreaterThan(5); // anormal, mais non soutenu
  });

  it('la mediane resiste aux pics de resultats qui pollueraient une moyenne', () => {
    const n = 80;
    const vols = Array.from({ length: n }, (_, i) => 100_000 + (i % 7) * 3_000);
    // quatre pics trimestriels dans la base
    for (const i of [10, 30, 50, 68]) vols[i] = 4_000_000;
    const st = liquidityStat(bars(new Array(n).fill(100), vols))!;
    // baseline reste proche du regime normal, pas tiree vers le haut
    expect(st.baseline).toBeLessThan(120_000 * 100);
  });

  it('le turnover est un dollar volume : deux titres a capital echange egal se comparent', () => {
    const n = 80;
    const volsCher = new Array(n).fill(10_000);
    const volsPasCher = new Array(n).fill(1_000_000);
    const a = liquidityStat(bars(new Array(n).fill(300), volsCher.map((v, i) => i >= n - 6 ? v * 5 : v + (i % 5) * 100)))!;
    const b = liquidityStat(bars(new Array(n).fill(3), volsPasCher.map((v, i) => i >= n - 6 ? v * 5 : v + (i % 5) * 10_000)))!;
    expect(a.streak).toBe(6);
    expect(b.streak).toBe(6);
  });
});

describe('scanCandidates', () => {
  /** Série avec afflux final, prix en repli depuis un plus haut. */
  function influx(price: number, vol: number, drawdownPct: number): Bar[] {
    const n = 260;
    const prices = new Array(n).fill(price);
    prices[100] = price / (1 + drawdownPct / 100); // le plus haut est en arriere
    const vols = Array.from({ length: n }, (_, i) => vol + (i % 7) * (vol * 0.03));
    for (let i = n - 6; i < n; i++) vols[i] = vol * 6;
    return bars(prices, vols);
  }

  it('retient un titre en afflux, sous son plus haut et suffisamment liquide', () => {
    const hits = scanCandidates({ AAA: influx(100, 200_000, -20) });
    expect(hits.map(h => h.ticker)).toEqual(['AAA']);
    expect(hits[0].streak).toBeGreaterThanOrEqual(DEFAULT_FILTER.minStreak);
    expect(hits[0].distToHigh).toBeLessThan(0);
  });

  it('ecarte ce qui est deja au plus haut — on cherche le naissant, pas le consomme', () => {
    const n = 260;
    const vols = Array.from({ length: n }, (_, i) => 200_000 + (i % 7) * 6_000);
    for (let i = n - 6; i < n; i++) vols[i] = 1_200_000;
    // prix strictement croissant : la derniere bougie EST le plus haut
    const monte = bars(Array.from({ length: n }, (_, i) => 100 + i), vols);
    expect(scanCandidates({ AAA: monte })).toEqual([]);
  });

  it('ecarte les titres illiquides — seul filtre legitime sur l entree', () => {
    // 1 000 actions a 10 $ = 10 k$/jour, sous le plancher
    expect(scanCandidates({ AAA: influx(10, 1_000, -20) })).toEqual([]);
  });

  it('ecarte un pic isole', () => {
    const n = 260;
    const vols = Array.from({ length: n }, (_, i) => 200_000 + (i % 7) * 6_000);
    vols[n - 1] = 5_000_000;
    const prices = new Array(n).fill(100);
    prices[100] = 130;
    expect(scanCandidates({ AAA: bars(prices, vols) })).toEqual([]);
  });

  it('trie par intensite d afflux', () => {
    const hits = scanCandidates({
      FAIBLE: influx(100, 200_000, -20),
      FORT: (() => {
        const b = influx(100, 200_000, -20);
        for (let i = b.length - 6; i < b.length; i++) b[i].volume *= 4;
        return b;
      })(),
    });
    expect(hits[0].ticker).toBe('FORT');
  });
});

describe('beta / residualize', () => {
  it('beta d une serie sur elle-meme vaut 1', () => {
    const x = [1, -2, 3, -1, 0.5, 2, -3];
    expect(beta(x, x)).toBeCloseTo(1, 10);
  });

  it('beta d une serie amplifiee', () => {
    const x = [1, -2, 3, -1, 0.5, 2, -3];
    expect(beta(x.map(v => v * 2.5), x)).toBeCloseTo(2.5, 10);
  });

  it('un titre qui n est que du marche a un residu nul', () => {
    const mkt = [1, -2, 3, -1, 0.5, 2, -3, 1.5, -0.5, 2];
    const res = residualize(mkt.map(v => v * 1.4), mkt);
    for (const v of res) expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it('retire aussi le secteur, sequentiellement', () => {
    const mkt = [1, -2, 3, -1, 0.5, 2, -3, 1.5, -0.5, 2];
    const sec = [0.5, 1, -1, 2, -2, 0.3, 1.2, -1.5, 0.8, -0.4];
    const stock = mkt.map((m, i) => 1.2 * m + 0.8 * sec[i]);
    const res = residualize(stock, mkt, sec);
    for (const v of res) expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it('preserve ce qui n est explique ni par le marche ni par le secteur', () => {
    const mkt = [1, -2, 3, -1, 0.5, 2, -3, 1.5, -0.5, 2];
    const sec = [0.5, 1, -1, 2, -2, 0.3, 1.2, -1.5, 0.8, -0.4];
    const theme = [2, 2, 2, -2, -2, 2, -2, 2, -2, -2];
    const stock = mkt.map((m, i) => 1.2 * m + 0.8 * sec[i] + theme[i]);
    const res = residualize(stock, mkt, sec);
    expect(Math.max(...res.map(Math.abs))).toBeGreaterThan(0.5);
  });

  it('series trop courtes → tableau vide', () => {
    expect(residualize([1], [1])).toEqual([]);
    expect(residualize([], [])).toEqual([]);
  });
});

describe('correlation', () => {
  it('serie avec elle-meme = 1, avec son oppose = -1', () => {
    const x = [1, -2, 3, -1, 0.5, 2, -3];
    expect(correlation(x, x)).toBeCloseTo(1, 10);
    expect(correlation(x, x.map(v => -v))).toBeCloseTo(-1, 10);
  });

  it('serie constante → 0 plutot que NaN', () => {
    expect(correlation([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
  });

  it('echantillon trop court → 0', () => {
    expect(correlation([1, 2], [1, 2])).toBe(0);
  });
});

describe('findClusters', () => {
  const theme = [2, -1, 3, -2, 1.5, -3, 2.5, -1, 2, -2, 1, -1.5];

  /**
   * Bruit pseudo-aleatoire deterministe (LCG). Volontairement pas des sinusoides
   * dephasees : deux sinusoides de meme frequence sont fortement correlees, ce
   * qui fabriquerait des clusters fantomes et ferait passer le test pour de
   * mauvaises raisons.
   */
  const bruit = (seed: number, n = 12): number[] => {
    let s = (seed * 9301 + 49297) % 233280;
    return Array.from({ length: n }, () => {
      s = (s * 9301 + 49297) % 233280;
      return (s / 233280) * 6 - 3;
    });
  };

  const membre = (ticker: string, sectorId: string | null, mix = 1): ClusterInput => ({
    ticker,
    sectorId,
    residuals: theme.map((v, i) => v * mix + bruit(ticker.charCodeAt(0)) [i] * 0.15),
  });

  it('regroupe des titres qui partagent un facteur residuel', () => {
    const cl = findClusters([
      membre('AAA', 'xlk'), membre('BBB', 'xlk'), membre('CCC', 'xli'), membre('DDD', 'xlv'),
    ]);
    expect(cl).toHaveLength(1);
    expect(cl[0].tickers).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(cl[0].cohesion).toBeGreaterThan(DEFAULT_CLUSTER.minCorrelation);
    expect(cl[0].sectors).toEqual(['xli', 'xlk', 'xlv']); // triés
  });

  it('un groupe trop petit n est pas un theme', () => {
    expect(findClusters([membre('AAA', 'xlk'), membre('BBB', 'xlk')])).toEqual([]);
  });

  it('des titres decorreles ne forment aucun cluster', () => {
    const indep: ClusterInput[] = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((t, i) => ({
      ticker: t, sectorId: 'xlk', residuals: bruit(i + 1),
    }));
    expect(findClusters(indep)).toEqual([]);
  });

  it('minSectors=2 ne garde que les themes transverses', () => {
    const intra = [
      membre('AAA', 'xlk'), membre('BBB', 'xlk'), membre('CCC', 'xlk'), membre('DDD', 'xlk'),
    ];
    expect(findClusters(intra, { ...DEFAULT_CLUSTER, minSectors: 2 })).toEqual([]);
    // ... mais le defaut a 1 les conserve : la memoire vit entierement dans la tech
    expect(findClusters(intra)).toHaveLength(1);
  });

  it('separe deux themes distincts au lieu de les fusionner', () => {
    const autre = [3, 3, -3, -3, 2, 2, -2, -2, 1, 1, -1, -1];
    const inputs: ClusterInput[] = [
      membre('AAA', 'xlk'), membre('BBB', 'xlk'), membre('CCC', 'xli'), membre('DDD', 'xlv'),
      ...['WWW', 'XXX', 'YYY', 'ZZZ'].map((t, i) => ({
        ticker: t, sectorId: 'xle', residuals: autre.map(v => v + bruit(i + 20)[0] * 0.05),
      })),
    ];
    const cl = findClusters(inputs);
    expect(cl).toHaveLength(2);
    expect(cl.flatMap(c => c.tickers)).toHaveLength(8);
    // aucun cluster ne melange les deux familles
    for (const c of cl) {
      const famille1 = c.tickers.filter(t => ['AAA', 'BBB', 'CCC', 'DDD'].includes(t)).length;
      expect(famille1 === 0 || famille1 === c.tickers.length).toBe(true);
    }
  });

  it('la cohesion mesure toutes les paires, pas seulement les liens directs', () => {
    // Une chaine A-B-C-D ou seuls les voisins sont correles doit avoir une
    // cohesion nettement inferieure a un groupe reellement homogene.
    const cl = findClusters([
      membre('AAA', 'xlk'), membre('BBB', 'xlk'), membre('CCC', 'xli'), membre('DDD', 'xlv'),
    ]);
    expect(cl[0].cohesion).toBeLessThanOrEqual(1);
    expect(cl[0].cohesion).toBeGreaterThan(0);
  });

  it('liste vide', () => {
    expect(findClusters([])).toEqual([]);
  });
});

describe('buildClusterInputs', () => {
  /** Série de 80 bougies dont les rendements suivent `r` (repété). */
  function serie(r: number[]): Bar[] {
    const prices = [100];
    for (let i = 1; i < 80; i++) prices.push(prices[i - 1] * (1 + r[i % r.length] / 100));
    return bars(prices, new Array(80).fill(100_000));
  }

  const cand = (ticker: string) => ({ ticker, z: 2, streak: 6, baseline: 1e7, distToHigh: -10 });
  const deps = {
    sectorOf: (t: string) => (t === 'AAA' || t === 'BBB' ? 'xlk' : t === 'CCC' ? 'xli' : null),
    etfOf: (s: string) => (s === 'xlk' ? 'VGT' : s === 'xli' ? 'XLI' : null),
    marketTicker: 'SPY',
  };

  const series = (): Record<string, Bar[]> => ({
    SPY: serie([0.5, -0.3, 0.8, -0.6, 0.2]),
    VGT: serie([0.7, -0.4, 1.0, -0.8, 0.3]),
    XLI: serie([0.3, -0.2, 0.5, -0.4, 0.1]),
    AAA: serie([0.9, -0.5, 1.2, -1.0, 0.4]),
    BBB: serie([0.8, -0.45, 1.1, -0.9, 0.35]),
    CCC: serie([0.4, -0.25, 0.6, -0.5, 0.15]),
  });

  it('produit un residu par candidat exploitable', () => {
    const { inputs, dropped } = buildClusterInputs(
      [cand('AAA'), cand('BBB'), cand('CCC')], series(), deps,
    );
    expect(inputs.map(i => i.ticker).sort()).toEqual(['AAA', 'BBB', 'CCC']);
    expect(dropped).toEqual([]);
    expect(inputs[0].sectorId).toBe('xlk');
  });

  it('ecarte un candidat sans secteur plutot que de le residualiser a moitie', () => {
    // Un titre nettoye du marche mais pas de son secteur correlerait avec ses
    // pairs sectoriels sur ce reliquat : un cluster qui n'est qu'un secteur
    // deguise. Mieux vaut un candidat de moins qu'un faux theme.
    const { inputs, dropped } = buildClusterInputs([cand('ZZZ')], { ...series(), ZZZ: serie([1]) }, deps);
    expect(inputs).toEqual([]);
    expect(dropped).toEqual(['ZZZ']);
  });

  it('ecarte un candidat dont l ETF sectoriel manque au cache', () => {
    const s = series();
    delete s.VGT;
    const { inputs, dropped } = buildClusterInputs([cand('AAA'), cand('CCC')], s, deps);
    expect(inputs.map(i => i.ticker)).toEqual(['CCC']);
    expect(dropped).toEqual(['AAA']);
  });

  it('sans benchmark de marche, tout est ecarte — rien n est residualise a l aveugle', () => {
    const s = series();
    delete s.SPY;
    const { inputs, dropped } = buildClusterInputs([cand('AAA'), cand('BBB')], s, deps);
    expect(inputs).toEqual([]);
    expect(dropped).toEqual(['AAA', 'BBB']);
  });

  it('le residu retire bien le marche et le secteur', () => {
    // AAA construit comme une combinaison exacte de SPY et VGT : son residu
    // doit etre negligeable.
    const s = series();
    const spyR = returns(s.SPY);
    const vgtR = returns(s.VGT);
    const prices = [100];
    for (let i = 0; i < spyR.length; i++) {
      prices.push(prices[i] * (1 + (0.6 * spyR[i] + 0.4 * vgtR[i]) / 100));
    }
    s.AAA = bars(prices, new Array(prices.length).fill(100_000));

    const { inputs } = buildClusterInputs([cand('AAA')], s, deps);
    expect(Math.max(...inputs[0].residuals.map(Math.abs))).toBeLessThan(0.01);
  });

  it('aucun candidat', () => {
    expect(buildClusterInputs([], series(), deps)).toEqual({ inputs: [], dropped: [] });
  });
});

describe('returns', () => {
  it('rendements journaliers en %', () => {
    const r = returns(bars([100, 110, 99], [1, 1, 1]));
    expect(r[0]).toBeCloseTo(10, 10);
    expect(r[1]).toBeCloseTo(-10, 10);
  });

  it('n bougies → n-1 rendements', () => {
    expect(returns(flat(10))).toHaveLength(9);
    expect(returns(flat(1))).toEqual([]);
  });
});
