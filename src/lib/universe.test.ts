import { describe, it, expect } from 'vitest';
import { toYahooTicker, parseHoldingsCsv, seedUniverse, gicsToSectorId } from './universe';
import { SP400_SEED } from './universe-seed';

const tickers = (csv: string) => parseHoldingsCsv(csv).map(r => r.ticker);

describe('toYahooTicker', () => {
  it('convertit les classes d actions : point → tiret', () => {
    expect(toYahooTicker('MOG.A')).toBe('MOG-A');
    expect(toYahooTicker('BRK.B')).toBe('BRK-B');
    expect(toYahooTicker('BF.B')).toBe('BF-B');
  });

  it('ne touche PAS aux suffixes de place, qui gardent le point', () => {
    // Le piege : `.PA` fait deux lettres, `.A` une seule. Convertir AIR.PA en
    // AIR-PA produirait une requete vide et le titre disparaitrait en silence.
    expect(toYahooTicker('AIR.PA')).toBe('AIR.PA');
    expect(toYahooTicker('ASML.AS')).toBe('ASML.AS');
    expect(toYahooTicker('NESN.SW')).toBe('NESN.SW');
  });

  it('normalise la casse et les espaces', () => {
    expect(toYahooTicker('  aapl ')).toBe('AAPL');
    expect(toYahooTicker('mog.a')).toBe('MOG-A');
  });

  it('laisse intacts les tickers simples', () => {
    expect(toYahooTicker('AAPL')).toBe('AAPL');
    expect(toYahooTicker('GOOGL')).toBe('GOOGL');
  });
});

describe('gicsToSectorId', () => {
  it('mappe les libelles GICS vers les identifiants de SECTORS', () => {
    expect(gicsToSectorId('Information Technology')).toBe('xlk');
    expect(gicsToSectorId('Health Care')).toBe('xlv');
    expect(gicsToSectorId('Real Estate')).toBe('xlre');
  });

  it('tolere la variante « Communication » d iShares', () => {
    // La nomenclature dit « Communication Services », iShares ecrit
    // « Communication » — d ou la comparaison sur prefixe.
    expect(gicsToSectorId('Communication')).toBe('xlc');
    expect(gicsToSectorId('Communication Services')).toBe('xlc');
  });

  it('insensible a la casse et aux espaces', () => {
    expect(gicsToSectorId('  industrials ')).toBe('xli');
  });

  it('libelle inconnu → null plutot qu un rattachement arbitraire', () => {
    expect(gicsToSectorId('Cash and/or Derivatives')).toBeNull();
    expect(gicsToSectorId('')).toBeNull();
  });
});

describe('seedUniverse', () => {
  it('contient les 400 constituants du S&P MidCap 400', () => {
    expect(seedUniverse()).toHaveLength(400);
  });

  it('aucun doublon', () => {
    const t = seedUniverse().map(e => e.ticker);
    expect(new Set(t).size).toBe(t.length);
  });

  it('la graine ne contient que des tickers plausibles, deja normalises', () => {
    for (const [raw] of SP400_SEED) {
      expect(raw).toMatch(/^[A-Z][A-Z0-9-]{0,6}$/);
      expect(raw).not.toContain('.');
    }
  });

  it('chaque titre porte un secteur resolu', () => {
    // Un secteur manquant casserait la residualisation : le titre serait
    // nettoye du marche mais pas de son secteur, et correlerait avec ses pairs
    // sur ce reliquat — un cluster fantome.
    expect(seedUniverse().filter(e => e.sectorId == null)).toEqual([]);
  });

  it('les secteurs sont ceux de lib/sectors.ts', () => {
    const valides = new Set(['xlk', 'xlv', 'xlf', 'xly', 'xli', 'xlc', 'xle', 'xlp', 'xlb', 'xlre', 'xlu']);
    for (const e of seedUniverse()) expect(valides.has(e.sectorId!)).toBe(true);
  });

  it('aucune ligne de collateral ou de futures n a survecu a l import', () => {
    const t = new Set(seedUniverse().map(e => e.ticker));
    for (const parasite of ['PARSW', 'GSISW', 'HSBBK', 'MLISW', 'FAU6', 'XTSLA']) {
      expect(t.has(parasite)).toBe(false);
    }
  });

  it('est marquee comme graine, pour que l UI puisse le signaler', () => {
    expect(seedUniverse().every(e => e.source === 'seed')).toBe(true);
  });
});

describe('parseHoldingsCsv', () => {
  // Format iShares : preambule de plusieurs lignes avant l en-tete.
  const ISHARES = [
    'iShares Core S&P Mid-Cap ETF',
    'Fund Holdings as of,"Jul 25, 2026"',
    'Inception Date,"May 22, 2000"',
    '',
    'Ticker,Name,Sector,Asset Class,Market Value,Weight (%)',
    'AAON,"AAON, INC.",Industrials,Equity,"1,234,567.89",0.45',
    'MOG.A,"MOOG INC CLASS A",Industrials,Equity,"987,654.32",0.31',
    'XTSLA,BLK CSH FND TREASURY SL AGENCY,Cash and/or Derivatives,Money Market,"12,345.00",0.01',
    'USD,USD CASH,Cash and/or Derivatives,Cash,"1,000.00",0.00',
    '',
    'The content contained herein is owned or licensed by BlackRock.',
  ].join('\n');

  it('saute le preambule et trouve la colonne Ticker', () => {
    expect(tickers(ISHARES)).toEqual(['AAON', 'MOG-A']);
  });

  it('remonte le secteur GICS quand le fichier le porte', () => {
    expect(parseHoldingsCsv(ISHARES)).toEqual([
      { ticker: 'AAON', sectorId: 'xli' },
      { ticker: 'MOG-A', sectorId: 'xli' },
    ]);
  });

  it('ecarte tresorerie et collateral via Asset Class', () => {
    const out = tickers(ISHARES);
    expect(out).not.toContain('XTSLA');
    expect(out).not.toContain('USD');
  });

  it('ecarte les lignes de note en fin de fichier', () => {
    expect(tickers(ISHARES)).toHaveLength(2);
  });

  // ── Le fichier reel : separateur ';' et tickers de collateral plausibles ──
  const ISHARES_FR = [
    'Ticker;Name;Type;Sector;Asset Class;Market Value;Quantity',
    'FTI;TECHNIPFMC PLC;EQUITY;Energy;Equity;1 044 604 954,00;13 610 488,00',
    'MOG.A;MOOG INC CLASS A;EQUITY;Industrials;Equity;500 000,00;1 000,00',
    'FNF;FIDELITY NATIONAL FINANCIAL INC;SWAP;Financials;Equity;0,00;19 299,00',
    'FNF;FIDELITY NATIONAL FINANCIAL INC;EQUITY;Financials;Equity;900 000,00;5 000,00',
    'FAU6;S&P MID 400 EMINI SEP 26;INDEX;Cash and/or Derivatives;Futures;0,00;892,00',
    'PARSW;CASH COLLATERAL USD PARSW;COLLATERAL;Cash and/or Derivatives;Cash Collateral and Margins;-140 324,45;-140 000,00',
    'HSBBK;CASH COLLATERAL USD HSBSW;COLLATERAL;Cash and/or Derivatives;Cash Collateral and Margins;-1 012 340,68;-1 010 000,00',
  ].join('\n');

  it('detecte le separateur point-virgule d un export Excel francais', () => {
    expect(tickers(ISHARES_FR)).toEqual(['FTI', 'MOG-A', 'FNF']);
  });

  it('ecarte futures et collateral, dont les tickers passeraient toute liste noire', () => {
    // PARSW, HSBBK et FAU6 ressemblent a de vrais tickers : seul le filtre sur
    // Asset Class les distingue.
    const out = tickers(ISHARES_FR);
    for (const parasite of ['FAU6', 'PARSW', 'HSBBK']) expect(out).not.toContain(parasite);
  });

  it('dedoublonne un titre detenu a la fois en physique et via swap', () => {
    expect(tickers(ISHARES_FR).filter(t => t === 'FNF')).toHaveLength(1);
  });

  it('accepte l en-tete « Symbol » (format SPDR)', () => {
    const spdr = 'Name,Symbol,Weight,Sector\nApple Inc.,AAPL,7.1,Information Technology\nMoog,MOG.A,0.1,Industrials';
    expect(parseHoldingsCsv(spdr)).toEqual([
      { ticker: 'AAPL', sectorId: 'xlk' },
      { ticker: 'MOG-A', sectorId: 'xli' },
    ]);
  });

  it('accepte « Holding Ticker », et sectorId reste null sans colonne Sector', () => {
    const csv = 'Holding Ticker,Description\nNVDA,NVIDIA\nMU,MICRON';
    expect(parseHoldingsCsv(csv)).toEqual([
      { ticker: 'NVDA', sectorId: null },
      { ticker: 'MU', sectorId: null },
    ]);
  });

  it('respecte les guillemets : un nom contenant une virgule ne decale pas les colonnes', () => {
    const csv = 'Ticker,Name,Weight\nAAON,"AAON, INC.",0.45\nBJ,"BJ\'S WHOLESALE CLUB, INC",0.3';
    expect(tickers(csv)).toEqual(['AAON', 'BJ']);
  });

  it('gere les guillemets echappes', () => {
    const csv = 'Ticker,Name\nAAA,"LE ""GRAND"" TRUC"\nBBB,Autre';
    expect(tickers(csv)).toEqual(['AAA', 'BBB']);
  });

  it('dedoublonne', () => {
    const csv = 'Ticker,Name\nAAPL,Apple\nAAPL,Apple\nMSFT,Microsoft';
    expect(tickers(csv)).toEqual(['AAPL', 'MSFT']);
  });

  it('aucun en-tete reconnaissable → tableau vide, pas une exception', () => {
    expect(parseHoldingsCsv('foo,bar\n1,2')).toEqual([]);
    expect(parseHoldingsCsv('')).toEqual([]);
  });

  it('gere les fins de ligne Windows', () => {
    expect(tickers('Ticker,Name\r\nAAPL,Apple\r\nMSFT,Microsoft\r\n')).toEqual(['AAPL', 'MSFT']);
  });
});
