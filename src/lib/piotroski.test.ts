import { describe, it, expect } from 'vitest';
import {
  computePiotroski,
  computePiotroskiSeries,
  verdictFor,
  MIN_AVAILABLE_TESTS,
  type PiotroskiTestId,
} from './piotroski';
import type { AnnualFigures } from './xbrl';

/** Exercice complet et sain, a deformer test par test. */
function year(periodEnd: string, o: Partial<AnnualFigures> = {}): AnnualFigures {
  return {
    periodEnd,
    revenue: 1000, grossProfit: 400, operatingIncome: 200, netIncome: 150,
    operatingCashFlow: 250, assets: 2000, assetsCurrent: 600, liabilities: 900,
    liabilitiesCurrent: 300, longTermDebt: 400, retainedEarnings: 500,
    stockholdersEquity: 1100, dilutedShares: 100,
    cash: 200, capex: 80, receivables: 150, inventory: 120,
    ...o,
  };
}

function run(cur: Partial<AnnualFigures>, prev: Partial<AnnualFigures> = {}, opts: {
  assetsBeforePrevious?: number | null; sharesChange?: number | null;
} = {}) {
  // `in` et non `??` : passer explicitement `null` doit rester `null`, c'est
  // precisement ce qu'on teste. `??` retomberait sur la valeur par defaut.
  return computePiotroski({
    current: year('2025-12-31', cur),
    previous: year('2024-12-31', prev),
    assetsBeforePrevious: 'assetsBeforePrevious' in opts ? opts.assetsBeforePrevious! : 1800,
    sharesChange: 'sharesChange' in opts ? opts.sharesChange! : -0.02,
  });
}

function test(s: ReturnType<typeof run>, id: PiotroskiTestId) {
  return s.tests.find((t) => t.id === id)!;
}

describe('tests de rentabilite', () => {
  it('ROA : positif rapporte a l\'actif d\'OUVERTURE, pas de cloture', () => {
    // REX 200 / actif d'ouverture 2000 = 0,10 — et non 200/2500.
    const s = run({ assets: 2500 }, { assets: 2000 });
    expect(test(s, 'roa').value).toBeCloseTo(0.1, 6);
    expect(test(s, 'roa').passed).toBe(true);
  });

  it('ROA : echoue sur un resultat operationnel negatif', () => {
    expect(test(run({ operatingIncome: -50 }), 'roa').passed).toBe(false);
  });

  it('cash-flow : echoue si le CFO est negatif', () => {
    expect(test(run({ operatingCashFlow: -10 }), 'cfo').passed).toBe(false);
  });

  it('Delta ROA : compare a l\'exercice precedent sur son propre actif d\'ouverture', () => {
    // ROA(t) = 200/2000 = 0,100 ; ROA(t-1) = 180/1800 = 0,100 => pas de hausse.
    const flat = run({ operatingIncome: 200 }, { operatingIncome: 180, assets: 2000 },
      { assetsBeforePrevious: 1800 });
    expect(test(flat, 'deltaRoa').passed).toBe(false);

    const up = run({ operatingIncome: 240 }, { operatingIncome: 180, assets: 2000 },
      { assetsBeforePrevious: 1800 });
    expect(test(up, 'deltaRoa').passed).toBe(true);
  });
});

describe('test d\'accruals — le resultat NET, deliberement', () => {
  it('passe quand le cash depasse le benefice comptable', () => {
    expect(test(run({ operatingCashFlow: 250, netIncome: 150 }), 'accruals').passed).toBe(true);
  });

  /**
   * Cas Marvell FY2026 : 69 % du resultat net vient d'une cession d'activite.
   * Le test doit echouer — c'est sa raison d'etre. S'il portait sur le resultat
   * operationnel (1 323 < CFO 1 750) il passerait a tort.
   */
  it('echoue sur un benefice gonfle par une cession, la ou le REX passerait', () => {
    const s = run({ operatingCashFlow: 1750, netIncome: 2670, operatingIncome: 1323 });
    expect(test(s, 'accruals').passed).toBe(false);
    // Le meme exercice reste rentable au sens du test 1, qui lit le REX.
    expect(test(s, 'roa').passed).toBe(true);
  });

  it('signale la part non operationnelle du resultat', () => {
    const s = run({ netIncome: 2670, operatingIncome: 1323 });
    expect(s.nonOperatingShare).toBeCloseTo((2670 - 1323) / 2670, 6);
  });

  it('ne signale rien d\'anormal quand le resultat vient de l\'exploitation', () => {
    // Negatif = l'impot rabote le resultat operationnel, cas nominal.
    const s = run({ netIncome: 150, operatingIncome: 200 });
    expect(s.nonOperatingShare!).toBeLessThan(0);
  });

  it('n\'expose aucune part hors-exploitation sur un exercice deficitaire', () => {
    // Cas Marvell 2023 : RN -163 M$ pour un REX positif. Le ratio divergeait a
    // -246 %, un chiffre qui n'apprend rien et alarme a tort.
    const s = run({ netIncome: -163, operatingIncome: 238 });
    expect(s.nonOperatingShare).toBeNull();
  });
});

describe('tests de structure financiere', () => {
  it('levier : le point va a une BAISSE du ratio dette/actif moyen', () => {
    // t : 300 / ((2000+2000)/2) = 0,15 ; t-1 : 400 / ((2000+1800)/2) = 0,2105
    const down = run({ longTermDebt: 300 }, { longTermDebt: 400 });
    expect(test(down, 'deltaLeverage').passed).toBe(true);

    const up = run({ longTermDebt: 600 }, { longTermDebt: 400 });
    expect(test(up, 'deltaLeverage').passed).toBe(false);
  });

  it('liquidite : le point va a une HAUSSE du ratio courant', () => {
    const up = run({ assetsCurrent: 900 }, { assetsCurrent: 600 });
    expect(test(up, 'deltaLiquidity').passed).toBe(true);

    const down = run({ assetsCurrent: 400 }, { assetsCurrent: 600 });
    expect(test(down, 'deltaLiquidity').passed).toBe(false);
  });

  it('dilution : rachat d\'actions ou stabilite valent le point', () => {
    expect(test(run({}, {}, { sharesChange: -0.03 }), 'dilution').passed).toBe(true);
    expect(test(run({}, {}, { sharesChange: 0 }), 'dilution').passed).toBe(true);
    expect(test(run({}, {}, { sharesChange: 0.04 }), 'dilution').passed).toBe(false);
  });

  it('dilution : non calculable si aucun depot ne couvre les deux exercices', () => {
    const s = run({}, {}, { sharesChange: null });
    expect(test(s, 'dilution').passed).toBeNull();
    expect(s.missing).toContain('dilution');
  });
});

describe('tests d\'efficacite', () => {
  it('marge brute : hausse du ratio marge/CA', () => {
    // t : 500/1000 = 0,50 ; t-1 : 400/1000 = 0,40
    expect(test(run({ grossProfit: 500 }, { grossProfit: 400 }), 'deltaMargin').passed).toBe(true);
    expect(test(run({ grossProfit: 300 }, { grossProfit: 400 }), 'deltaMargin').passed).toBe(false);
  });

  it('rotation : CA rapporte a l\'actif d\'ouverture, des deux cotes', () => {
    // t : 1000/2000 = 0,50 ; t-1 : 900/1800 = 0,50 => pas de hausse
    const flat = run({ revenue: 1000 }, { revenue: 900, assets: 2000 },
      { assetsBeforePrevious: 1800 });
    expect(test(flat, 'deltaTurnover').passed).toBe(false);

    const up = run({ revenue: 1200 }, { revenue: 900, assets: 2000 },
      { assetsBeforePrevious: 1800 });
    expect(test(up, 'deltaTurnover').passed).toBe(true);
  });
});

describe('disponibilite et verdict', () => {
  it('un exercice complet rend les 9 tests calculables', () => {
    const s = run({});
    expect(s.available).toBe(9);
    expect(s.missing).toEqual([]);
  });

  it('un poste absent rend NULL les tests concernes, jamais faux', () => {
    const s = run({ grossProfit: null });
    expect(test(s, 'deltaMargin').passed).toBeNull();
    // Les autres tests restent calculables.
    expect(test(s, 'roa').passed).toBe(true);
    expect(s.available).toBe(8);
  });

  it('un bilan t-2 absent neutralise les trois tests qui en dependent', () => {
    const s = run({}, {}, { assetsBeforePrevious: null });
    expect(s.missing.sort()).toEqual(['deltaLeverage', 'deltaRoa', 'deltaTurnover']);
    expect(s.available).toBe(6);
  });

  it('pas de verdict en dessous du plancher de tests disponibles', () => {
    const s = run({}, {}, { assetsBeforePrevious: null }); // 6 disponibles
    expect(s.available).toBeLessThan(MIN_AVAILABLE_TESTS);
    expect(s.verdict).toBeNull();
  });

  it('le verdict se rapporte aux tests disponibles, pas a 9 en aveugle', () => {
    // 7/7 doit valoir « solide », alors que 7/9 ne vaudrait que « correct ».
    expect(verdictFor(7, 7)).toBe('solide');
    expect(verdictFor(7, 9)).toBe('correct');
    expect(verdictFor(8, 9)).toBe('solide');
    expect(verdictFor(4, 9)).toBe('fragile');
    expect(verdictFor(1, 9)).toBe('difficulte');
  });

  it('refuse de conclure sur trop peu d\'observations', () => {
    expect(verdictFor(3, 3)).toBeNull();
    expect(verdictFor(6, 6)).toBeNull();
  });
});

describe('computePiotroskiSeries', () => {
  it('n\'attribue aucun score aux deux premiers exercices', () => {
    const series = [year('2023-12-31'), year('2024-12-31'), year('2025-12-31')];
    const scores = computePiotroskiSeries(series, () => -0.01);
    expect(scores).toHaveLength(1);
    expect(scores[0].periodEnd).toBe('2025-12-31');
  });

  it('retourne un tableau vide si l\'historique est trop court', () => {
    expect(computePiotroskiSeries([year('2024-12-31'), year('2025-12-31')], () => 0)).toEqual([]);
  });

  it('transmet les bonnes cloturees a la fonction de dilution', () => {
    const seen: [string, string][] = [];
    const series = [year('2023-12-31'), year('2024-12-31'), year('2025-12-31')];
    computePiotroskiSeries(series, (a, b) => { seen.push([a, b]); return 0; });
    expect(seen).toEqual([['2025-12-31', '2024-12-31']]);
  });
});
