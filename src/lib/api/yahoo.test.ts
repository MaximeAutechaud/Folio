import { describe, it, expect } from 'vitest';
import { detectCurrency, parseScannerBars } from './yahoo';

describe('parseScannerBars', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    timestamp: [1000, 2000, 3000],
    indicators: {
      quote: [{
        close: [100, 110, 120],
        open: [99, 109, 119],
        volume: [1_000, 2_000, 3_000],
      }],
      adjclose: [{ adjclose: [95, 106, 120] }],
    },
    ...over,
  });

  it('value = cloture ajustee, close = cloture brute', () => {
    const b = parseScannerBars(payload());
    expect(b.map(x => x.value)).toEqual([95, 106, 120]);
    expect(b.map(x => x.close)).toEqual([100, 110, 120]);
  });

  it('open est ajuste du meme facteur que la cloture', () => {
    // Sans ca, une ouverture brute comparee a une cloture ajustee fabrique un
    // gap le jour du detachement.
    const b = parseScannerBars(payload());
    expect(b[0].open).toBeCloseTo(99 * (95 / 100), 10);
    expect(b[2].open).toBeCloseTo(119, 10); // facteur 1 sur la derniere
  });

  it('le rendement ajuste depasse le brut pour un titre distributeur', () => {
    const b = parseScannerBars(payload());
    const adj = (b[2].value - b[0].value) / b[0].value;
    const brut = (b[2].close - b[0].close) / b[0].close;
    expect(adj).toBeGreaterThan(brut);
  });

  it('remonte le volume', () => {
    expect(parseScannerBars(payload()).map(b => b.volume)).toEqual([1_000, 2_000, 3_000]);
  });

  it('ecarte une bougie sans volume', () => {
    // La retenir avec un volume a 0 ferait chuter la mediane et rendrait
    // anormale la seance suivante — un faux afflux de liquidite.
    const b = parseScannerBars(payload({
      indicators: {
        quote: [{ close: [100, 110, 120], open: [99, 109, 119], volume: [1_000, null, 3_000] }],
        adjclose: [{ adjclose: [100, 110, 120] }],
      },
    }));
    expect(b).toHaveLength(2);
    expect(b.map(x => x.time)).toEqual([1000, 3000]);
  });

  it('ecarte une bougie sans cloture', () => {
    const b = parseScannerBars(payload({
      indicators: {
        quote: [{ close: [100, null, 120], open: [99, 109, 119], volume: [1_000, 2_000, 3_000] }],
        adjclose: [{ adjclose: [100, null, 120] }],
      },
    }));
    expect(b).toHaveLength(2);
  });

  it('repli sur la cloture brute quand adjclose est absent', () => {
    const b = parseScannerBars(payload({
      indicators: { quote: [{ close: [100, 110, 120], open: [99, 109, 119], volume: [1, 2, 3] }] },
    }));
    expect(b.map(x => x.value)).toEqual([100, 110, 120]);
  });

  it('une cloture nulle ne provoque pas de division par zero', () => {
    const b = parseScannerBars({
      timestamp: [1000],
      indicators: {
        quote: [{ close: [0], open: [5], volume: [10] }],
        adjclose: [{ adjclose: [0] }],
      },
    });
    expect(Number.isFinite(b[0].open)).toBe(true);
    expect(b[0].open).toBe(5); // facteur replie a 1
  });

  it('payload vide ou absent → tableau vide, jamais d exception', () => {
    expect(parseScannerBars(undefined)).toEqual([]);
    expect(parseScannerBars(null)).toEqual([]);
    expect(parseScannerBars({})).toEqual([]);
    expect(parseScannerBars({ timestamp: [1, 2] })).toEqual([]);
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
