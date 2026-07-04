import type { QueryClient } from '@tanstack/react-query';
import { usePortfolioStore, resolvePositions, computeTotals, convertCurrency } from '../store/portfolio';
import { detectCurrency } from './api/yahoo';
import { scoreSector } from '../hooks/useAlertEngine';
import type { MacroScoreData } from '../hooks/useMacroScore';
import type { SectorPerf } from '../hooks/useSectorData';

// Snapshot fermé de l'état de l'app à l'instant T, assemblé depuis le store Zustand
// + les caches TanStack déjà chauds (zéro requête réseau). Toutes les valeurs
// dérivées sont pré-calculées : le LLM ne fait aucun calcul. `null` = donnée non
// disponible (le prompt interdit de l'inventer).

export interface MacroSnapshot {
  score: number;
  regime: string;
  trend: 'up' | 'down' | 'flat';
  scorePrev: number | null;
  indicateurs: { label: string; valeur: string; signal: string }[];
}

export interface PositionSnapshot {
  ticker: string;
  nom: string;
  type: string;
  note?: string;                    // contexte / intention de l'user (présent seulement si renseigné)
  valeur: number | null;
  poidsPct: number | null;
  pnlPct: number | null;
  pnlValeur: number | null;
  joursDetenu: number;
  stopDefini: boolean;
  distanceStopPct: number | null;   // % au-dessus du stop (négatif = sous le stop)
  distanceTargetPct: number | null; // % à parcourir jusqu'au 1er objectif
  rMultipleCourant: number | null;  // gain latent en R (unrealized)
}

export interface PortfolioSnapshot {
  valeurTotale: number;
  coutTotal: number;
  pnlValeur: number;
  pnlPct: number;
  positionsSansStop: number;
  positions: PositionSnapshot[];
}

export interface SectorSnapshot {
  nom: string;
  etf: string;
  score: number;
  label: string;
  signal: string | null;
  relPerf1M: number | null;
  rsi: number | null;
}

export interface BriefingSnapshot {
  meta: { date: string; deviseBase: string; eurUsd: number };
  macro: MacroSnapshot | null;
  portefeuille: PortfolioSnapshot | null;
  secteurs: SectorSnapshot[] | null;
}

function r2(x: number | null): number | null {
  return x == null ? null : Math.round(x * 100) / 100;
}

function buildMacro(macro: MacroScoreData | undefined): MacroSnapshot | null {
  if (!macro) return null;
  return {
    score: macro.score,
    regime: macro.regime,
    trend: macro.trend,
    scorePrev: macro.scorePrev,
    indicateurs: macro.indicators
      .filter((i) => !i.contextOnly)
      .map((i) => ({ label: i.label, valeur: i.value, signal: i.signal })),
  };
}

function buildPortfolio(): PortfolioSnapshot | null {
  const { positions, prices, baseCurrency, eurUsd, transactions } = usePortfolioStore.getState();
  // Actions uniquement : ce briefing est centré rotation sectorielle TradFi. Le
  // crypto (et le fiat) sont hors périmètre — analyse crypto séparée à terme.
  const resolved = resolvePositions(positions, transactions).filter((p) => p.asset_type === 'stock');
  if (resolved.length === 0) return null;

  const { totalValue, totalCost } = computeTotals(resolved, prices, baseCurrency, eurUsd);
  const now = Math.floor(Date.now() / 1000);

  const positionsSnap: PositionSnapshot[] = resolved.map((p) => {
    const price = prices[p.ticker] ?? null;
    const quoteCcy = detectCurrency(p.ticker);
    const costBase = convertCurrency(p.quantity * p.cost_basis, p.currency, baseCurrency, eurUsd);
    const valueBase = price != null
      ? convertCurrency(p.quantity * price, quoteCcy, baseCurrency, eurUsd)
      : null;

    const pnlValeur = valueBase != null ? valueBase - costBase : null;
    const pnlPct = valueBase != null && costBase > 0 ? ((valueBase - costBase) / costBase) * 100 : null;
    const poidsPct = valueBase != null && totalValue > 0 ? (valueBase / totalValue) * 100 : null;

    // Ratios de prix : stop/target sont des niveaux dans la devise de cotation du
    // ticker (= detectCurrency), même base que `price` → ratio propre sans conversion.
    const distanceStopPct = price != null && p.stop_price != null
      ? ((price - p.stop_price) / price) * 100 : null;
    const distanceTargetPct = price != null && p.target_price != null
      ? ((p.target_price - price) / price) * 100 : null;

    // R courant : on ramène le PRU (en p.currency) vers la devise de cotation pour
    // rester cohérent avec price/stop. Garde-fou : entrée > stop (risque positif).
    let rMultipleCourant: number | null = null;
    if (price != null && p.stop_price != null) {
      const entryQuote = convertCurrency(p.cost_basis, p.currency, quoteCcy, eurUsd);
      const risk = entryQuote - p.stop_price;
      if (risk > 0) rMultipleCourant = (price - entryQuote) / risk;
    }

    return {
      ticker: p.ticker,
      nom: p.name,
      type: p.asset_type,
      note: p.note ?? undefined,
      valeur: r2(valueBase),
      poidsPct: r2(poidsPct),
      pnlPct: r2(pnlPct),
      pnlValeur: r2(pnlValeur),
      joursDetenu: Math.max(0, Math.floor((now - p.created_at) / 86400)),
      stopDefini: p.stop_price != null,
      distanceStopPct: r2(distanceStopPct),
      distanceTargetPct: r2(distanceTargetPct),
      rMultipleCourant: r2(rMultipleCourant),
    };
  });

  return {
    valeurTotale: r2(totalValue)!,
    coutTotal: r2(totalCost)!,
    pnlValeur: r2(totalValue - totalCost)!,
    pnlPct: r2(totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0)!,
    positionsSansStop: resolved.filter((p) => p.stop_price == null).length,
    positions: positionsSnap,
  };
}

function buildSectors(
  sectorPerfs: SectorPerf[] | undefined,
  macro: MacroScoreData | undefined,
): SectorSnapshot[] | null {
  if (!sectorPerfs || sectorPerfs.length === 0 || !macro) return null;
  return sectorPerfs
    .map((sp) => {
      const s = scoreSector(sp, macro);
      return {
        nom: sp.sector.name,
        etf: sp.sector.etf,
        score: s.total,
        label: s.label,
        signal: s.signal,
        relPerf1M: r2(sp.relPerf1M),
        rsi: sp.rsi,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function buildBriefingSnapshot(queryClient: QueryClient): BriefingSnapshot {
  const { baseCurrency, eurUsd } = usePortfolioStore.getState();
  const macro = queryClient.getQueryData<MacroScoreData>(['macro-score']);
  const sectorPerfs = queryClient.getQueryData<SectorPerf[]>(['sector-perfs', '3M']);

  return {
    meta: {
      date: new Date().toISOString().slice(0, 10),
      deviseBase: baseCurrency,
      eurUsd: r2(eurUsd)!,
    },
    macro: buildMacro(macro),
    portefeuille: buildPortfolio(),
    secteurs: buildSectors(sectorPerfs, macro),
  };
}
