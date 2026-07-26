import { describe, it, expect } from 'vitest';
import { lastSettledSession, truncate, toDateString, sessionEnd } from './settledSignals';

const DAY = 86400;
// 2026-07-20T20:00:00Z, un lundi de cloture
const MON = Math.floor(new Date('2026-07-20T20:00:00Z').getTime() / 1000);

function bars(n: number, endTime = MON): { time: number; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({ time: endTime - (n - 1 - i) * DAY, value: 100 + i }));
}

describe('toDateString / sessionEnd', () => {
  it('convertit en date UTC', () => {
    expect(toDateString(MON)).toBe('2026-07-20');
  });

  it('sessionEnd couvre toute la journee', () => {
    expect(sessionEnd('2026-07-20')).toBeGreaterThan(MON);
    expect(toDateString(sessionEnd('2026-07-20'))).toBe('2026-07-20');
  });
});

describe('truncate', () => {
  it('ne garde aucune bougie posterieure a la seance visee', () => {
    const series = bars(5);
    const cut = truncate(series, MON - 2 * DAY);
    expect(cut).toHaveLength(3);
    expect(Math.max(...cut.map((p) => p.time))).toBeLessThanOrEqual(MON - 2 * DAY);
  });

  it('serie vide', () => {
    expect(truncate([], MON)).toEqual([]);
  });

  it('spanDays borne aussi le debut', () => {
    const cut = truncate(bars(200), MON, 10);
    expect(cut).toHaveLength(11); // les 10 jours precedents + la seance visee
    expect(Math.min(...cut.map(p => p.time))).toBeGreaterThanOrEqual(MON - 10 * DAY);
  });

  it('fenetre entierement anterieure a la serie → vide', () => {
    expect(truncate(bars(5), MON - 99 * DAY)).toEqual([]);
  });

  it('la dichotomie donne exactement le meme resultat que le filtre lineaire', () => {
    const series = bars(500);
    const naive = (s: typeof series, at: number, span?: number) =>
      s.filter(p => p.time <= at && p.time >= (span != null ? at - span * DAY : -Infinity));
    for (const at of [MON, MON - 1, MON - 250 * DAY, MON - 499 * DAY, MON + DAY]) {
      for (const span of [undefined, 0, 1, 183]) {
        expect(truncate(series, at, span)).toEqual(naive(series, at, span));
      }
    }
  });
});

describe('lastSettledSession', () => {
  it('ecarte la bougie du jour meme apres la cloture', () => {
    // « maintenant » = le lundi a 23h : la bougie du lundi existe mais est du jour
    const now = Math.floor(new Date('2026-07-20T23:00:00Z').getTime() / 1000);
    const s = lastSettledSession(bars(5), now)!;
    expect(s.date).toBe('2026-07-19');
  });

  it('le lendemain, la seance de la veille devient exploitable', () => {
    const now = Math.floor(new Date('2026-07-21T09:00:00Z').getTime() / 1000);
    const s = lastSettledSession(bars(5), now)!;
    expect(s.date).toBe('2026-07-20');
  });

  it('resultat identique quelle que soit l heure d execution du meme jour', () => {
    const matin = Math.floor(new Date('2026-07-21T07:00:00Z').getTime() / 1000);
    const soir  = Math.floor(new Date('2026-07-21T22:00:00Z').getTime() / 1000);
    expect(lastSettledSession(bars(5), matin)).toEqual(lastSettledSession(bars(5), soir));
  });

  it('week-end : renvoie la derniere seance cotee, pas un jour sans bougie', () => {
    // bougies jusqu au vendredi 17, « maintenant » = dimanche 19
    const vendredi = Math.floor(new Date('2026-07-17T20:00:00Z').getTime() / 1000);
    const dimanche = Math.floor(new Date('2026-07-19T12:00:00Z').getTime() / 1000);
    expect(lastSettledSession(bars(5, vendredi), dimanche)!.date).toBe('2026-07-17');
  });

  it('null si la serie ne contient que la bougie du jour', () => {
    const now = Math.floor(new Date('2026-07-20T23:00:00Z').getTime() / 1000);
    expect(lastSettledSession([{ time: MON, value: 1 }], now)).toBeNull();
  });

  it('null sur une serie vide', () => {
    expect(lastSettledSession([], MON)).toBeNull();
  });
});
