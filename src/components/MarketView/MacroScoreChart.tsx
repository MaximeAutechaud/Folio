import { useState, useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle, LineSeries } from 'lightweight-charts';
import { useMacroScoreHistory } from '../../hooks/useMacroScoreHistory';
import styles from './MacroScoreChart.module.css';

type Period = '6M' | '1Y' | '2Y';

const PERIODS: Period[] = ['6M', '1Y', '2Y'];

const LOOKBACK_WEEKS: Record<Period, number> = {
  '6M':  26,
  '1Y':  52,
  '2Y': 104,
};

// Regime threshold lines: price, color, label
const THRESHOLDS = [
  { price: 75, color: '#3fb950', title: 'Risk-On'     },
  { price: 55, color: '#7ee787', title: 'Favorable'   },
  { price: 40, color: '#e3b341', title: 'Neutre'      },
  { price: 25, color: '#f0883e', title: 'Défavorable' },
];

export function MacroScoreChart() {
  const { data, isFetching } = useMacroScoreHistory();
  const [period, setPeriod]  = useState<Period>('1Y');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !data || data.length < 5) return;

    const sliced = data.slice(-LOOKBACK_WEEKS[period]);
    if (sliced.length < 2) return;

    const chart = createChart(containerRef.current, {
      height: 160,
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
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#21262d',
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        vertLine: { color: '#4b5563', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1f2937' },
        horzLine: { color: '#4b5563', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1f2937' },
      },
      handleScroll: false,
      handleScale: false,
    });

    const scoreSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      lastValueVisible: true,
    });

    for (const t of THRESHOLDS) {
      scoreSeries.createPriceLine({
        price: t.price,
        color: t.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: t.title,
      });
    }

    type TS = import('lightweight-charts').UTCTimestamp;
    scoreSeries.setData(sliced.map(d => ({ time: d.time as TS, value: d.score })));
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(containerRef.current);

    return () => { observer.disconnect(); chart.remove(); };
  }, [data, period]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Évolution du score macro</span>
        <div className={styles.legend}>
          {THRESHOLDS.map(t => (
            <span key={t.price} className={styles.legendItem}>
              <span className={styles.legendDash} style={{ background: t.color }} />
              {t.title}
            </span>
          ))}
        </div>
        <div className={styles.periodBar}>
          {PERIODS.map(p => (
            <button
              key={p}
              className={`${styles.periodBtn} ${period === p ? styles.active : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
        {isFetching && <span className={styles.spinner}>↻</span>}
      </div>
      {!data || data.length < 5
        ? <div className={styles.empty}>Chargement de l'historique…</div>
        : <div ref={containerRef} className={styles.chartContainer} />
      }
    </div>
  );
}
