import { describe, it, expect } from 'vitest';
import {
  buildAnnualSeries,
  collectAnnualDurations,
  collectInstants,
  durationDays,
  missingFields,
  resolveChain,
  sharesChangeWithinFiling,
  type CompanyFacts,
  type XbrlPoint,
} from './xbrl';

/** Fait de duree. `filed` par defaut posterieur a la cloture, comme dans la vraie vie. */
function dur(
  start: string,
  end: string,
  val: number,
  extra: Partial<XbrlPoint> = {},
): XbrlPoint {
  return {
    start, end, val,
    accn: '0000000000-00-000000',
    fy: 2025, fp: 'FY', form: '10-K', filed: '2025-11-01',
    ...extra,
  };
}

/** Fait instantane : pas de `start`. */
function inst(end: string, val: number, extra: Partial<XbrlPoint> = {}): XbrlPoint {
  return {
    end, val,
    accn: '0000000000-00-000000',
    fy: 2025, fp: 'FY', form: '10-K', filed: '2025-11-01',
    ...extra,
  };
}

function facts(gaap: Record<string, XbrlPoint[]>, unit = 'USD'): CompanyFacts {
  const out: Record<string, { units: Record<string, XbrlPoint[]> }> = {};
  for (const [tag, pts] of Object.entries(gaap)) out[tag] = { units: { [unit]: pts } };
  return { cik: 1, entityName: 'Test Corp', facts: { 'us-gaap': out } };
}

describe('durationDays', () => {
  it('retourne null sur un fait instantane', () => {
    expect(durationDays(inst('2025-09-27', 1))).toBeNull();
  });

  it('mesure la duree en jours', () => {
    expect(durationDays(dur('2024-09-29', '2025-09-27', 1))).toBe(363);
  });
});

describe('collectAnnualDurations', () => {
  it('ecarte les trimestres et les cumuls YTD, ne garde que les exercices', () => {
    const pts = [
      dur('2025-03-30', '2025-06-28', 90),  // trimestre (~90 j)
      dur('2024-09-29', '2025-06-28', 270), // cumul 9 mois (~272 j)
      dur('2024-09-29', '2025-09-27', 400), // exercice (~363 j)
    ];
    const out = collectAnnualDurations(pts);
    expect([...out.keys()]).toEqual(['2025-09-27']);
    expect(out.get('2025-09-27')!.val).toBe(400);
  });

  it('accepte un exercice 52/53 semaines qui ne tombe pas sur 365 j', () => {
    const out = collectAnnualDurations([dur('2024-12-30', '2025-12-28', 10)]);
    expect(out.size).toBe(1);
  });

  it('sur republication du meme exercice, le depot le plus recent gagne', () => {
    // Le chiffre est retraite un an plus tard : c'est la version corrigee
    // qu'il faut retenir, pas la premiere publiee.
    const pts = [
      dur('2023-10-01', '2024-09-28', 391_035, { filed: '2024-11-01' }),
      dur('2023-10-01', '2024-09-28', 391_999, { filed: '2025-10-31' }),
    ];
    expect(collectAnnualDurations(pts).get('2024-09-28')!.val).toBe(391_999);
  });

  it('ne se fie pas a fy, qui decrit le depot et non la periode du fait', () => {
    // Un 10-K depose en 2025 porte trois exercices, tous estampilles fy 2025.
    const pts = [
      dur('2022-09-25', '2023-09-30', 383, { fy: 2025 }),
      dur('2023-10-01', '2024-09-28', 391, { fy: 2025 }),
      dur('2024-09-29', '2025-09-27', 416, { fy: 2025 }),
    ];
    const out = collectAnnualDurations(pts);
    expect([...out.keys()]).toEqual(['2023-09-30', '2024-09-28', '2025-09-27']);
  });
});

describe('collectInstants', () => {
  it('ignore les faits de duree', () => {
    const out = collectInstants([inst('2025-09-27', 10), dur('2024-09-29', '2025-09-27', 99)]);
    expect(out.size).toBe(1);
    expect(out.get('2025-09-27')!.val).toBe(10);
  });

  it('applique la meme regle de republication', () => {
    const pts = [
      inst('2025-09-27', 100, { filed: '2025-11-01' }),
      inst('2025-09-27', 120, { filed: '2026-11-01' }),
    ];
    expect(collectInstants(pts).get('2025-09-27')!.val).toBe(120);
  });
});

describe('resolveChain', () => {
  it('fusionne les tags successifs d\'un meme poste', () => {
    const f = facts({
      SalesRevenueNet: [dur('2016-09-25', '2017-09-30', 229)],
      RevenueFromContractWithCustomerExcludingAssessedTax: [dur('2024-09-29', '2025-09-27', 416)],
    });
    const pts = resolveChain(f, 'us-gaap', [
      'RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
    ], 'USD');
    expect(pts).toHaveLength(2);
  });

  it('retourne un tableau vide si aucun tag de la chaine n\'existe', () => {
    expect(resolveChain(facts({}), 'us-gaap', ['Absent'], 'USD')).toEqual([]);
  });
});

describe('buildAnnualSeries', () => {
  it('recolle la bascule ASC 606 : la serie ne s\'arrete pas en 2018', () => {
    // Le piege reel : lire le seul tag `Revenues` renvoie une serie tronquee,
    // sans erreur. La chaine de repli doit produire les trois exercices.
    const f = facts({
      SalesRevenueNet: [dur('2016-09-25', '2017-09-30', 229_234)],
      Revenues:        [dur('2017-10-01', '2018-09-29', 265_595)],
      RevenueFromContractWithCustomerExcludingAssessedTax: [
        dur('2018-09-30', '2019-09-28', 260_174),
      ],
      NetIncomeLoss: [
        dur('2016-09-25', '2017-09-30', 48_351),
        dur('2017-10-01', '2018-09-29', 59_531),
        dur('2018-09-30', '2019-09-28', 55_256),
      ],
    });
    const series = buildAnnualSeries(f);
    expect(series.map((r) => r.periodEnd)).toEqual([
      '2017-09-30', '2018-09-29', '2019-09-28',
    ]);
    expect(series.map((r) => r.revenue)).toEqual([229_234, 265_595, 260_174]);
  });

  it('trie du plus ancien au plus recent', () => {
    const f = facts({
      NetIncomeLoss: [
        dur('2024-09-29', '2025-09-27', 112),
        dur('2022-09-25', '2023-09-30', 97),
        dur('2023-10-01', '2024-09-28', 94),
      ],
    });
    expect(buildAnnualSeries(f).map((r) => r.periodEnd)).toEqual([
      '2023-09-30', '2024-09-28', '2025-09-27',
    ]);
  });

  it('deduit la marge brute quand GrossProfit n\'est pas publie', () => {
    const f = facts({
      NetIncomeLoss:              [dur('2024-09-29', '2025-09-27', 10)],
      Revenues:                   [dur('2024-09-29', '2025-09-27', 1000)],
      CostOfGoodsAndServicesSold: [dur('2024-09-29', '2025-09-27', 600)],
    });
    expect(buildAnnualSeries(f)[0].grossProfit).toBe(400);
  });

  it('prefere GrossProfit publie a la deduction', () => {
    const f = facts({
      NetIncomeLoss:              [dur('2024-09-29', '2025-09-27', 10)],
      Revenues:                   [dur('2024-09-29', '2025-09-27', 1000)],
      CostOfGoodsAndServicesSold: [dur('2024-09-29', '2025-09-27', 600)],
      GrossProfit:                [dur('2024-09-29', '2025-09-27', 420)],
    });
    expect(buildAnnualSeries(f)[0].grossProfit).toBe(420);
  });

  it('deduit le total du passif du bilan quand Liabilities est absent', () => {
    const f = facts({
      NetIncomeLoss:      [dur('2024-09-29', '2025-09-27', 10)],
      Assets:             [inst('2025-09-27', 1000)],
      StockholdersEquity: [inst('2025-09-27', 300)],
    });
    expect(buildAnnualSeries(f)[0].liabilities).toBe(700);
  });

  it('n\'aligne un poste de bilan que sur une cloture d\'exercice', () => {
    // Assets est publie chaque trimestre ; seul l'instantane de cloture doit
    // etre retenu, et un trimestre isole ne doit pas creer d'exercice.
    const f = facts({
      NetIncomeLoss: [dur('2024-09-29', '2025-09-27', 10)],
      Assets: [
        inst('2025-03-29', 888),
        inst('2025-09-27', 1000),
      ],
    });
    const series = buildAnnualSeries(f);
    expect(series).toHaveLength(1);
    expect(series[0].assets).toBe(1000);
  });

  it('laisse a null un poste absent plutot que de l\'inventer', () => {
    const f = facts({ NetIncomeLoss: [dur('2024-09-29', '2025-09-27', 10)] });
    const row = buildAnnualSeries(f)[0];
    expect(row.revenue).toBeNull();
    expect(row.assets).toBeNull();
    expect(row.netIncome).toBe(10);
  });
});

describe('sharesChangeWithinFiling', () => {
  /**
   * Cas reel Apple : le 10-K de 2018 publie FY2017 et FY2018 en base d'origine ;
   * celui de 2020, publie apres le split 4:1, republie FY2018 en base ajustee.
   */
  const OLD = '0000320193-18-000145'; // depose avant le split
  const NEW = '0000320193-20-000096'; // depose apres le split
  const splitTrap = facts({
    WeightedAverageNumberOfDilutedSharesOutstanding: [
      dur('2016-10-02', '2017-09-30', 5_252, { accn: OLD, filed: '2018-11-05' }),
      dur('2017-10-01', '2018-09-29', 5_000, { accn: OLD, filed: '2018-11-05' }),
      dur('2017-10-01', '2018-09-29', 20_000, { accn: NEW, filed: '2020-10-30' }),
      dur('2018-09-30', '2019-09-28', 18_596, { accn: NEW, filed: '2020-10-30' }),
    ],
  }, 'shares');

  it('ne compare que des exercices issus du meme depot', () => {
    // Naivement : 20 000 vs 5 252 => +281 % de "dilution" fantome.
    // Au sein du depot d'origine : 5 000 vs 5 252 => rachat d'actions.
    const change = sharesChangeWithinFiling(splitTrap, '2018-09-29', '2017-09-30');
    expect(change).toBeCloseTo((5_000 - 5_252) / 5_252, 6);
    expect(change).toBeLessThan(0);
  });

  it('utilise la base ajustee quand les deux exercices y figurent', () => {
    const change = sharesChangeWithinFiling(splitTrap, '2019-09-28', '2018-09-29');
    expect(change).toBeCloseTo((18_596 - 20_000) / 20_000, 6);
  });

  it('retourne null si aucun depot ne couvre les deux exercices', () => {
    expect(sharesChangeWithinFiling(splitTrap, '2019-09-28', '2017-09-30')).toBeNull();
  });

  it('retourne null quand le poste est absent', () => {
    expect(sharesChangeWithinFiling(facts({}), '2025-09-27', '2024-09-28')).toBeNull();
  });
});

describe('missingFields', () => {
  it('liste les postes non resolus sans compter periodEnd', () => {
    const f = facts({ NetIncomeLoss: [dur('2024-09-29', '2025-09-27', 10)] });
    const missing = missingFields(buildAnnualSeries(f)[0]);
    expect(missing).toContain('revenue');
    expect(missing).toContain('assets');
    expect(missing).not.toContain('netIncome');
    expect(missing).not.toContain('periodEnd');
  });

  it('retourne un tableau vide quand tout est resolu', () => {
    const complete = {
      periodEnd: '2025-09-27',
      revenue: 1, grossProfit: 1, operatingIncome: 1, netIncome: 1,
      operatingCashFlow: 1, assets: 1, assetsCurrent: 1, liabilities: 1,
      liabilitiesCurrent: 1, longTermDebt: 1, retainedEarnings: 1, dilutedShares: 1,
    };
    expect(missingFields(complete)).toEqual([]);
  });
});
