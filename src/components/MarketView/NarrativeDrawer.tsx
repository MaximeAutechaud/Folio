import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, AreaSeries, type UTCTimestamp } from 'lightweight-charts';
import { fetchYahooHistory } from '../../lib/api/yahoo';
import { computeBasketHistory } from '../../hooks/useNarrativePerfs';
import type { Narrative, NarrativeTicker } from '../../types';
import styles from './NarrativeDrawer.module.css';

type Period = '1W' | '1M' | '3M' | '1Y';
const PERIODS: Period[] = ['1W', '1M', '3M', '1Y'];

function fmtPerf(n: number | null): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function calcPerf(history: { time: number; value: number }[]): number | null {
  if (history.length < 2) return null;
  const start = history[0].value;
  const end = history[history.length - 1].value;
  if (!start) return null;
  return ((end - start) / start) * 100;
}

interface HoldingRow {
  ticker: string;
  name: string;
  perf: number | null;
  relPerf: number | null;
  currentPrice: number | null;
}

interface Props {
  narrative: Narrative;
  tickers: NarrativeTicker[];
  initialPeriod: '1W' | '1M' | '3M';
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NarrativeDrawer({ narrative, tickers, initialPeriod, onEdit, onDelete, onClose }: Props) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch chart data
  const { data: chartData = [] } = useQuery({
    queryKey: ['narrative-chart', narrative.id, narrative.ref_etf, period],
    queryFn: async () => {
      if (narrative.ref_etf) {
        return fetchYahooHistory(narrative.ref_etf, period);
      }
      // Basket: fetch all tickers, compute normalized average
      const tickerHists = await Promise.all(
        tickers.map(t => fetchYahooHistory(t.ticker, period))
      );
      return computeBasketHistory(tickerHists);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch holdings table data
  const { data: holdings = [], isFetching: loadingHoldings } = useQuery<HoldingRow[]>({
    queryKey: ['narrative-holdings', narrative.id, period],
    queryFn: async () => {
      const tickersToFetch = ['SPY', ...tickers.map(t => t.ticker)];
      const histories = await Promise.all(
        tickersToFetch.map(t => fetchYahooHistory(t, period))
      );
      const spyPerf = calcPerf(histories[0]);
      return tickers.map((t, i) => {
        const hist = histories[i + 1];
        const perf = calcPerf(hist);
        return {
          ticker: t.ticker,
          name: t.name,
          perf,
          relPerf: perf != null && spyPerf != null ? perf - spyPerf : null,
          currentPrice: hist[hist.length - 1]?.value ?? null,
        };
      }).sort((a, b) => (b.perf ?? -999) - (a.perf ?? -999));
    },
    staleTime: 5 * 60 * 1000,
  });

  const chartPerf = calcPerf(chartData);
  const isPerfPos = (chartPerf ?? 0) >= 0;
  const isBasket = !narrative.ref_etf;

  useEffect(() => {
    if (!containerRef.current || chartData.length < 2) return;

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
      lineColor: narrative.color,
      topColor: narrative.color + '40',
      bottomColor: narrative.color + '00',
      lineWidth: 2,
    });

    series.setData(
      chartData.map(p => ({ time: p.time as UTCTimestamp, value: p.value }))
    );
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [chartData, narrative.color]);

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.drawer}>

        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.colorDot} style={{ background: narrative.color }} />
            <div>
              <span className={styles.title}>{narrative.name}</span>
              {narrative.ref_etf
                ? <span className={styles.subtitle}>ETF : {narrative.ref_etf}</span>
                : <span className={styles.subtitle}>Panier synthétique · {tickers.length} tickers</span>
              }
            </div>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.actionBtn} onClick={onEdit} title="Modifier">✎</button>
            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={onDelete} title="Supprimer">×</button>
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {narrative.description && (
          <p className={styles.description}>{narrative.description}</p>
        )}

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

        {isBasket && (
          <div className={styles.basketNote}>
            Indice synthétique — retours individuels normalisés à 100, puis moyennés
          </div>
        )}

        <div ref={containerRef} className={styles.chart} />

        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Perf. {period}</span>
            <span className={`${styles.statValue} ${isPerfPos ? styles.pos : styles.neg}`}>
              {fmtPerf(chartPerf)}
            </span>
          </div>
        </div>

        <div className={styles.holdingsSection}>
          <span className={styles.holdingsTitle}>
            {narrative.ref_etf ? 'Composants' : 'Tickers'} ({tickers.length})
          </span>
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
                  const relPos  = (h.relPerf ?? 0) >= 0;
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
                        {h.currentPrice != null ? h.currentPrice.toFixed(2) : '—'}
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
