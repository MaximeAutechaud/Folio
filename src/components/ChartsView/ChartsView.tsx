import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, LineStyle, AreaSeries } from 'lightweight-charts';
import { usePortfolioStore, convertCurrency } from '../../store/portfolio';
import { fetchYahooHistory, detectCurrency } from '../../lib/api/yahoo';
import { fetchCryptoHistory, symbolToId } from '../../lib/api/coingecko';
import styles from './ChartsView.module.css';

type Period = '1W' | '1M' | '3M' | '1Y';
const PERIODS: Period[] = ['1W', '1M', '3M', '1Y'];

function displayTicker(ticker: string, name: string, assetType: string): string {
  if (assetType === 'crypto') {
    const match = name.match(/\(([A-Z0-9]+)\)$/i);
    if (match) return match[1].toUpperCase();
  }
  return ticker.toUpperCase();
}

function fmt(value: number, ccy: string): string {
  const sym = ccy === 'EUR' ? '€' : ccy === 'GBP' ? '£' : '$';
  return sym + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ChartsView() {
  const rawPositions = usePortfolioStore((s) => s.positions);
  const baseCurrency = usePortfolioStore((s) => s.baseCurrency);
  const eurUsd      = usePortfolioStore((s) => s.eurUsd);
  const positions   = rawPositions.filter((p) => p.asset_type !== 'fiat');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [period, setPeriod]         = useState<Period>('1M');
  const containerRef                = useRef<HTMLDivElement>(null);

  const position = positions.find((p) => p.id === selectedId) ?? positions[0] ?? null;
  const priceCcy = position ? detectCurrency(position.ticker) : 'USD';

  const { data = [], isFetching } = useQuery({
    queryKey: ['history', position?.ticker, period],
    queryFn: async () => {
      if (!position) return [];
      if (position.asset_type === 'crypto') {
        return fetchCryptoHistory(symbolToId(position.ticker), period);
      }
      return fetchYahooHistory(position.ticker, period);
    },
    enabled: position != null,
    staleTime: 5 * 60 * 1000,
  });

  // Same conversion as Dashboard: raw price → baseCurrency
  const convertedData = useMemo(
    () => data.map((p) => ({
      time: p.time,
      value: convertCurrency(p.value, priceCcy, baseCurrency, eurUsd),
    })),
    [data, priceCcy, baseCurrency, eurUsd]
  );

  // PRU converted to baseCurrency — same as Dashboard cost column
  const entryInBase = position
    ? convertCurrency(position.cost_basis, position.currency, baseCurrency, eurUsd)
    : null;

  // Stat bar
  const firstValue = convertedData.length >= 2 ? convertedData[0].value : null;
  const lastValue  = convertedData.length >= 2 ? convertedData[convertedData.length - 1].value : null;
  const change     = firstValue != null && lastValue != null ? lastValue - firstValue : null;
  const changePct  = change != null && firstValue ? (change / firstValue) * 100 : null;
  const isPositive = change != null && change >= 0;

  useEffect(() => {
    if (!containerRef.current || convertedData.length < 2 || entryInBase == null) return;

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
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#21262d',
        timeVisible: true,
        secondsVisible: false,
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

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0.15)',
      bottomColor: 'rgba(59, 130, 246, 0)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });

    type TS = import('lightweight-charts').UTCTimestamp;
    series.setData(convertedData.map((p) => ({ time: p.time as TS, value: p.value })));

    series.createPriceLine({
      price: entryInBase,
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: 'PRU',
      axisLabelVisible: true,
    });

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(containerRef.current);

    return () => { observer.disconnect(); chart.remove(); };
  }, [convertedData, entryInBase]);

  if (positions.length === 0) {
    return <div className={styles.empty}>No positions to chart. Add positions first.</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <select
          className={styles.select}
          value={position?.id ?? ''}
          onChange={(e) => setSelectedId(Number(e.target.value))}
        >
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {displayTicker(p.ticker, p.name, p.asset_type)} — {p.name || p.ticker}
            </option>
          ))}
        </select>

        <div className={styles.periods}>
          {PERIODS.map((p) => (
            <button
              key={p}
              className={`${styles.periodBtn} ${period === p ? styles.active : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {lastValue != null && change != null && changePct != null && (
        <div className={styles.statBar}>
          <span className={styles.statPrice}>{fmt(lastValue, baseCurrency)}</span>
          <span className={`${styles.statChange} ${isPositive ? styles.green : styles.red}`}>
            {isPositive ? '+' : ''}{fmt(change, baseCurrency)}
          </span>
          <span className={`${styles.statPct} ${isPositive ? styles.green : styles.red}`}>
            ({isPositive ? '+' : ''}{changePct.toFixed(2)}%)
          </span>
          <span className={styles.statPeriod}>{period}</span>
        </div>
      )}

      <div className={styles.chartWrap}>
        {isFetching && convertedData.length === 0 && (
          <div className={styles.overlay}>Loading…</div>
        )}
        {!isFetching && convertedData.length < 2 && (
          <div className={styles.overlay}>No data available for this period.</div>
        )}
        <div
          ref={containerRef}
          className={styles.chart}
          style={{ visibility: convertedData.length >= 2 ? 'visible' : 'hidden' }}
        />
        {convertedData.length >= 2 && (
          <span className={styles.ccyLabel}>{baseCurrency}</span>
        )}
      </div>
    </div>
  );
}
