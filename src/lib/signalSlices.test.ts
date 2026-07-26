import { describe, it, expect } from 'vitest';
import {
  sliceSignal,
  meetsPrimaryThreshold,
  anySurvivingBucket,
  OUT_OF_SAMPLE_FROM,
  PRIMARY_TARGET,
  SCORE_BUCKETS,
  type SliceBucket,
} from './signalSlices';
import { MIN_EPISODES } from './signalStats';
import type { SignalLogRow } from '../types';

let nextId = 1;

interface Opts {
  date?: string;
  scopeId?: string;
  signal?: string;
  score?: number;
  j40?: number | null;
  j20?: number | null;
  mfe40?: number | null;
  mae40?: number | null;
  ma50?: number | null;
  macro?: number | null;
}

function log(o: Opts = {}): SignalLogRow {
  return {
    id: nextId++,
    date: o.date ?? '2015-06-01',
    scope: 'sector',
    scope_id: o.scopeId ?? 'xlk',
    signal: o.signal ?? 'reversal',
    score: o.score ?? 70,
    rsp_perf_j5: null,
    rsp_perf_j10: null,
    rsp_perf_j20: o.j20 ?? null,
    rsp_perf_j40: o.j40 ?? null,
    mfe_j20: null,
    mae_j20: null,
    mfe_j40: o.mfe40 ?? null,
    mae_j40: o.mae40 ?? null,
    rel_perf_j5: null,
    rel_perf_j10: null,
    rel_perf_j20: null,
    peer_perf_j20: null,
    ma50_above: o.ma50 ?? null,
    macro_score: o.macro ?? null,
  };
}

/**
 * Épisodes distincts.
 *
 * Il ne suffit **pas** de varier la date : un même signal sur un même secteur,
 * même étalé sur des dates différentes, reste un seul épisode tant que le moteur
 * a tourné entre-temps — c'est exactement ce que `toEpisodes` garantit. Il faut
 * donc varier le `scope_id`, ce qui correspond à la réalité mesurée (des secteurs
 * différents déclenchant à des dates différentes).
 */
function series(n: number, o: (i: number) => Opts): SignalLogRow[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2012, 0, 2 + i * 3));
    return log({ date: d.toISOString().slice(0, 10), scopeId: `s${i}`, ...o(i) });
  });
}

describe('sliceSignal — segment hors-echantillon', () => {
  const rows = [
    log({ date: '2015-06-01', scopeId: 'a', j40: 1 }),
    log({ date: '2021-12-31', scopeId: 'b', j40: 1 }),
    log({ date: '2022-01-03', scopeId: 'c', j40: 99 }),
    log({ date: '2025-06-01', scopeId: 'd', j40: 99 }),
  ];

  it('ecarte le hors-echantillon par defaut — la cartouche ne se depense pas par accident', () => {
    const r = sliceSignal(rows, { axis: 'year', signal: 'reversal', horizon: 40 });
    expect(r.buckets.map(b => b.label)).toEqual(['2015', '2021']);
  });

  it('l inclut seulement sur demande explicite', () => {
    const r = sliceSignal(rows, {
      axis: 'year', signal: 'reversal', horizon: 40, includeOutOfSample: true,
    });
    expect(r.buckets.map(b => b.label)).toEqual(['2015', '2021', '2022', '2025']);
  });

  it('la borne est bien exclusive sur OUT_OF_SAMPLE_FROM', () => {
    expect(OUT_OF_SAMPLE_FROM).toBe('2022-01-01');
    const r = sliceSignal([log({ date: OUT_OF_SAMPLE_FROM, j40: 1 })],
      { axis: 'year', signal: 'reversal', horizon: 40 });
    expect(r.buckets).toEqual([]);
  });
});

describe('sliceSignal — axes', () => {
  it('tranches de score, dans l ordre du plan et sans bucket vide', () => {
    const rows = [
      log({ date: '2015-01-01', scopeId: 'a', score: 30, j40: 1 }),
      log({ date: '2015-01-05', scopeId: 'b', score: 75, j40: 1 }),
      log({ date: '2015-01-09', scopeId: 'c', score: 95, j40: 1 }),
    ];
    const r = sliceSignal(rows, { axis: 'score', signal: 'reversal', horizon: 40 });
    expect(r.buckets.map(b => b.label)).toEqual(['0–49', '70–79', '80–100']);
  });

  it('les bornes de score couvrent 0 a 100 sans trou ni recouvrement', () => {
    for (let s = 0; s <= 100; s++) {
      const hits = SCORE_BUCKETS.filter(b => s >= b.min && s <= b.max);
      expect(hits).toHaveLength(1);
    }
  });

  it('par annee, ordre chronologique', () => {
    const rows = [
      log({ date: '2018-03-01', scopeId: 'a', j40: 1 }),
      log({ date: '2011-03-01', scopeId: 'b', j40: 1 }),
      log({ date: '2015-03-01', scopeId: 'c', j40: 1 }),
    ];
    const r = sliceSignal(rows, { axis: 'year', signal: 'reversal', horizon: 40 });
    expect(r.buckets.map(b => b.label)).toEqual(['2011', '2015', '2018']);
  });

  it('par secteur', () => {
    const rows = [
      log({ date: '2015-01-01', scopeId: 'xle', j40: 1 }),
      log({ date: '2015-01-05', scopeId: 'xlf', j40: 1 }),
    ];
    const r = sliceSignal(rows, { axis: 'sector', signal: 'reversal', horizon: 40 });
    expect(r.buckets.map(b => b.label)).toEqual(['xle', 'xlf']);
  });

  it('MA50 : une valeur nulle est non classee, pas rangee sous la MA50', () => {
    // Sinon le bucket « sous MA50 » serait pollue par des series trop courtes,
    // et c'est justement le bucket dont on veut savoir s'il est mauvais.
    const rows = [
      log({ date: '2015-01-01', scopeId: 'a', ma50: 1, j40: 1 }),
      log({ date: '2015-01-05', scopeId: 'b', ma50: 0, j40: 1 }),
      log({ date: '2015-01-09', scopeId: 'c', ma50: null, j40: 1 }),
    ];
    const r = sliceSignal(rows, { axis: 'ma50', signal: 'reversal', horizon: 40 });
    expect(r.buckets.map(b => b.label)).toEqual(['Au-dessus MA50', 'Sous MA50']);
    expect(r.buckets.every(b => b.total === 1)).toBe(true);
    expect(r.unclassified).toBe(1);
  });

  it('macro : coupe au point neutre 50, favorable inclus', () => {
    const rows = [
      log({ date: '2015-01-01', scopeId: 'a', macro: 50, j40: 1 }),
      log({ date: '2015-01-05', scopeId: 'b', macro: 49.9, j40: 1 }),
      log({ date: '2015-01-09', scopeId: 'c', macro: null, j40: 1 }),
    ];
    const r = sliceSignal(rows, { axis: 'macro', signal: 'reversal', horizon: 40 });
    expect(r.buckets.find(b => b.label === 'Macro favorable')!.total).toBe(1);
    expect(r.buckets.find(b => b.label === 'Macro défavorable')!.total).toBe(1);
    expect(r.unclassified).toBe(1);
  });
});

describe('sliceSignal — integrite du comptage', () => {
  it('les episodes sont reduits AVANT le filtrage par signal', () => {
    // xlk tient « reversal » 3 jours consecutifs alors que xle ecrit chaque jour :
    // le moteur a donc bien tourne, l episode xlk ne doit compter qu une fois.
    const rows = [
      log({ date: '2015-01-01', scopeId: 'xlk', signal: 'reversal', j40: 1 }),
      log({ date: '2015-01-02', scopeId: 'xlk', signal: 'reversal', j40: 1 }),
      log({ date: '2015-01-03', scopeId: 'xlk', signal: 'reversal', j40: 1 }),
      log({ date: '2015-01-01', scopeId: 'xle', signal: 'dip', j40: 1 }),
      log({ date: '2015-01-02', scopeId: 'xle', signal: 'dip', j40: 1 }),
      log({ date: '2015-01-03', scopeId: 'xle', signal: 'dip', j40: 1 }),
    ];
    const r = sliceSignal(rows, { axis: 'sector', signal: 'reversal', horizon: 40 });
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0].total).toBe(1);
  });

  it('un signal absent donne une decoupe vide, pas une erreur', () => {
    const r = sliceSignal([log({ j40: 1 })], { axis: 'score', signal: 'dip', horizon: 40 });
    expect(r.buckets).toEqual([]);
    expect(r.unclassified).toBe(0);
  });

  it('log vide', () => {
    expect(sliceSignal([], { axis: 'score', signal: 'dip', horizon: 40 }).buckets).toEqual([]);
  });

  it('lit la colonne de l horizon demande', () => {
    const rows = [log({ date: '2015-01-01', j20: 5, j40: -5 })];
    const at20 = sliceSignal(rows, { axis: 'score', signal: 'reversal', horizon: 20 });
    const at40 = sliceSignal(rows, { axis: 'score', signal: 'reversal', horizon: 40 });
    expect(at20.buckets[0].stat.avgRelPerf).toBeCloseTo(5, 10);
    expect(at40.buckets[0].stat.avgRelPerf).toBeCloseTo(-5, 10);
  });

  it('marque exploratoire tout ce qui n est pas la cible pre-enregistree', () => {
    const rows = [log({ date: '2015-01-01', j40: 1 })];
    const cible = sliceSignal(rows, {
      axis: 'score', signal: PRIMARY_TARGET.signal, horizon: PRIMARY_TARGET.horizon,
    });
    expect(cible.exploratory).toBe(false);
    expect(sliceSignal(rows, { axis: 'score', signal: 'dip', horizon: 40 }).exploratory).toBe(true);
    expect(sliceSignal(rows, { axis: 'score', signal: 'reversal', horizon: 20 }).exploratory).toBe(true);
  });
});

describe('meetsPrimaryThreshold', () => {
  const bucket = (over: Partial<SliceBucket> = {}): SliceBucket => ({
    label: 'x',
    total: MIN_EPISODES,
    underpowered: false,
    stat: {
      n: MIN_EPISODES, avgRelPerf: 1, medianRelPerf: 1, p25: 0, p75: 2, p10: -1,
      winRate: 0.5, avgWin: 3, avgLoss: 2, winLossRatio: 1.5, expectancy: 1,
    },
    excursion: { n: MIN_EPISODES, avgFavorable: 6, avgAdverse: -4, ratio: 1.5 },
    ...over,
  });

  it('franchit quand les trois conditions sont reunies', () => {
    expect(meetsPrimaryThreshold(bucket())).toBe(true);
  });

  it('un echantillon sous le plancher ne franchit jamais, meme flatteur', () => {
    const b = bucket({ underpowered: true });
    b.stat = { ...b.stat, expectancy: 12 };
    b.excursion = { ...b.excursion, ratio: 4 };
    expect(meetsPrimaryThreshold(b)).toBe(false);
  });

  it('une esperance sous 3x les frais ne franchit pas, meme avec une belle asymetrie', () => {
    const b = bucket();
    b.stat = { ...b.stat, expectancy: PRIMARY_TARGET.minExpectancy - 0.01 };
    expect(meetsPrimaryThreshold(b)).toBe(false);
  });

  it('un ratio d excursion sous le seuil ne franchit pas, meme avec une belle esperance', () => {
    const b = bucket();
    b.excursion = { ...b.excursion, ratio: PRIMARY_TARGET.minExcursionRatio - 0.01 };
    expect(meetsPrimaryThreshold(b)).toBe(false);
  });

  it('les seuils sont ceux calcules, pas des valeurs arrondies au hasard', () => {
    expect(PRIMARY_TARGET.minExcursionRatio).toBe(1.15); // 3 sigma de 1
    expect(PRIMARY_TARGET.minExpectancy).toBe(0.5);      // ~3x les frais aller-retour
  });

  it('des mesures absentes ne franchissent pas', () => {
    const b = bucket();
    b.stat = { ...b.stat, expectancy: null };
    expect(meetsPrimaryThreshold(b)).toBe(false);
    const c = bucket();
    c.excursion = { ...c.excursion, ratio: null };
    expect(meetsPrimaryThreshold(c)).toBe(false);
  });
});

describe('anySurvivingBucket — critere d arret de la Phase 1', () => {
  it('faux sur un resultat nul : les signaux restent descriptifs', () => {
    // 200 episodes a esperance nulle et parcours symetrique = le cas observe
    const rows = series(200, i => ({
      j40: i % 2 === 0 ? 2 : -2, mfe40: 6, mae40: -6, score: 70,
    }));
    const r = sliceSignal(rows, { axis: 'score', signal: 'reversal', horizon: 40 });
    expect(r.buckets[0].total).toBeGreaterThanOrEqual(MIN_EPISODES);
    expect(anySurvivingBucket([r])).toBe(false);
  });

  it('vrai quand un bucket suffisamment large franchit reellement', () => {
    const rows = series(200, () => ({ j40: 3, mfe40: 8, mae40: -4, score: 70 }));
    const r = sliceSignal(rows, { axis: 'score', signal: 'reversal', horizon: 40 });
    expect(anySurvivingBucket([r])).toBe(true);
  });

  it('un petit bucket flatteur ne suffit pas a relancer le chantier', () => {
    // 20 episodes parfaits : exactement le piege du durcissement a outrance
    const rows = series(20, () => ({ j40: 10, mfe40: 15, mae40: -2, score: 90 }));
    const r = sliceSignal(rows, { axis: 'score', signal: 'reversal', horizon: 40 });
    expect(r.buckets[0].stat.expectancy!).toBeGreaterThan(5);
    expect(anySurvivingBucket([r])).toBe(false);
  });
});
