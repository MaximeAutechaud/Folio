import { describe, it, expect } from 'vitest';
import {
  findBarIndex,
  forwardPath,
  relativeForward,
  peerRelPerf,
  tradingSessions,
} from './rebuildSignals';

// bougies a 13:30 UTC, comme celles de Yahoo pour les marches US.
// `open` par defaut = `value` : la plupart des tests ne portent pas sur le gap
// d'ouverture, ceux qui le font passent un open explicite.
function bar(dateIso: string, value: number, open = value) {
  return {
    time: Math.floor(new Date(`${dateIso}T13:30:00Z`).getTime() / 1000),
    open,
    value,
    close: value,
  };
}

const SERIE = [
  bar('2026-07-06', 100), bar('2026-07-07', 101), bar('2026-07-08', 102),
  bar('2026-07-09', 103), bar('2026-07-10', 104), bar('2026-07-13', 105),
  bar('2026-07-14', 106), bar('2026-07-15', 107),
];

describe('findBarIndex', () => {
  it('trouve la bougie de la date exacte', () => {
    expect(findBarIndex(SERIE, '2026-07-08')).toBe(2);
  });

  it('retombe sur la bougie suivante si la date n est pas cotee (week-end)', () => {
    // 11 et 12 juillet = week-end → premiere bougie >= est le lundi 13
    expect(findBarIndex(SERIE, '2026-07-11')).toBe(5);
  });

  it('-1 si la date est posterieure a toute la serie', () => {
    expect(findBarIndex(SERIE, '2026-08-01')).toBe(-1);
  });

  it('premiere bougie si la date precede toute la serie', () => {
    expect(findBarIndex(SERIE, '2020-01-01')).toBe(0);
  });

  it('-1 sur une serie vide', () => {
    expect(findBarIndex([], '2026-07-08')).toBe(-1);
  });

  it('la dichotomie donne le meme resultat que le balayage lineaire', () => {
    // serie longue : c'est le cas que la dichotomie sert a rendre praticable
    const longue = Array.from({ length: 400 }, (_, i) =>
      bar(new Date(Date.UTC(2010, 0, 4) + i * 86400_000).toISOString().slice(0, 10), 100 + i));
    const naive = (d: string) => {
      for (let i = 0; i < longue.length; i++) {
        if (new Date(longue[i].time * 1000).toISOString().slice(0, 10) >= d) return i;
      }
      return -1;
    };
    for (const d of ['2009-01-01', '2010-01-04', '2010-06-15', '2011-02-07', '2030-01-01']) {
      expect(findBarIndex(longue, d)).toBe(naive(d));
    }
  });
});

describe('forwardPath', () => {
  it('part de l ouverture de J+1, pas de la cloture de J', () => {
    // signal le 06/07 ; entree a l ouverture du 07/07 = 101 ; cloture du 07/07 = 101
    const path = forwardPath(SERIE, '2026-07-06', 3)!;
    expect(path[0]).toBeCloseTo(0, 6);              // open 101 → close 101
    expect(path[1]).toBeCloseTo((102 - 101) / 101 * 100, 6);
    expect(path[2]).toBeCloseTo((103 - 101) / 101 * 100, 6);
  });

  it('l ouverture de J+1 est bien celle utilisee, meme en cas de gap', () => {
    // gap haussier a l ouverture du 07/07 : entrer a 110 et non a 101
    const gappy = [...SERIE];
    gappy[1] = bar('2026-07-07', 101, 110);
    const path = forwardPath(gappy, '2026-07-06', 2)!;
    expect(path[0]).toBeCloseTo((101 - 110) / 110 * 100, 6);
    expect(path[0]).toBeLessThan(0); // le gap est paye a l entree
  });

  it('s arrete a la fin de la serie au lieu d inventer des seances', () => {
    // signal le 14/07 : il ne reste que la cloture du 15/07
    expect(forwardPath(SERIE, '2026-07-14', 20)).toHaveLength(1);
  });

  it('null si la bougie d entree n existe pas encore', () => {
    // signal sur la derniere bougie : aucune ouverture J+1 disponible
    expect(forwardPath(SERIE, '2026-07-15', 5)).toBeNull();
  });

  it('null sur une date posterieure a la serie', () => {
    expect(forwardPath(SERIE, '2026-08-01', 5)).toBeNull();
  });
});

describe('relativeForward', () => {
  // bench a +1/seance, meme depart que SERIE → les deux progressent a l identique
  const bench = SERIE.map((p, i) => bar(new Date(p.time * 1000).toISOString().slice(0, 10), 100 + i));

  it('deux series identiques → perf relative nulle', () => {
    const r = relativeForward(SERIE, bench, '2026-07-06', [3]);
    expect(r[3].relPerf).toBeCloseTo(0, 6);
  });

  it('isole la surperformance', () => {
    const fort = SERIE.map((p, i) =>
      bar(new Date(p.time * 1000).toISOString().slice(0, 10), 100 + i * 2));
    expect(relativeForward(fort, bench, '2026-07-06', [3])[3].relPerf!).toBeGreaterThan(0);
  });

  it('MFE et MAE encadrent la perf a l echeance', () => {
    // parcours en cloche : monte puis redescend sous le point d entree
    const cloche = [
      bar('2026-07-06', 100), bar('2026-07-07', 100), bar('2026-07-08', 110),
      bar('2026-07-09', 120), bar('2026-07-10', 95),  bar('2026-07-13', 90),
    ];
    const flat = cloche.map(p =>
      bar(new Date(p.time * 1000).toISOString().slice(0, 10), 100));
    const r = relativeForward(cloche, flat, '2026-07-06', [4])[4];
    expect(r.mfe!).toBeGreaterThan(15);   // le sommet a 120 est bien vu
    expect(r.mae!).toBeLessThan(-4);      // le creux a 95 aussi
    expect(r.relPerf!).toBeLessThan(0);   // mais l echeance est negative
    expect(r.mfe!).toBeGreaterThanOrEqual(r.relPerf!);
    expect(r.mae!).toBeLessThanOrEqual(r.relPerf!);
  });

  it('les excursions sont cumulatives : celles de J+40 englobent celles de J+20', () => {
    const cloche = [
      bar('2026-07-06', 100), bar('2026-07-07', 100), bar('2026-07-08', 105),
      bar('2026-07-09', 130), bar('2026-07-10', 80),
    ];
    const flat = cloche.map(p =>
      bar(new Date(p.time * 1000).toISOString().slice(0, 10), 100));
    const r = relativeForward(cloche, flat, '2026-07-06', [2, 4]);
    expect(r[4].mfe!).toBeGreaterThanOrEqual(r[2].mfe!);
    expect(r[4].mae!).toBeLessThanOrEqual(r[2].mae!);
  });

  it('horizon non atteint → null, pas d extrapolation', () => {
    const r = relativeForward(SERIE, bench, '2026-07-06', [3, 20]);
    expect(r[3].relPerf).not.toBeNull();
    expect(r[20].relPerf).toBeNull();
    expect(r[20].mfe).toBeNull();
  });
});

describe('peerRelPerf', () => {
  it('exclut le secteur mesure de son propre panier', () => {
    // self +10, les deux pairs +0 → ecart au panier = +10
    const paths = new Map<string, number[] | null>([
      ['self', [10]], ['a', [0]], ['b', [0]],
    ]);
    expect(peerRelPerf(paths, 'self', 1)).toBeCloseTo(10, 6);
  });

  it('la taille de l univers ne dilue pas l ecart', () => {
    const petit = new Map<string, number[] | null>([['self', [6]], ['a', [0]]]);
    const grand = new Map<string, number[] | null>([
      ['self', [6]], ['a', [0]], ['b', [0]], ['c', [0]], ['d', [0]],
    ]);
    expect(peerRelPerf(petit, 'self', 1)).toBeCloseTo(peerRelPerf(grand, 'self', 1)!, 6);
  });

  it('ignore les pairs sans mesure a cet horizon', () => {
    const paths = new Map<string, number[] | null>([
      ['self', [4]], ['a', [0]], ['b', null], ['c', []],
    ]);
    expect(peerRelPerf(paths, 'self', 1)).toBeCloseTo(4, 6);
  });

  it('null sans aucun pair mesurable', () => {
    expect(peerRelPerf(new Map([['self', [4]]]), 'self', 1)).toBeNull();
  });

  it('null si le secteur lui-meme n a pas de mesure', () => {
    const paths = new Map<string, number[] | null>([['self', null], ['a', [0]]]);
    expect(peerRelPerf(paths, 'self', 1)).toBeNull();
  });
});

describe('tradingSessions', () => {
  it('ecarte la journee en cours', () => {
    const now = Math.floor(new Date('2026-07-15T18:00:00Z').getTime() / 1000);
    const s = tradingSessions(SERIE, 0, now);
    expect(s.map(x => x.date)).not.toContain('2026-07-15');
    expect(s[s.length - 1].date).toBe('2026-07-14');
  });

  it('ne contient que des jours cotes — aucun week-end', () => {
    const now = Math.floor(new Date('2026-07-16T12:00:00Z').getTime() / 1000);
    const dates = tradingSessions(SERIE, 0, now).map(x => x.date);
    expect(dates).not.toContain('2026-07-11');
    expect(dates).not.toContain('2026-07-12');
  });

  it('minBars ecarte le debut de serie, ou les indicateurs manquent de profondeur', () => {
    const now = Math.floor(new Date('2026-07-16T12:00:00Z').getTime() / 1000);
    expect(tradingSessions(SERIE, 5, now).map(x => x.date))
      .toEqual(['2026-07-13', '2026-07-14', '2026-07-15']);
  });

  it('serie trop courte pour minBars → aucune seance', () => {
    const now = Math.floor(new Date('2026-07-16T12:00:00Z').getTime() / 1000);
    expect(tradingSessions(SERIE, 130, now)).toEqual([]);
  });
});
