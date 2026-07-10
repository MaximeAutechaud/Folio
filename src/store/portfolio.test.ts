import { describe, it, expect } from 'vitest';
import { convertCurrency, computeTotals, resolvePositions } from './portfolio';
import type { Position, Transaction } from '../types';

function pos(overrides: Partial<Position>): Position {
  return {
    id: 1,
    ticker: 'AAPL',
    name: 'Apple',
    asset_type: 'stock',
    currency: 'USD',
    quantity: 0,
    cost_basis: 0,
    stop_price: null,
    target_price: null,
    target_price_2: null,
    note: null,
    sector_id: null,
    created_at: 0,
    ...overrides,
  };
}

describe('convertCurrency', () => {
  const EURUSD = 1.1;

  it('identité quand from === to', () => {
    expect(convertCurrency(100, 'EUR', 'EUR', EURUSD)).toBe(100);
    expect(convertCurrency(100, 'USD', 'USD', EURUSD)).toBe(100);
  });

  it('EUR → USD multiplie par le taux', () => {
    expect(convertCurrency(100, 'EUR', 'USD', EURUSD)).toBeCloseTo(110, 10);
  });

  it('USD → EUR divise par le taux', () => {
    expect(convertCurrency(110, 'USD', 'EUR', EURUSD)).toBeCloseTo(100, 10);
  });

  it('aller-retour EUR → USD → EUR restitue le montant', () => {
    const usd = convertCurrency(123.45, 'EUR', 'USD', EURUSD);
    expect(convertCurrency(usd, 'USD', 'EUR', EURUSD)).toBeCloseTo(123.45, 10);
  });

  // Scope assumé EUR/USD only (décision 2026-07-10) : toute devise non-EUR
  // est traitée comme USD. Ce test documente la limitation — s'il casse,
  // c'est que le scope a changé et que les vrais taux sont branchés.
  it('limitation connue : une devise non-EUR est traitée comme USD', () => {
    expect(convertCurrency(100, 'GBP', 'USD', EURUSD)).toBe(100);
    expect(convertCurrency(100, 'GBP', 'EUR', EURUSD)).toBeCloseTo(100 / EURUSD, 10);
  });
});

describe('computeTotals', () => {
  const EURUSD = 1.1;

  it('position EUR en base EUR — pas de conversion', () => {
    const positions = [pos({ ticker: 'AIR.PA', currency: 'EUR', quantity: 10, cost_basis: 100 })];
    const { totalValue, totalCost } = computeTotals(positions, { 'AIR.PA': 150 }, 'EUR', EURUSD);
    expect(totalCost).toBe(1000);
    expect(totalValue).toBe(1500);
  });

  it('position EUR en base USD — coût et valeur convertis', () => {
    const positions = [pos({ ticker: 'AIR.PA', currency: 'EUR', quantity: 10, cost_basis: 100 })];
    const { totalValue, totalCost } = computeTotals(positions, { 'AIR.PA': 150 }, 'USD', EURUSD);
    expect(totalCost).toBeCloseTo(1100, 10);
    expect(totalValue).toBeCloseTo(1650, 10);
  });

  it('la devise du prix vient du suffixe ticker, pas de la devise de la position', () => {
    // Position déclarée en USD mais ticker .PA → le prix Yahoo est en EUR.
    // Coût converti depuis USD, valeur convertie depuis EUR.
    const positions = [pos({ ticker: 'AIR.PA', currency: 'USD', quantity: 10, cost_basis: 100 })];
    const { totalValue, totalCost } = computeTotals(positions, { 'AIR.PA': 150 }, 'EUR', EURUSD);
    expect(totalCost).toBeCloseTo(1000 / EURUSD, 10);
    expect(totalValue).toBe(1500);
  });

  it('prix manquant → compté dans le coût mais pas dans la valeur', () => {
    const positions = [
      pos({ id: 1, ticker: 'AIR.PA', currency: 'EUR', quantity: 10, cost_basis: 100 }),
      pos({ id: 2, ticker: 'MC.PA', currency: 'EUR', quantity: 2, cost_basis: 600 }),
    ];
    const { totalValue, totalCost } = computeTotals(positions, { 'AIR.PA': 150 }, 'EUR', EURUSD);
    expect(totalCost).toBe(1000 + 1200);
    expect(totalValue).toBe(1500);
  });

  it('les positions fiat sont ignorées', () => {
    const positions = [
      pos({ id: 1, ticker: 'AIR.PA', currency: 'EUR', quantity: 10, cost_basis: 100 }),
      pos({ id: 2, ticker: 'EUR', asset_type: 'fiat', currency: 'EUR', quantity: 5000, cost_basis: 1 }),
    ];
    const { totalValue, totalCost } = computeTotals(positions, { 'AIR.PA': 150, EUR: 1 }, 'EUR', EURUSD);
    expect(totalCost).toBe(1000);
    expect(totalValue).toBe(1500);
  });

  it('portefeuille mixte EUR + USD agrégé en base EUR', () => {
    const positions = [
      pos({ id: 1, ticker: 'AIR.PA', currency: 'EUR', quantity: 10, cost_basis: 100 }),
      pos({ id: 2, ticker: 'AAPL', currency: 'USD', quantity: 5, cost_basis: 200 }),
    ];
    const prices = { 'AIR.PA': 150, AAPL: 220 };
    const { totalValue, totalCost } = computeTotals(positions, prices, 'EUR', EURUSD);
    expect(totalCost).toBeCloseTo(1000 + 1000 / EURUSD, 10);
    expect(totalValue).toBeCloseTo(1500 + 1100 / EURUSD, 10);
  });
});

describe('resolvePositions', () => {
  function tx(positionId: number, type: Transaction['type'], quantity: number, price: number, createdAt: number): Transaction {
    return {
      id: createdAt,
      position_id: positionId,
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
    };
  }

  it('sans transaction, la position est retournée telle quelle', () => {
    const p = pos({ quantity: 10, cost_basis: 100 });
    expect(resolvePositions([p], {})).toEqual([p]);
    expect(resolvePositions([p], { 1: [] })).toEqual([p]);
  });

  it('les positions fiat ne sont jamais recalculées', () => {
    const p = pos({ asset_type: 'fiat', quantity: 5000, cost_basis: 1 });
    const resolved = resolvePositions([p], { 1: [tx(1, 'buy', 100, 2, 1)] });
    expect(resolved[0].quantity).toBe(5000);
    expect(resolved[0].cost_basis).toBe(1);
  });

  it('quantité/PRU stockés = état initial, les transactions s empilent dessus', () => {
    // 10 @ 100 pré-tracking + achat 10 @ 200 → 20 @ 150
    const p = pos({ quantity: 10, cost_basis: 100 });
    const resolved = resolvePositions([p], { 1: [tx(1, 'buy', 10, 200, 1)] });
    expect(resolved[0].quantity).toBe(20);
    expect(resolved[0].cost_basis).toBe(150);
  });

  it('une vente ne peut pas effacer le stock initial au-delà de zéro', () => {
    const p = pos({ quantity: 10, cost_basis: 100 });
    const resolved = resolvePositions([p], { 1: [tx(1, 'sell', 4, 150, 1)] });
    expect(resolved[0].quantity).toBe(6);
    expect(resolved[0].cost_basis).toBe(100);
  });

  it('chaque position utilise ses propres transactions', () => {
    const p1 = pos({ id: 1, quantity: 10, cost_basis: 100 });
    const p2 = pos({ id: 2, ticker: 'MC.PA', quantity: 2, cost_basis: 600 });
    const resolved = resolvePositions([p1, p2], { 1: [tx(1, 'buy', 10, 200, 1)] });
    expect(resolved[0].quantity).toBe(20);
    expect(resolved[1].quantity).toBe(2);
    expect(resolved[1].cost_basis).toBe(600);
  });
});
