import { describe, it, expect } from 'vitest';
import { buildHistoryUrl, parseBars, detectCurrency, MAX_DAILY_SINCE } from './yahoo';

describe('buildHistoryUrl', () => {
  const NOW = 1785110400;

  it('periodes nommees → range=', () => {
    expect(buildHistoryUrl('SPY', '6M', NOW)).toContain('interval=1d&range=6mo');
    expect(buildHistoryUrl('SPY', '2Y_daily', NOW)).toContain('interval=1d&range=2y');
  });

  it('MAX_daily → bornes explicites, pas de range', () => {
    const url = buildHistoryUrl('XLF', 'MAX_daily', NOW);
    expect(url).toContain(`period1=${MAX_DAILY_SINCE}&period2=${NOW}`);
    expect(url).not.toContain('range=');
    expect(url).toContain('interval=1d');
  });

  it('MAX_DAILY_SINCE vaut bien le 1er janvier 2010 UTC', () => {
    expect(new Date(MAX_DAILY_SINCE * 1000).toISOString()).toBe('2010-01-01T00:00:00.000Z');
  });

  it('periode inconnue → repli sur 1M', () => {
    expect(buildHistoryUrl('SPY', 'nimportequoi', NOW)).toContain('range=1mo');
  });

  it('echappe les tickers a caracteres speciaux', () => {
    expect(buildHistoryUrl('HG=F', '3M', NOW)).toContain('/chart/HG%3DF?');
    expect(buildHistoryUrl('^VIX', '3M', NOW)).toContain('/chart/%5EVIX?');
  });

  it('demande toujours la cloture ajustee', () => {
    // Sans ces parametres, Yahoo ne renvoie pas indicators.adjclose : les perfs
    // seraient ajustees des splits mais pas des dividendes.
    for (const p of ['1M', '6M', '2Y_daily', 'MAX_daily']) {
      const url = buildHistoryUrl('XLU', p, NOW);
      expect(url).toContain('includeAdjustedClose=true');
      expect(url).toContain('events=div%7Csplit');
    }
  });
});

describe('parseBars', () => {
  const result = (over: Record<string, unknown> = {}) => ({
    timestamp: [1000, 2000, 3000],
    indicators: {
      quote: [{ close: [100, 110, 120], open: [99, 109, 119] }],
      adjclose: [{ adjclose: [95, 106, 120] }],
    },
    ...over,
  });

  it('value = cloture ajustee', () => {
    expect(parseBars(result()).map(b => b.value)).toEqual([95, 106, 120]);
  });

  it('close garde la cloture brute', () => {
    expect(parseBars(result()).map(b => b.close)).toEqual([100, 110, 120]);
  });

  it('open est ajuste du meme facteur que la cloture', () => {
    // facteur de la 1re bougie = 95/100 ; l ouverture brute 99 devient 94.05.
    // Sans cet ajustement, un open brut compare a une cloture ajustee
    // fabriquerait un faux gap le jour du detachement.
    const bars = parseBars(result());
    expect(bars[0].open).toBeCloseTo(99 * (95 / 100), 10);
    expect(bars[2].open).toBeCloseTo(119, 10); // facteur 1 sur la derniere
  });

  it('le rendement ajuste est bien superieur au rendement brut d un distributeur', () => {
    const bars = parseBars(result());
    const adj = (bars[2].value - bars[0].value) / bars[0].value;
    const brut = (bars[2].close - bars[0].close) / bars[0].close;
    expect(adj).toBeGreaterThan(brut);
  });

  it('repli sur la cloture brute quand adjclose est absent (intervalles intraday)', () => {
    const bars = parseBars(result({
      indicators: { quote: [{ close: [100, 110], open: [99, 109] }] },
    }));
    expect(bars.map(b => b.value)).toEqual([100, 110]);
    expect(bars.map(b => b.open)).toEqual([99, 109]);
  });

  it('ecarte les bougies sans cloture (jours feries partiels de Yahoo)', () => {
    const bars = parseBars(result({
      indicators: {
        quote: [{ close: [100, null, 120], open: [99, null, 119] }],
        adjclose: [{ adjclose: [100, null, 120] }],
      },
    }));
    expect(bars).toHaveLength(2);
    expect(bars.map(b => b.time)).toEqual([1000, 3000]);
  });

  it('replie open sur value quand l ouverture manque', () => {
    const bars = parseBars(result({
      indicators: {
        quote: [{ close: [100] }],
        adjclose: [{ adjclose: [95] }],
      },
      timestamp: [1000],
    }));
    expect(bars[0].open).toBe(95);
  });

  it('payload vide ou absent → tableau vide, jamais d exception', () => {
    expect(parseBars(undefined)).toEqual([]);
    expect(parseBars(null)).toEqual([]);
    expect(parseBars({})).toEqual([]);
    expect(parseBars({ timestamp: [1, 2] })).toEqual([]);
  });

  it('une cloture nulle ne provoque pas de division par zero', () => {
    const bars = parseBars({
      timestamp: [1000],
      indicators: { quote: [{ close: [0], open: [5] }], adjclose: [{ adjclose: [0] }] },
    });
    expect(bars[0].open).toBe(5); // facteur replie a 1
    expect(Number.isFinite(bars[0].open)).toBe(true);
  });
});

describe('detectCurrency', () => {
  it('places de la zone euro → EUR', () => {
    expect(detectCurrency('AIR.PA')).toBe('EUR');   // Paris
    expect(detectCurrency('ASML.AS')).toBe('EUR');  // Amsterdam
    expect(detectCurrency('SAP.DE')).toBe('EUR');   // Francfort
    expect(detectCurrency('ENEL.MI')).toBe('EUR');  // Milan
    expect(detectCurrency('ITX.MC')).toBe('EUR');   // Madrid
  });

  it('places européennes hors zone euro — devise propre, pas EUR', () => {
    expect(detectCurrency('NESN.SW')).toBe('CHF');  // Zurich
    expect(detectCurrency('ROG.VX')).toBe('CHF');
    expect(detectCurrency('VOLV-B.ST')).toBe('SEK'); // Stockholm
    expect(detectCurrency('NOVO-B.CO')).toBe('DKK'); // Copenhague
    expect(detectCurrency('EQNR.OL')).toBe('NOK');   // Oslo
  });

  it('autres suffixes connus', () => {
    expect(detectCurrency('SHEL.L')).toBe('GBP');
    expect(detectCurrency('SHOP.TO')).toBe('CAD');
    expect(detectCurrency('BHP.AX')).toBe('AUD');
    expect(detectCurrency('7203.T')).toBe('JPY');
    expect(detectCurrency('0700.HK')).toBe('HKD');
  });

  it('sans suffixe → USD par défaut', () => {
    expect(detectCurrency('AAPL')).toBe('USD');
    expect(detectCurrency('SPY')).toBe('USD');
    expect(detectCurrency('^TNX')).toBe('USD');
  });

  it('insensible à la casse', () => {
    expect(detectCurrency('air.pa')).toBe('EUR');
    expect(detectCurrency('shel.l')).toBe('GBP');
  });

  it('le suffixe doit être en fin de chaîne (pas de faux positif)', () => {
    // « PA » présent dans le ticker mais pas comme suffixe
    expect(detectCurrency('PARA')).toBe('USD');
  });
});
