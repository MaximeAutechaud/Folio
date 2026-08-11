import { describe, it, expect } from 'vitest';
import { computeContextIndicators } from './contextIndicators';
import type { AnnualFigures } from './xbrl';

function year(o: Partial<AnnualFigures> = {}): AnnualFigures {
  return {
    periodEnd: '2025-12-31',
    revenue: 1000, grossProfit: 400, operatingIncome: 200, netIncome: 150,
    operatingCashFlow: 250, assets: 2000, assetsCurrent: 800, liabilities: 900,
    liabilitiesCurrent: 300, longTermDebt: 400, retainedEarnings: 500,
    stockholdersEquity: 1100, dilutedShares: 100,
    cash: 100, capex: 80, receivables: 150, inventory: 120, interestExpense: 20,
    ...o,
  };
}

const run = (o: Partial<AnnualFigures> = {}, marketCap: number | null = 3000) =>
  computeContextIndicators({ figures: year(o), marketCap });

describe('flux de tresorerie', () => {
  it('le FCF retranche les investissements du cash-flow d\'exploitation', () => {
    expect(run().freeCashFlow).toBe(250 - 80);
  });

  it('rapporte le FCF au CA et a la capitalisation', () => {
    expect(run().freeCashFlowMargin).toBeCloseTo(170 / 1000, 9);
    expect(run().freeCashFlowYield).toBeCloseTo(170 / 3000, 9);
  });

  it('reste null si les investissements ne sont pas publies', () => {
    const s = run({ capex: null });
    expect(s.freeCashFlow).toBeNull();
    expect(s.freeCashFlowYield).toBeNull();
  });
});

describe('endettement', () => {
  it('la dette nette retranche la tresorerie de la dette long terme', () => {
    expect(run().netDebt).toBe(400 - 100);
  });

  it('devient negative en situation de tresorerie nette', () => {
    expect(run({ cash: 900 }).netDebt).toBe(400 - 900);
  });

  it('n\'affiche pas de ratio d\'endettement en tresorerie nette', () => {
    // Un « -2,6 annees de remboursement » ne veut rien dire.
    expect(run({ cash: 900 }).netDebtToOperatingCashFlow).toBeNull();
  });

  it('mesure les annees de cash-flow necessaires au remboursement', () => {
    expect(run().netDebtToOperatingCashFlow).toBeCloseTo(300 / 250, 9);
  });

  it('couverture des interets : resultat operationnel sur charge d\'interets', () => {
    expect(run().interestCoverage).toBeCloseTo(200 / 20, 9);
  });

  it('couverture nulle et non infinie quand la charge n\'est pas publiee', () => {
    // Cas Apple apres 2023 et Caterpillar sur tout l'historique.
    expect(run({ interestExpense: null }).interestCoverage).toBeNull();
    expect(run({ interestExpense: 0 }).interestCoverage).toBeNull();
  });
});

describe('valorisation', () => {
  it('PER = capitalisation / resultat net', () => {
    expect(run().priceEarnings).toBeCloseTo(3000 / 150, 9);
  });

  it('pas de PER sur un resultat negatif — un PER negatif se lirait « bon marche »', () => {
    expect(run({ netIncome: -50 }).priceEarnings).toBeNull();
  });

  it('EV/REX inclut la dette nette dans la valeur d\'entreprise', () => {
    expect(run().enterpriseValueToEbit).toBeCloseTo((3000 + 300) / 200, 9);
  });

  it('pas d\'EV/REX si l\'exploitation est deficitaire', () => {
    expect(run({ operatingIncome: -10 }).enterpriseValueToEbit).toBeNull();
  });

  it('sans capitalisation, seuls les ratios de valorisation tombent', () => {
    const s = run({}, null);
    expect(s.priceEarnings).toBeNull();
    expect(s.freeCashFlowYield).toBeNull();
    expect(s.enterpriseValueToEbit).toBeNull();
    // Les indicateurs comptables restent intacts.
    expect(s.freeCashFlow).toBe(170);
    expect(s.netDebt).toBe(300);
    expect(s.interestCoverage).toBeCloseTo(10, 9);
  });
});

describe('qualite des profits', () => {
  it('DSO = creances rapportees au CA quotidien', () => {
    expect(run().daysSalesOutstanding).toBeCloseTo((150 / 1000) * 365, 9);
  });

  it('jours de stock rapportes au COUT des ventes, pas au CA', () => {
    // Cout des ventes = CA - marge brute = 600.
    expect(run().inventoryDays).toBeCloseTo((120 / 600) * 365, 9);
  });

  it('pas de jours de stock chez une societe qui n\'en a pas', () => {
    // Editeur de logiciels : absence legitime, pas une lacune.
    expect(run({ inventory: null }).inventoryDays).toBeNull();
  });

  it('pas de jours de stock si le cout des ventes est nul ou negatif', () => {
    expect(run({ grossProfit: 1000 }).inventoryDays).toBeNull();
  });
});
