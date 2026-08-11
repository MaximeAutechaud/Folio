import { describe, it, expect } from 'vitest';
import { computeAltman } from './altman';
import { isFinancialSic, isManufacturingSic } from './sic';
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

const run = (o: Partial<AnnualFigures> = {}, marketCap: number | null = 1800, sic = '3674') =>
  computeAltman({ figures: year(o), marketCap, sic });

describe('classification SIC', () => {
  it('identifie les financieres', () => {
    expect(isFinancialSic('6021')).toBe(true);   // banque commerciale
    expect(isFinancialSic('6798')).toBe(true);   // REIT
    expect(isFinancialSic('3674')).toBe(false);  // semi-conducteurs
    expect(isFinancialSic('7372')).toBe(false);  // logiciel
  });

  it('identifie le manufacturier', () => {
    expect(isManufacturingSic('3674')).toBe(true);  // semi-conducteurs
    expect(isManufacturingSic('3531')).toBe(true);  // engins de chantier
    expect(isManufacturingSic('7372')).toBe(false); // logiciel
    expect(isManufacturingSic('6021')).toBe(false); // banque
  });

  it('ne se laisse pas piegier par un code vide ou aberrant', () => {
    expect(isFinancialSic('')).toBe(false);
    expect(isManufacturingSic('')).toBe(false);
    expect(isManufacturingSic('abc')).toBe(false);
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

describe('choix de variante et zones', () => {
  it('retient le Z d\'origine pour un manufacturier', () => {
    const s = run({}, 1800, '3674');
    expect(s.variant).toBe('z');
    expect(s.headline).toBe(s.zMarket);
  });

  it('retient Z\'\' pour un non-manufacturier', () => {
    const s = run({}, 1800, '7372');
    expect(s.variant).toBe('zDoublePrime');
    expect(s.headline).toBe(s.zDoublePrime);
  });

  it('Z\'\' ignore X5 et n\'utilise que les capitaux propres comptables', () => {
    const s = run();
    const expected = 6.56 * s.x1! + 3.26 * s.x2! + 6.72 * s.x3! + 1.05 * s.x4Book!;
    expect(s.zDoublePrime).toBeCloseTo(expected, 9);
    // Changer la capitalisation ne doit pas bouger Z''.
    expect(run({}, 9999).zDoublePrime).toBeCloseTo(s.zDoublePrime!, 9);
  });

  it('applique les seuils propres a chaque variante', () => {
    // Le Z est en zone sure au-dessus de 2,99, Z'' au-dessus de 2,6.
    const solide = run({ retainedEarnings: 1400, operatingIncome: 600 }, 4000, '3674');
    expect(solide.zone).toBe('sur');

    const enDetresse = run(
      { assetsCurrent: 100, liabilitiesCurrent: 800, retainedEarnings: -900, operatingIncome: -300 },
      200, '3674',
    );
    expect(enDetresse.zone).toBe('detresse');
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

  it('un non-manufacturier reste notable sans capitalisation', () => {
    // Z'' n'en a pas besoin : le verdict tient malgre l'absence de cours.
    const s = run({}, null, '7372');
    expect(s.headline).not.toBeNull();
    expect(s.zone).not.toBeNull();
  });

  it('un passif nul ne produit pas d\'infini', () => {
    const s = run({ liabilities: 0 });
    expect(s.x4Market).toBeNull();
    expect(s.x4Book).toBeNull();
    expect(s.zMarket).toBeNull();
  });
});
