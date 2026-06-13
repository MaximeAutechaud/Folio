import { useMemo, useState } from 'react';
import { usePortfolioStore, convertCurrency, resolvePositions } from '../../store/portfolio';
import { detectCurrency } from '../../lib/api/yahoo';
import {
  buildClosedTrades,
  computeStats,
  SETUP_LABEL,
  type ClosedTrade,
  type TradeStats,
} from '../../lib/tradeJournal';
import { TransactionForm } from '../TransactionForm/TransactionForm';
import type { Position, Transaction } from '../../types';
import styles from './TradesView.module.css';

type SubTab = 'active' | 'closed' | 'stats';
type BaseCurrency = 'EUR' | 'USD';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCcy(n: number | undefined | null, currency: string, decimals = 2): string {
  if (n == null) return '—';
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return sym + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number | undefined | null): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function displayTicker(p: Position): string {
  if (p.asset_type === 'crypto') {
    const m = p.name.match(/\(([A-Z0-9]+)\)$/i);
    if (m) return m[1].toUpperCase();
  }
  return p.ticker.toUpperCase();
}

function SetupBadge({ setup }: { setup: string | null }) {
  if (!setup) return <span className={styles.noSetup}>—</span>;
  return <span className={styles.setupBadge}>{SETUP_LABEL[setup] ?? setup}</span>;
}

// ── Active Trades ─────────────────────────────────────────────────────────────

interface ActiveTradesProps {
  trades: Position[];
  storeTransactions: Record<number, Transaction[]>;
  prices: Record<string, number | undefined>;
  baseCurrency: BaseCurrency;
  eurUsd: number;
  onSell: (p: Position) => void;
}

function ActiveTrades({ trades, storeTransactions, prices, baseCurrency, eurUsd, onSell }: ActiveTradesProps) {
  if (trades.length === 0) {
    return (
      <div className={styles.empty}>
        Aucun trade en cours.
        <span className={styles.emptyHint}>Une position devient un trade dès qu'un stop loss est défini.</span>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Setup</th>
            <th>PRU</th>
            <th>Prix actuel</th>
            <th>Stop</th>
            <th>Dist. stop</th>
            <th>TP1 / TP2</th>
            <th>Risque</th>
            <th>J. tenus</th>
            <th>P&L</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {trades.map((p) => {
            const txs = storeTransactions[p.id] ?? [];
            const buys = txs.filter((t) => t.type === 'buy' || t.type === 'swap_in');
            const recentSetup = buys.length > 0 ? (buys[buys.length - 1].setup ?? null) : null;

            const priceCcy = detectCurrency(p.ticker);
            const rawPrice = prices[p.ticker];
            const currentPrice = rawPrice != null
              ? convertCurrency(rawPrice, priceCcy, baseCurrency, eurUsd)
              : undefined;
            const entryInBase = convertCurrency(p.cost_basis, p.currency, baseCurrency, eurUsd);
            const stopInBase = p.stop_price != null
              ? convertCurrency(p.stop_price, p.currency, baseCurrency, eurUsd)
              : null;
            const tp1InBase = p.target_price != null
              ? convertCurrency(p.target_price, p.currency, baseCurrency, eurUsd)
              : null;
            const tp2InBase = p.target_price_2 != null
              ? convertCurrency(p.target_price_2, p.currency, baseCurrency, eurUsd)
              : null;

            const distToStop = currentPrice != null && stopInBase != null
              ? ((stopInBase - currentPrice) / currentPrice) * 100
              : null;
            const riskAmt = stopInBase != null
              ? Math.max(0, p.quantity * (entryInBase - stopInBase))
              : null;

            const firstTx = txs.length > 0
              ? Math.min(...txs.map((t) => t.created_at))
              : p.created_at;
            const daysHeld = Math.floor((Date.now() / 1000 - firstTx) / 86400);

            const currentValue = currentPrice != null ? currentPrice * p.quantity : undefined;
            const totalCost = entryInBase * p.quantity;
            const pnl = currentValue != null ? currentValue - totalCost : undefined;
            const pnlPct = pnl != null && totalCost > 0 ? (pnl / totalCost) * 100 : undefined;

            const stopClose = distToStop != null && distToStop > -5;

            return (
              <tr key={p.id}>
                <td className={styles.tickerCell}>
                  <span className={styles.ticker}>{displayTicker(p)}</span>
                  <span className={styles.sub}>{p.name}</span>
                </td>
                <td><SetupBadge setup={recentSetup} /></td>
                <td className={styles.mono}>{fmtCcy(entryInBase, baseCurrency)}</td>
                <td className={styles.mono}>{fmtCcy(currentPrice, baseCurrency)}</td>
                <td className={`${styles.mono} ${styles.stopVal}`}>{fmtCcy(stopInBase, baseCurrency)}</td>
                <td className={`${styles.mono} ${stopClose ? styles.neg : styles.muted}`}>
                  {distToStop != null ? fmtPct(distToStop) : '—'}
                </td>
                <td className={styles.mono}>
                  {tp1InBase != null ? fmtCcy(tp1InBase, baseCurrency) : '—'}
                  {tp2InBase != null && (
                    <span className={styles.sub}><br />{fmtCcy(tp2InBase, baseCurrency)}</span>
                  )}
                </td>
                <td className={`${styles.mono} ${styles.riskVal}`}>
                  {fmtCcy(riskAmt, baseCurrency)}
                </td>
                <td className={styles.mono}>{daysHeld}j</td>
                <td className={styles.mono}>
                  <span className={pnl != null && pnl >= 0 ? styles.pos : styles.neg}>
                    {fmtCcy(pnl, baseCurrency)}
                  </span>
                  {pnlPct != null && (
                    <span className={`${styles.sub} ${pnlPct >= 0 ? styles.pos : styles.neg}`}>
                      <br />{fmtPct(pnlPct)}
                    </span>
                  )}
                </td>
                <td>
                  <button className={styles.sellBtn} onClick={() => onSell(p)}>
                    Vendre
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Closed Trades ─────────────────────────────────────────────────────────────

function ClosedTrades({ trades }: { trades: ClosedTrade[] }) {
  if (trades.length === 0) {
    return (
      <div className={styles.empty}>
        Aucun trade clôturé.
        <span className={styles.emptyHint}>Les ventes sur des positions avec stop loss apparaîtront ici.</span>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Setup</th>
            <th>Entrée</th>
            <th>Sortie</th>
            <th>Durée</th>
            <th>PRU</th>
            <th>Prix sortie</th>
            <th>P&L</th>
            <th>R</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const isPos = t.pnl > 0;
            const rSign = t.rMultiple != null && t.rMultiple >= 0 ? '+' : '';
            let rClass = styles.muted;
            if (t.rMultiple != null) rClass = t.rMultiple >= 1 ? styles.pos : t.rMultiple >= 0 ? styles.neutral : styles.neg;
            return (
              <tr key={t.id}>
                <td className={styles.tickerCell}>
                  <span className={styles.ticker}>{t.ticker.toUpperCase()}</span>
                </td>
                <td><SetupBadge setup={t.setup} /></td>
                <td className={styles.mono}>{fmtDate(t.entryDate)}</td>
                <td className={styles.mono}>{fmtDate(t.exitDate)}</td>
                <td className={styles.mono}>{t.daysHeld}j</td>
                <td className={styles.mono}>{fmtCcy(t.entryPrice, t.currency)}</td>
                <td className={styles.mono}>{fmtCcy(t.exitPrice, t.currency)}</td>
                <td className={styles.mono}>
                  <span className={isPos ? styles.pos : styles.neg}>{fmtPct(t.pnlPct)}</span>
                  <span className={`${styles.sub} ${isPos ? styles.pos : styles.neg}`}>
                    <br />{fmtCcy(t.pnl, t.currency)}
                  </span>
                </td>
                <td className={`${styles.mono} ${rClass}`}>
                  {t.rMultiple != null ? `${rSign}${t.rMultiple.toFixed(2)}R` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, positive }: {
  label: string; value: string; sub: string; positive: boolean;
}) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${positive ? styles.pos : styles.neg}`}>{value}</span>
      <span className={styles.statSub}>{sub}</span>
    </div>
  );
}

function StatsView({ stats }: { stats: TradeStats | null }) {
  if (!stats) {
    return (
      <div className={styles.empty}>
        Pas encore assez de données.
        <span className={styles.emptyHint}>Les statistiques s'affichent dès le premier trade clôturé.</span>
      </div>
    );
  }

  return (
    <div className={styles.statsRoot}>
      <div className={styles.statCards}>
        <StatCard
          label="Win rate"
          value={`${(stats.winRate * 100).toFixed(0)}%`}
          sub={`${stats.wins}W · ${stats.losses}L sur ${stats.total} trades`}
          positive={stats.winRate >= 0.5}
        />
        <StatCard
          label="Expectancy"
          value={fmtPct(stats.expectancy)}
          sub="gain moyen par trade"
          positive={stats.expectancy >= 0}
        />
        <StatCard
          label="R moyen"
          value={stats.avgR != null
            ? `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`
            : '—'}
          sub={stats.avgR == null ? 'stops initiaux manquants' : 'vs risque initial'}
          positive={stats.avgR != null && stats.avgR >= 1}
        />
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Durée moy.</span>
          <div className={styles.durationRow}>
            <span>
              <span className={styles.pos}>{stats.avgDaysWinners.toFixed(0)}j</span>
              <span className={styles.statSub}> winners</span>
            </span>
            <span className={styles.muted}>vs</span>
            <span>
              <span className={styles.neg}>{stats.avgDaysLosers.toFixed(0)}j</span>
              <span className={styles.statSub}> losers</span>
            </span>
          </div>
          <span className={styles.statSub}>
            {stats.avgDaysWinners < stats.avgDaysLosers
              ? 'tu coupes trop tôt ou tu laisses courir les pertes'
              : 'les gagnants durent plus longtemps — bon signe'}
          </span>
        </div>
      </div>

      {stats.bySetup.length > 0 && (
        <div className={styles.setupTable}>
          <div className={styles.sectionTitle}>Performance par setup</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Setup</th>
                <th>Trades</th>
                <th>Win rate</th>
                <th>P&L moy.</th>
              </tr>
            </thead>
            <tbody>
              {stats.bySetup.map((s) => (
                <tr key={s.setup}>
                  <td>
                    {s.setup === '__none__'
                      ? <span className={styles.noSetup}>Non défini</span>
                      : <SetupBadge setup={s.setup} />}
                  </td>
                  <td className={styles.mono}>{s.count}</td>
                  <td className={`${styles.mono} ${s.winRate >= 0.5 ? styles.pos : styles.neg}`}>
                    {(s.winRate * 100).toFixed(0)}%
                  </td>
                  <td className={`${styles.mono} ${s.avgPnlPct >= 0 ? styles.pos : styles.neg}`}>
                    {fmtPct(s.avgPnlPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function TradesView() {
  const [subTab, setSubTab] = useState<SubTab>('active');
  const [sellPosition, setSellPosition] = useState<Position | null>(null);

  const rawPositions = usePortfolioStore((s) => s.positions);
  const storeTransactions = usePortfolioStore((s) => s.transactions);
  const prices = usePortfolioStore((s) => s.prices);
  const baseCurrency = usePortfolioStore((s) => s.baseCurrency);
  const eurUsd = usePortfolioStore((s) => s.eurUsd);

  const positions = useMemo(
    () => resolvePositions(rawPositions, storeTransactions),
    [rawPositions, storeTransactions],
  );

  const tradePositions = useMemo(
    () => positions.filter((p) => p.stop_price != null && p.asset_type !== 'fiat'),
    [positions],
  );

  const activeTrades = useMemo(
    () => tradePositions.filter((p) => p.quantity > 1e-10),
    [tradePositions],
  );

  const closedTrades = useMemo(
    () =>
      rawPositions
        .filter((p) => p.stop_price != null && p.asset_type !== 'fiat')
        .flatMap((p) =>
          buildClosedTrades(
            p.ticker,
            p.name,
            storeTransactions[p.id] ?? [],
            p.quantity,    // raw DB qty — seed before transactions
            p.cost_basis,  // raw DB PRU
            p.currency,
            p.created_at,
          )
        )
        .sort((a, b) => b.exitDate - a.exitDate),
    [rawPositions, storeTransactions],
  );

  const stats = useMemo(() => computeStats(closedTrades), [closedTrades]);

  const SUB_TABS: [SubTab, string][] = [
    ['active', `En cours (${activeTrades.length})`],
    ['closed', `Clôturés (${closedTrades.length})`],
    ['stats', 'Stats'],
  ];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h2 className={styles.title}>Trades</h2>
          <span className={styles.headerHint}>Positions avec stop loss · sans stop = investissement</span>
        </div>
        <div className={styles.subTabs}>
          {SUB_TABS.map(([key, label]) => (
            <button
              key={key}
              className={`${styles.subTab} ${subTab === key ? styles.subTabActive : ''}`}
              onClick={() => setSubTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.content}>
        {subTab === 'active' && (
          <ActiveTrades
            trades={activeTrades}
            storeTransactions={storeTransactions}
            prices={prices}
            baseCurrency={baseCurrency}
            eurUsd={eurUsd}
            onSell={setSellPosition}
          />
        )}
        {subTab === 'closed' && <ClosedTrades trades={closedTrades} />}
        {subTab === 'stats' && <StatsView stats={stats} />}
      </div>

      {sellPosition && (
        <TransactionForm
          position={sellPosition}
          onClose={() => setSellPosition(null)}
          defaultType="sell"
          effectiveQty={sellPosition.quantity}
        />
      )}
    </div>
  );
}
