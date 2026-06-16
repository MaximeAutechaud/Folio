import { useState } from 'react';
import { usePortfolioStore, computeTotals, convertCurrency, resolvePositions, type BaseCurrency } from '../../store/portfolio';
import { detectCurrency } from '../../lib/api/yahoo';
import { usePeriodPnl } from '../../hooks/usePeriodPnl';
import type { PendingCorporateAction, PositionWithValue, Snapshot } from '../../types';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';
import styles from './Dashboard.module.css';

type Filter = 'all' | 'stock' | 'crypto';

function fmtQty(n: number, assetType: string): string {
  if (assetType === 'crypto') {
    if (n === 0) return '0';
    const decimals = n < 0.0001 ? 8 : n < 0.01 ? 6 : n < 1 ? 4 : 2;
    return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function displayTicker(position: { ticker: string; name: string; asset_type: string }): string {
  if (position.asset_type === 'crypto') {
    const match = position.name.match(/\(([A-Z0-9]+)\)$/i);
    if (match) return match[1].toUpperCase();
  }
  return position.ticker.toUpperCase();
}

function fmtCurrency(n: number | undefined, currency: string): string {
  if (n == null) return '—';
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return sym + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | undefined): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

interface Props {
  snapshots: Snapshot[];
  onAddClick: () => void;
  onEdit: (id: number) => void;
  onRemove: (id: number) => void;
  onRowClick: (id: number) => void;
  pendingActions?: PendingCorporateAction[];
  onCorporateActionClick?: (action: PendingCorporateAction) => void;
}

export function Dashboard({ snapshots, onAddClick, onEdit, onRemove, onRowClick, pendingActions = [], onCorporateActionClick }: Props) {
  const rawPositions = usePortfolioStore((s) => s.positions);
  const storeTransactions = usePortfolioStore((s) => s.transactions);
  const prices = usePortfolioStore((s) => s.prices);
  const isLoading = usePortfolioStore((s) => s.isLoading);
  const baseCurrency = usePortfolioStore((s) => s.baseCurrency);
  const setBaseCurrency = usePortfolioStore((s) => s.setBaseCurrency);
  const eurUsd = usePortfolioStore((s) => s.eurUsd);
  const [filter, setFilter] = useState<Filter>('all');

  const pendingByPositionId = new Map<number, PendingCorporateAction[]>();
  for (const a of pendingActions) {
    const existing = pendingByPositionId.get(a.positionId) ?? [];
    pendingByPositionId.set(a.positionId, [...existing, a]);
  }

  const positions = resolvePositions(rawPositions, storeTransactions);
  const investmentPositions = positions.filter((p) => p.asset_type !== 'fiat');
  const fiatPositions = positions.filter((p) => p.asset_type === 'fiat');

  const filtered = filter === 'all'
    ? investmentPositions
    : investmentPositions.filter((p) => p.asset_type === filter);

  const { totalValue, totalCost } = computeTotals(filtered, prices, baseCurrency, eurUsd);
  const periods = usePeriodPnl(snapshots, totalValue);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  // Dividend income — derived from ledger, no extra query
  const dividendByPositionId = new Map<number, number>();
  for (const rawPos of rawPositions) {
    const txs = storeTransactions[rawPos.id] ?? [];
    const total = txs
      .filter((t) => t.type === 'dividend')
      .reduce((sum, t) => sum + t.quantity * t.price, 0);
    if (total > 0) dividendByPositionId.set(rawPos.id, total);
  }
  const hasDividends = dividendByPositionId.size > 0;
  const totalDividendsBase = rawPositions.reduce((sum, p) => {
    const div = dividendByPositionId.get(p.id) ?? 0;
    return sum + convertCurrency(div, p.currency, baseCurrency, eurUsd);
  }, 0);

  const rows: PositionWithValue[] = filtered.map((p) => {
    const price = prices[p.ticker];
    const priceCcy = detectCurrency(p.ticker); // currency Yahoo/CoinGecko quotes in (from ticker suffix)
    const value = price != null
      ? convertCurrency(p.quantity * price, priceCcy, baseCurrency, eurUsd)
      : undefined;
    const cost = convertCurrency(p.quantity * p.cost_basis, p.currency, baseCurrency, eurUsd);
    const pnl = value != null ? value - cost : undefined;
    const pnl_pct = pnl != null && cost > 0 ? (pnl / cost) * 100 : undefined;
    const current_price = price != null
      ? convertCurrency(price, priceCcy, baseCurrency, eurUsd)
      : undefined;
    return { ...p, current_price, current_value: value, pnl, pnl_pct };
  });

  return (
    <div className={styles.root}>
      {/* Summary bar */}
      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.label}>Portfolio value</span>
          <span className={styles.valueLarge}>{fmtCurrency(totalValue, baseCurrency)}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.label}>Total cost</span>
          <span className={styles.value}>{fmtCurrency(totalCost, baseCurrency)}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.label}>P&amp;L</span>
          <span className={`${styles.value} ${totalPnl >= 0 ? styles.green : styles.red}`}>
            {totalPnl >= 0 ? '+' : ''}{fmtCurrency(totalPnl, baseCurrency)} ({fmtPct(totalPnlPct)})
          </span>
        </div>
        {totalDividendsBase > 0 && (
          <div className={styles.summaryItem}>
            <span className={styles.label}>Dividendes <InfoTooltip text="Cumul des dividendes perçus sur toutes les positions, convertis en devise de base." /></span>
            <span className={`${styles.value} ${styles.green}`}>
              +{fmtCurrency(totalDividendsBase, baseCurrency)}
            </span>
          </div>
        )}

        {periods.length > 0 && (
          <div className={styles.periods}>
            {periods.map((p) => (
              <div key={p.label} className={styles.period}>
                <span className={styles.periodLabel}>{p.label}</span>
                <span className={`${styles.periodValue} ${p.pnl >= 0 ? styles.green : styles.red}`}>
                  {fmtPct(p.pct)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.summaryActions}>
          <div className={styles.currencyToggle}>
            {(['EUR', 'USD'] as BaseCurrency[]).map((c) => (
              <button
                key={c}
                className={`${styles.currencyBtn} ${baseCurrency === c ? styles.currencyActive : ''}`}
                onClick={() => setBaseCurrency(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <button className={styles.addBtn} onClick={onAddClick}>
            + Add position
          </button>
        </div>
      </div>

      {isLoading && rawPositions.length === 0 ? (
        <p className={styles.empty}>Loading…</p>
      ) : rawPositions.length === 0 ? (
        <p className={styles.empty}>No positions yet. Add your first one.</p>
      ) : (
        <>
          <div className={styles.tableHeader}>
            <div className={styles.filterToggle}>
              {(['all', 'stock', 'crypto'] as Filter[]).map((f) => (
                <button
                  key={f}
                  className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {investmentPositions.length === 0 ? (
            <p className={styles.empty}>No positions yet. Add your first one.</p>
          ) : filtered.length === 0 ? (
            <p className={styles.empty}>No {filter} positions.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Devise</th>
                  <th className={styles.right}>Qté</th>
                  <th className={styles.right}>Prix de revient</th>
                  <th className={styles.right}>Prix ({baseCurrency})</th>
                  <th className={styles.right}>Valeur ({baseCurrency})</th>
                  <th className={styles.right}>G/P <InfoTooltip text="Gain ou Perte sur la position : différence entre la valeur actuelle et le montant investi." /></th>
                  <th className={styles.right}>G/P % <InfoTooltip text="Gain ou Perte en pourcentage du montant investi." /></th>
                  {hasDividends && <th className={styles.right}>Div. <InfoTooltip text="Dividendes perçus cumulés sur cette position." /></th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={styles.clickableRow} onClick={() => onRowClick(row.id)}>
                    <td className={styles.ticker}>{displayTicker(row)}</td>
                    <td>{row.name || '—'}</td>
                    <td>
                      <span className={`${styles.badge} ${row.asset_type === 'crypto' ? styles.crypto : styles.stock}`}>
                        {row.asset_type}
                      </span>
                    </td>
                    <td className={styles.ccy}>{row.currency}</td>
                    <td className={styles.right}>{fmtQty(row.quantity, row.asset_type)}</td>
                    <td className={styles.right}>{fmtCurrency(row.cost_basis, row.currency)}</td>
                    <td className={styles.right}>
                      {row.current_price != null ? fmtCurrency(row.current_price, baseCurrency) : '—'}
                    </td>
                    <td className={styles.right}>
                      {row.current_value != null ? fmtCurrency(row.current_value, baseCurrency) : '—'}
                    </td>
                    <td className={`${styles.right} ${row.pnl == null ? '' : row.pnl >= 0 ? styles.green : styles.red}`}>
                      {row.pnl != null ? `${row.pnl >= 0 ? '+' : ''}${fmtCurrency(row.pnl, baseCurrency)}` : '—'}
                    </td>
                    <td className={`${styles.right} ${row.pnl_pct == null ? '' : row.pnl_pct >= 0 ? styles.green : styles.red}`}>
                      {fmtPct(row.pnl_pct)}
                    </td>
                    {hasDividends && (
                      <td className={`${styles.right} ${styles.divCell}`}>
                        {dividendByPositionId.has(row.id)
                          ? fmtCurrency(dividendByPositionId.get(row.id), row.currency)
                          : '—'}
                      </td>
                    )}
                    <td className={styles.actions} onClick={(e) => e.stopPropagation()}>
                      {!row.stop_price && (
                        <span
                          className={styles.noStopBadge}
                          data-tooltip="Aucun stop défini"
                        >⚠</span>
                      )}
                      {(() => {
                        const pending = pendingByPositionId.get(row.id) ?? [];
                        if (pending.length === 0 || !onCorporateActionClick) return null;
                        return (
                          <button
                            className={styles.eventChip}
                            onClick={() => onCorporateActionClick(pending[0])}
                            title={`${pending.length} événement(s) corporate détecté(s)`}
                          >
                            ⚡ {pending.length}
                          </button>
                        );
                      })()}
                      <button
                        className={styles.editBtn}
                        onClick={() => onEdit(row.id)}
                        title="Edit position"
                      >
                        ✎
                      </button>
                      <button
                        className={styles.removeBtn}
                        onClick={() => onRemove(row.id)}
                        title="Remove position"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {fiatPositions.length > 0 && (
            <div className={styles.cashSection}>
              <div className={styles.cashHeader}>Cash</div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th className={styles.right}>Balance</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {fiatPositions.map((p) => (
                    <tr key={p.id} className={styles.clickableRow} onClick={() => onRowClick(p.id)}>
                      <td className={styles.ticker}>{p.ticker}</td>
                      <td className={styles.right}>{fmtCurrency(p.quantity, p.currency)}</td>
                      <td className={styles.actions} onClick={(e) => e.stopPropagation()}>
                        <button className={styles.editBtn} onClick={() => onEdit(p.id)} title="Edit">✎</button>
                        <button className={styles.removeBtn} onClick={() => onRemove(p.id)} title="Remove">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
