import { describe, it, expect } from 'vitest';
import { computeDeleteImpact, isDestructive } from './deleteImpact';
import type { Position, Transaction, TransactionType } from '../types';

const DAY = 86400;
let nextId = 1;

function pos(overrides: Partial<Position> = {}): Position {
  return {
    id: 1, ticker: 'AIR.PA', name: 'Air Liquide', asset_type: 'stock',
    currency: 'EUR', quantity: 0, cost_basis: 0,
    stop_price: null, target_price: null, target_price_2: null,
    note: null, sector_id: null, created_at: 0,
    ...overrides,
  };
}

function tx(
  type: TransactionType, quantity: number, price: number, createdAt: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: nextId++, position_id: 1, ticker: 'AIR.PA', type, quantity, price,
    currency: 'EUR', linked_tx_id: null, fee: 0, note: '', setup: null,
    note_context: null, created_at: createdAt,
    ...overrides,
  };
}

describe('computeDeleteImpact', () => {
  it('position sans transaction — rien à perdre', () => {
    const impact = computeDeleteImpact(pos({ quantity: 10, cost_basis: 100 }), [], 10);
    expect(impact.transactions).toBe(0);
    expect(impact.closedTrades).toBe(0);
    expect(isDestructive(impact)).toBe(false);
  });

  it('compte les transactions détruites par le CASCADE', () => {
    const txs = [tx('buy', 10, 100, 0), tx('sell', 4, 120, DAY)];
    const impact = computeDeleteImpact(pos(), txs, 6);
    expect(impact.transactions).toBe(2);
    expect(isDestructive(impact)).toBe(true);
  });

  it('compte les trades clôturés retirés du journal', () => {
    const txs = [
      tx('buy', 10, 100, 0, { note_context: '{"initialStop":90}' }),
      tx('sell', 5, 120, DAY),
      tx('sell', 5, 130, 2 * DAY),
    ];
    const impact = computeDeleteImpact(pos(), txs, 0);
    expect(impact.closedTrades).toBe(2);
  });

  it('applique le même critère que le journal : sans stop à l achat, pas de trade', () => {
    const txs = [tx('buy', 10, 100, 0), tx('sell', 10, 120, DAY)];
    const impact = computeDeleteImpact(pos(), txs, 0);
    expect(impact.transactions).toBe(2);
    expect(impact.closedTrades).toBe(0);
    // Des transactions partent quand même : la suppression reste destructive.
    expect(isDestructive(impact)).toBe(true);
  });

  it('signale une position encore ouverte', () => {
    const open = computeDeleteImpact(pos(), [tx('buy', 10, 100, 0)], 10);
    expect(open.stillOpen).toBe(true);
    expect(open.quantity).toBe(10);

    const closed = computeDeleteImpact(pos(), [tx('buy', 10, 100, 0), tx('sell', 10, 120, DAY)], 0);
    expect(closed.stillOpen).toBe(false);
  });

  it('une quantité résiduelle négligeable ne compte pas comme ouverte', () => {
    expect(computeDeleteImpact(pos(), [], 1e-12).stillOpen).toBe(false);
  });

  it('tient compte des splits pour les trades comptés', () => {
    const txs = [
      tx('buy', 10, 100, 0, { note_context: '{"initialStop":90}' }),
      tx('split', 0, 2, DAY),
      tx('sell', 20, 60, 2 * DAY),
    ];
    const impact = computeDeleteImpact(pos(), txs, 0);
    expect(impact.transactions).toBe(3);
    expect(impact.closedTrades).toBe(1);
  });
});
