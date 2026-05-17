interface SeedTicker { ticker: string; name: string; exchange: string }
export interface SeedNarrative {
  name: string;
  description: string;
  color: string;
  ref_etf: string | null;
  parent_sector: string | null;
  tickers: SeedTicker[];
}

export const NARRATIVE_SEED: SeedNarrative[] = [
  // ── Technology ────────────────────────────────────────────────────────────
  {
    name: 'Semiconducteurs',
    description: 'Puces logiques, mémoire, équipements lithographie',
    color: '#818cf8',
    ref_etf: 'SOXX',
    parent_sector: 'xlk',
    tickers: [
      { ticker: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ' },
      { ticker: 'AMD',  name: 'Advanced Micro Devices', exchange: 'NASDAQ' },
      { ticker: 'AVGO', name: 'Broadcom', exchange: 'NASDAQ' },
      { ticker: 'QCOM', name: 'Qualcomm', exchange: 'NASDAQ' },
      { ticker: 'MU',   name: 'Micron Technology', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Cybersécurité',
    description: 'Protection cloud, zero-trust, endpoints',
    color: '#06b6d4',
    ref_etf: 'CIBR',
    parent_sector: 'xlk',
    tickers: [
      { ticker: 'PANW', name: 'Palo Alto Networks', exchange: 'NASDAQ' },
      { ticker: 'CRWD', name: 'CrowdStrike', exchange: 'NASDAQ' },
      { ticker: 'ZS',   name: 'Zscaler', exchange: 'NASDAQ' },
      { ticker: 'FTNT', name: 'Fortinet', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Cloud & Software',
    description: 'Infra cloud, SaaS entreprise',
    color: '#3b82f6',
    ref_etf: 'WCLD',
    parent_sector: 'xlk',
    tickers: [
      { ticker: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' },
      { ticker: 'AMZN', name: 'Amazon', exchange: 'NASDAQ' },
      { ticker: 'GOOGL', name: 'Alphabet', exchange: 'NASDAQ' },
      { ticker: 'SNOW', name: 'Snowflake', exchange: 'NYSE' },
      { ticker: 'CRM',  name: 'Salesforce', exchange: 'NYSE' },
    ],
  },
  {
    name: 'IA Hardware',
    description: 'Accélérateurs IA, interconnexions, photonique',
    color: '#a855f7',
    ref_etf: null,
    parent_sector: 'xlk',
    tickers: [
      { ticker: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ' },
      { ticker: 'AMD',  name: 'Advanced Micro Devices', exchange: 'NASDAQ' },
      { ticker: 'AVGO', name: 'Broadcom', exchange: 'NASDAQ' },
      { ticker: 'MRVL', name: 'Marvell Technology', exchange: 'NASDAQ' },
      { ticker: 'COHR', name: 'Coherent Corp.', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Robotique & Automation',
    description: 'Robots industriels, automatisation, drones',
    color: '#10b981',
    ref_etf: 'ROBO',
    parent_sector: 'xlk',
    tickers: [
      { ticker: 'ISRG', name: 'Intuitive Surgical', exchange: 'NASDAQ' },
      { ticker: 'ROK',  name: 'Rockwell Automation', exchange: 'NYSE' },
      { ticker: 'ABB',  name: 'ABB Ltd', exchange: 'NYSE' },
      { ticker: 'FANUY', name: 'Fanuc Corp', exchange: 'OTC' },
    ],
  },
  {
    name: 'Photonique',
    description: 'Interconnexions optiques, silicon photonics, lidar',
    color: '#f59e0b',
    ref_etf: null,
    parent_sector: 'xlk',
    tickers: [
      { ticker: 'COHR', name: 'Coherent Corp.', exchange: 'NYSE' },
      { ticker: 'LITE', name: 'Lumentum Holdings', exchange: 'NASDAQ' },
      { ticker: 'MRVL', name: 'Marvell Technology', exchange: 'NASDAQ' },
      { ticker: 'VIAV', name: 'Viavi Solutions', exchange: 'NASDAQ' },
    ],
  },

  // ── Health Care ──────────────────────────────────────────────────────────
  {
    name: 'Biotech',
    description: 'Thérapies géniques, ARNm, anticorps monoclonaux',
    color: '#22c55e',
    ref_etf: 'XBI',
    parent_sector: 'xlv',
    tickers: [
      { ticker: 'MRNA',  name: 'Moderna', exchange: 'NASDAQ' },
      { ticker: 'REGN',  name: 'Regeneron', exchange: 'NASDAQ' },
      { ticker: 'GILD',  name: 'Gilead Sciences', exchange: 'NASDAQ' },
      { ticker: 'VRTX',  name: 'Vertex Pharmaceuticals', exchange: 'NASDAQ' },
      { ticker: 'BIIB',  name: 'Biogen', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'GLP-1 / Obésité',
    description: 'Médicaments obésité et diabète — LLY, NVO',
    color: '#ec4899',
    ref_etf: null,
    parent_sector: 'xlv',
    tickers: [
      { ticker: 'LLY', name: 'Eli Lilly', exchange: 'NYSE' },
      { ticker: 'NVO', name: 'Novo Nordisk', exchange: 'NYSE' },
    ],
  },
  {
    name: 'MedTech',
    description: 'Dispositifs médicaux, imagerie, implants',
    color: '#14b8a6',
    ref_etf: 'IHI',
    parent_sector: 'xlv',
    tickers: [
      { ticker: 'MDT',  name: 'Medtronic', exchange: 'NYSE' },
      { ticker: 'ABT',  name: 'Abbott Laboratories', exchange: 'NYSE' },
      { ticker: 'BSX',  name: 'Boston Scientific', exchange: 'NYSE' },
      { ticker: 'SYK',  name: 'Stryker', exchange: 'NYSE' },
      { ticker: 'EW',   name: 'Edwards Lifesciences', exchange: 'NYSE' },
    ],
  },

  // ── Energy ───────────────────────────────────────────────────────────────
  {
    name: 'Oil & Gas E&P',
    description: 'Exploration & production pétrole et gaz',
    color: '#f97316',
    ref_etf: 'XOP',
    parent_sector: 'xle',
    tickers: [
      { ticker: 'XOM', name: 'ExxonMobil', exchange: 'NYSE' },
      { ticker: 'CVX', name: 'Chevron', exchange: 'NYSE' },
      { ticker: 'COP', name: 'ConocoPhillips', exchange: 'NYSE' },
      { ticker: 'EOG', name: 'EOG Resources', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Nucléaire',
    description: 'Énergie nucléaire — demande électrique IA et data centers',
    color: '#eab308',
    ref_etf: 'NLR',
    parent_sector: 'xle',
    tickers: [
      { ticker: 'CEG', name: 'Constellation Energy', exchange: 'NASDAQ' },
      { ticker: 'VST', name: 'Vistra Corp.', exchange: 'NYSE' },
      { ticker: 'CCJ', name: 'Cameco Corp.', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Énergies renouvelables',
    description: 'Solaire, éolien, stockage énergie',
    color: '#4ade80',
    ref_etf: 'ICLN',
    parent_sector: 'xle',
    tickers: [
      { ticker: 'NEE',  name: 'NextEra Energy', exchange: 'NYSE' },
      { ticker: 'ENPH', name: 'Enphase Energy', exchange: 'NASDAQ' },
      { ticker: 'RUN',  name: 'Sunrun', exchange: 'NASDAQ' },
      { ticker: 'FSLR', name: 'First Solar', exchange: 'NASDAQ' },
    ],
  },

  // ── Industrials ──────────────────────────────────────────────────────────
  {
    name: 'Défense US',
    description: 'Contractors défense américains — budget en hausse',
    color: '#64748b',
    ref_etf: 'ITA',
    parent_sector: 'xli',
    tickers: [
      { ticker: 'LMT', name: 'Lockheed Martin', exchange: 'NYSE' },
      { ticker: 'RTX', name: 'RTX Corp.', exchange: 'NYSE' },
      { ticker: 'NOC', name: 'Northrop Grumman', exchange: 'NYSE' },
      { ticker: 'GD',  name: 'General Dynamics', exchange: 'NYSE' },
      { ticker: 'HII', name: 'Huntington Ingalls', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Grid & Infrastructure',
    description: 'Modernisation réseau électrique US — 70% du réseau a +50 ans',
    color: '#94a3b8',
    ref_etf: null,
    parent_sector: 'xli',
    tickers: [
      { ticker: 'ETN', name: 'Eaton Corporation', exchange: 'NYSE' },
      { ticker: 'PWR', name: 'Quanta Services', exchange: 'NYSE' },
      { ticker: 'VRT', name: 'Vertiv Holdings', exchange: 'NYSE' },
      { ticker: 'GEV', name: 'GE Vernova', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Défense EU',
    description: 'Réarmement européen — tendance structurelle 15–20 ans',
    color: '#475569',
    ref_etf: null,
    parent_sector: 'xli',
    tickers: [
      { ticker: 'HO.PA',   name: 'Thales', exchange: 'Euronext Paris' },
      { ticker: 'RHM.DE',  name: 'Rheinmetall', exchange: 'XETRA' },
      { ticker: 'BAES.L',  name: 'BAE Systems', exchange: 'LSE' },
      { ticker: 'LDO.MI',  name: 'Leonardo', exchange: 'Borsa Italiana' },
    ],
  },

  // ── Materials ─────────────────────────────────────────────────────────────
  {
    name: 'Or & Minières',
    description: 'Dé-dollarisation, banques centrales, inflation',
    color: '#fbbf24',
    ref_etf: 'GDX',
    parent_sector: 'xlb',
    tickers: [
      { ticker: 'NEM',  name: 'Newmont Corporation', exchange: 'NYSE' },
      { ticker: 'AEM',  name: 'Agnico Eagle Mines', exchange: 'NYSE' },
      { ticker: 'GOLD', name: 'Barrick Gold', exchange: 'NYSE' },
      { ticker: 'WPM',  name: 'Wheaton Precious Metals', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Cuivre',
    description: 'Transition énergétique, data centers, véhicules électriques',
    color: '#fb923c',
    ref_etf: 'COPX',
    parent_sector: 'xlb',
    tickers: [
      { ticker: 'FCX',  name: 'Freeport-McMoRan', exchange: 'NYSE' },
      { ticker: 'SCCO', name: 'Southern Copper', exchange: 'NYSE' },
      { ticker: 'TECK', name: 'Teck Resources', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Terres rares',
    description: 'Matériaux critiques — batteries, aimants permanents',
    color: '#a78bfa',
    ref_etf: 'REMX',
    parent_sector: 'xlb',
    tickers: [
      { ticker: 'MP',    name: 'MP Materials', exchange: 'NYSE' },
      { ticker: 'LYSDY', name: 'Lynas Rare Earths', exchange: 'OTC' },
    ],
  },

  // ── Financials ────────────────────────────────────────────────────────────
  {
    name: 'Banques US',
    description: 'Grandes banques — taux, crédit, trading',
    color: '#38bdf8',
    ref_etf: 'KBE',
    parent_sector: 'xlf',
    tickers: [
      { ticker: 'JPM', name: 'JPMorgan Chase', exchange: 'NYSE' },
      { ticker: 'BAC', name: 'Bank of America', exchange: 'NYSE' },
      { ticker: 'WFC', name: 'Wells Fargo', exchange: 'NYSE' },
      { ticker: 'GS',  name: 'Goldman Sachs', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Fintech',
    description: 'Paiements digitaux, crypto, néobanques',
    color: '#818cf8',
    ref_etf: null,
    parent_sector: 'xlf',
    tickers: [
      { ticker: 'SQ',   name: 'Block Inc.', exchange: 'NYSE' },
      { ticker: 'PYPL', name: 'PayPal', exchange: 'NASDAQ' },
      { ticker: 'COIN', name: 'Coinbase', exchange: 'NASDAQ' },
      { ticker: 'HOOD', name: 'Robinhood Markets', exchange: 'NASDAQ' },
    ],
  },
];
