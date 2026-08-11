import { calcRsi } from './indicators';
import type { Top100Coin } from './api/coingecko';
import type { ScreenerLogRow } from '../types';

export interface ScreenerEntry {
  coin: Top100Coin;
  heat: number;
  accelScore: number;
  rsi: number | null;
  rangePos: number | null;
  volRank: number;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function norm(x: number, low: number, high: number): number {
  return clamp(((x - low) / (high - low)) * 100);
}

/**
 * Filtre les stables/pegged : range de prix quasi nul sur 7 jours. Plus fiable
 * qu'une liste de symboles en dur (USDT, USDC, DAI... et leurs variantes se
 * multiplient) — un actif dont le prix ne bouge pas ne peut de toute facon pas
 * ressortir "chaud".
 */
export function isLikelyPegged(sparkline: number[]): boolean {
  if (sparkline.length < 2) return true;
  const min = Math.min(...sparkline);
  const max = Math.max(...sparkline);
  if (min <= 0) return true;
  return (max - min) / min < 0.015;
}

/**
 * Tokens adosses a une matiere premiere (or...) plutot qu'au dollar : leur
 * prix suit l'or, donc `isLikelyPegged` (qui suppose un range quasi nul) ne
 * les detecte pas — ils sont ressortis "chauds" les 2026-08-07 et 08-11
 * simplement parce que l'or montait. Contrairement aux stablecoins fiat, cet
 * ensemble ne se multiplie pas (2 tickers dans le top 100 a ce jour) : une
 * liste en dur est ici le choix le plus simple, pas un heuristique de prix.
 */
const COMMODITY_PEGGED_IDS = new Set(['tether-gold', 'pax-gold']);

function isCommodityPegged(id: string): boolean {
  return COMMODITY_PEGGED_IDS.has(id);
}

/**
 * Score "chaud" experimental (branche de test) — a ne pas confondre avec le
 * score d'opportunite sectoriel (`lib/scoring.ts`, RS slope/RSI/dip/macro) :
 * pas de benchmark relatif ni d'alignement macro par piece ici, juste une
 * lecture de momentum/volume sur le lot recupere en un seul appel CoinGecko
 * (`fetchTop100Markets`). Descriptif et non calibre — cf. CLAUDE.md sur les
 * campagnes de backtest fermees pour les scores macro : celui-ci n'a pas
 * encore ete observe en conditions reelles.
 */
export function computeHeatScore(
  coin: Top100Coin,
  volumeToMcapPercentile: number,
): { heat: number; accelScore: number; rsi: number | null; rangePos: number | null } {
  // Acceleration : rythme des dernieres 24h vs la moyenne quotidienne des 7 derniers jours
  const dailyAvg7d = coin.perf7d != null ? coin.perf7d / 7 : null;
  const accel = coin.perf24h != null && dailyAvg7d != null ? coin.perf24h - dailyAvg7d : null;
  const accelScore = accel != null ? norm(accel, -8, 8) : 50;

  const rsi = coin.sparkline7d.length > 15 ? calcRsi(coin.sparkline7d, 14) : null;
  // Zone chaude = momentum fort sans exces : pic autour de 65, penalise sous 40 et au-dela de 85
  const rsiScore = rsi == null ? 50 : clamp(100 - Math.abs(rsi - 65) * (100 / 45));

  const min7d = coin.sparkline7d.length ? Math.min(...coin.sparkline7d) : null;
  const max7d = coin.sparkline7d.length ? Math.max(...coin.sparkline7d) : null;
  const rangePos =
    min7d != null && max7d != null && max7d > min7d
      ? ((coin.price - min7d) / (max7d - min7d)) * 100
      : null;
  const rangeScore = rangePos != null ? clamp(rangePos) : 50;

  const heat =
    accelScore * 0.35 +
    rsiScore * 0.3 +
    rangeScore * 0.15 +
    volumeToMcapPercentile * 0.2;

  return { heat: Math.round(clamp(heat)), accelScore: Math.round(accelScore), rsi, rangePos };
}

/** Classe un lot de pieces par score "chaud", stables/pegged exclus. */
export function rankScreener(coins: Top100Coin[]): ScreenerEntry[] {
  const candidates = coins.filter(
    (c) => c.marketCap > 0 && !isLikelyPegged(c.sparkline7d) && !isCommodityPegged(c.id),
  );

  const volRatios = candidates
    .map((c) => c.volume24h / c.marketCap)
    .sort((a, b) => a - b);

  const percentileOf = (v: number): number => {
    if (volRatios.length <= 1) return 50;
    const idx = volRatios.findIndex((x) => x >= v);
    return ((idx < 0 ? volRatios.length - 1 : idx) / (volRatios.length - 1)) * 100;
  };

  return candidates
    .map((coin) => {
      const volRank = percentileOf(coin.volume24h / coin.marketCap);
      const { heat, accelScore, rsi, rangePos } = computeHeatScore(coin, volRank);
      return { coin, heat, accelScore, rsi, rangePos, volRank: Math.round(volRank) };
    })
    .sort((a, b) => b.heat - a.heat);
}

/**
 * Nombre de jours consecutifs qu'une piece a passe dans le top journalier
 * logue, en remontant depuis le jour le plus recent — un jour sans **aucune**
 * ligne loguee (tous coins confondus) veut dire "app fermee" et ne casse pas
 * le streak, un jour logue ou la piece est absente veut dire "sortie du top"
 * et le casse. Meme principe que le traitement de `signal_log` pour les
 * secteurs (cf. CLAUDE.md) — sans lui, la moindre journee sans ouverture de
 * l'app remettrait tous les streaks a zero.
 */
export function computeStreaks(rows: ScreenerLogRow[]): Map<string, number> {
  const byDate = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, new Set());
    byDate.get(r.date)!.add(r.coin_id);
  }
  const activeDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  if (activeDates.length === 0) return new Map();

  const latest = byDate.get(activeDates[0])!;
  const streaks = new Map<string, number>();
  for (const coinId of latest) {
    let streak = 0;
    for (const date of activeDates) {
      if (!byDate.get(date)!.has(coinId)) break;
      streak++;
    }
    streaks.set(coinId, streak);
  }
  return streaks;
}
