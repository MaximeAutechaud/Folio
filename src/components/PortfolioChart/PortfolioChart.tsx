import { useState, useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle, AreaSeries, LineSeries } from 'lightweight-charts';
import type { Snapshot } from '../../types';
import styles from './PortfolioChart.module.css';

type Period = '1W' | '1M' | '3M' | '1Y' | 'ALL';

const PERIODS: Period[] = ['1W', '1M', '3M', '1Y', 'ALL'];

const PERIOD_MS: Record<Period, number | null> = {
  '1W':  7  * 86400 * 1000,
  '1M':  30 * 86400 * 1000,
  '3M':  90 * 86400 * 1000,
  '1Y': 365 * 86400 * 1000,
  'ALL': null,
};

interface Props {
  snapshots: Snapshot[];
}

function downsample(snapshots: Snapshot[]): Snapshot[] {
  if (snapshots.length < 2) return snapshots;
  const span = snapshots[snapshots.length - 1].recorded_at - snapshots[0].recorded_at;

  let bucketSize: number;
  if (span < 2 * 3600)        bucketSize = 5 * 60;
  else if (span < 24 * 3600)  bucketSize = 30 * 60;
  else if (span < 7 * 86400)  bucketSize = 2 * 3600;
  else                         bucketSize = 86400;

  const buckets = new Map<number, Snapshot>();
  for (const s of snapshots) {
    const key = Math.floor(s.recorded_at / bucketSize) * bucketSize;
    buckets.set(key, s);
  }
  return Array.from(buckets.values()).sort((a, b) => a.recorded_at - b.recorded_at);
}

function filterByPeriod(snapshots: Snapshot[], period: Period): Snapshot[] {
  const ms = PERIOD_MS[period];
  if (ms === null) return snapshots;
  const cutoff = (Date.now() - ms) / 1000;
  const filtered = snapshots.filter(s => s.recorded_at >= cutoff);
  return filtered.length >= 2 ? filtered : snapshots;
}

export function PortfolioChart({ snapshots }: Props) {
  const [period, setPeriod] = useState<Period>('ALL');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || snapshots.length < 2) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6e7681',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: '#1f2937', style: LineStyle.Dotted },
        horzLines: { color: '#1f2937', style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: '#21262d',
        scaleMargins: { top: 0.15, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#21262d',
        timeVisible: true,
        secondsVisible: false,
        minBarSpacing: 6,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        vertLine: { color: '#4b5563', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1f2937' },
        horzLine: { color: '#4b5563', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1f2937' },
      },
      handleScroll: true,
      handleScale: true,
    });

    const valueSeries = chart.addSeries(AreaSeries, {
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0.15)',
      bottomColor: 'rgba(59, 130, 246, 0)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });

    const costSeries = chart.addSeries(LineSeries, {
      color: '#374151',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      crosshairMarkerVisible: false,
    });

    const deduped = snapshots.reduce<Map<number, Snapshot>>((acc, s) => {
      acc.set(s.recorded_at, s);
      return acc;
    }, new Map());
    const sorted = Array.from(deduped.values()).sort((a, b) => a.recorded_at - b.recorded_at);
    const data = downsample(filterByPeriod(sorted, period));

    type TS = import('lightweight-charts').UTCTimestamp;
    valueSeries.setData(data.map((s) => ({ time: s.recorded_at as TS, value: s.total_value })));
    costSeries.setData(data.map((s) => ({ time: s.recorded_at as TS, value: s.total_cost })));
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(containerRef.current);

    return () => { observer.disconnect(); chart.remove(); };
  }, [snapshots, period]);

  if (snapshots.length < 2) {
    return (
      <div className={styles.empty}>
        Le graphique apparaîtra après le premier rafraîchissement des prix.
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.periodBar}>
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
    </div>
  );
}
