import { useState } from 'react';
import type { Position } from '../../types';
import { usePortfolioStore, convertCurrency } from '../../store/portfolio';
import { detectCurrency } from '../../lib/api/yahoo';
import { useTransactions } from '../../hooks/useTransactions';
import { TransactionForm } from '../TransactionForm/TransactionForm';
import styles from './PositionDrawer.module.css';

interface Props {
  position: Position;
  onClose: () => void;
}

function fmtCcy(n: number | undefined, currency: string): string {
  if (n == null) return '—';
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return sym + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function displayTicker(position: Position): string {
  if (position.asset_type === 'crypto') {
    const match = position.name.match(/\(([A-Z0-9]+)\)$/i);
    if (match) return match[1].toUpperCase();
  }
  return position.ticker.toUpperCase();
}

const TX_LABELS: Record<string, string> = {
  buy: 'BUY',
  sell: 'SELL',
  swap_in: 'SWAP IN',
  swap_out: 'SWAP OUT',
};

export function PositionDrawer({ position, onClose }: Props) {
  const prices = usePortfolioStore((s) => s.prices);
  const baseCurrency = usePortfolioStore((s) => s.baseCurrency);
  const eurUsd = usePortfolioStore((s) => s.eurUsd);
  const removeTransaction = usePortfolioStore((s) => s.removeTransaction);
  const allTransactions = usePortfolioStore((s) => s.transactions);
  const { transactions, isCalculated } = useTransactions(position.id);
  const [showTxForm, setShowTxForm] = useState(false);
  const [expandedTxId, setExpandedTxId] = useState<number | null>(null);

  const rawPrice = prices[position.ticker];
  const priceCcy = detectCurrency(position.ticker);
  const currentPrice = rawPrice != null
    ? convertCurrency(rawPrice, priceCcy, baseCurrency, eurUsd)
    : undefined;
  const entryPrice = convertCurrency(position.cost_basis, position.currency, baseCurrency, eurUsd);
  const currentValue = currentPrice != null ? currentPrice * position.quantity : undefined;
  const totalCost = entryPrice * position.quantity;
  const pnl = currentValue != null ? currentValue - totalCost : undefined;
  const pnlPct = pnl != null && totalCost > 0 ? (pnl / totalCost) * 100 : undefined;

  const stopPriceBase = position.stop_price != null
    ? convertCurrency(position.stop_price, position.currency, baseCurrency, eurUsd)
    : null;
  const targetPriceBase = position.target_price != null
    ? convertCurrency(position.target_price, position.currency, baseCurrency, eurUsd)
    : null;
  const target2PriceBase = position.target_price_2 != null
    ? convertCurrency(position.target_price_2, position.currency, baseCurrency, eurUsd)
    : null;
  const distToStop = currentPrice != null && stopPriceBase != null
    ? (stopPriceBase / currentPrice - 1) * 100
    : null;

  const firstTx = transactions.length > 0
    ? Math.min(...transactions.map((t) => t.created_at))
    : position.created_at;
  const daysHeld = Math.floor((Date.now() / 1000 - firstTx) / 86400);
  const entryDate = new Date(firstTx * 1000).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const isPositive = pnl != null && pnl >= 0;

  return (
    <>
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.drawer}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerTicker}>
              <span className={styles.ticker}>{displayTicker(position)}</span>
              {isCalculated && <span className={styles.calcBadge}>calculé</span>}
            </div>
            <span className={styles.name}>{position.name || position.ticker.toUpperCase()}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {position.asset_type !== 'fiat' && (
            <>
              <div className={styles.pnlBlock}>
                <span className={styles.pnlLabel}>P&amp;L total</span>
                {pnl != null ? (
                  <>
                    <span className={`${styles.pnlValue} ${isPositive ? styles.green : styles.red}`}>
                      {isPositive ? '+' : ''}{fmtCcy(pnl, baseCurrency)}
                    </span>
                    <span className={`${styles.pnlPct} ${isPositive ? styles.green : styles.red}`}>
                      {fmtPct(pnlPct!)}
                    </span>
                  </>
                ) : (
                  <span className={styles.pnlValue}>Prix en attente…</span>
                )}
              </div>

              <div className={styles.divider} />

              <div className={styles.grid}>
                <Stat label="Prix actuel" value={currentPrice != null ? fmtCcy(currentPrice, baseCurrency) : '—'} />
                <Stat label="Valeur actuelle" value={currentValue != null ? fmtCcy(currentValue, baseCurrency) : '—'} />
                <Stat label="Prix moyen d'achat" value={fmtCcy(entryPrice, baseCurrency)} />
                <Stat label="Investi" value={fmtCcy(totalCost, baseCurrency)} />
                <Stat label="Quantité" value={position.quantity.toLocaleString('en-US', { maximumSignificantDigits: 8 })} />
                <Stat label="Devise" value={position.currency} />
                <Stat label="Jours détenus" value={daysHeld < 1 ? '< 1 jour' : `${daysHeld} j`} />
                <Stat label="Depuis" value={entryDate} span={2} />
                {(position.stop_price != null || position.target_price != null || position.target_price_2 != null) && (
                  <>
                    <Stat label="Stop loss" value={stopPriceBase != null ? fmtCcy(stopPriceBase, baseCurrency) : '—'} />
                    {distToStop != null && (
                      <Stat
                        label="Distance stop"
                        value={fmtPct(distToStop)}
                        valueClass={distToStop <= 0 ? styles.green : styles.red}
                      />
                    )}
                    <Stat label="TP 1 (1R)" value={targetPriceBase != null ? fmtCcy(targetPriceBase, baseCurrency) : '—'} />
                    <Stat label="TP 2 (2R)" value={target2PriceBase != null ? fmtCcy(target2PriceBase, baseCurrency) : '—'} />
                  </>
                )}
              </div>

              <div className={styles.divider} />
            </>
          )}

          <div className={styles.txSection}>
            <div className={styles.txHeader}>
              <span className={styles.txTitle}>Transactions</span>
              <button className={styles.addTxBtn} onClick={() => setShowTxForm(true)}>+ Ajouter</button>
            </div>

            {transactions.length === 0 ? (
              <div className={styles.txList}>
                <div className={styles.txCard}>
                  <div className={styles.txRow}>
                    <span className={`${styles.txBadge} ${styles.tx_initial}`}>INITIAL</span>
                    <span className={styles.txQty}>
                      {position.quantity.toLocaleString('en-US', { maximumSignificantDigits: 6 })}
                    </span>
                    <span className={styles.txPrice}>
                      @ {position.cost_basis.toLocaleString('en-US', { maximumSignificantDigits: 6 })} {position.currency}
                    </span>
                    <span className={styles.txDate}>position initiale</span>
                  </div>
                </div>
                <p className={styles.txEmptyHint}>Ajoutez des transactions pour suivre vos achats et ventes.</p>
              </div>
            ) : (
              <div className={styles.txList}>
                {[...transactions].reverse().map((tx) => {
                  const expanded = expandedTxId === tx.id;
                  const linkedTx = tx.linked_tx_id
                    ? Object.values(allTransactions).flat().find((t) => t.id === tx.linked_tx_id)
                    : undefined;
                  return (
                    <div key={tx.id} className={`${styles.txCard} ${expanded ? styles.txCardExpanded : ''}`}>
                      {/* Summary row — always visible, click to expand */}
                      <div
                        className={styles.txRow}
                        onClick={() => setExpandedTxId(expanded ? null : tx.id)}
                      >
                        <span className={`${styles.txBadge} ${styles[`tx_${tx.type}`]}`}>
                          {TX_LABELS[tx.type]}
                        </span>
                        <span className={styles.txQty}>
                          {tx.quantity.toLocaleString('en-US', { maximumSignificantDigits: 6 })}
                        </span>
                        <span className={styles.txPrice}>
                          @ {tx.price.toLocaleString('en-US', { maximumSignificantDigits: 6 })} {tx.currency}
                        </span>
                        <span className={styles.txDate}>
                          {new Date(tx.created_at * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}
                        </span>
                        <span className={styles.txChevron}>{expanded ? '▲' : '▼'}</span>
                      </div>

                      {/* Expanded detail */}
                      {expanded && (
                        <div className={styles.txDetail}>
                          <div className={styles.txDetailGrid}>
                            <span className={styles.txDetailLabel}>Quantité</span>
                            <span className={styles.txDetailValue}>
                              {tx.quantity.toLocaleString('en-US', { maximumSignificantDigits: 10 })} {position.ticker.toUpperCase()}
                            </span>
                            <span className={styles.txDetailLabel}>Prix unitaire</span>
                            <span className={styles.txDetailValue}>
                              {tx.price.toLocaleString('en-US', { maximumSignificantDigits: 10 })} {tx.currency.toUpperCase()}
                            </span>
                            {tx.type === 'swap_out' && linkedTx != null && (
                              <>
                                <span className={styles.txDetailLabel}>Taux</span>
                                <span className={styles.txDetailValue}>
                                  1 {tx.ticker.toUpperCase()} = {(linkedTx.quantity / tx.quantity).toLocaleString('en-US', { maximumSignificantDigits: 8 })} {linkedTx.ticker.toUpperCase()}
                                </span>
                              </>
                            )}
                            {tx.type === 'swap_in' && linkedTx?.type === 'swap_out' && (
                              <>
                                <span className={styles.txDetailLabel}>Taux</span>
                                <span className={styles.txDetailValue}>
                                  1 {linkedTx.ticker.toUpperCase()} = {(tx.quantity / linkedTx.quantity).toLocaleString('en-US', { maximumSignificantDigits: 8 })} {tx.ticker.toUpperCase()}
                                </span>
                              </>
                            )}
                            {tx.fee > 0 && <>
                              <span className={styles.txDetailLabel}>Frais</span>
                              <span className={styles.txDetailValue}>{tx.fee} {position.currency}</span>
                            </>}
                            {tx.note && <>
                              <span className={styles.txDetailLabel}>Note</span>
                              <span className={styles.txDetailValue}>{tx.note}</span>
                            </>}
                            {linkedTx && <>
                              <span className={styles.txDetailLabel}>Lié à</span>
                              <span className={styles.txDetailValue}>
                                {TX_LABELS[linkedTx.type]} {linkedTx.quantity.toLocaleString('en-US', { maximumSignificantDigits: 6 })} {linkedTx.currency.toUpperCase()}
                              </span>
                            </>}
                            <span className={styles.txDetailLabel}>Date</span>
                            <span className={styles.txDetailValue}>
                              {new Date(tx.created_at * 1000).toLocaleString('fr-FR', {
                                day: '2-digit', month: 'short', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <button
                            className={styles.txDeleteExpanded}
                            onClick={() => {
                              const linkedPos = tx.linked_tx_id
                                ? Object.values(allTransactions).flat().find((t) => t.id === tx.linked_tx_id)?.position_id
                                : undefined;
                              removeTransaction(tx.id, position.id, linkedPos);
                            }}
                          >
                            Supprimer
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>

    {showTxForm && (
      <TransactionForm
        position={position}
        onClose={() => setShowTxForm(false)}
      />
    )}
    </>
  );
}

function Stat({ label, value, span, valueClass }: { label: string; value: string; span?: number; valueClass?: string }) {
  return (
    <div className={styles.stat} style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}
