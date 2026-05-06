import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePortfolioStore, computeTotals, resolvePositions } from '../store/portfolio';
import { fetchYahooPrices, fetchEurUsd } from '../lib/api/yahoo';
import { fetchCryptoPrices, symbolToId } from '../lib/api/coingecko';
import { insertSnapshot } from '../lib/db';

const REFETCH_INTERVAL = 60_000;

export function usePrices() {
  const queryClient = useQueryClient();
  const lastSnapshotRef = useRef(0);
  const positions = usePortfolioStore((s) => s.positions);
  const storeTransactions = usePortfolioStore((s) => s.transactions);
  const setPrices = usePortfolioStore((s) => s.setPrices);
  const setEurUsd = usePortfolioStore((s) => s.setEurUsd);
  const baseCurrency = usePortfolioStore((s) => s.baseCurrency);
  const eurUsd = usePortfolioStore((s) => s.eurUsd);

  const stockTickers = positions
    .filter((p) => p.asset_type === 'stock')
    .map((p) => p.ticker);

  const cryptoPositions = positions.filter((p) => p.asset_type === 'crypto');
  const cryptoIds = cryptoPositions.map((p) => symbolToId(p.ticker));

  const fxQuery = useQuery({
    queryKey: ['fx', 'eurusd'],
    queryFn: fetchEurUsd,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const stockQuery = useQuery({
    queryKey: ['prices', 'stocks', stockTickers],
    queryFn: () => fetchYahooPrices(stockTickers),
    enabled: stockTickers.length > 0,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 30_000,
  });

  const cryptoQuery = useQuery({
    queryKey: ['prices', 'crypto', cryptoIds],
    queryFn: async () => {
      const raw = await fetchCryptoPrices(cryptoIds);
      const result: Record<string, number> = {};
      cryptoPositions.forEach((p) => {
        const id = symbolToId(p.ticker).toUpperCase();
        if (raw[id] != null) result[p.ticker] = raw[id];
      });
      return result;
    },
    enabled: cryptoIds.length > 0,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (fxQuery.data != null) setEurUsd(fxQuery.data);
  }, [fxQuery.data]);

  useEffect(() => {
    if (stockQuery.data) setPrices(stockQuery.data);
  }, [stockQuery.data]);

  useEffect(() => {
    if (cryptoQuery.data) setPrices(cryptoQuery.data);
  }, [cryptoQuery.data]);

  useEffect(() => {
    if (positions.length === 0) return;
    const now = Math.floor(Date.now() / 1000);
    if (now - lastSnapshotRef.current < 5) return; // debounce: max 1 snapshot per 5s
    lastSnapshotRef.current = now;
    const freshPrices = { ...stockQuery.data, ...cryptoQuery.data };
    const resolved = resolvePositions(positions, storeTransactions);
    const { totalValue, totalCost } = computeTotals(resolved, freshPrices, baseCurrency, eurUsd);
    if (totalValue === 0) return;
    insertSnapshot(totalValue, totalCost)
      .then(() => queryClient.invalidateQueries({ queryKey: ['snapshots'] }))
      .catch(console.error);
  }, [stockQuery.dataUpdatedAt, cryptoQuery.dataUpdatedAt]);

  return {
    isLoading: stockQuery.isFetching || cryptoQuery.isFetching,
    isError: stockQuery.isError || cryptoQuery.isError,
  };
}
