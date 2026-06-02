import { useState } from 'react';
import { usePortfolioStore, convertCurrency } from '../../store/portfolio';
import { detectCurrency } from '../../lib/api/yahoo';
import { TickerChart } from '../TickerChart/TickerChart';
import { Select } from '../Select/Select';
import { TickerSearch, type TickerResult } from '../TickerSearch/TickerSearch';
import styles from './ChartsView.module.css';

function displayTicker(ticker: string, name: string, assetType: string): string {
  if (assetType === 'crypto') {
    const match = name.match(/\(([A-Z0-9]+)\)$/i);
    if (match) return match[1].toUpperCase();
  }
  return ticker.toUpperCase();
}

export function ChartsView() {
  const rawPositions = usePortfolioStore((s) => s.positions);
  const eurUsd       = usePortfolioStore((s) => s.eurUsd);
  const positions    = rawPositions.filter((p) => p.asset_type !== 'fiat');

  const [selectedId, setSelectedId]       = useState<number | null>(null);
  const [customTicker, setCustomTicker]   = useState<TickerResult | null>(null);

  const portfolioPosition = positions.find((p) => p.id === selectedId) ?? positions[0] ?? null;
  const position          = customTicker ? null : portfolioPosition;
  const activeTicker      = customTicker?.ticker ?? position?.ticker ?? null;
  const activeAssetType   = customTicker?.assetType ?? (position?.asset_type === 'crypto' ? 'crypto' : 'stock');
  const priceCcy          = activeTicker && activeAssetType === 'stock' ? detectCurrency(activeTicker) : 'USD';

  const entryInBase = position
    ? convertCurrency(position.cost_basis, position.currency, priceCcy, eurUsd)
    : null;

  const activeLabel = customTicker
    ? customTicker.name
    : position
      ? `${displayTicker(position.ticker, position.name, position.asset_type)} — ${position.name || position.ticker}`
      : null;

  function handleSearchSelect(result: TickerResult) {
    setCustomTicker(result);
    setSelectedId(null);
  }

  function handlePortfolioSelect(id: number) {
    setSelectedId(id);
    setCustomTicker(null);
  }

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
      </div>

      {activeTicker ? (
        <TickerChart
          key={activeTicker}
          ticker={activeTicker}
          assetType={activeAssetType}
          name={activeLabel ?? undefined}
          entryPrice={entryInBase}
          currency={priceCcy}
        />
      ) : (
        <div className={styles.empty}>Sélectionnez un ticker ou recherchez-en un</div>
      )}
    </div>
  );
}
