import type { Position, Transaction } from '../types';
import { buildClosedTrades } from './tradeJournal';

export interface DeleteImpact {
  /** Transactions détruites par le CASCADE. */
  transactions: number;
  /** Trades clôturés qui disparaîtront du journal et des statistiques. */
  closedTrades: number;
  /** La position détient encore des titres au moment de la suppression. */
  stillOpen: boolean;
  /** Quantité résiduelle (0 pour une ligne déjà soldée). */
  quantity: number;
}

/**
 * Ce que coûte la suppression d'une position. `positions.id` est référencé par
 * `transactions.position_id` en `ON DELETE CASCADE` : supprimer la ligne efface
 * tout son ledger, donc ses trades clôturés, donc sa contribution au win rate
 * et à l'expectancy. Rien de tout ça n'est récupérable.
 *
 * `transactions` est le ledger brut de la position ; `position` porte les
 * valeurs de la base (état antérieur au suivi des transactions).
 */
export function computeDeleteImpact(
  position: Position,
  transactions: Transaction[],
  resolvedQuantity: number,
): DeleteImpact {
  const closed = buildClosedTrades(
    position.ticker,
    position.name,
    transactions,
    position.quantity,
    position.cost_basis,
    position.currency,
    position.created_at,
  ).filter((t) => t.initialStop != null); // même critère que l'onglet Trades

  return {
    transactions: transactions.length,
    closedTrades: closed.length,
    stillOpen: resolvedQuantity > 1e-10,
    quantity: resolvedQuantity,
  };
}

/** `true` si la suppression détruit de l'historique irremplaçable. */
export function isDestructive(impact: DeleteImpact): boolean {
  return impact.transactions > 0 || impact.closedTrades > 0;
}
