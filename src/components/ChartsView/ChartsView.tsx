import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, LineStyle, AreaSeries, LineSeries } from 'lightweight-charts';
import { usePortfolioStore, convertCurrency } from '../../store/portfolio';
import { fetchYahooHistory, detectCurrency } from '../../lib/api/yahoo';
import { fetchCryptoHistory, symbolToId } from '../../lib/api/coingecko';
import { Select } from '../Select/Select';
import { TickerSearch, type TickerResult } from '../TickerSearch/TickerSearch';
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
  const eurUsd = usePortfolioStore((s) => s.eurUsd);
  const positions   = rawPositions.filter((p) => p.asset_type !== 'fiat');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [period, setPeriod]         = useState<Period>('1M');
  const [showMcap, setShowMcap]     = useState(false);
  const [customTicker, setCustomTicker] = useState<TickerResult | null>(null);
  const containerRef                = useRef<HTMLDivElement>(null);

  const portfolioPosition = positions.find((p) => p.id === selectedId) ?? positions[0] ?? null;
  const position = customTicker ? null : portfolioPosition;
  const activeTicker = customTicker?.ticker ?? position?.ticker ?? null;
  const activeAssetType = customTicker?.assetType ?? (position?.asset_type === 'crypto' ? 'crypto' : 'stock');
  const priceCcy = activeTicker && activeAssetType === 'stock' ? detectCurrency(activeTicker) : 'USD';

  function handleSearchSelect(result: TickerResult) {
    setCustomTicker(result);
    setSelectedId(null);
    setShowMcap(false);
  }

  function handlePortfolioSelect(id: number) {
    setSelectedId(id);
    setCustomTicker(null);
    setShowMcap(false);
  }

  const { data = [], isFetching } = useQuery({
    queryKey: ['history', activeTicker, activeAssetType, period],
    queryFn: async () => {
      if (!activeTicker) return [];
      if (activeAssetType === 'crypto') return fetchCryptoHistory(symbolToId(activeTicker), period);
      return fetchYahooHistory(activeTicker, period);
    },
    enabled: activeTicker != null,
    staleTime: 5 * 60 * 1000,
  });

  const isCrypto = activeAssetType === 'crypto';

  // Charts show native asset price — no conversion to baseCurrency
  const convertedData = useMemo(
    () => data.map((p) => ({
      time: p.time,
      value: p.value,
      marketCap: 'marketCap' in p ? (p.marketCap as number | null) : null,
    })),
    [data]
  );

  // PRU converted to native price currency for comparison with chart
  const entryInBase = position
    ? convertCurrency(position.cost_basis, position.currency, priceCcy, eurUsd)
    : null;

  // Stat bar
  const firstValue = convertedData.length >= 2 ? convertedData[0].value : null;
  const lastValue  = convertedData.length >= 2 ? convertedData[convertedData.length - 1].value : null;
  const change     = firstValue != null && lastValue != null ? lastValue - firstValue : null;
  const changePct  = change != null && firstValue ? (change / firstValue) * 100 : null;
  const isPositive = change != null && change >= 0;

  useEffect(() => {
    if (!containerRef.current || convertedData.length < 2) return;

    const mcapData = showMcap && isCrypto
      ? convertedData.filter(p => p.marketCap != null).map(p => ({ time: p.time, value: p.marketCap! / 1e9 }))
      : [];

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
      leftPriceScale: {
        visible: mcapData.length > 0,
        borderColor: '#21262d',
        scaleMargins: { top: 0.1, bottom: 0.1 },
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

    if (entryInBase != null) {
      series.createPriceLine({
        price: entryInBase,
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
        lineStyle: LineStyle.Solid,
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

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(containerRef.current);

    return () => { observer.disconnect(); chart.remove(); };
  }, [convertedData, entryInBase, showMcap, isCrypto]);

  const activeLabel = customTicker
    ? customTicker.name
    : position
      ? `${displayTicker(position.ticker, position.name, position.asset_type)} — ${position.name || position.ticker}`
      : null;

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <TickerSearch onSelect={handleSearchSelect} />
        {positions.length > 0 && (
          <Select
            value={customTicker ? null : (portfolioPosition?.id ?? null)}
            onChange={(v) => handlePortfolioSelect(Number(v))}
            placeholder="Portfolio…"
            options={positions.map((p) => ({
              value: p.id,
              label: displayTicker(p.ticker, p.name, p.asset_type),
              sublabel: p.name || p.ticker,
            }))}
          />
        )}

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

      {lastValue != null && change != null && changePct != null && (
        <div className={styles.statBar}>
          {activeLabel && <span className={styles.statTicker}>{activeLabel}</span>}
          <span className={styles.statPrice}>{fmt(lastValue, priceCcy)}</span>
          <span className={`${styles.statChange} ${isPositive ? styles.green : styles.red}`}>
            {isPositive ? '+' : ''}{fmt(change, priceCcy)}
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
          <span className={styles.ccyLabel}>{priceCcy}</span>
        )}
      </div>
    </div>
  );
}
