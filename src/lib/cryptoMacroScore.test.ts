import { describe, it, expect } from 'vitest';
import {
  calcCryptoMacroScore, calcCryptoSubScores, CRYPTO_MACRO_WEIGHTS,
  ethBtcRatio, sumSupply, regimeFromScore,
} from './cryptoMacroScore';
import type { CryptoMacroInputs } from './cryptoMacroScore';

const EMPTY: CryptoMacroInputs = {
  stable1M: null, ethBtc1M: null, fearGreed: null, dxy1M: null, vix: null, hyg1M: null,
};

describe('CRYPTO_MACRO_WEIGHTS', () => {
  it('somme a 1', () => {
    const total = Object.values(CRYPTO_MACRO_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('calcCryptoSubScores', () => {
  it('neutralise a 50 chaque entree manquante', () => {
    expect(calcCryptoSubScores(EMPTY)).toEqual({
      stable: 50, ethBtc: 50, fearGreed: 50, dxy: 50, vix: 50, hyg: 50,
    });
  });

  it('mappe le Fear & Greed a l identite', () => {
    expect(calcCryptoSubScores({ ...EMPTY, fearGreed: 28 }).fearGreed).toBeCloseTo(28, 10);
    expect(calcCryptoSubScores({ ...EMPTY, fearGreed: 0 }).fearGreed).toBeCloseTo(0, 10);
    expect(calcCryptoSubScores({ ...EMPTY, fearGreed: 100 }).fearGreed).toBeCloseTo(100, 10);
  });

  it('borne les extremes sans deborder de 0-100', () => {
    const hot = calcCryptoSubScores({
      stable1M: 999, ethBtc1M: 999, fearGreed: 999, dxy1M: -999, vix: 1, hyg1M: 999,
    });
    Object.values(hot).forEach(v => expect(v).toBe(100));

    const cold = calcCryptoSubScores({
      stable1M: -999, ethBtc1M: -999, fearGreed: -999, dxy1M: 999, vix: 99, hyg1M: -999,
    });
    Object.values(cold).forEach(v => expect(v).toBe(0));
  });

  it('inverse DXY et VIX — un dollar faible et un VIX bas sont favorables', () => {
    const weakDollar = calcCryptoSubScores({ ...EMPTY, dxy1M: -3 }).dxy;
    const strongDollar = calcCryptoSubScores({ ...EMPTY, dxy1M: 3 }).dxy;
    expect(weakDollar).toBeGreaterThan(strongDollar);

    const calmVix = calcCryptoSubScores({ ...EMPTY, vix: 15 }).vix;
    const panicVix = calcCryptoSubScores({ ...EMPTY, vix: 35 }).vix;
    expect(calmVix).toBeGreaterThan(panicVix);
  });

  it('place les bornes stablecoins sur les percentiles mesures', () => {
    // p5 = -2,17 % et p95 = +5,15 % sur un an : au-dela, le sous-score sature.
    expect(calcCryptoSubScores({ ...EMPTY, stable1M: -2 }).stable).toBe(0);
    expect(calcCryptoSubScores({ ...EMPTY, stable1M: 5 }).stable).toBe(100);
    // La contraction observee le 2026-07-30 (-1,46 %) reste dans le bas de la plage.
    expect(calcCryptoSubScores({ ...EMPTY, stable1M: -1.46 }).stable).toBeLessThan(20);
  });
});

describe('calcCryptoMacroScore', () => {
  it('rend 50 quand tout est absent', () => {
    expect(calcCryptoMacroScore(EMPTY)).toBe(50);
  });

  it('est la somme ponderee des sous-scores', () => {
    const inputs: CryptoMacroInputs = {
      stable1M: 1.5, ethBtc1M: 4, fearGreed: 62, dxy1M: -0.8, vix: 18, hyg1M: 0.5,
    };
    const s = calcCryptoSubScores(inputs);
    const W = CRYPTO_MACRO_WEIGHTS;
    const expected = Math.round(
      s.stable * W.stable + s.ethBtc * W.ethBtc + s.fearGreed * W.fearGreed +
      s.dxy * W.dxy + s.vix * W.vix + s.hyg * W.hyg
    );
    expect(calcCryptoMacroScore(inputs)).toBe(expected);
  });

  it('donne le plus de poids aux stablecoins', () => {
    // Deplacer la seule entree stablecoins doit bouger le score plus que
    // n'importe quelle autre entree deplacee de 0 a 100.
    const base = calcCryptoMacroScore(EMPTY);
    const viaStable = calcCryptoMacroScore({ ...EMPTY, stable1M: 5 }) - base;
    const viaEthBtc = calcCryptoMacroScore({ ...EMPTY, ethBtc1M: 11 }) - base;
    const viaFng    = calcCryptoMacroScore({ ...EMPTY, fearGreed: 100 }) - base;
    expect(viaStable).toBeGreaterThan(viaEthBtc);
    expect(viaStable).toBeGreaterThan(viaFng);
  });

  it('reste dans 0-100 aux extremes', () => {
    expect(calcCryptoMacroScore({
      stable1M: 99, ethBtc1M: 99, fearGreed: 100, dxy1M: -99, vix: 5, hyg1M: 99,
    })).toBe(100);
    expect(calcCryptoMacroScore({
      stable1M: -99, ethBtc1M: -99, fearGreed: 0, dxy1M: 99, vix: 99, hyg1M: -99,
    })).toBe(0);
  });

  it('classe le regime avec les memes bornes que le macro actions', () => {
    expect(regimeFromScore(80)).toBe('risk-on');
    expect(regimeFromScore(60)).toBe('favorable');
    expect(regimeFromScore(45)).toBe('neutral');
    expect(regimeFromScore(30)).toBe('unfavorable');
    expect(regimeFromScore(10)).toBe('risk-off');
  });
});

describe('ethBtcRatio', () => {
  it('divise point a point sur les horodatages communs', () => {
    const eth = [{ time: 1, value: 3000 }, { time: 2, value: 3300 }];
    const btc = [{ time: 1, value: 100000 }, { time: 2, value: 110000 }];
    expect(ethBtcRatio(eth, btc)).toEqual([
      { time: 1, value: 0.03 },
      { time: 2, value: 0.03 },
    ]);
  });

  it('ignore les dates presentes d un seul cote', () => {
    const eth = [{ time: 1, value: 3000 }, { time: 2, value: 3300 }];
    const btc = [{ time: 2, value: 110000 }];
    expect(ethBtcRatio(eth, btc)).toHaveLength(1);
    expect(ethBtcRatio(eth, btc)[0].time).toBe(2);
  });

  it('rend une serie vide quand rien ne s aligne', () => {
    expect(ethBtcRatio([{ time: 1, value: 1 }], [{ time: 9, value: 1 }])).toEqual([]);
  });
});

describe('sumSupply', () => {
  it('additionne les capitalisations alignees', () => {
    const usdt = [{ time: 1, value: 180 }, { time: 2, value: 182 }];
    const usdc = [{ time: 1, value: 70 }, { time: 2, value: 74 }];
    expect(sumSupply(usdt, usdc)).toEqual([
      { time: 1, value: 250 },
      { time: 2, value: 256 },
    ]);
  });

  it('ecarte une date manquante d un cote plutot que de la compter a zero', () => {
    // Le piege que le test garde : compter USDT seul sur une date ou USDC
    // manque simulerait une sortie massive de liquidite.
    const usdt = [{ time: 1, value: 180 }, { time: 2, value: 182 }];
    const usdc = [{ time: 1, value: 70 }];
    const out = sumSupply(usdt, usdc);
    expect(out).toEqual([{ time: 1, value: 250 }]);
  });

  it('accepte une valeur nulle sans la confondre avec une absence', () => {
    const a = [{ time: 1, value: 100 }];
    const b = [{ time: 1, value: 0 }];
    expect(sumSupply(a, b)).toEqual([{ time: 1, value: 100 }]);
  });
});
