import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, AreaSeries, type UTCTimestamp } from 'lightweight-charts';
import { SECTORS } from '../../lib/sectors';
import { useSectorHoldings } from '../../hooks/useSectorData';
import { fetchYahooHistory } from '../../lib/api/yahoo';
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

export function SectorDrawer({
  sectorId,
  initialPeriod,
  onClose,
}: {
  sectorId: string;
  initialPeriod: '1W' | '1M' | '3M';
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
                  <th>vs SPY</th>
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
      </div>
    </>
  );
}
