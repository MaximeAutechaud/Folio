import type { Position } from '../../types';
import { usePortfolioStore, convertCurrency } from '../../store/portfolio';
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

export function PositionDrawer({ position, onClose }: Props) {
  const prices = usePortfolioStore((s) => s.prices);
  const baseCurrency = usePortfolioStore((s) => s.baseCurrency);
  const eurUsd = usePortfolioStore((s) => s.eurUsd);

  const rawPrice = prices[position.ticker];
  const currentPrice = rawPrice != null
    ? convertCurrency(rawPrice, position.currency, baseCurrency, eurUsd)
    : undefined;
  const entryPrice = convertCurrency(position.cost_basis, position.currency, baseCurrency, eurUsd);
  const currentValue = currentPrice != null ? currentPrice * position.quantity : undefined;
  const totalCost = entryPrice * position.quantity;
  const pnl = currentValue != null ? currentValue - totalCost : undefined;
  const pnlPct = pnl != null && totalCost > 0 ? (pnl / totalCost) * 100 : undefined;

  const daysHeld = Math.floor((Date.now() / 1000 - position.created_at) / 86400);
  const entryDate = new Date(position.created_at * 1000).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  // Break-even: same as cost basis (position already at break-even when price = cost_basis)
  const breakEven = fmtCcy(entryPrice, baseCurrency);

  const isPositive = pnl != null && pnl >= 0;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.drawer}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.ticker}>{displayTicker(position)}</span>
            <span className={styles.name}>{position.name || position.ticker.toUpperCase()}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {/* Main P&L */}
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

          {/* Stats grid */}
          <div className={styles.grid}>
            <Stat label="Prix actuel" value={currentPrice != null ? fmtCcy(currentPrice, baseCurrency) : '—'} />
            <Stat label="Valeur actuelle" value={currentValue != null ? fmtCcy(currentValue, baseCurrency) : '—'} />
            <Stat label="Prix d'entrée" value={fmtCcy(entryPrice, baseCurrency)} />
            <Stat label="Investi" value={fmtCcy(totalCost, baseCurrency)} />
            <Stat label="Quantité" value={position.quantity.toLocaleString('en-US', { maximumSignificantDigits: 8 })} />
            <Stat label="Devise" value={position.currency} />
            <Stat label="Break-even" value={breakEven} />
            <Stat label="Jours détenus" value={daysHeld < 1 ? '< 1 jour' : `${daysHeld} j`} />
            <Stat label="Depuis" value={entryDate} span={2} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, span }: { label: string; value: string; span?: number }) {
  return (
    <div className={styles.stat} style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}
