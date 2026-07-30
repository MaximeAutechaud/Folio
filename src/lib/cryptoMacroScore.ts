import { norm, regimeFromScore } from './macroScore';
import type { Regime } from './macroScore';

export type { Regime };
export { regimeFromScore };

/**
 * Contexte macro du crypto, sur le modele de `macroScore.ts`.
 *
 * Principe de composition : un score de regime ne vaut que s'il lit autre chose
 * que le marche qu'il decrit — sinon c'est une paraphrase du prix. Pour les
 * actions ce role est tenu par le VIX (marche des options) et la courbe (marche
 * des taux). Cote crypto, la seule information libre qui ne soit pas une
 * transformation des prix est l'**offre de stablecoins** : c'est de la monnaie
 * emise, pas une cotation. Elle porte donc le poids le plus fort.
 *
 * Les trois entrees heritees du macro actions (DXY, VIX, HYG) valent 30 % : le
 * crypto est l'actif risque a plus haut beta, sa toile de fond est celle des
 * actifs risques. Les surponderer ferait du score crypto une copie du score
 * actions.
 */
export interface CryptoMacroInputs {
  /** Variation 30j de l'offre agregee USDT + USDC, en %. */
  stable1M: number | null;
  /** Variation 30j du ratio ETH/BTC, en %. */
  ethBtc1M: number | null;
  /** Fear & Greed index crypto, 0-100. */
  fearGreed: number | null;
  /** Variation 30j du dollar index, en %. */
  dxy1M: number | null;
  /** Niveau du VIX. */
  vix: number | null;
  /** Variation 30j de HYG, en %. */
  hyg1M: number | null;
}

export const CRYPTO_MACRO_WEIGHTS = {
  stable: 0.30, ethBtc: 0.20, fearGreed: 0.20, dxy: 0.15, vix: 0.10, hyg: 0.05,
} as const;

export type CryptoSubScores = Record<keyof typeof CRYPTO_MACRO_WEIGHTS, number>;

/**
 * Sous-scores 0-100, un par entree. **Seul endroit ou vivent les bornes.**
 *
 * Le macro actions duplique ses bornes entre `calcMacroScore` et les sous-scores
 * d'affichage de `useMacroScore` (cf. CLAUDE.md — tout changement doit etre fait
 * aux deux endroits sous peine de divergence). On ne reproduit pas ce defaut
 * ici : le composite est une somme ponderee de cette fonction, et l'affichage
 * lit la meme.
 *
 * Bornes calibrees sur les percentiles 5/95 d'un an d'historique quotidien
 * (releve 2026-07-30) plutot que choisies a la main :
 *   - offre stablecoins 30j : p5 = -2,17 % / p95 = +5,15 %
 *   - ETH/BTC 30j          : p5 = -13,2 % / p95 = +11,1 %
 * Les trois entrees heritees gardent les bornes du macro actions, pour que les
 * deux scores restent lisibles l'un a cote de l'autre.
 */
export function calcCryptoSubScores(inputs: CryptoMacroInputs): CryptoSubScores {
  const { stable1M, ethBtc1M, fearGreed, dxy1M, vix, hyg1M } = inputs;
  return {
    stable:    stable1M  != null ? norm(stable1M,  -2,  5) * 100 : 50,
    ethBtc:    ethBtc1M  != null ? norm(ethBtc1M, -13, 11) * 100 : 50,
    fearGreed: fearGreed != null ? norm(fearGreed,  0, 100) * 100 : 50,
    dxy:       dxy1M     != null ? norm(dxy1M,      3, -3) * 100 : 50,
    vix:       vix       != null ? norm(vix,       35, 15) * 100 : 50,
    hyg:       hyg1M     != null ? norm(hyg1M,     -3,  3) * 100 : 50,
  };
}

export function calcCryptoMacroScore(inputs: CryptoMacroInputs): number {
  const s = calcCryptoSubScores(inputs);
  const W = CRYPTO_MACRO_WEIGHTS;
  return Math.round(
    s.stable * W.stable + s.ethBtc * W.ethBtc + s.fearGreed * W.fearGreed +
    s.dxy * W.dxy + s.vix * W.vix + s.hyg * W.hyg
  );
}

/**
 * Ratio ETH/BTC aligne par horodatage. CoinGecko ne renvoie pas les deux series
 * sur exactement les memes points ; on n'interpole pas, on ne garde que les
 * dates communes.
 */
export function ethBtcRatio(
  eth: { time: number; value: number }[],
  btc: { time: number; value: number }[],
): { time: number; value: number }[] {
  const byTime = new Map(btc.map(p => [p.time, p.value]));
  const out: { time: number; value: number }[] = [];
  for (const p of eth) {
    const b = byTime.get(p.time);
    if (b) out.push({ time: p.time, value: p.value / b });
  }
  return out;
}

/**
 * Somme de deux series de capitalisation alignees par horodatage. Meme regle
 * que ci-dessus : uniquement les dates communes, sinon un trou sur une seule
 * des deux series ferait chuter l'offre agregee et simulerait une sortie de
 * liquidite qui n'a pas eu lieu.
 */
export function sumSupply(
  a: { time: number; value: number }[],
  b: { time: number; value: number }[],
): { time: number; value: number }[] {
  const byTime = new Map(b.map(p => [p.time, p.value]));
  const out: { time: number; value: number }[] = [];
  for (const p of a) {
    const v = byTime.get(p.time);
    if (v != null) out.push({ time: p.time, value: p.value + v });
  }
  return out;
}
