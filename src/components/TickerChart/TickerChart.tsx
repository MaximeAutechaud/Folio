import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createChart, ColorType, LineStyle,
  AreaSeries, LineSeries,
  type LogicalRange,
} from 'lightweight-charts';
import { fetchYahooHistory, detectCurrency } from '../../lib/api/yahoo';
import { fetchCryptoHistory, symbolToId } from '../../lib/api/coingecko';
import { calcRsiSeries } from '../../lib/indicators';
import styles from './TickerChart.module.css';

type Period = '1W' | '1M' | '3M' | '1Y';
const PERIODS: Period[] = ['1W', '1M', '3M', '1Y'];

function fmt(value: number, ccy: string): string {
  const sym = ccy === 'EUR' ? '€' : ccy === 'GBP' ? '£' : '$';
  return sym + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CHART_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: 'transparent' } as const,
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
    scaleMargins: { top: 0.1, bottom: 0.05 },
  },
  crosshair: {
    vertLine: { color: '#4b5563', width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: '#1f2937' },
    horzLine: { color: '#4b5563', width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: '#1f2937' },
  },
  handleScroll: true,
  handleScale: true,
};

interface Props {
  ticker: string;
  assetType: 'stock' | 'crypto';
  name?: string;
  entryPrice?: number | null;
  currency?: string;
}

export function TickerChart({ ticker, assetType, name, entryPrice, currency }: Props) {
  const [period, setPeriod] = useState<Period>('1M');
  const [showMcap, setShowMcap] = useState(false);
  const priceRef  = useRef<HTMLDivElement>(null);
  const rsiRef    = useRef<HTMLDivElement>(null);

  const isCrypto = assetType === 'crypto';
  const priceCcy = currency ?? (isCrypto ? 'USD' : detectCurrency(ticker));

  const { data = [], isFetching } = useQuery({
    queryKey: ['history', ticker, assetType, period],
    queryFn: () =>
      isCrypto
        ? fetchCryptoHistory(symbolToId(ticker), period)
        : fetchYahooHistory(ticker, period),
    enabled: !!ticker,
    staleTime: 5 * 60 * 1000,
  });

  const convertedData = useMemo(
    () => data.map(p => ({
      time: p.time,
      value: p.value,
      marketCap: 'marketCap' in p ? (p.marketCap as number | null) : null,
    })),
    [data]
  );

  const firstValue = convertedData.length >= 2 ? convertedData[0].value : null;
  const lastValue  = convertedData.length >= 2 ? convertedData[convertedData.length - 1].value : null;
  const change     = firstValue != null && lastValue != null ? lastValue - firstValue : null;
  const changePct  = change != null && firstValue ? (change / firstValue) * 100 : null;
  const isPositive = change != null && change >= 0;

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current || convertedData.length < 2) return;

    type TS = import('lightweight-charts').UTCTimestamp;

    // ── Price chart ──────────────────────────────────────────────────────────
    const mcapData = showMcap && isCrypto
      ? convertedData.filter(p => p.marketCap != null).map(p => ({ time: p.time, value: p.marketCap! / 1e9 }))
      : [];

    const chart = createChart(priceRef.current, {
      ...CHART_THEME,
      leftPriceScale: { visible: mcapData.length > 0, borderColor: '#21262d', scaleMargins: { top: 0.1, bottom: 0.05 } },
      timeScale: { borderColor: '#21262d', timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      width: priceRef.current.clientWidth,
      height: priceRef.current.clientHeight || 280,
    });

    const priceSeries = chart.addSeries(AreaSeries, {
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0.15)',
      bottomColor: 'rgba(59, 130, 246, 0)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });
    priceSeries.setData(convertedData.map(p => ({ time: p.time as TS, value: p.value })));

    if (entryPrice != null) {
      priceSeries.createPriceLine({
        price: entryPrice,
        color: '#f59e0b',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'PRU',
        axisLabelVisible: true,
      });
    }

    if (mcapData.length > 0) {
      const mcapSeries = chart.addSeries(LineSeries, {
        color: '#a855f7',
        lineWidth: 1,
        priceScaleId: 'left',
        priceFormat: {
          type: 'custom',
          formatter: (v: number) => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'T' : v.toFixed(0) + 'B'}`,
        },
        crosshairMarkerVisible: false,
        title: 'MCap',
      });
      mcapSeries.setData(mcapData.map(p => ({ time: p.time as TS, value: p.value })));
    }

    // ── RSI chart ────────────────────────────────────────────────────────────
    const rsiChart = createChart(rsiRef.current, {
      ...CHART_THEME,
      timeScale: { borderColor: '#21262d', timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      rightPriceScale: { borderColor: '#21262d', scaleMargins: { top: 0.1, bottom: 0.1 } },
      width: rsiRef.current.clientWidth,
      height: rsiRef.current.clientHeight || 100,
    });

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: '#d29922',
      lineWidth: 1,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
    });

    // Align RSI to the price time axis: the first `period` bars have no RSI
    // (warmup), so emit them as whitespace ({ time } without value). Otherwise
    // the RSI series is shorter than price, and syncing the two by *logical*
    // range clamps the price chart down to the RSI's bar count
    // (fixLeftEdge/fixRightEdge), collapsing the initial view to the first bars.
    const rsiByTime = new Map(calcRsiSeries(convertedData).map(p => [p.time, p.value]));
    const rsiData = convertedData.map(p =>
      rsiByTime.has(p.time)
        ? { time: p.time as TS, value: rsiByTime.get(p.time)! }
        : { time: p.time as TS }
    );
    rsiSeries.setData(rsiData);

    rsiSeries.createPriceLine({ price: 70, color: '#f85149', lineWidth: 1, lineStyle: LineStyle.Dashed, title: '' });
    rsiSeries.createPriceLine({ price: 50, color: '#6e7681', lineWidth: 1, lineStyle: LineStyle.Dotted, title: '' });
    rsiSeries.createPriceLine({ price: 30, color: '#3fb950', lineWidth: 1, lineStyle: LineStyle.Dashed, title: '' });

    // ── Sync time scales ──────────────────────────────────────────────────────
    let syncing = false;
    const syncToRsi = (range: LogicalRange | null) => {
      if (syncing || !range) return;
      syncing = true;
      rsiChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    const syncToPrice = (range: LogicalRange | null) => {
      if (syncing || !range) return;
      syncing = true;
      chart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncToRsi);
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncToPrice);

    chart.timeScale().fitContent();

    // ── Resize ────────────────────────────────────────────────────────────────
    const observer = new ResizeObserver(() => {
      if (priceRef.current)
        chart.applyOptions({ width: priceRef.current.clientWidth, height: priceRef.current.clientHeight });
      if (rsiRef.current)
        rsiChart.applyOptions({ width: rsiRef.current.clientWidth, height: rsiRef.current.clientHeight });
    });
    if (priceRef.current) observer.observe(priceRef.current);
    if (rsiRef.current)   observer.observe(rsiRef.current);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncToRsi);
      rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncToPrice);
      observer.disconnect();
      chart.remove();
      rsiChart.remove();
    };
  }, [convertedData, entryPrice, showMcap, isCrypto]);

  const hasData = convertedData.length >= 2;

  return (
    <div className={styles.root}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.statBar}>
          {name && <span className={styles.statLabel}>{name}</span>}
          {lastValue != null && (
            <>
              <span className={styles.statPrice}>{fmt(lastValue, priceCcy)}</span>
              {change != null && changePct != null && (
                <>
                  <span className={`${styles.statChange} ${isPositive ? styles.green : styles.red}`}>
                    {isPositive ? '+' : ''}{fmt(change, priceCcy)}
                  </span>
                  <span className={`${styles.statPct} ${isPositive ? styles.green : styles.red}`}>
                    ({isPositive ? '+' : ''}{changePct.toFixed(2)}%)
                  </span>
                </>
              )}
              <span className={styles.statPeriod}>{period}</span>
            </>
          )}
        </div>

        <div className={styles.periods}>
          {PERIODS.map(p => (
            <button
              key={p}
              className={`${styles.periodBtn} ${period === p ? styles.active : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
          {isCrypto && (
            <button
              className={`${styles.periodBtn} ${styles.mcapBtn} ${showMcap ? styles.active : ''}`}
              onClick={() => setShowMcap(v => !v)}
              title="Superposer le market cap"
            >
              MCap
            </button>
          )}
        </div>
      </div>

      {/* ── Charts ── */}
      <div className={styles.chartsWrap}>
        {isFetching && !hasData && <div className={styles.overlay}>Chargement…</div>}
        {!isFetching && !hasData && <div className={styles.overlay}>Aucune donnée disponible</div>}

        <div className={styles.priceWrap} style={{ visibility: hasData ? 'visible' : 'hidden' }}>
          <div ref={priceRef} className={styles.priceChart} />
          <span className={styles.ccyLabel}>{priceCcy}</span>
        </div>

        <div className={styles.rsiDivider}>
          <span className={styles.rsiLabel}>RSI 14</span>
        </div>

        <div
          ref={rsiRef}
          className={styles.rsiChart}
          style={{ visibility: hasData ? 'visible' : 'hidden' }}
        />
      </div>
    </div>
  );
}
