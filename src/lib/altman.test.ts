import { describe, it, expect } from 'vitest';
import { computeAltman } from './altman';
import { isFinancialSic } from './sic';
import type { AnnualFigures } from './xbrl';

function year(o: Partial<AnnualFigures> = {}): AnnualFigures {
  return {
    periodEnd: '2025-12-31',
    revenue: 1000, grossProfit: 400, operatingIncome: 200, netIncome: 150,
    operatingCashFlow: 250, assets: 2000, assetsCurrent: 800, liabilities: 900,
    liabilitiesCurrent: 300, longTermDebt: 400, retainedEarnings: 500,
    stockholdersEquity: 1100, dilutedShares: 100,
    cash: 200, capex: 80, receivables: 150, inventory: 120,
    ...o,
  };
}

const run = (o: Partial<AnnualFigures> = {}, marketCap: number | null = 1800) =>
  computeAltman({ figures: year(o), marketCap });

describe('classification SIC', () => {
  it('identifie les financieres', () => {
    expect(isFinancialSic('6021')).toBe(true);   // banque commerciale
    expect(isFinancialSic('6798')).toBe(true);   // REIT
    expect(isFinancialSic('3674')).toBe(false);  // semi-conducteurs
    expect(isFinancialSic('7372')).toBe(false);  // logiciel
  });

  it('ne se laisse pas piegier par un code vide ou aberrant', () => {
    expect(isFinancialSic('')).toBe(false);
    expect(isFinancialSic('abc')).toBe(false);
  });
});

describe('termes du Z', () => {
  it('calcule les cinq ratios', () => {
    const s = run();
    expect(s.x1).toBeCloseTo((800 - 300) / 2000, 6);
    expect(s.x2).toBeCloseTo(500 / 2000, 6);
    expect(s.x3).toBeCloseTo(200 / 2000, 6);
    expect(s.x4Market).toBeCloseTo(1800 / 900, 6);
    expect(s.x4Book).toBeCloseTo(1100 / 900, 6);
    expect(s.x5).toBeCloseTo(1000 / 2000, 6);
  });

  it('X1 peut etre negatif quand le BFR l\'est', () => {
    const s = run({ assetsCurrent: 200, liabilitiesCurrent: 500 });
    expect(s.x1).toBeCloseTo(-300 / 2000, 6);
  });

  it('applique les coefficients d\'origine, X5 a 0,999', () => {
    const s = run();
    const expected =
      1.2 * s.x1! + 1.4 * s.x2! + 3.3 * s.x3! + 0.6 * s.x4Market! + 0.999 * s.x5!;
    expect(s.zMarket).toBeCloseTo(expected, 9);
  });
});

describe('isolation de l\'effet marche', () => {
  it('Z_marche et Z_bilan ne different que par X4', () => {
    const s = run();
    // Ecart attendu = coefficient de X4 x difference des deux X4.
    expect(s.marketEffect).toBeCloseTo(0.6 * (s.x4Market! - s.x4Book!), 9);
  });

  it('une chute de cours degrade Z_marche sans toucher Z_bilan', () => {
    const haut = run({}, 3000);
    const bas = run({}, 1800);
    expect(bas.zMarket!).toBeLessThan(haut.zMarket!);
    // Le bilan n'a pas bouge : Z_bilan est identique au centieme pres.
    expect(bas.zBook).toBeCloseTo(haut.zBook!, 9);
  });

  it('une degradation du bilan deplace les deux', () => {
    const sain = run();
    const degrade = run({ retainedEarnings: -500, operatingIncome: -100 });
    expect(degrade.zMarket!).toBeLessThan(sain.zMarket!);
    expect(degrade.zBook!).toBeLessThan(sain.zBook!);
  });
});

describe('verdict : Z\'\' fait foi, quel que soit le secteur', () => {
  it('le verdict ne depend jamais de la capitalisation', () => {
    // Z'' n'utilise que les capitaux propres comptables : multiplier la
    // capitalisation par cinq ne doit rien changer au verdict.
    const bas = run({}, 1800);
    const haut = run({}, 9000);
    expect(haut.headline).toBeCloseTo(bas.headline!, 9);
    expect(haut.zone).toBe(bas.zone);
  });

  it('Z\'\' ignore X5 et n\'utilise que les capitaux propres comptables', () => {
    const s = run();
    const expected = 6.56 * s.x1! + 3.26 * s.x2! + 6.72 * s.x3! + 1.05 * s.x4Book!;
    expect(s.zDoublePrime).toBeCloseTo(expected, 9);
    expect(s.headline).toBe(s.zDoublePrime);
  });

  it('applique les seuils de Z\'\' — 2,6 et 1,1', () => {
    const solide = run({ retainedEarnings: 1400, operatingIncome: 600 });
    expect(solide.zone).toBe('sur');

    const enDetresse = run({
      assetsCurrent: 100, liabilitiesCurrent: 800,
      retainedEarnings: -900, operatingIncome: -300,
    });
    expect(enDetresse.zone).toBe('detresse');
  });
});

describe('signal de detresse — le seul champ actionnable', () => {
  it('ne se declenche qu\'en zone de detresse', () => {
    const enDetresse = run({
      assetsCurrent: 100, liabilitiesCurrent: 800,
      retainedEarnings: -900, operatingIncome: -300,
    });
    expect(enDetresse.distressSignal).toBe(true);
  });

  /**
   * Cas Apple mesure : reserves accumulees negatives a force de rachats
   * d'actions, BFR negatif parce qu'elle encaisse avant de payer ses
   * fournisseurs. Z'' tombe a 2,31 pour un seuil a 2,60 — zone grise. Traiter
   * cette zone comme un avertissement produirait un faux positif sur l'une des
   * entreprises les plus solvables qui soient.
   */
  it('reste muet en zone grise, y compris avec des reserves negatives', () => {
    const apple = run({
      assetsCurrent: 133, liabilitiesCurrent: 165,   // BFR negatif
      retainedEarnings: -14,                          // rachats d'actions cumules
      assets: 359, liabilities: 285, stockholdersEquity: 74,
      operatingIncome: 133, revenue: 416,
    });
    expect(apple.zone).toBe('grise');
    expect(apple.distressSignal).toBe(false);
  });

  it('reste muet en zone sure', () => {
    expect(run({ retainedEarnings: 1400, operatingIncome: 600 }).distressSignal).toBe(false);
  });

  it('vaut null quand le score n\'est pas calculable', () => {
    expect(run({ retainedEarnings: null }).distressSignal).toBeNull();
  });
});

describe('donnees manquantes', () => {
  it('ne rend aucun Z partiel : un terme absent annule la somme', () => {
    const s = run({ retainedEarnings: null });
    expect(s.x2).toBeNull();
    expect(s.zMarket).toBeNull();
    expect(s.zBook).toBeNull();
    expect(s.zDoublePrime).toBeNull();
    expect(s.zone).toBeNull();
    expect(s.missing).toContain('retainedEarnings');
  });

  it('sans capitalisation, Z_bilan et Z\'\' restent calculables', () => {
    const s = run({}, null);
    expect(s.zMarket).toBeNull();
    expect(s.zBook).not.toBeNull();
    expect(s.zDoublePrime).not.toBeNull();
    expect(s.marketEffect).toBeNull();
    expect(s.missing).toContain('marketCap');
  });

  it('le verdict tient malgre l\'absence de cours', () => {
    // Z'' n'utilise pas la capitalisation : une panne Yahoo ne prive pas du score.
    const s = run({}, null);
    expect(s.headline).not.toBeNull();
    expect(s.zone).not.toBeNull();
    expect(s.distressSignal).not.toBeNull();
  });

  it('un passif nul ne produit pas d\'infini', () => {
    const s = run({ liabilities: 0 });
    expect(s.x4Market).toBeNull();
    expect(s.x4Book).toBeNull();
    expect(s.zMarket).toBeNull();
  });
});
