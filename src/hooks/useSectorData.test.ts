import { describe, it, expect } from 'vitest';
import {
  sliceByBars,
  calcPerf,
  calcBenchWindows,
  computeEtfMetrics,
  BARS,
  type Point,
} from './useSectorData';

const DAY = 86400;
const START = Math.floor(new Date('2020-01-02T14:30:00Z').getTime() / 1000);

/** Série journalière régulière, valeur = 100 + i. */
function serie(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ time: START + i * DAY, value: 100 + i }));
}

describe('sliceByBars', () => {
  it('n seances = n+1 bougies — il faut deux bornes pour mesurer une variation', () => {
    expect(sliceByBars(serie(50), 5)).toHaveLength(6);
    expect(sliceByBars(serie(50), 1)).toHaveLength(2);
  });

  it('prend bien la fin de serie, pas le debut', () => {
    const cut = sliceByBars(serie(50), 5);
    expect(cut[cut.length - 1].value).toBe(149);
    expect(cut[0].value).toBe(144);
  });

  it('serie plus courte que la fenetre → serie entiere, sans erreur', () => {
    expect(sliceByBars(serie(3), 20)).toHaveLength(3);
    expect(sliceByBars([], 20)).toEqual([]);
  });

  it('une perf sur 5 seances mesure bien 5 pas de la serie', () => {
    // 100 → 105 sur les 5 dernieres seances d une serie qui monte de 1/jour
    const perf = calcPerf(sliceByBars(serie(6), 5))!;
    expect(perf).toBeCloseTo((105 - 100) / 100 * 100, 10);
  });

  it('la fenetre ne depend pas des jours de calendrier absents', () => {
    // Meme serie, mais avec un trou de 10 jours au milieu (long week-end,
    // suspension de cotation). Une borne calendaire aurait change le nombre de
    // bougies retenues ; une borne en barres, non — c'est tout l interet.
    const trouee = serie(30).map((p, i) => ({ ...p, time: p.time + (i >= 15 ? 10 * DAY : 0) }));
    expect(sliceByBars(trouee, BARS.w1)).toHaveLength(BARS.w1 + 1);
    expect(sliceByBars(serie(30), BARS.w1)).toHaveLength(BARS.w1 + 1);
  });
});

describe('calcBenchWindows', () => {
  it('chaque fenetre couvre son nombre de seances', () => {
    // serie a +1/jour depuis 100 : la perf sur n seances part de 100+(len-1-n)
    const s = serie(200);
    const w = calcBenchWindows(s, BARS.m3);
    const expected = (n: number) => {
      const from = 100 + (200 - 1 - n);
      return ((100 + 199 - from) / from) * 100;
    };
    expect(w.w1!).toBeCloseTo(expected(BARS.w1), 10);
    expect(w.m1!).toBeCloseTo(expected(BARS.m1), 10);
    expect(w.m3!).toBeCloseTo(expected(BARS.m3), 10);
    expect(w.period!).toBeCloseTo(expected(BARS.m3), 10);
  });

  it('serie vide → toutes les fenetres nulles', () => {
    const w = calcBenchWindows([], BARS.m3);
    expect([w.period, w.w1, w.m1, w.m3]).toEqual([null, null, null, null]);
  });
});

describe('computeEtfMetrics — bornes de fenetre', () => {
  const flat = (n: number): Point[] =>
    Array.from({ length: n }, (_, i) => ({ time: START + i * DAY, value: 100 }));
  const zeroBench = { period: 0, w1: 0, m1: 0, m3: 0 };

  it('drawdown6M ne remonte pas au-dela de 126 seances', () => {
    // Un pic isole 300 seances avant la fin ne doit plus etre vu comme un
    // « plus haut 6 mois ». C'etait le bug : high6M prenait le maximum de
    // TOUTE la serie recue, donc un historique long donnait un plus haut sur
    // seize ans et un drawdown faux.
    const s = flat(400);
    s[50] = { ...s[50], value: 500 };
    const m = computeEtfMetrics(s, zeroBench, zeroBench, BARS.m3);
    expect(m.drawdown6M).toBeCloseTo(0, 10);
  });

  it('mais voit bien un pic situe dans la fenetre', () => {
    const s = flat(400);
    s[399 - 100] = { ...s[399 - 100], value: 200 };
    const m = computeEtfMetrics(s, zeroBench, zeroBench, BARS.m3);
    expect(m.drawdown6M!).toBeCloseTo(-50, 10);
  });

  it('le resultat ne depend plus de la longueur de serie fournie', () => {
    // Meme fin de serie, profondeurs differentes : les metriques doivent
    // coincider. C'est la propriete qui rend la troncature purement optionnelle
    // (et donc purement une optimisation).
    const long = serie(1000);
    const court = long.slice(-140);
    const a = computeEtfMetrics(long, zeroBench, zeroBench, BARS.m3);
    const b = computeEtfMetrics(court, zeroBench, zeroBench, BARS.m3);
    expect(b.drawdown6M).toBeCloseTo(a.drawdown6M!, 10);
    expect(b.drawdown3M).toBeCloseTo(a.drawdown3M!, 10);
    expect(b.rsi).toBeCloseTo(a.rsi!, 10);
    expect(b.ma50).toBeCloseTo(a.ma50!, 10);
    expect(b.relPerf3M).toBeCloseTo(a.relPerf3M!, 10);
  });

  it('ma50Above compare le dernier cours a la moyenne des 50 dernieres seances', () => {
    const m = computeEtfMetrics(serie(200), zeroBench, zeroBench, BARS.m3);
    expect(m.ma50Above).toBe(true); // serie croissante
    expect(m.ma50!).toBeLessThan(m.currentPrice!);
  });
});
