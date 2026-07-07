import type { QueryClient } from '@tanstack/react-query';
import { usePortfolioStore, resolvePositions, computeTotals, convertCurrency } from '../store/portfolio';
import { detectCurrency } from './api/yahoo';
import { scoreSector, scoreEtf } from '../hooks/useAlertEngine';
import type { MacroScoreData } from '../hooks/useMacroScore';
import type { SectorPerf } from '../hooks/useSectorData';
import type { NarrativeEtfPerf } from '../hooks/useNarrativeEtfPerfs';

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
  secteur: string | null;           // secteur de rattachement (positions.sector_id) — croisement avec la rotation
  secteurLabel: string | null;      // label du score de ce secteur (hot/warming/neutral/cooling)
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

// Divergence thème/secteur, pré-calculée en code : la détection du pattern est
// déterministe, le LLM ne fait que la verbaliser (doctrine : un thème fort dans
// un secteur faible = thèse décorrélée, éligible opportunité ; un retardataire
// dans un secteur fort = évitement, jamais une opportunité de rattrapage).
export type ThemeDivergence = 'theme_fort_secteur_faible' | 'retardataire_secteur_fort' | null;

export interface ThemeSnapshot {
  nom: string;
  etf: string;
  score: number;
  label: string;
  signal: string | null;
  rsi: number | null;
  relPerf1M: number | null;     // vs SPY, comme les secteurs
  vsParent1M: number | null;    // vs l'ETF du secteur parent : le thème tire-t-il son secteur ?
  secteurParent: string | null;
  secteurLabel: string | null;  // label du secteur parent (contexte de la divergence)
  divergence: ThemeDivergence;
}

export interface BriefingSnapshot {
  meta: { date: string; deviseBase: string; eurUsd: number };
  macro: MacroSnapshot | null;
  portefeuille: PortfolioSnapshot | null;
  secteurs: SectorSnapshot[] | null;
  themes: ThemeSnapshot[] | null;
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

// nom + label de score par id de secteur — partagé entre les positions (rattachement
// sectoriel) et les thèmes (contexte du parent). Vide si les caches ne sont pas chauds.
function buildSectorCtx(
  sectorPerfs: SectorPerf[] | undefined,
  macro: MacroScoreData | undefined,
): Record<string, { nom: string; label: string }> {
  const out: Record<string, { nom: string; label: string }> = {};
  if (!sectorPerfs || !macro) return out;
  for (const sp of sectorPerfs) {
    out[sp.sector.id] = { nom: sp.sector.name, label: scoreSector(sp, macro).label };
  }
  return out;
}

function buildPortfolio(sectorCtx: Record<string, { nom: string; label: string }>): PortfolioSnapshot | null {
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

    const sec = p.sector_id ? sectorCtx[p.sector_id] : undefined;

    return {
      ticker: p.ticker,
      nom: p.name,
      type: p.asset_type,
      secteur: sec?.nom ?? null,
      secteurLabel: sec?.label ?? null,
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

// Entonnoir inversé : on sélectionne les thèmes notables par le bas (score,
// signal, écart vs parent) puis on remonte au secteur parent pour qualifier la
// trouvaille (confirmation / thèse décorrélée / retardataire à éviter).
const THEME_CAP = 12;
const VS_PARENT_NOTABLE = 3; // pts d'écart 1M vs l'ETF parent

function buildThemes(
  narrativePerfs: NarrativeEtfPerf[] | undefined,
  sectorPerfs: SectorPerf[] | undefined,
  macro: MacroScoreData | undefined,
): ThemeSnapshot[] | null {
  if (!narrativePerfs || narrativePerfs.length === 0 || !macro) return null;

  const parentById = buildSectorCtx(sectorPerfs, macro);

  return narrativePerfs
    .map((np) => {
      const s = scoreEtf(np, np.macroProfile, macro);
      const parent = np.narrative.parent_sector ? parentById[np.narrative.parent_sector] : undefined;
      const vsParent1M = np.relPerfVsParent1M;

      let divergence: ThemeDivergence = null;
      if (parent && vsParent1M != null) {
        const themeFort = s.label === 'hot' || s.label === 'warming';
        const parentFort = parent.label === 'hot' || parent.label === 'warming';
        if (themeFort && !parentFort && vsParent1M >= VS_PARENT_NOTABLE) {
          divergence = 'theme_fort_secteur_faible';
        } else if (parentFort && vsParent1M <= -VS_PARENT_NOTABLE) {
          divergence = 'retardataire_secteur_fort';
        }
      }

      return {
        nom: np.narrative.name,
        etf: np.narrative.ref_etf!,
        score: s.total,
        label: s.label,
        signal: s.signal,
        rsi: np.rsi,
        relPerf1M: r2(np.relPerf1M),
        vsParent1M: r2(vsParent1M),
        secteurParent: parent?.nom ?? null,
        secteurLabel: parent?.label ?? null,
        divergence,
      };
    })
    // Notable = signal actif, ou label extrême, ou divergence vs parent.
    .filter((t) =>
      t.signal != null ||
      t.label === 'hot' || t.label === 'cooling' ||
      t.divergence != null
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, THEME_CAP);
}

export function buildBriefingSnapshot(queryClient: QueryClient): BriefingSnapshot {
  const { baseCurrency, eurUsd } = usePortfolioStore.getState();
  const macro = queryClient.getQueryData<MacroScoreData>(['macro-score']);
  const sectorPerfs = queryClient.getQueryData<SectorPerf[]>(['sector-perfs', '3M']);

  // Les métriques qui nourrissent le score (relPerf 1W/1M/3M, RSI) sont
  // indépendantes de la période sélectionnée dans l'onglet : n'importe quelle
  // entrée de cache convient — on prend la première disponible (zéro réseau).
  const narrativePerfs = (['3M', '1M', '1W'] as const)
    .map((p) => queryClient.getQueryData<NarrativeEtfPerf[]>(['narrative-etf-perfs', p]))
    .find((d) => d != null);

  return {
    meta: {
      date: new Date().toISOString().slice(0, 10),
      deviseBase: baseCurrency,
      eurUsd: r2(eurUsd)!,
    },
    macro: buildMacro(macro),
    portefeuille: buildPortfolio(buildSectorCtx(sectorPerfs, macro)),
    secteurs: buildSectors(sectorPerfs, macro),
    themes: buildThemes(narrativePerfs, sectorPerfs, macro),
  };
}
