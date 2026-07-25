import { describe, it, expect } from 'vitest';
import { detectCurrency } from './yahoo';

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
