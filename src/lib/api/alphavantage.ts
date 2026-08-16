import { invoke } from '@tauri-apps/api/core';

/**
 * Indicateurs de marche absents des comptes SEC : forward P/E, PEG et
 * croissance trimestrielle reposent sur un consensus d'analystes, jamais
 * publie dans un depot XBRL (100% historique). Source : `OVERVIEW`
 * d'Alpha Vantage, gratuit sur simple inscription.
 *
 * Tier gratuit : 25 requetes/jour, aucune limite par minute documentee. D'ou
 * le cache SQLite (`market_indicators_cache`, cf. db.ts) plutot qu'un simple
 * staleTime TanStack Query, qui ne survivrait pas a un redemarrage de l'app.
 */
export const ALPHA_VANTAGE_API_KEY_SETTING = 'alphavantage_api_key';

export interface MarketIndicators {
  /** Capitalisation / benefice ATTENDU (12 prochains mois), consensus analystes. */
  forwardPE: number | null;
  /** Forward P/E rapporte au taux de croissance attendu. */
  pegRatio: number | null;
  /** Volatilite de l'action vs le marche. 1 = bouge comme le marche. */
  beta: number | null;
  /** BPA du dernier trimestre publie vs meme trimestre un an plus tot. */
  quarterlyEarningsGrowthYoY: number | null;
  /** CA du dernier trimestre publie vs meme trimestre un an plus tot. */
  quarterlyRevenueGrowthYoY: number | null;
}

interface RawOverview {
  Symbol?: string;
  ForwardPE?: string;
  PEGRatio?: string;
  Beta?: string;
  QuarterlyEarningsGrowthYOY?: string;
  QuarterlyRevenueGrowthYOY?: string;
  Note?: string;
  Information?: string;
}

/**
 * Alpha Vantage encode l'absence d'une donnee par la chaine litterale "None"
 * (ou "-"), jamais par un champ omis — un `Number("None")` vaudrait `NaN` et
 * se propagerait silencieusement sans ce filtre.
 */
export function avNumber(raw: string | undefined): number | null {
  if (raw == null || raw === 'None' || raw === '-') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export type MarketIndicatorsResult =
  | { kind: 'ok'; data: MarketIndicators }
  /** Quota quotidien ou frequence depassee — jamais un HTTP 429, cf. en-tete. */
  | { kind: 'rate_limited' }
  /** Ticker inconnu d'Alpha Vantage : reponds par un objet vide, pas une erreur. */
  | { kind: 'not_found' }
  | { kind: 'error' };

/**
 * `fetch_url` ne verifie pas le statut HTTP (cf. CLAUDE.md) : un plafond
 * atteint n'arrive donc jamais comme une exception, mais comme un JSON 200
 * portant `Note` (frequence) ou `Information` (quota) a la place des champs
 * attendus. Les deux se lisent comme un `RawOverview` valide si on ne teste
 * pas explicitement leur presence.
 */
export async function fetchMarketIndicators(
  ticker: string,
  apiKey: string,
): Promise<MarketIndicatorsResult> {
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;

  let raw: string;
  try {
    raw = await invoke('fetch_url', { url });
  } catch {
    return { kind: 'error' };
  }

  let data: RawOverview;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'error' };
  }

  if (data.Note || data.Information) return { kind: 'rate_limited' };
  if (!data.Symbol) return { kind: 'not_found' };

  return {
    kind: 'ok',
    data: {
      forwardPE: avNumber(data.ForwardPE),
      pegRatio: avNumber(data.PEGRatio),
      beta: avNumber(data.Beta),
      quarterlyEarningsGrowthYoY: avNumber(data.QuarterlyEarningsGrowthYOY),
      quarterlyRevenueGrowthYoY: avNumber(data.QuarterlyRevenueGrowthYOY),
    },
  };
}
