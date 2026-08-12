import { describe, it, expect } from 'vitest';
import {
  buildAnnualSeries,
  collectAnnualDurations,
  collectInstants,
  detectReporting,
  durationDays,
  missingFields,
  resolveChainPoints,
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

function conceptsOf(tags: Record<string, XbrlPoint[]>, unit: string) {
  const out: Record<string, { units: Record<string, XbrlPoint[]> }> = {};
  for (const [tag, pts] of Object.entries(tags)) out[tag] = { units: { [unit]: pts } };
  return out;
}

function facts(gaap: Record<string, XbrlPoint[]>, unit = 'USD'): CompanyFacts {
  return { cik: 1, entityName: 'Test Corp', facts: { 'us-gaap': conceptsOf(gaap, unit) } };
}

/** Meme fabrique, taxonomie des emetteurs etrangers. */
function ifrsFacts(tags: Record<string, XbrlPoint[]>, unit = 'EUR'): CompanyFacts {
  return { cik: 2, entityName: 'Test SE', facts: { 'ifrs-full': conceptsOf(tags, unit) } };
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

describe('resolveChainPoints', () => {
  it('fusionne les tags successifs d\'un meme poste', () => {
    const f = facts({
      SalesRevenueNet: [dur('2016-09-25', '2017-09-30', 229)],
      RevenueFromContractWithCustomerExcludingAssessedTax: [dur('2024-09-29', '2025-09-27', 416)],
    });
    const pts = resolveChainPoints(f, 'us-gaap', [
      'RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
    ], 'USD');
    expect(pts).toHaveLength(2);
  });

  it('retourne un tableau vide si aucun tag de la chaine n\'existe', () => {
    expect(resolveChainPoints(facts({}), 'us-gaap', ['Absent'], 'USD')).toEqual([]);
  });
});

describe('priorite de chaine', () => {
  /**
   * Regression Caterpillar 2024 : `CostOfRevenue` (le total, 40,2 Md$) et
   * `CostOfGoodsAndServicesSold` (une composante, ~0) couvrent le meme exercice.
   * Arbitrer au depot le plus recent au lieu de l'ordre de la chaine donnait une
   * marge brute de ~100 %.
   */
  it('le premier tag de la chaine gagne, meme si un autre est depose plus tard', () => {
    const f = facts({
      NetIncomeLoss: [dur('2023-12-31', '2024-12-31', 10_800)],
      Revenues:      [dur('2023-12-31', '2024-12-31', 64_800)],
      CostOfRevenue: [dur('2023-12-31', '2024-12-31', 40_200, { filed: '2025-02-01' })],
      // Depose plus tard, mais ce n'est qu'une composante : ne doit pas l'emporter.
      CostOfGoodsAndServicesSold: [dur('2023-12-31', '2024-12-31', 12, { filed: '2026-02-01' })],
    });
    expect(buildAnnualSeries(f)[0].grossProfit).toBe(64_800 - 40_200);
  });

  it('un tag secondaire comble les exercices que le premier ne couvre pas', () => {
    // Apple ne publie pas CostOfRevenue : la composante doit alors servir.
    const f = facts({
      NetIncomeLoss:              [dur('2024-09-29', '2025-09-27', 112)],
      Revenues:                   [dur('2024-09-29', '2025-09-27', 416_200)],
      CostOfGoodsAndServicesSold: [dur('2024-09-29', '2025-09-27', 221_000)],
    });
    expect(buildAnnualSeries(f)[0].grossProfit).toBe(416_200 - 221_000);
  });

  it('n\'ecrase pas un exercice deja resolu par un tag prioritaire', () => {
    const f = facts({
      NetIncomeLoss: [
        dur('2022-12-31', '2023-12-31', 1),
        dur('2023-12-31', '2024-12-31', 2),
      ],
      CostOfRevenue:              [dur('2023-12-31', '2024-12-31', 100)],
      CostOfGoodsAndServicesSold: [
        dur('2022-12-31', '2023-12-31', 90),  // comble 2023
        dur('2023-12-31', '2024-12-31', 999), // ignore : 2024 deja pris
      ],
      Revenues: [
        dur('2022-12-31', '2023-12-31', 200),
        dur('2023-12-31', '2024-12-31', 300),
      ],
    });
    const s = buildAnnualSeries(f);
    expect(s.find((r) => r.periodEnd === '2023-12-31')!.grossProfit).toBe(200 - 90);
    expect(s.find((r) => r.periodEnd === '2024-12-31')!.grossProfit).toBe(300 - 100);
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

describe('postes de contexte', () => {
  it('resout tresorerie, capex, creances et stocks', () => {
    const f = facts({
      NetIncomeLoss:                             [dur('2024-09-29', '2025-09-27', 10)],
      PaymentsToAcquirePropertyPlantAndEquipment: [dur('2024-09-29', '2025-09-27', 950)],
      CashAndCashEquivalentsAtCarryingValue:     [inst('2025-09-27', 3000)],
      AccountsReceivableNetCurrent:              [inst('2025-09-27', 1200)],
      InventoryNet:                              [inst('2025-09-27', 800)],
    });
    const r = buildAnnualSeries(f)[0];
    expect(r.capex).toBe(950);
    expect(r.cash).toBe(3000);
    expect(r.receivables).toBe(1200);
    expect(r.inventory).toBe(800);
  });

  it('bascule sur le second tag de capex quand le premier ne couvre pas l\'exercice', () => {
    // Reel chez Apple et Caterpillar : le capex se repartit sur deux tags.
    const f = facts({
      NetIncomeLoss: [
        dur('2022-12-31', '2023-12-31', 1),
        dur('2023-12-31', '2024-12-31', 2),
      ],
      PaymentsToAcquirePropertyPlantAndEquipment: [dur('2023-12-31', '2024-12-31', 500)],
      PaymentsToAcquireProductiveAssets:          [dur('2022-12-31', '2023-12-31', 400)],
    });
    const s = buildAnnualSeries(f);
    expect(s.find((r) => r.periodEnd === '2023-12-31')!.capex).toBe(400);
    expect(s.find((r) => r.periodEnd === '2024-12-31')!.capex).toBe(500);
  });

  it('ne compte pas les postes de contexte comme manquants', () => {
    // Un editeur de logiciels sans stocks ne doit pas paraitre lacunaire.
    const f = facts({
      NetIncomeLoss: [dur('2024-09-29', '2025-09-27', 10)],
    });
    expect(missingFields(buildAnnualSeries(f)[0])).not.toContain('inventory');
    expect(missingFields(buildAnnualSeries(f)[0])).not.toContain('capex');
  });
});

describe('capitaux propres', () => {
  /**
   * Regression Caterpillar : la societe ne publie QUE la variante incluant les
   * interets minoritaires. La prendre en premier garde l'identite
   * `actif = passif + capitaux propres` vraie, et fournit a Altman le coussin
   * total plutot que la seule part du groupe.
   */
  it('prefere la variante incluant les interets minoritaires', () => {
    const f = facts({
      NetIncomeLoss: [dur('2024-12-31', '2025-12-31', 10)],
      Assets:        [inst('2025-12-31', 1000)],
      StockholdersEquity: [inst('2025-12-31', 280)],
      StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: [
        inst('2025-12-31', 300),
      ],
    });
    const r = buildAnnualSeries(f)[0];
    expect(r.stockholdersEquity).toBe(300);
    // Le passif deduit doit valoir 700, pas 720.
    expect(r.liabilities).toBe(700);
  });

  it('retombe sur le tag simple pour une societe sans minoritaires', () => {
    const f = facts({
      NetIncomeLoss:      [dur('2024-09-29', '2025-09-27', 10)],
      Assets:             [inst('2025-09-27', 1000)],
      StockholdersEquity: [inst('2025-09-27', 300)],
    });
    expect(buildAnnualSeries(f)[0].stockholdersEquity).toBe(300);
  });

  it('compte les capitaux propres comme poste de scoring manquant', () => {
    // Z_bilan en depend : leur absence doit se voir.
    const f = facts({ NetIncomeLoss: [dur('2024-09-29', '2025-09-27', 10)] });
    expect(missingFields(buildAnnualSeries(f)[0])).toContain('stockholdersEquity');
  });
});

describe('detectReporting', () => {
  it('reconnait un declarant us-gaap en dollars', () => {
    const f = facts({
      Assets: [inst('2025-09-27', 359_000)],
      Revenues: [dur('2024-09-29', '2025-09-27', 400_000)],
    });
    expect(detectReporting(f)).toEqual({ taxonomy: 'us-gaap', currency: 'USD' });
  });

  it('reconnait un declarant IFRS dans sa monnaie de publication', () => {
    const f = ifrsFacts({
      Assets: [inst('2025-12-31', 40_000)],
      Revenue: [dur('2025-01-01', '2025-12-31', 36_800)],
    }, 'EUR');
    expect(detectReporting(f)).toEqual({ taxonomy: 'ifrs-full', currency: 'EUR' });
  });

  /**
   * Cas SAP, mesure sur les comptes reels : 11 exercices en euros et **un seul**
   * en dollars, publie a cote. Preferer le dollar par principe — ce que faisait
   * l'ancien `reportingCurrency` — donnerait une serie d'un exercice, donc un
   * F-Score sans historique et sans verdict. La devise se mesure a la
   * completude, elle ne se choisit pas.
   */
  it('prefere la devise qui porte la serie la plus complete, pas le dollar', () => {
    const f: CompanyFacts = {
      cik: 1, entityName: 'Double devise', facts: {
        'ifrs-full': {
          Assets: {
            units: {
              EUR: [inst('2023-12-31', 1), inst('2024-12-31', 2), inst('2025-12-31', 3)],
              USD: [inst('2025-12-31', 4)],
            },
          },
          Revenue: {
            units: {
              EUR: [
                dur('2023-01-01', '2023-12-31', 10),
                dur('2024-01-01', '2024-12-31', 11),
                dur('2025-01-01', '2025-12-31', 12),
              ],
              USD: [dur('2025-01-01', '2025-12-31', 13)],
            },
          },
        },
      },
    };
    expect(detectReporting(f)?.currency).toBe('EUR');
    expect(buildAnnualSeries(f).map((r) => r.revenue)).toEqual([10, 11, 12]);
  });

  /**
   * Cas Diageo, Toyota et Sony, tous trois mesures sur comptes reels : la
   * societe change de devise (livre puis dollar en 2024) ou de taxonomie
   * (us-gaap puis IFRS en 2021), et **l'ancienne serie est toujours la plus
   * longue**. Trancher a la seule completude affichait un rapport arrete quatre
   * ans plus tot sans que rien ne le signale.
   */
  it('prefere la combinaison a jour a un historique plus long mais perime', () => {
    const f: CompanyFacts = {
      cik: 3, entityName: 'Changement de taxonomie', facts: {
        'us-gaap': conceptsOf({
          Assets: [inst('2019-12-31', 1), inst('2020-12-31', 2)],
          Revenues: [
            dur('2019-01-01', '2019-12-31', 10),
            dur('2020-01-01', '2020-12-31', 11),
          ],
          NetIncomeLoss: [
            dur('2019-01-01', '2019-12-31', 1),
            dur('2020-01-01', '2020-12-31', 2),
          ],
        }, 'USD'),
        'ifrs-full': conceptsOf({
          Assets: [inst('2025-12-31', 3)],
          Revenue: [dur('2025-01-01', '2025-12-31', 12)],
        }, 'USD'),
      },
    };
    expect(detectReporting(f)?.taxonomy).toBe('ifrs-full');
    expect(buildAnnualSeries(f).map((r) => r.periodEnd)).toEqual(['2025-12-31']);
  });

  it('ne disqualifie pas une combinaison decalee d\'un seul exercice', () => {
    // Un exercice decale de quelques mois (cloture fiscale differente, depot en
    // retard) doit rester candidat : seul un vrai abandon compte.
    const f: CompanyFacts = {
      cik: 4, entityName: 'Decalage court', facts: {
        'ifrs-full': {
          Revenue: {
            units: {
              EUR: [
                dur('2024-01-01', '2024-12-31', 10),
                dur('2025-01-01', '2025-12-31', 11),
              ],
              USD: [dur('2025-04-01', '2026-03-31', 12)],
            },
          },
          Assets: {
            units: {
              EUR: [inst('2024-12-31', 1), inst('2025-12-31', 2)],
              USD: [inst('2026-03-31', 3)],
            },
          },
        },
      },
    };
    expect(detectReporting(f)?.currency).toBe('EUR');
  });

  it('ignore les unites non monetaires', () => {
    expect(detectReporting(facts({ Assets: [inst('2025-12-31', 100)] }, 'shares'))).toBeNull();
  });

  it('retourne null quand aucun poste ne se resout — ETF, fonds, fiducie', () => {
    expect(detectReporting(facts({}))).toBeNull();
    expect(buildAnnualSeries(facts({}))).toEqual([]);
  });
});

describe('chaines IFRS', () => {
  /**
   * Les tags releves sur les comptes reels des 12 ADR sondes. Le test ne verifie
   * pas la taxonomie mais le cablage : que chaque poste du snapshot trouve bien
   * sa chaine IFRS, faute de quoi la serie ressort vide sans lever d'erreur.
   */
  it('resout un exercice complet depuis les tags IFRS', () => {
    const f = ifrsFacts({
      Revenue: [dur('2025-01-01', '2025-12-31', 1000)],
      CostOfSales: [dur('2025-01-01', '2025-12-31', 600)],
      ProfitLossFromOperatingActivities: [dur('2025-01-01', '2025-12-31', 250)],
      ProfitLoss: [dur('2025-01-01', '2025-12-31', 200)],
      CashFlowsFromUsedInOperatingActivities: [dur('2025-01-01', '2025-12-31', 300)],
      Assets: [inst('2025-12-31', 2000)],
      CurrentAssets: [inst('2025-12-31', 800)],
      Liabilities: [inst('2025-12-31', 1200)],
      CurrentLiabilities: [inst('2025-12-31', 500)],
      LongtermBorrowings: [inst('2025-12-31', 400)],
      RetainedEarnings: [inst('2025-12-31', 700)],
      Equity: [inst('2025-12-31', 800)],
      CashAndCashEquivalents: [inst('2025-12-31', 150)],
      Inventories: [inst('2025-12-31', 120)],
      CurrentTradeReceivables: [inst('2025-12-31', 90)],
      FinanceCosts: [dur('2025-01-01', '2025-12-31', 30)],
    }, 'EUR');

    const [row] = buildAnnualSeries(f);
    expect(missingFields(row)).toEqual(['dilutedShares']);
    // Marge brute deduite : les declarants IFRS publient souvent le cout des
    // ventes sans le sous-total.
    expect(row.grossProfit).toBe(400);
    expect(row.longTermDebt).toBe(400);
    expect(row.interestExpense).toBe(30);
  });

  it('lit le decompte dilue en unite shares, quelle que soit la devise', () => {
    const f = ifrsFacts({
      Revenue: [dur('2025-01-01', '2025-12-31', 1000)],
    }, 'DKK');
    f.facts['ifrs-full'].AdjustedWeightedAverageShares = {
      units: { shares: [dur('2025-01-01', '2025-12-31', 4_447_700_000)] },
    };
    expect(buildAnnualSeries(f)[0].dilutedShares).toBe(4_447_700_000);
  });

  /**
   * BP et TotalEnergies ne publient aucun decompte d'actions : la variation doit
   * ressortir null — test non calculable — et non zero, qui se lirait comme une
   * absence de dilution reussie.
   */
  it('rend null quand la taxonomie ne porte aucun decompte d\'actions', () => {
    const f = ifrsFacts({
      Revenue: [
        dur('2024-01-01', '2024-12-31', 900),
        dur('2025-01-01', '2025-12-31', 1000),
      ],
    }, 'USD');
    expect(sharesChangeWithinFiling(f, '2025-12-31', '2024-12-31')).toBeNull();
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
      liabilitiesCurrent: 1, longTermDebt: 1, retainedEarnings: 1,
      stockholdersEquity: 1, dilutedShares: 1,
      // Postes de contexte laisses a null : ils ne doivent pas remonter.
      cash: null, capex: null, receivables: null, inventory: null, interestExpense: null,
    };
    expect(missingFields(complete)).toEqual([]);
  });
});
