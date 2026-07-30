import { useQuery } from '@tanstack/react-query';
import { fetchGlobalCrypto, fetchCoinMarketCaps, coingeckoDelay } from '../lib/api/coingecko';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { fetchFearGreed } from '../lib/api/fearGreed';
import { perfWindow, valueAt, type Point } from '../lib/macroScore';
import {
  calcCryptoMacroScore, calcCryptoSubScores, CRYPTO_MACRO_WEIGHTS,
  regimeFromScore, ethBtcRatio, sumSupply,
} from '../lib/cryptoMacroScore';
import type { CryptoMacroInputs } from '../lib/cryptoMacroScore';
import { useMacroScore } from './useMacroScore';
import type { MacroIndicator, MacroScoreData, Signal } from './useMacroScore';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtUsd(n: number): string {
  return n >= 1e12 ? `$${(n / 1e12).toFixed(2)} T`
       : n >= 1e9  ? `$${(n / 1e9).toFixed(1)} Md`
       :             `$${(n / 1e6).toFixed(0)} M`;
}

function toSignal(s: number): Signal {
  return s > 65 ? 'bullish' : s < 35 ? 'bearish' : 'neutral';
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Contexte macro du crypto. Reutilise la structure d'affichage du macro actions
 * (`MacroIndicator` / `MacroScoreData`) pour que les deux panneaux se lisent de
 * la meme facon.
 *
 * Les entrees DXY / VIX / HYG sont **reprises du macro actions deja en cache**
 * (`useMacroScore().histories`) et non refetchees : meme queryKey, donc aucun
 * appel Yahoo supplementaire.
 *
 * CoinGecko n'est sollicite que pour ce que lui seul fournit — l'offre en
 * circulation des stablecoins. Les **prix** BTC et ETH viennent de Yahoo
 * (`BTC-USD`, `ETH-USD`) : pas de quota, et les horodatages journaliers
 * s'alignent exactement (92/92 points, mesure). Faire passer ETH/BTC par
 * CoinGecko coutait deux appels supplementaires et les faisait tomber en 429,
 * ce qui vidait silencieusement une entree pesant 20 % du score.
 *
 * Les appels CoinGecko restants sont **sequentiels et espaces** : l'offre
 * gratuite plafonne a 10-30 req/min, avec une fenetre de refroidissement par IP.
 */
export function useCryptoMacroScore() {
  const { data: equityMacro } = useMacroScore();

  return useQuery<MacroScoreData>({
    queryKey: ['crypto-macro-score'],
    // Le macro actions fournit DXY / VIX / HYG : on attend qu'il soit la.
    enabled: !!equityMacro,
    queryFn: async () => {
      const hist = equityMacro!.histories;

      // ── Prix BTC / ETH : Yahoo, en parallele, sans quota ──────────────────
      const [btcPrices, ethPrices] = await Promise.all([
        fetchYahooHistory('BTC-USD', '3M'),
        fetchYahooHistory('ETH-USD', '3M'),
      ]);

      // ── Offre de stablecoins : CoinGecko seul la publie ───────────────────
      const usdtCaps = await fetchCoinMarketCaps('tether');
      await coingeckoDelay();
      const usdcCaps = await fetchCoinMarketCaps('usd-coin');
      await coingeckoDelay();
      // En dernier : purement contextuel, son echec ne coute aucun poids.
      const global = await fetchGlobalCrypto();

      const fng = await fetchFearGreed();

      const stableSupply: Point[] = sumSupply(usdtCaps ?? [], usdcCaps ?? []);
      const ratio: Point[] = ethBtcRatio(ethPrices, btcPrices);

      // ── Entrees du score ──────────────────────────────────────────────────
      const inputs: CryptoMacroInputs = {
        stable1M:  perfWindow(stableSupply, 30),
        ethBtc1M:  perfWindow(ratio, 30),
        fearGreed: fng.value,
        dxy1M:     perfWindow(hist['DX-Y.NYB'] ?? [], 30),
        vix:       valueAt(hist['^VIX'] ?? [], 0),
        hyg1M:     perfWindow(hist['HYG'] ?? [], 30),
      };

      const score = calcCryptoMacroScore(inputs);
      const sub = calcCryptoSubScores(inputs);
      const W = CRYPTO_MACRO_WEIGHTS;

      // ── Degradation visible ───────────────────────────────────────────────
      // Une entree absente est neutralisee a 50 par `calcCryptoSubScores`, ce
      // qui produit un score d'allure normale construit sur du vide. Tant que
      // ca ne se voit pas, c'est un mensonge par omission — on remonte donc le
      // poids reellement manquant jusqu'au panneau.
      const missing: { label: string; weight: number }[] = [
        { label: 'offre de stablecoins', weight: W.stable,    ok: inputs.stable1M  != null },
        { label: 'ETH/BTC',              weight: W.ethBtc,    ok: inputs.ethBtc1M  != null },
        { label: 'Fear & Greed',         weight: W.fearGreed, ok: inputs.fearGreed != null },
        { label: 'DXY',                  weight: W.dxy,       ok: inputs.dxy1M     != null },
        { label: 'VIX',                  weight: W.vix,       ok: inputs.vix       != null },
        { label: 'HYG',                  weight: W.hyg,       ok: inputs.hyg1M     != null },
      ].filter(e => !e.ok).map(({ label, weight }) => ({ label, weight }));

      const missingWeight = missing.reduce((s, m) => s + m.weight, 0);
      const warning = missing.length === 0 ? undefined :
        `Score dégradé — ${Math.round(missingWeight * 100)} % du poids indisponible ` +
        `(${missing.map(m => m.label).join(', ')}), neutralisé à 50. ` +
        `Cause la plus fréquente : quota CoinGecko (429), qui se relâche après quelques minutes.`;

      // ── Tendance : meme score une semaine plus tot ────────────────────────
      // Il faut ~37 jours d'historique pour qu'une fenetre 1M finissant il y a
      // une semaine existe vraiment (meme garde que le macro actions).
      const earliest = stableSupply[0]?.time ?? Infinity;
      const spanDays = (Date.now() / 1000 - earliest) / 86400;
      const scorePrev = spanDays >= 37
        ? calcCryptoMacroScore({
            stable1M:  perfWindow(stableSupply, 30, 7),
            ethBtc1M:  perfWindow(ratio, 30, 7),
            fearGreed: fng.value7dAgo,
            dxy1M:     perfWindow(hist['DX-Y.NYB'] ?? [], 30, 7),
            vix:       valueAt(hist['^VIX'] ?? [], 7),
            hyg1M:     perfWindow(hist['HYG'] ?? [], 30, 7),
          })
        : null;

      const trend: MacroScoreData['trend'] =
        scorePrev == null       ? 'flat' :
        score - scorePrev >= 3  ? 'up'   :
        score - scorePrev <= -3 ? 'down' :
        'flat';

      const last = <T,>(a: T[]): T | null => (a.length ? a[a.length - 1] : null);
      const supplyNow = last(stableSupply)?.value ?? null;
      const ratioNow = last(ratio)?.value ?? null;

      // ── Indicateurs ───────────────────────────────────────────────────────
      const indicators: MacroIndicator[] = [
        {
          id: 'stablecoins', chip: 'Stables', label: 'Offre de stablecoins (USDT+USDC 1M)',
          value: inputs.stable1M != null
            ? fmtPct(inputs.stable1M) + (supplyNow != null ? `  (${fmtUsd(supplyNow)})` : '')
            : '—',
          score: Math.round(sub.stable), signal: toSignal(sub.stable), weight: W.stable,
          explanation:
            inputs.stable1M == null ? '—' :
            inputs.stable1M > 3     ? 'Offre en forte expansion — de la monnaie entre dans le crypto et n\'est pas encore investie : poudre sèche en hausse.' :
            inputs.stable1M > 0.5   ? 'Offre en croissance modérée — les capitaux continuent d\'affluer, sans emballement.' :
            inputs.stable1M > -1    ? 'Offre stable — ni entrée ni sortie nette de capitaux sur la période.' :
                                      'Offre en contraction — des capitaux quittent l\'écosystème, la liquidité disponible se réduit.',
          tip:
            'Capitalisation agrégée de Tether (USDT)\net USD Coin (USDC), variation sur 1 mois.\n\n' +
            'C\'est la seule entrée du score qui ne soit\npas une transformation des prix : ce sont\ndes dollars réellement émis sur la chaîne.\n\n' +
            'Offre ↑ → poudre sèche, capitaux entrants\nOffre ↓ → capitaux sortants\n\n' +
            'Bornes calibrées sur les percentiles 5/95\nd\'un an d\'historique (−2 % / +5 %).',
        },
        {
          id: 'ethbtc', chip: 'ETH/BTC', label: 'Ratio ETH/BTC (1M)',
          value: inputs.ethBtc1M != null
            ? fmtPct(inputs.ethBtc1M) + (ratioNow != null ? `  (${ratioNow.toFixed(5)})` : '')
            : '—',
          score: Math.round(sub.ethBtc), signal: toSignal(sub.ethBtc), weight: W.ethBtc,
          explanation:
            inputs.ethBtc1M == null ? '—' :
            inputs.ethBtc1M > 5     ? 'ETH surperforme nettement BTC — appétit pour le risque à l\'intérieur du crypto, configuration classique d\'alt-season.' :
            inputs.ethBtc1M > -3    ? 'ETH et BTC évoluent de concert — pas de rotation marquée vers les altcoins.' :
                                      'ETH sous-performe BTC — repli vers l\'actif le plus établi, aversion au risque interne au crypto.',
          tip:
            'Prix ETH divisé par prix BTC, variation 1 mois.\n\n' +
            'Équivalent crypto du ratio small caps /\nlarge caps : mesure l\'appétit pour le risque\nà l\'intérieur de la classe d\'actifs.\n\n' +
            'ETH/BTC ↑ → rotation vers les altcoins\nETH/BTC ↓ → fuite vers BTC\n\n' +
            'Bornes : percentiles 5/95 sur un an\n(−13 % / +11 %). Médiane à −1,9 % : le ratio\na dérivé à la baisse, d\'où des bornes\nasymétriques plutôt que centrées sur zéro.',
        },
        {
          id: 'fng', chip: 'F&G', label: 'Fear & Greed crypto',
          value: fng.value != null
            ? `${fng.value}${fng.classification ? ` — ${fng.classification}` : ''}`
            : '—',
          score: Math.round(sub.fearGreed), signal: toSignal(sub.fearGreed), weight: W.fearGreed,
          explanation:
            fng.value == null ? '—' :
            fng.value < 25    ? 'Peur extrême — sentiment très dégradé. Historiquement associé aux creux, mais un creux ne se date pas à l\'avance.' :
            fng.value < 45    ? 'Peur — les intervenants sont sur la défensive.' :
            fng.value < 55    ? 'Neutre — pas de biais émotionnel marqué.' :
            fng.value < 75    ? 'Avidité — appétit pour le risque élevé, positionnement de plus en plus tendu.' :
                                'Avidité extrême — euphorie, configuration historiquement fragile.',
          tip:
            'Indice Fear & Greed crypto (alternative.me),\nde 0 (peur extrême) à 100 (avidité extrême).\n\n' +
            'Composite : volatilité, momentum/volume,\nréseaux sociaux, dominance, tendances de\nrecherche. Une partie de son contenu est donc\nhors prix (social, Google Trends).\n\n' +
            'Lu ici comme un descripteur de régime\n(avidité = risk-on), et non à contre-courant :\nle sens contrarien n\'a pas été mesuré ici.',
        },
        {
          id: 'dxy-crypto', chip: 'DXY', label: 'Dollar Index (DXY 1M)',
          value: inputs.dxy1M != null ? fmtPct(inputs.dxy1M) : '—',
          score: Math.round(sub.dxy), signal: toSignal(sub.dxy), weight: W.dxy,
          explanation:
            inputs.dxy1M == null ? '—' :
            inputs.dxy1M < -1    ? 'Dollar en recul — desserrement des conditions de liquidité mondiale, vent arrière pour le crypto.' :
            inputs.dxy1M < 1     ? 'Dollar stable — pas d\'impact directionnel notable.' :
                                   'Dollar en hausse — resserrement de la liquidité, vent de face pour les actifs à haut bêta.',
          tip:
            'Dollar Index — force du USD face à un\npanier de 6 devises.\n\n' +
            'Le crypto se cote en dollars et n\'a pas de\nflux de trésorerie : il est particulièrement\nsensible aux conditions de liquidité en USD.\n\n' +
            'DXY ↓ → favorable\nDXY ↑ → défavorable',
        },
        {
          id: 'vix-crypto', chip: 'VIX', label: 'VIX — appétit risque global',
          value: inputs.vix != null ? inputs.vix.toFixed(1) : '—',
          score: Math.round(sub.vix), signal: toSignal(sub.vix), weight: W.vix,
          explanation:
            inputs.vix == null ? '—' :
            inputs.vix < 20    ? 'Volatilité actions faible — environnement porteur pour les actifs risqués dans leur ensemble.' :
            inputs.vix < 30    ? 'Volatilité actions élevée — stress qui se transmet généralement au crypto.' :
                                 'Volatilité actions extrême — les phases de panique frappent le crypto plus fort que les actions.',
          tip:
            'CBOE Volatility Index.\n\n' +
            'Le crypto est l\'actif risqué à plus haut\nbêta : en régime de stress il ne se\ndésolidarise pas des actions, il amplifie.\n\n' +
            'Poids volontairement modeste (10 %) pour que\nle score crypto ne soit pas une copie du\nscore actions.',
        },
        {
          id: 'hyg-crypto', chip: 'HYG', label: 'High Yield Bonds (HYG 1M)',
          value: inputs.hyg1M != null ? fmtPct(inputs.hyg1M) : '—',
          score: Math.round(sub.hyg), signal: toSignal(sub.hyg), weight: W.hyg,
          explanation:
            inputs.hyg1M == null ? '—' :
            inputs.hyg1M > 1     ? 'Crédit à haut rendement en hausse — appétit pour le risque de crédit intact.' :
            inputs.hyg1M > -1    ? 'Crédit stable — pas de signal clair.' :
                                   'Crédit en baisse — fuite vers la qualité, contexte hostile aux actifs spéculatifs.',
          tip:
            'iShares High Yield Bond ETF (HYG).\n\n' +
            'Baromètre de l\'appétit pour le risque de\ncrédit. Quand le crédit se tend, les actifs\nspéculatifs corrigent en général avant.\n\n' +
            'Poids faible (5 %) — signal lent, et déjà\nlargement capté par le DXY et le VIX.',
        },

        // ── Contexte, hors score ────────────────────────────────────────────
        {
          id: 'btc-dominance', chip: 'Dom.BTC', label: 'Dominance BTC',
          value: global?.btcDominance != null
            ? `${global?.btcDominance.toFixed(1)}%${global?.ethDominance != null ? `  ·  ETH ${global?.ethDominance.toFixed(1)}%` : ''}`
            : '—',
          score: 50,
          signal: (
            global?.btcDominance == null ? 'neutral' :
            global?.btcDominance > 60 ? 'bearish' :
            global?.btcDominance < 45 ? 'bullish' : 'neutral'
          ) as Signal,
          weight: 0,
          contextOnly: true,
          explanation:
            global?.btcDominance == null ? '—' :
            global?.btcDominance > 60 ? `BTC capte ${global?.btcDominance.toFixed(1)} % de la capitalisation — marché concentré sur l'actif refuge du secteur, les altcoins souffrent.` :
            global?.btcDominance > 50 ? `Dominance à ${global?.btcDominance.toFixed(1)} % — équilibre habituel entre BTC et le reste du marché.` :
                                       `Dominance à ${global?.btcDominance.toFixed(1)} % — les capitaux se sont largement déplacés vers les altcoins.`,
          tip:
            'Part de Bitcoin dans la capitalisation totale.\n\n' +
            'Hors score, faute d\'historique : l\'endpoint\nCoinGecko de dominance historique est réservé\naux abonnés Pro (error_code 10005), donc\naucune variation n\'est calculable.\n\n' +
            'Le niveau seul n\'est pas comparable d\'une\népoque à l\'autre — le nombre d\'actifs cotés\na été multiplié par plusieurs depuis 2017.\n\n' +
            'L\'appétit intra-crypto est porté dans le\nscore par le ratio ETH/BTC, qui lui a un\nhistorique gratuit.',
        },
        {
          id: 'total-mcap', chip: 'MCap', label: 'Capitalisation totale crypto',
          value: global?.totalMcapUsd != null
            ? fmtUsd(global?.totalMcapUsd) + (global?.mcapChange24h != null ? `  ${fmtPct(global?.mcapChange24h)}/24h` : '')
            : '—',
          score: 50,
          signal: (
            global?.mcapChange24h == null ? 'neutral' :
            global?.mcapChange24h > 2  ? 'bullish' :
            global?.mcapChange24h < -2 ? 'bearish' : 'neutral'
          ) as Signal,
          weight: 0,
          contextOnly: true,
          explanation:
            global?.totalMcapUsd == null ? '—' :
            `Capitalisation de l'ensemble du marché crypto${global?.mcapChange24h != null ? `, ${fmtPct(global?.mcapChange24h)} sur 24 h` : ''}. Repère de taille, pas un signal.`,
          tip:
            'Capitalisation cumulée de tous les actifs\nsuivis par CoinGecko.\n\n' +
            'Hors score volontairement : la variation de\nla capitalisation totale est une\ntransformation directe des prix — la faire\nentrer dans le score reviendrait à noter le\nmarché sur sa propre performance récente.',
        },
      ];

      return { score, scorePrev, trend, regime: regimeFromScore(score), indicators, histories: {}, warning };
    },
    // Genereux : 5 appels CoinGecko en serie, et aucune de ces entrees ne bouge
    // a la minute (offre de stablecoins et F&G sont quotidiens).
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
}
