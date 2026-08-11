import { describe, it, expect } from 'vitest';
import { computeHeatScore, computeStreaks, isLikelyPegged, rankScreener } from './cryptoScreener';
import type { Top100Coin } from './api/coingecko';
import type { ScreenerLogRow } from '../types';

function row(date: string, coinId: string, rank = 1): ScreenerLogRow {
  return { id: 0, date, coin_id: coinId, symbol: coinId.toUpperCase(), heat: 70, rank };
}

function makeCoin(overrides: Partial<Top100Coin> = {}): Top100Coin {
  return {
    id: 'test-coin',
    symbol: 'TST',
    name: 'Test Coin',
    price: 100,
    marketCap: 1_000_000_000,
    marketCapRank: 42,
    volume24h: 50_000_000,
    perf24h: 0,
    perf7d: 0,
    perf30d: 0,
    sparkline7d: Array.from({ length: 168 }, (_, i) => 100 + Math.sin(i / 10) * 5),
    ...overrides,
  };
}

describe('isLikelyPegged', () => {
  it('detecte un stablecoin (range < 1.5%)', () => {
    const flat = Array.from({ length: 168 }, () => 1.0002);
    expect(isLikelyPegged(flat)).toBe(true);
  });

  it('ne flag pas un actif volatil', () => {
    const volatile = Array.from({ length: 168 }, (_, i) => 100 + i * 0.5);
    expect(isLikelyPegged(volatile)).toBe(false);
  });

  it('traite une serie trop courte comme suspecte', () => {
    expect(isLikelyPegged([1])).toBe(true);
    expect(isLikelyPegged([])).toBe(true);
  });
});

describe('computeHeatScore', () => {
  it('reste dans 0-100', () => {
    const hot = computeHeatScore(makeCoin({ perf24h: 40, perf7d: 5 }), 100);
    expect(hot.heat).toBeGreaterThanOrEqual(0);
    expect(hot.heat).toBeLessThanOrEqual(100);

    const cold = computeHeatScore(makeCoin({ perf24h: -40, perf7d: -5 }), 0);
    expect(cold.heat).toBeGreaterThanOrEqual(0);
    expect(cold.heat).toBeLessThanOrEqual(100);
  });

  it('score plus haut pour une acceleration positive que negative, toutes choses egales', () => {
    const accelerating = computeHeatScore(makeCoin({ perf24h: 5, perf7d: 7 }), 50);
    const decelerating = computeHeatScore(makeCoin({ perf24h: -5, perf7d: 7 }), 50);
    expect(accelerating.heat).toBeGreaterThan(decelerating.heat);
  });

  it('neutralise a 50 sans donnees de performance', () => {
    const noPerf = computeHeatScore(makeCoin({ perf24h: null, perf7d: null, sparkline7d: [] }), 50);
    expect(noPerf.accelScore).toBe(50);
    expect(noPerf.rsi).toBeNull();
    expect(noPerf.rangePos).toBeNull();
  });
});

describe('rankScreener', () => {
  it('exclut les pieces pegged du classement', () => {
    const stable = makeCoin({ id: 'stable', sparkline7d: Array.from({ length: 168 }, () => 1.0001) });
    const volatile = makeCoin({ id: 'volatile' });
    const ranked = rankScreener([stable, volatile]);
    expect(ranked.map((r) => r.coin.id)).toEqual(['volatile']);
  });

  it('trie par score decroissant', () => {
    const strong = makeCoin({ id: 'strong', perf24h: 15, perf7d: 5 });
    const weak = makeCoin({ id: 'weak', perf24h: -15, perf7d: -5 });
    const ranked = rankScreener([weak, strong]);
    expect(ranked[0].coin.id).toBe('strong');
    expect(ranked[0].heat).toBeGreaterThanOrEqual(ranked[1].heat);
  });

  it('ignore les pieces sans capitalisation', () => {
    const zeroMcap = makeCoin({ id: 'zero', marketCap: 0 });
    const ranked = rankScreener([zeroMcap]);
    expect(ranked).toHaveLength(0);
  });

  it('exclut les tokens adosses a l\'or malgre un prix volatil', () => {
    const gold = makeCoin({
      id: 'tether-gold',
      sparkline7d: Array.from({ length: 168 }, (_, i) => 2400 + i * 0.5),
    });
    const volatile = makeCoin({ id: 'volatile' });
    const ranked = rankScreener([gold, volatile]);
    expect(ranked.map((r) => r.coin.id)).toEqual(['volatile']);
  });
});

describe('computeStreaks', () => {
  it('compte les jours consecutifs jusqu\'au jour le plus recent', () => {
    const rows = [
      row('2026-08-01', 'bitcoin'), row('2026-08-02', 'bitcoin'), row('2026-08-03', 'bitcoin'),
    ];
    expect(computeStreaks(rows).get('bitcoin')).toBe(3);
  });

  it('ignore un jour totalement absent du log (app fermee ce jour-la)', () => {
    // Pas de ligne du tout le 08-02, ni pour bitcoin ni pour un autre coin :
    // impossible de savoir si l'app etait ouverte, donc le trou ne casse pas le streak.
    const rows = [row('2026-08-01', 'bitcoin'), row('2026-08-03', 'bitcoin')];
    expect(computeStreaks(rows).get('bitcoin')).toBe(2);
  });

  it('casse le streak si un autre coin est logue le jour ou la piece est absente', () => {
    // Le 08-02, ethereum est logue (preuve que l'app etait ouverte) mais pas
    // bitcoin : bitcoin est vraiment sorti du top ce jour-la, le streak casse.
    const rows = [
      row('2026-08-01', 'bitcoin'), row('2026-08-02', 'ethereum'),
      row('2026-08-03', 'bitcoin'), row('2026-08-03', 'ethereum'),
    ];
    expect(computeStreaks(rows).get('bitcoin')).toBe(1);
  });

  it('retourne une map vide sans historique', () => {
    expect(computeStreaks([]).size).toBe(0);
  });

  it('ne renvoie un streak que pour les pieces presentes au jour le plus recent', () => {
    const rows = [row('2026-08-01', 'bitcoin'), row('2026-08-02', 'ethereum')];
    const streaks = computeStreaks(rows);
    expect(streaks.has('bitcoin')).toBe(false);
    expect(streaks.get('ethereum')).toBe(1);
  });
});
