import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle, AreaSeries, LineSeries } from 'lightweight-charts';
import type { Snapshot } from '../../types';
import styles from './PortfolioChart.module.css';

interface Props {
  snapshots: Snapshot[];
}

// Bucket snapshots by interval (seconds), keeping the last value per bucket
function downsample(snapshots: Snapshot[]): Snapshot[] {
  if (snapshots.length < 2) return snapshots;
  const span = snapshots[snapshots.length - 1].recorded_at - snapshots[0].recorded_at;

  let bucketSize: number;
  if (span < 2 * 3600)        bucketSize = 5 * 60;     // < 2h  → 5 min buckets
  else if (span < 24 * 3600)  bucketSize = 30 * 60;    // < 1d  → 30 min buckets
  else if (span < 7 * 86400)  bucketSize = 2 * 3600;   // < 7d  → 2h buckets
  else                         bucketSize = 86400;       // ≥ 7d  → 1 day buckets

  const buckets = new Map<number, Snapshot>();
  for (const s of snapshots) {
    const key = Math.floor(s.recorded_at / bucketSize) * bucketSize;
    buckets.set(key, s); // last wins
  }

  return Array.from(buckets.values()).sort((a, b) => a.recorded_at - b.recorded_at);
}

export function PortfolioChart({ snapshots }: Props) {
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

    // Deduplicate then downsample
    const deduped = snapshots.reduce<Map<number, Snapshot>>((acc, s) => {
      acc.set(s.recorded_at, s);
      return acc;
    }, new Map());
    const sorted = Array.from(deduped.values()).sort((a, b) => a.recorded_at - b.recorded_at);
    const data = downsample(sorted);

    type TS = import('lightweight-charts').UTCTimestamp;
    valueSeries.setData(data.map((s) => ({ time: s.recorded_at as TS, value: s.total_value })));
    costSeries.setData(data.map((s) => ({ time: s.recorded_at as TS, value: s.total_cost })));
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(containerRef.current);

    return () => { observer.disconnect(); chart.remove(); };
  }, [snapshots]);

  if (snapshots.length < 2) {
    return (
      <div className={styles.empty}>
        Chart will appear after prices are fetched twice (≥ 2 snapshots).
      </div>
    );
  }

  return <div ref={containerRef} className={styles.chart} />;
}
