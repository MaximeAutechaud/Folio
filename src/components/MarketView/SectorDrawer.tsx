import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, AreaSeries, type UTCTimestamp } from 'lightweight-charts';
import { SECTORS } from '../../lib/sectors';
import { useSectorHoldings } from '../../hooks/useSectorData';
import { useNarrativePools } from '../../hooks/useNarrativePools';
import { fetchYahooHistory } from '../../lib/api/yahoo';
import type { SectorScore, SectorSignal } from '../../lib/scoring';
import styles from './SectorDrawer.module.css';

type Period = '1W' | '1M' | '3M' | '1Y';
const PERIODS: Period[] = ['1W', '1M', '3M', '1Y'];

function calcPerf(history: { time: number; value: number }[]): number | null {
  if (history.length < 2) return null;
  const start = history[0].value;
  const end = history[history.length - 1].value;
  if (!start) return null;
  return ((end - start) / start) * 100;
}

function fmtPerf(n: number | null): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ── Score breakdown ───────────────────────────────────────────────────────────

function ScoreBar({ value }: { value: number }) {
  const fill = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.scoreBarTrack}>
      <div className={styles.scoreBarFill} style={{ width: `${fill}%` }} />
    </div>
  );
}

const SIGNAL_CONFIG: Record<NonNullable<SectorSignal>, { icon: string; label: string; cls: string }> = {
  reversal:     { icon: '↗', label: 'Retournement détecté — secteur qui repart après une sous-perf 3M',   cls: 'signalReversal'     },
  exhaustion:   { icon: '↘', label: 'Potentiel essoufflement — forte 3M, RS qui décroche, RSI élevé',    cls: 'signalExhaustion'   },
  accelerating: { icon: '↑', label: 'Accélération en cours — RS qui s\'emballe, RSI encore sain',         cls: 'signalAccelerating' },
  dip:          { icon: '◎', label: 'Dip dans tendance — RS toujours positive, pullback = opportunité',   cls: 'signalDip'          },
};

function SignalBadge({ signal }: { signal: SectorSignal }) {
  if (!signal) return null;
  const { icon, label, cls } = SIGNAL_CONFIG[signal];
  return (
    <div className={`${styles.signalBadge} ${styles[cls]}`}>
      {icon} {label}
    </div>
  );
}

// Exporté : réutilisé par NarrativeDrawer (narratives-ETF, même score/pipeline)
export function ScoreBreakdown({ score }: { score: SectorScore }) {
  const labelCls =
    score.label === 'hot'     ? styles.scoreTotalHot  :
    score.label === 'warming' ? styles.scoreTotalWarm :
    score.label === 'cooling' ? styles.scoreTotalCool :
    styles.scoreTotalNeutral;

  const labelText =
    score.label === 'hot'     ? 'Chaud'      :
    score.label === 'warming' ? 'En chauffe' :
    score.label === 'cooling' ? 'Refroidit'  :
    'Neutre';

  const rows: { label: string; value: number; weight: string }[] = [
    { label: 'RS Slope',  value: score.rsSlope,    weight: '×40%' },
    { label: 'RSI Entry', value: score.rsiEntry,   weight: '×25%' },
    { label: 'Dip',       value: score.drawdown,   weight: '×20%' },
    { label: 'Macro',     value: score.macroAlign, weight: '×15%' },
  ];

  return (
    <div className={styles.scoreSection}>
      <div className={styles.scoreSectionHeader}>
        <span className={styles.scoreSectionTitle}>Score opportunité</span>
        <span className={`${styles.scoreTotal} ${labelCls}`}>
          {score.total}/100 — {labelText}
        </span>
      </div>
      {rows.map(r => (
        <div key={r.label} className={styles.scoreRow}>
          <span className={styles.scoreRowLabel}>{r.label}</span>
          <ScoreBar value={r.value} />
          <span className={styles.scoreRowValue}>{r.value}</span>
          <span className={styles.scoreRowWeight}>{r.weight}</span>
        </div>
      ))}
      {score.ma50Above != null && (
        <div className={`${styles.ma50Badge} ${score.ma50Above ? styles.ma50Above : styles.ma50Below}`}>
          {score.ma50Above
            ? '▲ Prix au-dessus MA 50j — tendance court terme intacte'
            : '▼ Prix sous MA 50j — prudence sur les entrées'}
        </div>
      )}
      <SignalBadge signal={score.signal} />
      <div className={styles.scoreDisclaimer}>
        Ce score ignore : earnings, news, liquidité. Il mesure uniquement le momentum relatif.
      </div>
    </div>
  );
}

export function SectorDrawer({
  sectorId,
  initialPeriod,
  score,
  onClose,
}: {
  sectorId: string;
  initialPeriod: '1W' | '1M' | '3M';
  score?: SectorScore;
  onClose: () => void;
}) {
  const sector = SECTORS.find(s => s.id === sectorId)!;
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: history = [] } = useQuery({
    queryKey: ['sector-chart', sector.etf, period],
    queryFn: () => fetchYahooHistory(sector.etf, period),
    staleTime: 5 * 60 * 1000,
  });

  const { data: holdings = [], isFetching: loadingHoldings } = useSectorHoldings(
    sectorId,
    period
  );
  const { data: pools = [] } = useNarrativePools(sectorId);

  const etfPerf = calcPerf(history);
  const isPerfPos = (etfPerf ?? 0) >= 0;

  useEffect(() => {
    if (!containerRef.current || history.length < 2) return;

    const width = containerRef.current.clientWidth || 400;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6e7681',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      rightPriceScale: { borderColor: '#21262d' },
      timeScale: { borderColor: '#21262d', timeVisible: true },
      width,
      height: 180,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: sector.color,
      topColor: sector.color + '40',
      bottomColor: sector.color + '00',
      lineWidth: 2,
    });

    series.setData(
      history.map(p => ({ time: p.time as UTCTimestamp, value: p.value }))
    );
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [history, sector.color]);

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span
              className={styles.colorDot}
              style={{ background: sector.color }}
            />
            <span className={styles.title}>{sector.name}</span>
            <span className={styles.etf}>{sector.etf}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.periods}>
          {PERIODS.map(p => (
            <button
              key={p}
              className={`${styles.periodBtn} ${period === p ? styles.periodActive : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>

        <div ref={containerRef} className={styles.chart} />

        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Perf. {period}</span>
            <span className={`${styles.statValue} ${isPerfPos ? styles.pos : styles.neg}`}>
              {fmtPerf(etfPerf)}
            </span>
          </div>
        </div>

        {score && <ScoreBreakdown score={score} />}

        <div className={styles.holdingsSection}>
          <span className={styles.holdingsTitle}>Top Holdings</span>
          {loadingHoldings ? (
            <span className={styles.loadingMsg}>Chargement…</span>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Nom</th>
                  <th>Perf.</th>
                  <th>vs S&P 500</th>
                  <th>Prix</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => {
                  const perfPos = (h.perf ?? 0) >= 0;
                  const relPos = (h.relPerf ?? 0) >= 0;
                  return (
                    <tr key={h.ticker}>
                      <td className={styles.tickerCell}>{h.ticker}</td>
                      <td className={styles.nameCell}>{h.name}</td>
                      <td className={`${styles.numCell} ${perfPos ? styles.pos : styles.neg}`}>
                        {fmtPerf(h.perf)}
                      </td>
                      <td className={`${styles.numCell} ${relPos ? styles.pos : styles.neg}`}>
                        {fmtPerf(h.relPerf)}
                      </td>
                      <td className={styles.numCell}>
                        {h.currentPrice != null ? '$' + h.currentPrice.toFixed(2) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {pools.length > 0 && (
          <div className={styles.holdingsSection}>
            <span className={styles.holdingsTitle}>
              Candidats thématiques
              <span className={styles.poolHint}> — tickers évalués individuellement vs {sector.etf} (1M)</span>
            </span>
            {pools.map(({ narrative, rows }) => (
              <div key={narrative.id} className={styles.poolGroup}>
                <div className={styles.poolName}>
                  <span className={styles.colorDot} style={{ background: narrative.color }} />
                  {narrative.name}
                  {narrative.description && (
                    <span className={styles.poolDesc}>{narrative.description}</span>
                  )}
                </div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Nom</th>
                      <th>Perf. 1M</th>
                      <th>vs {sector.etf}</th>
                      <th>RSI</th>
                      <th>Prix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const perfPos = (r.perf1M ?? 0) >= 0;
                      const relPos = (r.relPerf1M ?? 0) >= 0;
                      const rsiCls =
                        r.rsi == null ? '' :
                        r.rsi < 30 || r.rsi > 70 ? styles.rsiExtreme :
                        r.rsi < 45 ? styles.rsiFavorable : '';
                      return (
                        <tr key={r.ticker}>
                          <td className={styles.tickerCell}>{r.ticker}</td>
                          <td className={styles.nameCell}>{r.name}</td>
                          <td className={`${styles.numCell} ${perfPos ? styles.pos : styles.neg}`}>
                            {fmtPerf(r.perf1M)}
                          </td>
                          <td className={`${styles.numCell} ${relPos ? styles.pos : styles.neg}`}>
                            {fmtPerf(r.relPerf1M)}
                          </td>
                          <td className={`${styles.numCell} ${rsiCls}`}>
                            {r.rsi ?? '—'}
                          </td>
                          <td className={styles.numCell}>
                            {r.currentPrice != null ? r.currentPrice.toFixed(2) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
