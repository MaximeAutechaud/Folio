interface SeedTicker { ticker: string; name: string; exchange: string }
interface SeedNarrative {
  name: string;
  description: string;
  color: string;
  ref_etf: string | null;
  keywords: string[];
  tickers: SeedTicker[];
}

export const NARRATIVE_SEED: SeedNarrative[] = [
  {
    name: 'IA Infrastructure',
    description: 'Data centers, photonique, interconnexions optiques',
    color: '#6366f1',
    ref_etf: 'SMH',
    keywords: ['photonics', 'optical interconnect', 'silicon photonics', 'coherent', 'data center optics'],
    tickers: [
      { ticker: 'COHR', name: 'Coherent Corp.', exchange: 'NYSE' },
      { ticker: 'LITE', name: 'Lumentum Holdings', exchange: 'NASDAQ' },
      { ticker: 'MRVL', name: 'Marvell Technology', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Énergie / Nucléaire',
    description: 'Demande électrique explosive des data centers IA',
    color: '#f59e0b',
    ref_etf: 'NLR',
    keywords: ['nuclear energy AI', 'data center power', 'hyperscaler electricity', 'PPA nuclear'],
    tickers: [
      { ticker: 'CEG', name: 'Constellation Energy', exchange: 'NASDAQ' },
      { ticker: 'VST', name: 'Vistra Corp.', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Refroidissement liquide',
    description: 'Migration liquid cooling 120–150 kW/rack',
    color: '#06b6d4',
    ref_etf: null,
    keywords: ['liquid cooling', 'data center thermal', 'immersion cooling', 'direct liquid cooling'],
    tickers: [
      { ticker: 'VRT', name: 'Vertiv Holdings', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Grid / Infrastructure',
    description: 'Modernisation du réseau électrique — 70% du réseau US a +50 ans',
    color: '#10b981',
    ref_etf: null,
    keywords: ['grid modernization', 'transformer shortage', 'electrical infrastructure', 'power grid AI'],
    tickers: [
      { ticker: 'ETN', name: 'Eaton Corporation', exchange: 'NYSE' },
      { ticker: 'PWR', name: 'Quanta Services', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Data Center REITs',
    description: "L'immobilier de la révolution IA — dividendes + exposition structurelle",
    color: '#8b5cf6',
    ref_etf: null,
    keywords: ['data center REIT', 'colocation', 'hyperscale real estate'],
    tickers: [
      { ticker: 'EQIX', name: 'Equinix', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Défense EU',
    description: 'Réarmement européen — tendance structurelle 15–20 ans',
    color: '#ef4444',
    ref_etf: null,
    keywords: ['European defense', 'NATO spending', 'rearmament', 'defense budget'],
    tickers: [
      { ticker: 'HO.PA', name: 'Thales', exchange: 'Euronext Paris' },
      { ticker: 'RHM.DE', name: 'Rheinmetall', exchange: 'XETRA' },
      { ticker: 'LDO.MI', name: 'Leonardo', exchange: 'Borsa Italiana' },
      { ticker: 'BAES.L', name: 'BAE Systems', exchange: 'LSE' },
    ],
  },
  {
    name: 'Or & Mineurs',
    description: 'Dé-dollarisation, achats banques centrales, inflation',
    color: '#d97706',
    ref_etf: 'GDX',
    keywords: ['gold price', 'gold miners', 'central bank gold', 'de-dollarization', 'safe haven'],
    tickers: [
      { ticker: 'NEM', name: 'Newmont Corporation', exchange: 'NYSE' },
      { ticker: 'AEM', name: 'Agnico Eagle Mines', exchange: 'NYSE' },
      { ticker: 'GDX', name: 'VanEck Gold Miners ETF', exchange: 'NYSE Arca' },
    ],
  },
  {
    name: 'Semiconducteurs EU',
    description: 'STM, Infineon — transition IA data center + automotive recovery',
    color: '#3b82f6',
    ref_etf: 'EXV3.DE',
    keywords: ['European semiconductors', 'AI chips', 'silicon carbide', 'power semiconductors'],
    tickers: [
      { ticker: 'STMPA', name: 'STMicroelectronics', exchange: 'Euronext Paris' },
      { ticker: 'IFX.DE', name: 'Infineon Technologies', exchange: 'XETRA' },
      { ticker: 'NOKIA.HE', name: 'Nokia Oyj', exchange: 'Helsinki' },
    ],
  },
  {
    name: 'GLP-1 / Obésité',
    description: 'Révolution médicaments obésité et diabète',
    color: '#ec4899',
    ref_etf: null,
    keywords: ['GLP-1', 'obesity drug', 'Ozempic', 'weight loss drug', 'semaglutide'],
    tickers: [
      { ticker: 'LLY', name: 'Eli Lilly', exchange: 'NYSE' },
      { ticker: 'NVO', name: 'Novo Nordisk', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Cybersécurité',
    description: 'Protection infrastructure IA et cloud',
    color: '#14b8a6',
    ref_etf: 'CIBR',
    keywords: ['cybersecurity', 'AI security', 'cloud security', 'zero trust'],
    tickers: [
      { ticker: 'PANW', name: 'Palo Alto Networks', exchange: 'NASDAQ' },
      { ticker: 'CRWD', name: 'CrowdStrike', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Post-Quantum Cryptography',
    description: "Migration PQC inévitable — 50% probabilité Q-Day d'ici 2034",
    color: '#a855f7',
    ref_etf: null,
    keywords: ['post-quantum cryptography', 'quantum computing', 'PQC migration', 'NIST standards'],
    tickers: [
      { ticker: 'IBM', name: 'IBM', exchange: 'NYSE' },
      { ticker: 'IONQ', name: 'IonQ', exchange: 'NYSE' },
    ],
  },
  {
    name: 'HBM Memory / IA',
    description: 'Mémoire haute bande passante pour GPU IA',
    color: '#f97316',
    ref_etf: null,
    keywords: ['HBM memory', 'high bandwidth memory', 'AI memory', 'GPU memory'],
    tickers: [
      { ticker: 'MU', name: 'Micron Technology', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Eau / Ressources',
    description: 'Infrastructure eau et services environnementaux',
    color: '#0ea5e9',
    ref_etf: null,
    keywords: ['water infrastructure', 'water technology', 'environmental services'],
    tickers: [
      { ticker: 'XYL', name: 'Xylem', exchange: 'NYSE' },
      { ticker: 'VIE.PA', name: 'Veolia Environnement', exchange: 'Euronext Paris' },
    ],
  },
];
