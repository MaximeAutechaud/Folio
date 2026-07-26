import { describe, it, expect } from 'vitest';
import {
  computeSignalStats,
  isWin,
  orient,
  horizonStat,
  excursionStat,
  toEpisodes,
  LOW_SAMPLE_THRESHOLD,
  MIN_EPISODES,
  SIGNAL_KINDS,
} from './signalStats';
import type { SignalLogRow } from '../types';

interface Perfs {
  j5?: number | null;
  j10?: number | null;
  j20?: number | null;
  j40?: number | null;
  mfe20?: number | null;
  mae20?: number | null;
}

let nextId = 1;

/**
 * `j5`/`j10`/`j20` alimentent les colonnes **primaires** (vs RSP) : ce sont
 * elles que lisent les statistiques. `rel_perf_*` (vs SPY) reçoit les mêmes
 * valeurs, ce qui garde les anciennes assertions lisibles sans les rendre
 * porteuses du résultat.
 */
function base(
  signal: string, score: number, date: string, scopeId: string, scope: string, p: Perfs,
): SignalLogRow {
  return {
    id: nextId++,
    date,
    scope,
    scope_id: scopeId,
    signal,
    score,
    rsp_perf_j5: p.j5 ?? null,
    rsp_perf_j10: p.j10 ?? null,
    rsp_perf_j20: p.j20 ?? null,
    rsp_perf_j40: p.j40 ?? null,
    mfe_j20: p.mfe20 ?? null,
    mae_j20: p.mae20 ?? null,
    mfe_j40: null,
    mae_j40: null,
    rel_perf_j5: p.j5 ?? null,
    rel_perf_j10: p.j10 ?? null,
    rel_perf_j20: p.j20 ?? null,
    peer_perf_j20: null,
    ma50_above: null,
    macro_score: null,
  };
}

function row(signal: string, score: number, perfs: Perfs = {}): SignalLogRow {
  return base(signal, score, '2026-07-01', 'xlk', 'sector', perfs);
}

describe('isWin', () => {
  it('signaux haussiers : gagné si relPerf > 0', () => {
    for (const s of ['dip', 'reversal', 'accelerating'] as const) {
      expect(isWin(s, 1.5)).toBe(true);
      expect(isWin(s, -1.5)).toBe(false);
      expect(isWin(s, 0)).toBe(false);
    }
  });

  it('exhaustion (évitement) : gagné si relPerf < 0 — logique inversée', () => {
    expect(isWin('exhaustion', -1.5)).toBe(true);
    expect(isWin('exhaustion', 1.5)).toBe(false);
    expect(isWin('exhaustion', 0)).toBe(false);
  });
});

describe('orient', () => {
  it('laisse les signaux haussiers tels quels', () => {
    for (const s of ['dip', 'reversal', 'accelerating'] as const) {
      expect(orient(s, 3)).toBe(3);
      expect(orient(s, -3)).toBe(-3);
    }
  });

  it('inverse exhaustion : une sous-performance est un succes', () => {
    expect(orient('exhaustion', -3)).toBe(3);
    expect(orient('exhaustion', 3)).toBe(-3);
  });
});

describe('horizonStat — esperance et distribution', () => {
  it('un win rate bas peut porter une esperance positive', () => {
    // 2 gagnants a +10, 3 perdants a -2 → E = (20 - 6) / 5 = +2.8
    const st = horizonStat('dip', [10, 10, -2, -2, -2]);
    expect(st.winRate).toBeCloseTo(0.4, 10);
    expect(st.expectancy!).toBeGreaterThan(0);
    expect(st.expectancy).toBeCloseTo(2.8, 10);
    expect(st.avgWin).toBeCloseTo(10, 10);
    expect(st.avgLoss).toBeCloseTo(2, 10);
    expect(st.winLossRatio).toBeCloseTo(5, 10);
  });

  it('un win rate eleve peut porter une esperance negative', () => {
    // 4 gagnants a +0.5, 1 perdant a -5 → E = (2 - 5) / 5 = -0.6
    const st = horizonStat('dip', [0.5, 0.5, 0.5, 0.5, -5]);
    expect(st.winRate).toBeCloseTo(0.8, 10);
    expect(st.expectancy!).toBeLessThan(0);
  });

  it('esperance = moyenne orientee, coherente avec winRate x avgWin - (1-p) x avgLoss', () => {
    const st = horizonStat('dip', [4, -1, 2, -3, 6]);
    const p = st.winRate!;
    expect(st.expectancy).toBeCloseTo(p * st.avgWin! - (1 - p) * st.avgLoss!, 10);
  });

  it('exhaustion : esperance positive quand le secteur sous-performe ensuite', () => {
    const st = horizonStat('exhaustion', [-4, -3, 1]);
    expect(st.expectancy!).toBeGreaterThan(0);
    // la moyenne brute reste negative — ce n'est pas la meme grandeur
    expect(st.avgRelPerf!).toBeLessThan(0);
  });

  it('mediane insensible a un extreme qui deplace la moyenne', () => {
    const st = horizonStat('dip', [-1, -1, -1, -1, 100]);
    expect(st.medianRelPerf).toBeCloseTo(-1, 10);
    expect(st.avgRelPerf!).toBeGreaterThan(0);
  });

  it('mediane sur un echantillon pair = moyenne des deux valeurs centrales', () => {
    expect(horizonStat('dip', [1, 2, 3, 4]).medianRelPerf).toBeCloseTo(2.5, 10);
  });

  it('une perf nulle compte comme perdante, pas comme gagnante', () => {
    const st = horizonStat('dip', [0, 0]);
    expect(st.winRate).toBe(0);
    expect(st.avgWin).toBeNull();
    expect(st.avgLoss).toBeCloseTo(0, 10);
    // avgLoss nul → pas de ratio calculable, plutot qu'une division par zero
    expect(st.winLossRatio).toBeNull();
  });

  it('ignore les mesures absentes sans les compter comme nulles', () => {
    const st = horizonStat('dip', [2, null, null, 4]);
    expect(st.n).toBe(2);
    expect(st.avgRelPerf).toBeCloseTo(3, 10);
  });
});

describe('excursionStat — asymetrie du parcours', () => {
  it('ratio > 1 quand la queue droite domine', () => {
    const st = excursionStat('dip', [12, 10], [-2, -2]);
    expect(st.ratio!).toBeGreaterThan(1);
    expect(st.avgFavorable).toBeCloseTo(11, 10);
    expect(st.avgAdverse).toBeCloseTo(-2, 10);
  });

  it('ratio proche de 1 = parcours symetrique, rien a recolter par une sortie', () => {
    expect(excursionStat('dip', [5, 5], [-5, -5]).ratio).toBeCloseTo(1, 10);
  });

  it('exhaustion : favorable et adverse echangent leur role', () => {
    // le secteur a chute de 8 au plus bas et monte de 1 au plus haut :
    // pour un signal d evitement, c'est un bon appel.
    const st = excursionStat('exhaustion', [1], [-8]);
    expect(st.avgFavorable).toBeCloseTo(8, 10);
    expect(st.avgAdverse).toBeCloseTo(-1, 10);
    expect(st.ratio!).toBeGreaterThan(1);
  });

  it('exige les deux bornes : une ligne a moitie remplie est ignoree', () => {
    expect(excursionStat('dip', [5, null], [-5, -5]).n).toBe(1);
    expect(excursionStat('dip', [], []).ratio).toBeNull();
  });
});

describe('computeSignalStats', () => {
  it('retourne toujours les 4 signaux, même sans données', () => {
    const stats = computeSignalStats([]);
    expect(stats.map(s => s.signal)).toEqual(SIGNAL_KINDS);
    for (const s of stats) {
      expect(s.total).toBe(0);
      expect(s.avgScore).toBeNull();
      expect(s.j5.n).toBe(0);
      expect(s.j5.avgRelPerf).toBeNull();
      expect(s.j5.winRate).toBeNull();
      expect(s.j5.expectancy).toBeNull();
      expect(s.excursion20.ratio).toBeNull();
      expect(s.lowSample).toBe(true);
      expect(s.underpowered).toBe(true);
    }
  });

  it('sépare total (occurrences loggées) et n (perfs disponibles)', () => {
    const stats = computeSignalStats([
      row('dip', 60, { j5: 2.0 }),
      row('dip', 70), // backfill pas encore passé → rel_perf NULL
    ]);
    const dip = stats.find(s => s.signal === 'dip')!;
    expect(dip.total).toBe(2);
    expect(dip.j5.n).toBe(1);
    expect(dip.j10.n).toBe(0);
  });

  it('winRate et avgRelPerf par horizon', () => {
    const stats = computeSignalStats([
      row('dip', 60, { j5: 2.0, j10: -1.0 }),
      row('dip', 50, { j5: -1.0, j10: -3.0 }),
      row('dip', 70, { j5: 3.5 }),
    ]);
    const dip = stats.find(s => s.signal === 'dip')!;
    expect(dip.j5.n).toBe(3);
    expect(dip.j5.winRate).toBeCloseTo(2 / 3, 10);
    expect(dip.j5.avgRelPerf).toBeCloseTo((2.0 - 1.0 + 3.5) / 3, 10);
    expect(dip.j10.n).toBe(2);
    expect(dip.j10.winRate).toBe(0);
    expect(dip.j10.avgRelPerf).toBeCloseTo(-2.0, 10);
  });

  it('winRate d exhaustion inversé : sous-performance = réussite', () => {
    const stats = computeSignalStats([
      row('exhaustion', 80, { j5: -2.0 }), // bonne détection
      row('exhaustion', 75, { j5: -0.5 }), // bonne détection
      row('exhaustion', 85, { j5: 1.0 }),  // raté (a continué de monter)
    ]);
    const ex = stats.find(s => s.signal === 'exhaustion')!;
    expect(ex.j5.winRate).toBeCloseTo(2 / 3, 10);
    // avgRelPerf reste la moyenne brute, pas inversée
    expect(ex.j5.avgRelPerf).toBeCloseTo((-2.0 - 0.5 + 1.0) / 3, 10);
  });

  it('les signaux ne se contaminent pas entre eux', () => {
    const stats = computeSignalStats([
      row('dip', 60, { j5: 5.0 }),
      row('reversal', 40, { j5: -5.0 }),
    ]);
    expect(stats.find(s => s.signal === 'dip')!.j5.avgRelPerf).toBe(5.0);
    expect(stats.find(s => s.signal === 'reversal')!.j5.avgRelPerf).toBe(-5.0);
    expect(stats.find(s => s.signal === 'accelerating')!.total).toBe(0);
  });

  it('avgScore arrondi à l entier', () => {
    const stats = computeSignalStats([row('dip', 60), row('dip', 65)]);
    expect(stats.find(s => s.signal === 'dip')!.avgScore).toBe(63); // 62.5 → round
  });

  it(`lowSample bascule à ${LOW_SAMPLE_THRESHOLD} occurrences (perfs remplies ou non)`, () => {
    const nine = computeSignalStats(
      Array.from({ length: LOW_SAMPLE_THRESHOLD - 1 }, () => row('dip', 60)),
    );
    expect(nine.find(s => s.signal === 'dip')!.lowSample).toBe(true);

    const ten = computeSignalStats(
      Array.from({ length: LOW_SAMPLE_THRESHOLD }, () => row('dip', 60)),
    );
    expect(ten.find(s => s.signal === 'dip')!.lowSample).toBe(false);
  });

  it('ignore les signaux inconnus (ex. futur signal_change loggé par erreur)', () => {
    const stats = computeSignalStats([row('signal_change', 50, { j5: 1 })]);
    for (const s of stats) expect(s.total).toBe(0);
  });

  it(`underpowered tant que le plancher de ${MIN_EPISODES} episodes n est pas atteint`, () => {
    // Des dates distinctes : sinon toEpisodes fusionnerait tout en un episode.
    const mk = (n: number) => Array.from({ length: n }, (_, i) =>
      day(`2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        'xlk', i % 2 === 0 ? 'dip' : 'reversal', { j20: 1 }));

    const few = computeSignalStats(mk(40)).find(s => s.signal === 'dip')!;
    expect(few.lowSample).toBe(false);        // au-dessus du seuil d echantillon faible
    expect(few.underpowered).toBe(true);      // mais sous le plancher de puissance
    expect(few.total).toBeLessThan(MIN_EPISODES);
  });

  it('lit les colonnes vs RSP et non vs SPY', () => {
    // Meme ligne, deux benchmarks divergents : la stat primaire suit RSP.
    const r = row('dip', 60, { j20: 3 });
    r.rel_perf_j20 = -9; // vs SPY, volontairement contradictoire
    const dip = computeSignalStats([r]).find(s => s.signal === 'dip')!;
    expect(dip.j20.avgRelPerf).toBeCloseTo(3, 10);
    expect(dip.spyJ20.avgRelPerf).toBeCloseTo(-9, 10);
  });

  it('remonte les excursions par horizon', () => {
    const dip = computeSignalStats([
      row('dip', 60, { j20: 1, mfe20: 9, mae20: -3 }),
    ]).find(s => s.signal === 'dip')!;
    expect(dip.excursion20.n).toBe(1);
    expect(dip.excursion20.ratio).toBeCloseTo(3, 10);
    expect(dip.excursion40.n).toBe(0); // non renseigne par le backfill
  });
});

// ── Épisodes ──────────────────────────────────────────────────────────────────

function day(
  date: string, scopeId: string, signal: string, perfs: Perfs = {}, scope = 'sector',
): SignalLogRow {
  return base(signal, 70, date, scopeId, scope, perfs);
}

describe('toEpisodes', () => {
  it('un signal qui tient plusieurs jours compte pour une seule detection', () => {
    const ep = toEpisodes([
      day('2026-07-01', 'xlk', 'reversal'),
      day('2026-07-02', 'xlk', 'reversal'),
      day('2026-07-03', 'xlk', 'reversal'),
    ]);
    expect(ep).toHaveLength(1);
    expect(ep[0].date).toBe('2026-07-01');
  });

  it('un changement de signal ouvre un nouvel episode', () => {
    const ep = toEpisodes([
      day('2026-07-01', 'xlk', 'dip'),
      day('2026-07-02', 'xlk', 'reversal'),
    ]);
    expect(ep.map((r) => r.signal)).toEqual(['dip', 'reversal']);
  });

  it('un signal interrompu puis revenu compte deux fois', () => {
    // Le moteur a tourne le 02 (xle a une ligne) mais xlk n'en a pas :
    // son signal avait bien cesse.
    const ep = toEpisodes([
      day('2026-07-01', 'xlk', 'reversal'),
      day('2026-07-02', 'xle', 'dip'),
      day('2026-07-03', 'xlk', 'reversal'),
    ]);
    expect(ep.filter((r) => r.scope_id === 'xlk')).toHaveLength(2);
  });

  it('un jour sans aucune ecriture ne coupe pas l episode (app fermee)', () => {
    // Rien du tout le 02 : on ne sait pas si le signal a cesse, on prolonge.
    const ep = toEpisodes([
      day('2026-07-01', 'xlk', 'reversal'),
      day('2026-07-03', 'xlk', 'reversal'),
    ]);
    expect(ep).toHaveLength(1);
  });

  it('les scopes ne se contaminent pas', () => {
    const ep = toEpisodes([
      day('2026-07-01', 'xlk', 'reversal'),
      day('2026-07-01', 'xle', 'reversal'),
      day('2026-07-02', 'xlk', 'reversal'),
      day('2026-07-02', 'xle', 'dip'),
    ]);
    expect(ep.map((r) => `${r.scope_id}:${r.signal}`).sort())
      .toEqual(['xle:dip', 'xle:reversal', 'xlk:reversal']);
  });

  it('meme scope_id dans deux scopes differents = deux series', () => {
    const ep = toEpisodes([
      day('2026-07-01', 'ita', 'reversal'),
      day('2026-07-02', 'ita', 'reversal'),
      day('2026-07-02', 'ita', 'dip', {}, 'narrative'),
    ]);
    expect(ep).toHaveLength(2);
  });

  it('log vide', () => {
    expect(toEpisodes([])).toEqual([]);
  });
});

describe('computeSignalStats — comptage par episode', () => {
  it('n reflete les detections, pas les jours cumules', () => {
    // Une seule detection tenue 4 jours : la perf du jour d apparition compte.
    const stats = computeSignalStats([
      day('2026-07-01', 'xlk', 'reversal', { j5: 2 }),
      day('2026-07-02', 'xlk', 'reversal', { j5: 2.1 }),
      day('2026-07-03', 'xlk', 'reversal', { j5: 1.9 }),
      day('2026-07-04', 'xlk', 'reversal', { j5: 2.2 }),
    ]);
    const rev = stats.find((s) => s.signal === 'reversal')!;
    expect(rev.total).toBe(1);
    expect(rev.j5.n).toBe(1);
    expect(rev.j5.avgRelPerf).toBeCloseTo(2, 10);
  });

  it('un mouvement unique ne peut plus valider un signal a lui seul', () => {
    // 6 jours de persistance sur un seul secteur : sous l ancien comptage,
    // n=6 franchissait presque le seuil d echantillon faible.
    const rows = ['01', '02', '03', '04', '05', '06'].map((d) =>
      day(`2026-07-${d}`, 'xlk', 'reversal', { j5: 3 }));
    const rev = computeSignalStats(rows).find((s) => s.signal === 'reversal')!;
    expect(rev.total).toBe(1);
    expect(rev.lowSample).toBe(true);
  });
});
