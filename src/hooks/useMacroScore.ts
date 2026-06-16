import { useQuery } from '@tanstack/react-query';
import { fetchYahooPrices, fetchYahooHistory } from '../lib/api/yahoo';
import { norm, calcMacroScore, regimeFromScore, MACRO_WEIGHTS } from '../lib/macroScore';

export type { Regime } from '../lib/macroScore';
export type Signal = 'bullish' | 'neutral' | 'bearish';

export interface MacroIndicator {
  id: string;
  label: string;
  chip: string;
  value: string;
  score: number;
  signal: Signal;
  weight: number;
  explanation: string;
  tip: string;
  contextOnly?: boolean;
}

export interface MacroScoreData {
  score: number;
  scorePrev: number | null;
  trend: 'up' | 'down' | 'flat';
  regime: ReturnType<typeof regimeFromScore>;
  indicators: MacroIndicator[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcPerf(h: { time: number; value: number }[]): number | null {
  if (h.length < 2) return null;
  const start = h[0].value;
  if (!start) return null;
  return ((h[h.length - 1].value - start) / start) * 100;
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function toSignal(s: number): Signal {
  return s > 65 ? 'bullish' : s < 35 ? 'bearish' : 'neutral';
}

function weekDeltaBp(h: { time: number; value: number }[]): number | null {
  if (h.length < 6) return null;
  return Math.round((h[h.length - 1].value - h[h.length - 6].value) * 100);
}

const DAY = 86400;

// Trailing-window perf: % change over `windowDays`, ending `endDaysAgo` days ago.
// Lets us measure a true trailing-1M momentum both now (endDaysAgo=0) and as of
// a week ago (endDaysAgo=7) from a single ~3M daily history.
function perfWindow(h: { time: number; value: number }[], windowDays: number, endDaysAgo = 0): number | null {
  if (h.length < 2) return null;
  const end = Date.now() / 1000 - endDaysAgo * DAY;
  const start = end - windowDays * DAY;
  return calcPerf(h.filter(p => p.time >= start && p.time <= end));
}

// Daily close as of `daysAgo` days ago (last bar at or before that point).
function valueAt(h: { time: number; value: number }[], daysAgo: number): number | null {
  if (h.length === 0) return null;
  const target = Date.now() / 1000 - daysAgo * DAY;
  let v: number | null = null;
  for (const p of h) {
    if (p.time <= target) v = p.value;
    else break;
  }
  return v ?? h[0].value;
}

// ── Tickers fetchés ───────────────────────────────────────────────────────────

const TICKERS = ['^VIX', 'DX-Y.NYB', '^TNX', '^TYX', '^IRX', 'HYG', 'GLD', 'HG=F', 'SPY', 'IWM'];

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMacroScore() {
  return useQuery<MacroScoreData>({
    queryKey: ['macro-score'],
    queryFn: async () => {
      const [prices, histories] = await Promise.all([
        fetchYahooPrices(TICKERS),
        // 3M daily so we can take a true trailing-1M window both now and as of a
        // week ago (the trend computation needs the latter — see scorePrev below)
        Promise.all(TICKERS.map(t => fetchYahooHistory(t, '3M'))),
      ]);

      const hist: Record<string, { time: number; value: number }[]> = {};
      TICKERS.forEach((t, i) => { hist[t] = histories[i]; });

      const vix  = prices['^VIX']     ?? null;
      const tnx  = prices['^TNX']     ?? null;
      const tyx  = prices['^TYX']     ?? null;
      const irx  = prices['^IRX']     ?? null;
      const dxy  = prices['DX-Y.NYB'] ?? null;

      const hyg1M    = perfWindow(hist['HYG'],      30);
      const gld1M    = perfWindow(hist['GLD'],      30);
      const copper1M = perfWindow(hist['HG=F'],     30);
      const dxy1M    = perfWindow(hist['DX-Y.NYB'], 30);
      const spy1M    = perfWindow(hist['SPY'],      30);
      const iwm1M    = perfWindow(hist['IWM'],      30);

      const yieldCurve = tnx != null && irx != null ? tnx - irx : null;
      const iwmVsSpy   = iwm1M != null && spy1M != null ? iwm1M - spy1M : null;

      const tnxWeekBp   = weekDeltaBp(hist['^TNX']);
      const tyxWeekBp   = weekDeltaBp(hist['^TYX']);
      const spread30_10 = tnx != null && tyx != null ? tyx - tnx : null;

      // ── Score global ────────────────────────────────────────────────────────

      const score = calcMacroScore({ vix, yieldCurve, hyg1M, gld1M, copper1M, iwmVsSpy, dxy1M });

      // Trend: compare the live score against the same score computed as of one
      // week ago, using true trailing-1M windows for the momentum components.
      // (Previously only 1M of data was fetched, so the "t-1W" momentum was
      // measured over a ~3-week fixed-start window — a systematic bias.)
      const tnxPrev = valueAt(hist['^TNX'], 7);
      const irxPrev = valueAt(hist['^IRX'], 7);
      const spyPrev = perfWindow(hist['SPY'], 30, 7);
      const iwmPrev = perfWindow(hist['IWM'], 30, 7);
      const earliest = hist['SPY']?.[0]?.time ?? Infinity;
      const spanDays = (Date.now() / 1000 - earliest) / DAY;
      // Need ~37 days of data so a 1M window ending a week ago actually exists
      const scorePrev = spanDays >= 37
        ? calcMacroScore({
            vix:        valueAt(hist['^VIX'], 7),
            yieldCurve: tnxPrev != null && irxPrev != null ? tnxPrev - irxPrev : null,
            hyg1M:      perfWindow(hist['HYG'],      30, 7),
            gld1M:      perfWindow(hist['GLD'],      30, 7),
            copper1M:   perfWindow(hist['HG=F'],     30, 7),
            dxy1M:      perfWindow(hist['DX-Y.NYB'], 30, 7),
            iwmVsSpy:   iwmPrev != null && spyPrev != null ? iwmPrev - spyPrev : null,
          })
        : null;
      const trend: MacroScoreData['trend'] =
        scorePrev == null        ? 'flat' :
        score - scorePrev >= 3  ? 'up'   :
        score - scorePrev <= -3 ? 'down' :
        'flat';

      const regime = regimeFromScore(score);

      // ── Scores individuels pour l'affichage ─────────────────────────────────

      const W = MACRO_WEIGHTS;
      const vixScore    = vix        != null ? norm(vix,        35, 15) * 100 : 50;
      const curveScore  = yieldCurve != null ? norm(yieldCurve, -1,  1) * 100 : 50;
      const hygScore    = hyg1M      != null ? norm(hyg1M,      -3,  3) * 100 : 50;
      const gldScore    = gld1M      != null ? norm(gld1M,       5, -3) * 100 : 50;
      const copperScore = copper1M   != null ? norm(copper1M,   -5,  5) * 100 : 50;
      const iwmScore    = iwmVsSpy   != null ? norm(iwmVsSpy,   -3,  3) * 100 : 50;
      const dxyScore    = dxy1M      != null ? norm(dxy1M,       3, -3) * 100 : 50;

      // ── Indicateurs détaillés ───────────────────────────────────────────────

      const indicators: MacroIndicator[] = [
        {
          id: 'vix', chip: 'VIX', label: 'VIX',
          value: vix != null ? vix.toFixed(1) : '—',
          score: Math.round(vixScore), signal: toSignal(vixScore), weight: W.vix,
          explanation:
            vix == null ? '—' :
            vix < 15    ? 'Volatilité très faible — marché serein, environnement très favorable au rally.' :
            vix < 20    ? 'Volatilité faible — calme habituel, pas de signal d\'inquiétude.' :
            vix < 25    ? 'Volatilité modérée — légère nervosité, surveiller sans paniquer.' :
            vix < 30    ? 'Volatilité élevée — stress notable, investisseurs en mode défensif.' :
                          'Volatilité extrême — panique de marché, retournements brusques probables.',
          tip:
            'CBOE Volatility Index\nMesure la volatilité implicite attendue\nsur les 30 prochains jours.\n\n' +
            '< 15   → très calme, favorable\n15–20 → normal\n20–30 → stress croissant\n> 30   → panique',
        },
        {
          id: 'curve', chip: '10Y−3M', label: 'Yield Curve (10Y − 3M)',
          value: yieldCurve != null ? fmtPct(yieldCurve) : '—',
          score: Math.round(curveScore), signal: toSignal(curveScore), weight: W.curve,
          explanation:
            yieldCurve == null  ? '—' :
            yieldCurve > 0.5    ? 'Courbe normale et pentue — banques incitées à prêter, pas de signal récessionniste.' :
            yieldCurve > 0      ? 'Courbe légèrement positive — proche de la neutralité, à surveiller.' :
            yieldCurve > -0.5   ? 'Courbe légèrement inversée — signal d\'alerte, récession possible dans 12–18 mois.' :
                                  'Courbe fortement inversée — signal historique de récession à venir.',
          tip:
            'Spread taux 10 ans − 3 mois.\nUne courbe inversée (valeur négative) a\nprécédé chaque récession US depuis 1970.\n\n' +
            '> +0.5% → courbe saine\n0 à +0.5% → prudence\n< 0     → signal d\'alerte\n< -0.5% → alerte forte',
        },
        {
          id: 'hyg', chip: 'HYG', label: 'High Yield Bonds (HYG 1M)',
          value: hyg1M != null ? fmtPct(hyg1M) : '—',
          score: Math.round(hygScore), signal: toSignal(hygScore), weight: W.hyg,
          explanation:
            hyg1M == null ? '—' :
            hyg1M > 1     ? 'Obligations HY en hausse — les investisseurs acceptent le risque de crédit : fort appétit pour le risque.' :
            hyg1M > -1    ? 'HY stable — pas de signal clair dans les marchés de crédit.' :
                            'HY en baisse — fuite vers la qualité obligataire, aversion au risque croissante.',
          tip:
            'iShares High Yield Bond ETF (HYG)\nLes obligations à haut rendement sont émises\npar des entreprises fragiles. Quand elles\nmontent, les investisseurs acceptent le risque.\n\n' +
            'HYG ↑ → appétit risque\nHYG ↓ → fuite vers la qualité',
        },
        {
          id: 'iwm', chip: 'IWM/SPY', label: 'Small Caps vs Large Caps (IWM − SPY 1M)',
          value: iwmVsSpy != null ? fmtPct(iwmVsSpy) + ' vs SPY' : '—',
          score: Math.round(iwmScore), signal: toSignal(iwmScore), weight: W.iwm,
          explanation:
            iwmVsSpy == null ? '—' :
            iwmVsSpy > 1     ? 'Small caps leaders — le rally est large et sain, pas uniquement porté par quelques méga-caps.' :
            iwmVsSpy > -1    ? 'Small et large caps en ligne — pas de divergence notable de breadth.' :
                               'Small caps à la traîne — rally concentré sur les grandes valeurs, signe de fragilité.',
          tip:
            'Performance relative Russell 2000 (IWM)\nvs S&P 500 (SPY) sur 1 mois.\n\n' +
            'Les small caps sont plus sensibles\nà l\'économie domestique et au crédit.\n\n' +
            'IWM > SPY → rally large et solide\nIWM < SPY → rally étroit, méga-caps seulement',
        },
        {
          id: 'dxy', chip: 'DXY', label: 'Dollar Index (DXY 1M)',
          value: dxy1M != null
            ? fmtPct(dxy1M) + (dxy != null ? ` (${dxy.toFixed(1)})` : '')
            : dxy != null ? dxy.toFixed(1) : '—',
          score: Math.round(dxyScore), signal: toSignal(dxyScore), weight: W.dxy,
          explanation:
            dxy1M == null ? '—' :
            dxy1M < -1    ? 'Dollar en recul — vent arrière pour les actifs risqués, les émergents et les matières premières.' :
            dxy1M < 1     ? 'Dollar stable — pas d\'impact directionnel significatif sur les marchés.' :
                            'Dollar en hausse — pression sur les multinationales US (revenus en devises) et les émergents.',
          tip:
            'Dollar Index — force du USD face à\nun panier de 6 devises (EUR 57%, JPY 14%…)\n\n' +
            'DXY ↓ → favorable aux actifs risqués,\nmatières premières et marchés émergents\n\n' +
            'DXY ↑ → pression sur les exportateurs\nUS et les dettes en USD des émergents',
        },
        {
          id: 'copper', chip: 'Cuivre', label: 'Cuivre — "Dr. Copper" (HG=F 1M)',
          value: copper1M != null ? fmtPct(copper1M) : '—',
          score: Math.round(copperScore), signal: toSignal(copperScore), weight: W.copper,
          explanation:
            copper1M == null ? '—' :
            copper1M > 2     ? '"Dr. Copper" en hausse — les marchés anticipent une accélération de l\'activité industrielle mondiale.' :
            copper1M > -2    ? 'Cuivre stable — croissance mondiale au neutre, pas de signal fort.' :
                               '"Dr. Copper" en baisse — signal de ralentissement ou de récession industrielle mondiale.',
          tip:
            'Futures cuivre CME (HG=F)\nLe cuivre entre dans la fabrication de\nquasi tous les produits industriels et\nde construction. Son prix anticipe la\ncroissance mondiale 3–6 mois à l\'avance.\n\n' +
            'Cuivre ↑ → croissance attendue\nCuivre ↓ → ralentissement attendu',
        },
        {
          id: 'gold', chip: 'Or', label: 'Or — actif refuge (GLD 1M)',
          value: gld1M != null ? fmtPct(gld1M) : '—',
          score: Math.round(gldScore), signal: toSignal(gldScore), weight: W.gold,
          explanation:
            gld1M == null ? '—' :
            gld1M > 3     ? 'Or en forte hausse — fuite vers les actifs refuges, signal d\'incertitude géopolitique ou d\'inflation.' :
            gld1M > -1    ? 'Or stable — pas de demande refuge anormale, contexte serein.' :
                            'Or en baisse — les investisseurs délaissent la sécurité pour des actifs risqués.',
          tip:
            'SPDR Gold ETF (GLD) variation 1 mois.\nL\'or monte dans deux cas : peur\n(récession, crise) et inflation.\n\n' +
            'Or ↑ fort → fuite vers la sécurité\nOr stable → pas d\'anxiété notable\nOr ↓ → appétit pour le risque\n\n' +
            'Note : l\'or peut monter sur inflation\nmême en marché actions haussier.',
        },
        {
          id: 'tnx-level', chip: '10Y', label: 'Taux 10Y US',
          value: tnx != null
            ? `${tnx.toFixed(2)}%${tnxWeekBp != null ? `  ${tnxWeekBp >= 0 ? '+' : ''}${tnxWeekBp}bp/sem` : ''}`
            : '—',
          score: 50,
          signal: (
            tnx == null ? 'neutral' :
            (tnx > 4.5 || (tnxWeekBp != null && tnxWeekBp > 25)) ? 'bearish' :
            tnx < 3.5 ? 'bullish' : 'neutral'
          ) as Signal,
          weight: 0,
          contextOnly: true,
          explanation: (() => {
            if (tnx == null) return '—';
            const lvl =
              tnx > 5   ? `Niveau très élevé (${tnx.toFixed(2)}%) — pression structurelle sur VNQ (immobilier) et XLU (utilities). XLF (financières) avantagé par les spreads élargis.` :
              tnx > 4.5 ? `Niveau élevé (${tnx.toFixed(2)}%) — headwinds pour VNQ et VGT (growth tech), tailwind pour XLF.` :
              tnx > 3.5 ? `Niveau modéré (${tnx.toFixed(2)}%) — impact différencié selon la duration des actifs.` :
                          `Niveau bas (${tnx.toFixed(2)}%) — environnement favorable pour l'immobilier (VNQ), les utilities et le growth tech.`;
            const spk =
              tnxWeekBp != null && tnxWeekBp >= 15  ? ` Spike de +${tnxWeekBp}bp cette semaine — rotation accélérée probable vers les secteurs value/cycliques au détriment du growth et de l'immobilier.` :
              tnxWeekBp != null && tnxWeekBp <= -15 ? ` Détente de ${Math.abs(tnxWeekBp)}bp cette semaine — soulagement pour les secteurs sensibles aux taux (VNQ, XLU, VGT).` :
              '';
            return lvl + spk;
          })(),
          tip:
            'Taux des obligations du Trésor US à 10 ans.\nBenchmark mondial du coût du capital.\n\n' +
            'Impact sur la rotation sectorielle :\n↑ Taux → headwinds VNQ, XLU, VGT\n↑ Taux → tailwind XLF (financières)\n\n' +
            '< 3.5% → favorable au growth\n4.5–5% → pression secteurs sensibles\n> 5%   → stress généralisé\n\n' +
            'Distinct du "10Y−3M" (forme de courbe) :\nce chiffre mesure le niveau absolu.',
        },
        {
          id: 'tyx-level', chip: '30Y', label: 'Taux 30Y US',
          value: (() => {
            if (tyx == null) return '—';
            const delta = tyxWeekBp != null ? `  ${tyxWeekBp >= 0 ? '+' : ''}${tyxWeekBp}bp/sem` : '';
            const sprd  = spread30_10 != null ? `  ·  spread 30/10 +${Math.round(spread30_10 * 100)}bp` : '';
            return `${tyx.toFixed(2)}%${delta}${sprd}`;
          })(),
          score: 50,
          signal: (
            tyx == null ? 'neutral' :
            (tyx > 5.0 || (tyxWeekBp != null && tyxWeekBp > 25)) ? 'bearish' :
            tyx < 4.0 ? 'bullish' : 'neutral'
          ) as Signal,
          weight: 0,
          contextOnly: true,
          explanation: (() => {
            if (tyx == null) return '—';
            const sprd =
              spread30_10 == null ? '' :
              spread30_10 < 0     ? ' Inversion 30Y/10Y — très inhabituel, signal de distorsion majeure sur la dette longue.' :
              spread30_10 > 0.5   ? ` Prime de terme élevée (+${Math.round(spread30_10 * 100)}bp) — pentification anormale de la longue courbe. Les marchés anticipent inflation persistante ou dégradent leur confiance dans la trajectoire de la dette US.` :
                                    ` Prime de terme normale (+${Math.round(spread30_10 * 100)}bp vs 10Y).`;
            const spk =
              tyxWeekBp != null && tyxWeekBp >= 15  ? ` Spike de +${tyxWeekBp}bp sur la semaine — les investisseurs exigent une prime plus élevée sur la dette longue, signal négatif pour les actifs à longue duration.` :
              tyxWeekBp != null && tyxWeekBp <= -15 ? ` Détente de ${Math.abs(tyxWeekBp)}bp sur la semaine.` :
              '';
            return `30Y à ${tyx.toFixed(2)}%.${sprd}${spk}`;
          })(),
          tip:
            'Taux des obligations du Trésor US à 30 ans.\nMesure la prime de terme et les anticipations\nd\'inflation à long terme.\n\n' +
            'Spread 30Y−10Y > +50bp → pentification\nanormale : défiance sur la dette longue US\nou anticipations inflationnistes persistantes.\n\n' +
            'Spread < 0 → inversion rare, distorsion\nde marché sur les primes de terme.\n\n' +
            'Un spike 30Y sans spike 10Y signale une\ndéfiance spécifique sur la dette ultra-longue.',
        },
      ];

      return { score, scorePrev, trend, regime, indicators };
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
