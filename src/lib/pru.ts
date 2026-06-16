import type { Transaction } from '../types';

export function computePRU(
  transactions: Transaction[],
  initialQty = 0,
  initialPRU = 0,
): { quantity: number; costBasis: number } {
  const sorted = [...transactions].sort((a, b) => a.created_at - b.created_at);

  let quantity = initialQty;
  let pru = initialPRU;

  for (const tx of sorted) {
    if (tx.type === 'buy' || tx.type === 'swap_in' || tx.type === 'bonus_share') {
      const newQty = quantity + tx.quantity;
      pru = newQty > 0 ? (quantity * pru + tx.quantity * tx.price) / newQty : tx.price;
      quantity = newQty;
    } else if (tx.type === 'sell' || tx.type === 'swap_out') {
      quantity = Math.max(0, quantity - tx.quantity);
      // PRU stays unchanged on sell (méthode PRU pondéré française)
    } else if (tx.type === 'split') {
      // tx.price = ratio (2.0 = 2:1 forward split, 0.5 = 1:2 reverse split)
      if (tx.price > 0) {
        quantity = quantity * tx.price;
        pru = pru / tx.price;
      }
    }
    // 'dividend': no-op on qty/PRU — stored for income tracking only
  }

  return { quantity, costBasis: pru };
}
