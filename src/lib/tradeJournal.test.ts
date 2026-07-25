import { describe, it, expect } from 'vitest';
import { buildClosedTrades, computeStats, type ClosedTrade } from './tradeJournal';
import { computePRU } from './pru';
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

describe('buildClosedTrades — frais', () => {
  it('sans frais, net = brut', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('sell', 10, 120, DAY),
    ]);
    expect(trades[0].pnlGross).toBe(200);
    expect(trades[0].fees).toBe(0);
    expect(trades[0].pnl).toBe(200);
  });

  it('aller-retour au même prix avec frais → perte', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { fee: 5 }),
      tx('sell', 10, 100, DAY, { fee: 5 }),
    ]);
    expect(trades[0].pnlGross).toBe(0);
    expect(trades[0].fees).toBeCloseTo(10, 10);
    expect(trades[0].pnl).toBeCloseTo(-10, 10);
    expect(trades[0].pnlPct).toBeLessThan(0);
  });

  it('vente partielle ne consomme que la part de frais d entrée du lot vendu', () => {
    // 10 @ 100 avec 10€ de frais → 1€/action. Vente de 4 → 4€ de frais d'entrée.
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { fee: 10 }),
      tx('sell', 4, 120, DAY, { fee: 2 }),
    ]);
    expect(trades[0].fees).toBeCloseTo(4 + 2, 10);
    expect(trades[0].pnl).toBeCloseTo(80 - 6, 10);
  });

  it('deux lots à frais différents → prorata FIFO', () => {
    // Lot A : 10 @ 100, frais 10 (1/action). Lot B : 10 @ 200, frais 30 (3/action).
    // Vente de 15 → 10 du lot A (10€) + 5 du lot B (15€) = 25€ de frais d'entrée.
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { fee: 10 }),
      tx('buy', 10, 200, DAY, { fee: 30 }),
      tx('sell', 15, 180, 2 * DAY, { fee: 5 }),
    ]);
    expect(trades[0].fees).toBeCloseTo(25 + 5, 10);
  });

  it('rendement % rapporté au capital engagé, frais d entrée inclus', () => {
    // 10 @ 100 + 10 de frais = 1010 engagés. Sortie 110 × 10 − 0 = 1100.
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { fee: 10 }),
      tx('sell', 10, 110, DAY),
    ]);
    expect(trades[0].pnl).toBeCloseTo(90, 10);
    expect(trades[0].pnlPct).toBeCloseTo((90 / 1010) * 100, 10);
  });

  it('le R est net de frais', () => {
    // Entrée 100, stop 90 → 1R = 10€/action, 100€ pour 10 actions.
    // Sortie 120 → brut 200 (=2R), frais 20 → net 180 = 1.8R
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { fee: 10, note_context: '{"initialStop":90}' }),
      tx('sell', 10, 120, DAY, { fee: 10 }),
    ]);
    expect(trades[0].rMultiple).toBeCloseTo(1.8, 10);
  });

  it('frais de sortie au prorata quand la vente dépasse les lots disponibles', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 5, 100, 0),
      tx('sell', 10, 120, DAY, { fee: 10 }), // seules 5 actions existent
    ]);
    expect(trades[0].qty).toBe(5);
    expect(trades[0].fees).toBeCloseTo(5, 10);
  });
});

describe('buildClosedTrades — corporate actions', () => {
  it('split 2:1 avant la vente → PRU et quantité ajustés', () => {
    // 10 @ 100 puis split 2:1 → 20 @ 50. Vente des 20 à 60 → +200
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('split', 0, 2, DAY),
      tx('sell', 20, 60, 2 * DAY),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].qty).toBe(20);
    expect(trades[0].entryPrice).toBeCloseTo(50, 10);
    expect(trades[0].pnl).toBeCloseTo(200, 10);
  });

  it('regroupement 1:2 (ratio 0.5) → quantité divisée, PRU doublé', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('split', 0, 0.5, DAY),
      tx('sell', 5, 220, 2 * DAY),
    ]);
    expect(trades[0].entryPrice).toBeCloseTo(200, 10);
    expect(trades[0].pnl).toBeCloseTo(100, 10);
  });

  it('le split conserve les frais d entrée du lot', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0, { fee: 10 }),
      tx('split', 0, 2, DAY),
      tx('sell', 20, 50, 2 * DAY),
    ]);
    // Sortie au PRU post-split → brut nul, seuls les 10€ de frais restent.
    expect(trades[0].pnlGross).toBeCloseTo(0, 10);
    expect(trades[0].fees).toBeCloseTo(10, 10);
  });

  it('split ignoré si ratio nul ou négatif', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('split', 0, 0, DAY),
      tx('sell', 10, 120, 2 * DAY),
    ]);
    expect(trades[0].entryPrice).toBe(100);
    expect(trades[0].pnl).toBe(200);
  });

  it('action gratuite → dilue le PRU des lots ouverts', () => {
    // 10 @ 100 (coût 1000) + 1 action gratuite → 11 actions, PRU 1000/11
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('bonus_share', 1, 0, DAY),
      tx('sell', 11, 100, 2 * DAY),
    ]);
    expect(trades[0].qty).toBeCloseTo(11, 10);
    expect(trades[0].entryPrice).toBeCloseTo(1000 / 11, 10);
    expect(trades[0].pnl).toBeCloseTo(100, 10); // la 11e action est du pur gain
  });

  it('action gratuite dilue tous les lots ouverts au prorata', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('buy', 10, 200, DAY),
      tx('bonus_share', 2, 0, 2 * DAY), // 20 détenues → 22
      tx('sell', 22, 150, 3 * DAY),
    ]);
    // Coût total inchangé (3000), 22 actions vendues à 150 → 3300
    expect(trades[0].qty).toBeCloseTo(22, 10);
    expect(trades[0].pnl).toBeCloseTo(300, 10);
  });

  it('action gratuite sans lot ouvert → ignorée', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('bonus_share', 5, 0, 0),
      tx('sell', 5, 100, DAY),
    ]);
    expect(trades).toEqual([]);
  });

  it('le dividende ne touche ni la quantité ni le PRU', () => {
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      tx('buy', 10, 100, 0),
      tx('dividend', 10, 3, DAY), // 3€/action × 10 actions
      tx('sell', 10, 120, 2 * DAY),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].qty).toBe(10);
    expect(trades[0].entryPrice).toBe(100);
    expect(trades[0].pnl).toBe(200);
  });

  it('cohérence avec computePRU sur split + action gratuite + frais', () => {
    const ledger = [
      tx('buy', 10, 100, 0, { fee: 10 }),
      tx('split', 0, 2, DAY),
      tx('bonus_share', 2, 0, 2 * DAY),
    ];
    const { quantity, costBasis } = computePRU(ledger);
    const trades = buildClosedTrades('AIR.PA', 'Air Liquide', [
      ...ledger,
      tx('sell', quantity, 80, 3 * DAY),
    ]);
    expect(trades[0].qty).toBeCloseTo(quantity, 10);
    // Le PRU de computePRU intègre les frais d'achat ; ici entryPrice est hors
    // frais et fees les porte à part — la somme doit se retrouver.
    const investedFromTrade = trades[0].qty * trades[0].entryPrice + trades[0].fees;
    expect(investedFromTrade).toBeCloseTo(quantity * costBasis, 8);
  });
});

describe('computeStats', () => {
  function trade(overrides: Partial<ClosedTrade>): ClosedTrade {
    return {
      id: 't', ticker: 'AIR.PA', positionName: 'Air Liquide', setup: null,
      entryPrice: 100, exitPrice: 110, qty: 1, currency: 'EUR',
      entryDate: 0, exitDate: DAY, daysHeld: 1,
      pnlGross: 10, fees: 0, pnl: 10, pnlPct: 10, rMultiple: null, initialStop: null,
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
