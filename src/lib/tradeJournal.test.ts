import { describe, it, expect } from 'vitest';
import { buildClosedTrades, computeStats, type ClosedTrade } from './tradeJournal';
import type { Transaction, TransactionType } from '../types';

const DAY = 86400;

let nextId = 1;
function tx(
  type: TransactionType,
  quantity: number,
  price: number,
  createdAt: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: nextId++,
    position_id: 1,
    ticker: 'AIR.PA',
    type,
    quantity,
    price,
    currency: 'EUR',
    linked_tx_id: null,
    fee: 0,
    note: '',
    setup: null,
    note_context: null,
    created_at: createdAt,
    ...overrides,
  };
}

describe('buildClosedTrades — appariement FIFO', () => {
  it('aucune vente → aucun trade fermé', () => {
    expect(buildClosedTrades('AIR.PA', 'Air Liquide', [tx('buy', 10, 100, 0)])).toEqual([]);
  });

  it('achat puis vente totale → un trade avec P&L correct', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('sell', 10, 120, 10 * DAY),
    ]);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.entryPrice).toBe(100);
    expect(t.exitPrice).toBe(120);
    expect(t.qty).toBe(10);
    expect(t.pnl).toBe(200);
    expect(t.pnlPct).toBeCloseTo(20, 10);
    expect(t.daysHeld).toBe(10);
  });

  it('FIFO : une vente consomme les lots dans l ordre, prix d entrée pondéré', () => {
    // 10 @ 100 puis 10 @ 200 ; vente de 15 → 10 du lot 1 + 5 du lot 2
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('buy', 10, 200, DAY),
      tx('sell', 15, 180, 2 * DAY),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].entryPrice).toBeCloseTo((10 * 100 + 5 * 200) / 15, 10);
    // entryDate = premier lot consommé
    expect(trades[0].entryDate).toBe(0);
  });

  it('ventes partielles successives → un trade fermé par vente', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('sell', 4, 110, DAY),
      tx('sell', 6, 130, 2 * DAY),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades[0].qty).toBe(4);
    expect(trades[1].qty).toBe(6);
    expect(trades[1].entryPrice).toBe(100);
  });

  it('vente sans lot disponible → ignorée silencieusement', () => {
    expect(buildClosedTrades('AIR.PA', 'Air Liquide', [tx('sell', 10, 120, 0)])).toEqual([]);
  });

  it('le stock pré-tracking forme un lot synthétique consommable', () => {
    const trades = buildClosedTrades(
      'AIR.PA', 'Air Liquide',
      [tx('sell', 5, 150, 20 * DAY)],
      10, 100, 'EUR', 0,
    );
    expect(trades).toHaveLength(1);
    expect(trades[0].entryPrice).toBe(100);
    expect(trades[0].setup).toBeNull();
    expect(trades[0].currency).toBe('EUR');
  });

  it('swap_out est ignoré (taux d échange, pas du fiat)', () => {
    const trades = buildClosedTrades('bitcoin', 'Bitcoin (BTC)', [
      tx('buy', 1, 50000, 0),
      tx('swap_out', 0.5, 15.2, DAY), // price = taux de swap, pas un prix de vente
    ]);
    expect(trades).toEqual([]);
  });

  it('setup et contexte pris sur le lot le plus récent consommé', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { setup: 'dip_sectoriel' }),
      tx('buy', 10, 200, DAY, { setup: 'breakout', note_context: '{"macroScore":62,"regime":"favorable"}' }),
      tx('sell', 15, 180, 2 * DAY),
    ]);
    expect(trades[0].setup).toBe('breakout');
    expect(trades[0].macroScore).toBe(62);
    expect(trades[0].regime).toBe('favorable');
  });

  it('rMultiple depuis initialStop du note_context', () => {
    // Entrée 100, stop 90 (1R = 10), sortie 120 → +2R
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { note_context: '{"initialStop":90}' }),
      tx('sell', 10, 120, DAY),
    ]);
    expect(trades[0].rMultiple).toBeCloseTo(2, 10);
    expect(trades[0].initialStop).toBe(90);
  });

  it('rMultiple null si pas de stop ou stop incohérent (≥ entrée)', () => {
    const noStop = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('sell', 10, 120, DAY),
    ]);
    expect(noStop[0].rMultiple).toBeNull();

    const badStop = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { note_context: '{"initialStop":100}' }),
      tx('sell', 10, 120, DAY),
    ]);
    expect(badStop[0].rMultiple).toBeNull();
  });

  it('note_context malformé → contexte vide, pas de crash', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { note_context: '{invalid json' }),
      tx('sell', 10, 120, DAY),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].macroScore).toBeNull();
    expect(trades[0].rMultiple).toBeNull();
  });

  it('trie par created_at, pas par ordre du tableau', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('sell', 10, 120, 2 * DAY),
      tx('buy', 10, 100, 0),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].pnl).toBe(200);
  });
});

describe('computeStats', () => {
  function trade(overrides: Partial<ClosedTrade>): ClosedTrade {
    return {
      id: 't', ticker: 'AIR.PA', positionName: 'Air Liquide', setup: null,
      entryPrice: 100, exitPrice: 110, qty: 1, currency: 'EUR',
      entryDate: 0, exitDate: DAY, daysHeld: 1,
      pnl: 10, pnlPct: 10, rMultiple: null, initialStop: null,
      macroScore: null, regime: null,
      ...overrides,
    };
  }

  it('null sans trade', () => {
    expect(computeStats([])).toBeNull();
  });

  it('winRate, moyennes et expectancy', () => {
    const stats = computeStats([
      trade({ pnl: 100, pnlPct: 10, daysHeld: 4 }),
      trade({ pnl: 50, pnlPct: 20, daysHeld: 6 }),
      trade({ pnl: -80, pnlPct: -5, daysHeld: 12 }),
    ])!;
    expect(stats.total).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(2 / 3, 10);
    expect(stats.avgWinPct).toBeCloseTo(15, 10);
    expect(stats.avgLossPct).toBeCloseTo(-5, 10);
    // expectancy = 2/3 × 15 + 1/3 × (−5)
    expect(stats.expectancy).toBeCloseTo(10 - 5 / 3, 10);
    expect(stats.avgDaysWinners).toBe(5);
    expect(stats.avgDaysLosers).toBe(12);
  });

  it('un P&L de 0 compte comme une perte (pas de zone grise)', () => {
    const stats = computeStats([trade({ pnl: 0, pnlPct: 0 })])!;
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(1);
  });

  it('avgR calculé uniquement sur les trades avec un R disponible', () => {
    const stats = computeStats([
      trade({ rMultiple: 2 }),
      trade({ rMultiple: -1 }),
      trade({ rMultiple: null }),
    ])!;
    expect(stats.avgR).toBeCloseTo(0.5, 10);

    const noR = computeStats([trade({})])!;
    expect(noR.avgR).toBeNull();
  });

  it('bySetup : groupement, label, tri par effectif décroissant', () => {
    const stats = computeStats([
      trade({ setup: 'breakout', pnl: 10, pnlPct: 5 }),
      trade({ setup: 'breakout', pnl: -10, pnlPct: -5 }),
      trade({ setup: null, pnl: 10, pnlPct: 8 }),
    ])!;
    expect(stats.bySetup).toHaveLength(2);
    expect(stats.bySetup[0].setup).toBe('breakout');
    expect(stats.bySetup[0].label).toBe('Breakout');
    expect(stats.bySetup[0].count).toBe(2);
    expect(stats.bySetup[0].winRate).toBe(0.5);
    expect(stats.bySetup[0].avgPnlPct).toBe(0);
    expect(stats.bySetup[1].label).toBe('Non défini');
  });
});
