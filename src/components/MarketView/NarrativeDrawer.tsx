import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, AreaSeries, type UTCTimestamp } from 'lightweight-charts';
import { fetchYahooHistory } from '../../lib/api/yahoo';
import { ScoreBreakdown } from './SectorDrawer';
import type { SectorScore } from '../../lib/scoring';
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
  relPerf: number | null; // vs l'ETF de la narrative — qui tire le thème ?
  currentPrice: number | null;
}

interface Props {
  narrative: Narrative;
  tickers: NarrativeTicker[];
  rsTrend: [number | null, number | null, number | null];        // [3M, 1M, 1W] vs SPY
  vsParentTrend: [number | null, number | null, number | null];  // [3M, 1M, 1W] vs ETF du secteur parent
  parentEtf: string | null;
  score?: SectorScore;
  initialPeriod: '1W' | '1M' | '3M';
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NarrativeDrawer({
  narrative, tickers, rsTrend, vsParentTrend, parentEtf, score,
  initialPeriod, onEdit, onDelete, onClose,
}: Props) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const containerRef = useRef<HTMLDivElement>(null);
  // Le dashboard n'affiche que des narratives-ETF — ref_etf est toujours présent ici.
  const refEtf = narrative.ref_etf!;

  const { data: chartData = [] } = useQuery({
    queryKey: ['narrative-chart', narrative.id, refEtf, period],
    queryFn: () => fetchYahooHistory(refEtf, period),
    staleTime: 5 * 60 * 1000,
  });

  // Composants du thème, comparés à l'ETF de la narrative (pas SPY) :
  // répond à « qui tire le thème ? », pas « qui bat le marché ? »
  const { data: holdings = [], isFetching: loadingHoldings } = useQuery<HoldingRow[]>({
    queryKey: ['narrative-holdings', narrative.id, refEtf, period],
    queryFn: async () => {
      const tickersToFetch = [refEtf, ...tickers.map(t => t.ticker)];
      const histories = await Promise.all(
        tickersToFetch.map(t => fetchYahooHistory(t, period))
      );
      const etfPerf = calcPerf(histories[0]);
      return tickers.map((t, i) => {
        const hist = histories[i + 1];
        const perf = calcPerf(hist);
        return {
          ticker: t.ticker,
          name: t.name,
          perf,
          relPerf: perf != null && etfPerf != null ? perf - etfPerf : null,
          currentPrice: hist[hist.length - 1]?.value ?? null,
        };
      }).sort((a, b) => (b.perf ?? -999) - (a.perf ?? -999));
    },
    staleTime: 5 * 60 * 1000,
  });

  const chartPerf = calcPerf(chartData);
  const isPerfPos = (chartPerf ?? 0) >= 0;

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
              <span className={styles.subtitle}>ETF : {refEtf}</span>
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

        <div ref={containerRef} className={styles.chart} />

        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Perf. {period}</span>
            <span className={`${styles.statValue} ${isPerfPos ? styles.pos : styles.neg}`}>
              {fmtPerf(chartPerf)}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>RS vs S&P 500</span>
            <div className={styles.rsTrend}>
              {(['3M', '1M', '1W'] as const).map((label, i) => {
                const v = rsTrend[i];
                return (
                  <span key={label} className={`${styles.rsItem} ${v == null ? '' : v >= 0 ? styles.pos : styles.neg}`}>
                    <span className={styles.rsTimeLabel}>{label}</span>
                    {v != null ? fmtPerf(v) : '—'}
                  </span>
                );
              })}
            </div>
          </div>
          {parentEtf && (
            <div className={styles.stat}>
              <span className={styles.statLabel}>RS vs secteur ({parentEtf})</span>
              <div className={styles.rsTrend}>
                {(['3M', '1M', '1W'] as const).map((label, i) => {
                  const v = vsParentTrend[i];
                  return (
                    <span key={label} className={`${styles.rsItem} ${v == null ? '' : v >= 0 ? styles.pos : styles.neg}`}>
                      <span className={styles.rsTimeLabel}>{label}</span>
                      {v != null ? fmtPerf(v) : '—'}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {score && <ScoreBreakdown score={score} />}

        <div className={styles.holdingsSection}>
          <span className={styles.holdingsTitle}>Composants ({tickers.length})</span>
          {loadingHoldings ? (
            <span className={styles.loadingMsg}>Chargement…</span>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Nom</th>
                  <th>Perf.</th>
                  <th>vs {refEtf}</th>
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
