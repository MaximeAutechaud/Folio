import { describe, it, expect } from 'vitest';
import { computePRU } from './pru';
import type { Transaction, TransactionType } from '../types';

let nextId = 1;
function tx(
  type: TransactionType,
  quantity: number,
  price: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: nextId++,
    position_id: 1,
    ticker: 'TEST.PA',
    type,
    quantity,
    price,
    currency: 'EUR',
    linked_tx_id: null,
    fee: 0,
    note: '',
    setup: null,
    note_context: null,
    created_at: nextId,
    ...overrides,
  };
}

describe('computePRU — base', () => {
  it('retourne l état initial sans transaction', () => {
    expect(computePRU([], 10, 50)).toEqual({ quantity: 10, costBasis: 50 });
    expect(computePRU([])).toEqual({ quantity: 0, costBasis: 0 });
  });

  it('un seul achat depuis zéro', () => {
    const { quantity, costBasis } = computePRU([tx('buy', 10, 100)]);
    expect(quantity).toBe(10);
    expect(costBasis).toBe(100);
  });

  it('achats multiples → moyenne pondérée', () => {
    // 10 @ 100 puis 10 @ 200 → PRU 150
    const { quantity, costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('buy', 10, 200, { created_at: 2 }),
    ]);
    expect(quantity).toBe(20);
    expect(costBasis).toBe(150);
  });

  it('inclut les frais d achat dans le PRU (méthode française)', () => {
    // 10 @ 100 + 10€ de frais → coût 1010 → PRU 101
    const { costBasis } = computePRU([tx('buy', 10, 100, { fee: 10 })]);
    expect(costBasis).toBe(101);
  });

  it('accumule au-dessus de l état initial (position pré-tracking)', () => {
    // 10 @ PRU 100 en stock initial, achat 10 @ 200 → PRU 150
    const { quantity, costBasis } = computePRU([tx('buy', 10, 200)], 10, 100);
    expect(quantity).toBe(20);
    expect(costBasis).toBe(150);
  });

  it('trie par created_at, pas par ordre du tableau', () => {
    // Vente avant achat dans le tableau, mais après par timestamp :
    // buy 10 @ 100 (t=1) puis sell 5 (t=2) → qty 5, PRU 100
    const { quantity, costBasis } = computePRU([
      tx('sell', 5, 120, { created_at: 2 }),
      tx('buy', 10, 100, { created_at: 1 }),
    ]);
    expect(quantity).toBe(5);
    expect(costBasis).toBe(100);
  });
});

describe('computePRU — ventes', () => {
  it('la vente réduit la quantité sans toucher le PRU', () => {
    const { quantity, costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('sell', 4, 250, { created_at: 2 }),
    ]);
    expect(quantity).toBe(6);
    expect(costBasis).toBe(100);
  });

  it('les frais de vente ne touchent pas le PRU', () => {
    const { costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('sell', 5, 250, { created_at: 2, fee: 20 }),
    ]);
    expect(costBasis).toBe(100);
  });

  it('sur-vente clampée à quantité 0', () => {
    const { quantity } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('sell', 15, 100, { created_at: 2 }),
    ]);
    expect(quantity).toBe(0);
  });

  it('rachat après vente totale → PRU du nouvel achat', () => {
    const { quantity, costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('sell', 10, 300, { created_at: 2 }),
      tx('buy', 5, 200, { created_at: 3 }),
    ]);
    expect(quantity).toBe(5);
    expect(costBasis).toBe(200);
  });
});

describe('computePRU — swaps', () => {
  it('swap_in se comporte comme un achat', () => {
    const { quantity, costBasis } = computePRU([tx('swap_in', 2, 500)]);
    expect(quantity).toBe(2);
    expect(costBasis).toBe(500);
  });

  it('swap_out se comporte comme une vente (PRU intact)', () => {
    const { quantity, costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('swap_out', 3, 180, { created_at: 2 }),
    ]);
    expect(quantity).toBe(7);
    expect(costBasis).toBe(100);
  });
});

describe('computePRU — corporate actions (sémantique price/quantity surchargée)', () => {
  it('split forward 2:1 — price=ratio, quantity=0 : qty ×2, PRU ÷2, coût total invariant', () => {
    const { quantity, costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('split', 0, 2.0, { created_at: 2 }),
    ]);
    expect(quantity).toBe(20);
    expect(costBasis).toBe(50);
    expect(quantity * costBasis).toBe(1000);
  });

  it('split reverse 1:2 (ratio 0.5) : qty ÷2, PRU ×2', () => {
    const { quantity, costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('split', 0, 0.5, { created_at: 2 }),
    ]);
    expect(quantity).toBe(5);
    expect(costBasis).toBe(200);
  });

  it('split avec ratio invalide (0 ou négatif) → no-op', () => {
    const before = computePRU([tx('buy', 10, 100, { created_at: 1 })]);
    const zero = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('split', 0, 0, { created_at: 2 }),
    ]);
    expect(zero).toEqual(before);
  });

  it('bonus_share — quantity=actions gratuites, price=0 : dilue le PRU, coût total invariant', () => {
    // Air Liquide 1-pour-10 : 10 détenues @ 100 → +1 gratuite → PRU 1000/11
    const { quantity, costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('bonus_share', 1, 0, { created_at: 2 }),
    ]);
    expect(quantity).toBe(11);
    expect(costBasis).toBeCloseTo(1000 / 11, 10);
    expect(quantity * costBasis).toBeCloseTo(1000, 10);
  });

  it('bonus_share équivaut mathématiquement au split de même ratio', () => {
    // Ratio 1.1 : split 1.1 vs bonus de qty×(ratio−1) = 1 action
    const viaSplit = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('split', 0, 1.1, { created_at: 2 }),
    ]);
    const viaBonus = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('bonus_share', 1, 0, { created_at: 2 }),
    ]);
    expect(viaBonus.quantity).toBeCloseTo(viaSplit.quantity, 10);
    expect(viaBonus.costBasis).toBeCloseTo(viaSplit.costBasis, 10);
  });

  it('dividend — no-op sur qty et PRU, même avec price/quantity renseignés', () => {
    // price=montant/action, quantity=actions à l ex-date : ne doit PAS faire qty×price
    const { quantity, costBasis } = computePRU([
      tx('buy', 10, 100, { created_at: 1 }),
      tx('dividend', 10, 3.05, { created_at: 2 }),
    ]);
    expect(quantity).toBe(10);
    expect(costBasis).toBe(100);
  });
});

describe('computePRU — scénario complet', () => {
  it('cycle de vie réaliste : achats, split, dividende, action gratuite, vente partielle', () => {
    const result = computePRU([
      tx('buy', 10, 100, { created_at: 1, fee: 5 }),   // coût 1005, PRU 100.5
      tx('buy', 10, 200, { created_at: 2 }),           // coût 3005 / 20 → PRU 150.25
      tx('split', 0, 2.0, { created_at: 3 }),          // 40 @ 75.125
      tx('dividend', 40, 1.5, { created_at: 4 }),      // no-op
      tx('bonus_share', 4, 0, { created_at: 5 }),      // 44, coût 3005 → PRU 68.295…
      tx('sell', 14, 90, { created_at: 6 }),           // 30, PRU intact
    ]);
    expect(result.quantity).toBe(30);
    expect(result.costBasis).toBeCloseTo(3005 / 44, 10);
  });
});
