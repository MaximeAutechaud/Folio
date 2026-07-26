import { describe, it, expect } from 'vitest';
import { findBarIndex, forwardRelPerf, tradingSessions } from './rebuildSignals';

// bougies a 13:30 UTC, comme celles de Yahoo pour les marches US
function bar(dateIso: string, value: number) {
  return { time: Math.floor(new Date(`${dateIso}T13:30:00Z`).getTime() / 1000), value };
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

describe('forwardRelPerf', () => {
  const spy = SERIE.map((p, i) => ({ time: p.time, value: 100 + i })); // +1/seance

  it('performance relative sur N seances', () => {
    // etf 100 -> 103 sur 3 seances = +3% ; spy 100 -> 103 = +3% → relatif 0
    expect(forwardRelPerf(SERIE, spy, '2026-07-06', 3)).toBeCloseTo(0, 6);
  });

  it('isole la surperformance', () => {
    const fort = SERIE.map((p, i) => ({ time: p.time, value: 100 + i * 2 }));
    const r = forwardRelPerf(fort, spy, '2026-07-06', 3)!;
    expect(r).toBeGreaterThan(0);
  });

  it('null si les seances futures n existent pas encore', () => {
    // 20 seances apres le debut : la serie n en a que 8
    expect(forwardRelPerf(SERIE, spy, '2026-07-06', 20)).toBeNull();
  });

  it('null sur une date hors serie', () => {
    expect(forwardRelPerf(SERIE, spy, '2026-08-01', 5)).toBeNull();
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
