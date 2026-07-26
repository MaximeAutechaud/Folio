import { describe, it, expect } from 'vitest';
import { buildHistoryUrl, detectCurrency, MAX_DAILY_SINCE } from './yahoo';

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
