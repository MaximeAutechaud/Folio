export interface Holding {
  ticker: string;
  name: string;
}

export interface SectorDef {
  id: string;
  name: string;
  etf: string;
  color: string;
  holdings: Holding[];
}

export const SECTORS: SectorDef[] = [
  {
    id: 'vgt', name: 'Technology', etf: 'VGT', color: '#58a6ff',
    holdings: [
      { ticker: 'AAPL',  name: 'Apple' },
      { ticker: 'NVDA',  name: 'NVIDIA' },
      { ticker: 'MSFT',  name: 'Microsoft' },
      { ticker: 'AVGO',  name: 'Broadcom' },
      { ticker: 'ORCL',  name: 'Oracle' },
    ],
  },
  {
    id: 'xlv', name: 'Health Care', etf: 'XLV', color: '#3fb950',
    holdings: [
      { ticker: 'LLY',  name: 'Eli Lilly' },
      { ticker: 'UNH',  name: 'UnitedHealth' },
      { ticker: 'JNJ',  name: 'J&J' },
      { ticker: 'ABBV', name: 'AbbVie' },
      { ticker: 'MRK',  name: 'Merck' },
    ],
  },
  {
    id: 'xlf', name: 'Financials', etf: 'XLF', color: '#f0883e',
    holdings: [
      { ticker: 'BRK-B', name: 'Berkshire' },
      { ticker: 'JPM',   name: 'JPMorgan' },
      { ticker: 'V',     name: 'Visa' },
      { ticker: 'MA',    name: 'Mastercard' },
      { ticker: 'BAC',   name: 'Bank of America' },
    ],
  },
  {
    id: 'xly', name: 'Cons. Discretionary', etf: 'XLY', color: '#d2a8ff',
    holdings: [
      { ticker: 'AMZN', name: 'Amazon' },
      { ticker: 'TSLA', name: 'Tesla' },
      { ticker: 'HD',   name: 'Home Depot' },
      { ticker: 'MCD',  name: "McDonald's" },
      { ticker: 'LOW',  name: "Lowe's" },
    ],
  },
  {
    id: 'xli', name: 'Industrials', etf: 'XLI', color: '#79c0ff',
    holdings: [
      { ticker: 'GE',  name: 'GE Aerospace' },
      { ticker: 'RTX', name: 'RTX Corp' },
      { ticker: 'CAT', name: 'Caterpillar' },
      { ticker: 'HON', name: 'Honeywell' },
      { ticker: 'ETN', name: 'Eaton' },
    ],
  },
  {
    id: 'xlc', name: 'Comm. Services', etf: 'XLC', color: '#f78166',
    holdings: [
      { ticker: 'META',  name: 'Meta' },
      { ticker: 'GOOGL', name: 'Alphabet' },
      { ticker: 'NFLX',  name: 'Netflix' },
      { ticker: 'TMUS',  name: 'T-Mobile' },
      { ticker: 'DIS',   name: 'Disney' },
    ],
  },
  {
    id: 'xle', name: 'Energy', etf: 'XLE', color: '#ffa657',
    holdings: [
      { ticker: 'XOM', name: 'ExxonMobil' },
      { ticker: 'CVX', name: 'Chevron' },
      { ticker: 'COP', name: 'ConocoPhillips' },
      { ticker: 'EOG', name: 'EOG Resources' },
      { ticker: 'SLB', name: 'SLB' },
    ],
  },
  {
    id: 'xlp', name: 'Cons. Staples', etf: 'XLP', color: '#56d364',
    holdings: [
      { ticker: 'COST', name: 'Costco' },
      { ticker: 'WMT',  name: 'Walmart' },
      { ticker: 'PG',   name: 'P&G' },
      { ticker: 'KO',   name: 'Coca-Cola' },
      { ticker: 'PEP',  name: 'PepsiCo' },
    ],
  },
  {
    id: 'xlb', name: 'Materials', etf: 'XLB', color: '#e3b341',
    holdings: [
      { ticker: 'LIN', name: 'Linde' },
      { ticker: 'SHW', name: 'Sherwin-Williams' },
      { ticker: 'FCX', name: 'Freeport-McMoRan' },
      { ticker: 'APD', name: 'Air Products' },
      { ticker: 'NEM', name: 'Newmont' },
    ],
  },
  {
    id: 'vnq', name: 'Real Estate', etf: 'VNQ', color: '#a371f7',
    holdings: [
      { ticker: 'PLD',  name: 'Prologis' },
      { ticker: 'AMT',  name: 'American Tower' },
      { ticker: 'EQIX', name: 'Equinix' },
      { ticker: 'WELL', name: 'Welltower' },
      { ticker: 'SPG',  name: 'Simon Property' },
    ],
  },
  {
    id: 'xlu', name: 'Utilities', etf: 'XLU', color: '#7ee787',
    holdings: [
      { ticker: 'NEE', name: 'NextEra Energy' },
      { ticker: 'SO',  name: 'Southern Co.' },
      { ticker: 'DUK', name: 'Duke Energy' },
      { ticker: 'AEP', name: 'AEP' },
      { ticker: 'SRE', name: 'Sempra' },
    ],
  },
  {
    id: 'ita', name: 'Défense & Aérospatial', etf: 'ITA', color: '#94a3b8',
    holdings: [
      { ticker: 'RTX',  name: 'RTX Corp' },
      { ticker: 'LMT',  name: 'Lockheed Martin' },
      { ticker: 'NOC',  name: 'Northrop Grumman' },
      { ticker: 'GD',   name: 'General Dynamics' },
      { ticker: 'HII',  name: 'Huntington Ingalls' },
    ],
  },
  {
    id: 'blok', name: 'Blockchain & Crypto', etf: 'BLOK', color: '#f59e0b',
    holdings: [
      { ticker: 'COIN', name: 'Coinbase' },
      { ticker: 'MSTR', name: 'MicroStrategy' },
      { ticker: 'SQ',   name: 'Block Inc.' },
      { ticker: 'MARA', name: 'MARA Holdings' },
      { ticker: 'HOOD', name: 'Robinhood' },
    ],
  },
];

export const MACRO_TICKERS = ['SPY', '^VIX', 'DX-Y.NYB', '^TNX'];
