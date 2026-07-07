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
    ref_etf: 'OZEM',
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
  // Pas de narrative « Défense US » : ITA est déjà un secteur à part entière
  // dans lib/sectors.ts — la dupliquer ici créait un double scoring avec un
  // profil macro contradictoire (defensive côté secteur, risk_on hérité de xli).
  {
    name: 'Grid & Infrastructure',
    description: 'Modernisation réseau électrique US — 70% du réseau a +50 ans',
    color: '#94a3b8',
    ref_etf: 'GRID',
    parent_sector: 'xli',
    tickers: [
      { ticker: 'ETN', name: 'Eaton Corporation', exchange: 'NYSE' },
      { ticker: 'PWR', name: 'Quanta Services', exchange: 'NYSE' },
      { ticker: 'VRT', name: 'Vertiv Holdings', exchange: 'NYSE' },
      { ticker: 'GEV', name: 'GE Vernova', exchange: 'NYSE' },
    ],
  },
  {
    // Parent ita (et non xli) : profil macro defensive cohérent avec la thèse défense.
    name: 'Défense EU',
    description: 'Réarmement européen — tendance structurelle 15–20 ans',
    color: '#475569',
    ref_etf: 'EUAD',
    parent_sector: 'ita',
    tickers: [
      { ticker: 'HO.PA',   name: 'Thales', exchange: 'Euronext Paris' },
      { ticker: 'RHM.DE',  name: 'Rheinmetall', exchange: 'XETRA' },
      { ticker: 'BAES.L',  name: 'BAE Systems', exchange: 'LSE' },
      { ticker: 'LDO.MI',  name: 'Leonardo', exchange: 'Borsa Italiana' },
    ],
  },

  {
    name: 'Infrastructure US',
    description: 'Construction lourde, matériaux, équipement — cycle capex domestique',
    color: '#a3e635',
    ref_etf: 'PAVE',
    parent_sector: 'xli',
    tickers: [
      { ticker: 'PWR', name: 'Quanta Services', exchange: 'NYSE' },
      { ticker: 'VMC', name: 'Vulcan Materials', exchange: 'NYSE' },
      { ticker: 'MLM', name: 'Martin Marietta', exchange: 'NYSE' },
      { ticker: 'NUE', name: 'Nucor', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Compagnies aériennes',
    description: 'Transport aérien — cycle voyage, kérosène, pricing power',
    color: '#38bdf8',
    ref_etf: 'JETS',
    parent_sector: 'xli',
    tickers: [
      { ticker: 'DAL', name: 'Delta Air Lines', exchange: 'NYSE' },
      { ticker: 'UAL', name: 'United Airlines', exchange: 'NASDAQ' },
      { ticker: 'LUV', name: 'Southwest Airlines', exchange: 'NYSE' },
      { ticker: 'AAL', name: 'American Airlines', exchange: 'NASDAQ' },
    ],
  },

  // ── Défense & Aérospatial ─────────────────────────────────────────────────
  {
    name: 'Defense Tech',
    description: 'Défense nouvelle génération — logiciels, drones, autonomie',
    color: '#9ca3af',
    ref_etf: 'SHLD',
    parent_sector: 'ita',
    tickers: [
      { ticker: 'PLTR', name: 'Palantir Technologies', exchange: 'NASDAQ' },
      { ticker: 'LHX',  name: 'L3Harris Technologies', exchange: 'NYSE' },
      { ticker: 'KTOS', name: 'Kratos Defense', exchange: 'NASDAQ' },
      { ticker: 'AVAV', name: 'AeroVironment', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Espace',
    description: 'Lanceurs, satellites, communications spatiales',
    color: '#a78bfa',
    ref_etf: 'UFO',
    parent_sector: 'ita',
    tickers: [
      { ticker: 'RKLB', name: 'Rocket Lab', exchange: 'NASDAQ' },
      { ticker: 'ASTS', name: 'AST SpaceMobile', exchange: 'NASDAQ' },
      { ticker: 'IRDM', name: 'Iridium Communications', exchange: 'NASDAQ' },
      { ticker: 'VSAT', name: 'Viasat', exchange: 'NASDAQ' },
    ],
  },

  // ── Consumer Discretionary ────────────────────────────────────────────────
  {
    name: 'Construction résidentielle',
    description: 'Homebuilders US — sensibilité taux hypothécaires, déficit de logements',
    color: '#f97316',
    ref_etf: 'ITB',
    parent_sector: 'xly',
    tickers: [
      { ticker: 'DHI', name: 'D.R. Horton', exchange: 'NYSE' },
      { ticker: 'LEN', name: 'Lennar', exchange: 'NYSE' },
      { ticker: 'NVR', name: 'NVR Inc.', exchange: 'NYSE' },
      { ticker: 'PHM', name: 'PulteGroup', exchange: 'NYSE' },
    ],
  },
  {
    name: 'E-commerce',
    description: 'Vente en ligne — plateformes, marketplaces, livraison',
    color: '#fb7185',
    ref_etf: 'ONLN',
    parent_sector: 'xly',
    tickers: [
      { ticker: 'AMZN', name: 'Amazon', exchange: 'NASDAQ' },
      { ticker: 'EBAY', name: 'eBay', exchange: 'NASDAQ' },
      { ticker: 'CHWY', name: 'Chewy', exchange: 'NYSE' },
      { ticker: 'DASH', name: 'DoorDash', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Paris sportifs & iGaming',
    description: 'Jeux d\'argent en ligne — légalisation progressive aux US',
    color: '#e879f9',
    ref_etf: 'BETZ',
    parent_sector: 'xly',
    tickers: [
      { ticker: 'DKNG', name: 'DraftKings', exchange: 'NASDAQ' },
      { ticker: 'FLUT', name: 'Flutter Entertainment', exchange: 'NYSE' },
      { ticker: 'MGM',  name: 'MGM Resorts', exchange: 'NYSE' },
      { ticker: 'CZR',  name: 'Caesars Entertainment', exchange: 'NASDAQ' },
    ],
  },

  // ── Comm. Services ────────────────────────────────────────────────────────
  {
    name: 'Réseaux sociaux',
    description: 'Plateformes sociales — publicité digitale, engagement',
    color: '#f472b6',
    ref_etf: 'SOCL',
    parent_sector: 'xlc',
    tickers: [
      { ticker: 'META', name: 'Meta Platforms', exchange: 'NASDAQ' },
      { ticker: 'PINS', name: 'Pinterest', exchange: 'NYSE' },
      { ticker: 'SNAP', name: 'Snap Inc.', exchange: 'NYSE' },
      { ticker: 'RDDT', name: 'Reddit', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Gaming & eSports',
    description: 'Jeux vidéo — éditeurs, plateformes, compétition',
    color: '#c084fc',
    ref_etf: 'ESPO',
    parent_sector: 'xlc',
    tickers: [
      { ticker: 'RBLX', name: 'Roblox', exchange: 'NYSE' },
      { ticker: 'EA',   name: 'Electronic Arts', exchange: 'NASDAQ' },
      { ticker: 'TTWO', name: 'Take-Two Interactive', exchange: 'NASDAQ' },
      { ticker: 'NTES', name: 'NetEase', exchange: 'NASDAQ' },
    ],
  },

  // ── Consumer Staples ──────────────────────────────────────────────────────
  // Secteur ingrat pour le thématique : PBJ est le seul ETF crédible.
  {
    name: 'Food & Beverage',
    description: 'Alimentaire et boissons US — marques, pricing power',
    color: '#fda4af',
    ref_etf: 'PBJ',
    parent_sector: 'xlp',
    tickers: [
      { ticker: 'KO',   name: 'Coca-Cola', exchange: 'NYSE' },
      { ticker: 'PEP',  name: 'PepsiCo', exchange: 'NASDAQ' },
      { ticker: 'MDLZ', name: 'Mondelez', exchange: 'NASDAQ' },
      { ticker: 'HSY',  name: 'Hershey', exchange: 'NYSE' },
    ],
  },

  // ── Real Estate ───────────────────────────────────────────────────────────
  {
    name: 'Data Centers REITs',
    description: 'Immobilier data centers et tours télécom — demande IA',
    color: '#60a5fa',
    ref_etf: 'SRVR',
    parent_sector: 'xlre',
    tickers: [
      { ticker: 'EQIX', name: 'Equinix', exchange: 'NASDAQ' },
      { ticker: 'DLR',  name: 'Digital Realty', exchange: 'NYSE' },
      { ticker: 'AMT',  name: 'American Tower', exchange: 'NYSE' },
      { ticker: 'IRM',  name: 'Iron Mountain', exchange: 'NYSE' },
    ],
  },
  {
    name: 'REITs industriels',
    description: 'Entrepôts et logistique — cycle e-commerce',
    color: '#94a3b8',
    ref_etf: 'INDS',
    parent_sector: 'xlre',
    tickers: [
      { ticker: 'PLD',  name: 'Prologis', exchange: 'NYSE' },
      { ticker: 'REXR', name: 'Rexford Industrial', exchange: 'NYSE' },
      { ticker: 'STAG', name: 'STAG Industrial', exchange: 'NYSE' },
      { ticker: 'FR',   name: 'First Industrial Realty', exchange: 'NYSE' },
    ],
  },
  {
    name: 'REITs résidentiels',
    description: 'Logement locatif US — pénurie structurelle',
    color: '#d4a72c',
    ref_etf: 'REZ',
    parent_sector: 'xlre',
    tickers: [
      { ticker: 'AVB',  name: 'AvalonBay Communities', exchange: 'NYSE' },
      { ticker: 'EQR',  name: 'Equity Residential', exchange: 'NYSE' },
      { ticker: 'INVH', name: 'Invitation Homes', exchange: 'NYSE' },
      { ticker: 'MAA',  name: 'Mid-America Apartment', exchange: 'NYSE' },
    ],
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  // Peu d'ETF thématiques utilities : les thèses électricité (GRID, NLR, ICLN)
  // sont déjà portées par d'autres secteurs. PHO couvre l'angle eau.
  {
    name: 'Eau',
    description: 'Infrastructure et traitement de l\'eau — stress hydrique',
    color: '#22d3ee',
    ref_etf: 'PHO',
    parent_sector: 'xlu',
    tickers: [
      { ticker: 'XYL',  name: 'Xylem', exchange: 'NYSE' },
      { ticker: 'AWK',  name: 'American Water Works', exchange: 'NYSE' },
      { ticker: 'ECL',  name: 'Ecolab', exchange: 'NYSE' },
      { ticker: 'VLTO', name: 'Veralto', exchange: 'NYSE' },
    ],
  },

  // ── Energy (suite) ────────────────────────────────────────────────────────
  {
    name: 'Uranium',
    description: 'Mineurs d\'uranium — beta cyclique de la thèse nucléaire',
    color: '#4ade80',
    ref_etf: 'URA',
    parent_sector: 'xle',
    tickers: [
      { ticker: 'CCJ', name: 'Cameco Corp.', exchange: 'NYSE' },
      { ticker: 'NXE', name: 'NexGen Energy', exchange: 'NYSE' },
      { ticker: 'UEC', name: 'Uranium Energy', exchange: 'NYSE' },
      { ticker: 'DNN', name: 'Denison Mines', exchange: 'NYSE' },
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

  {
    name: 'Lithium & Batteries',
    description: 'Chaîne batterie — lithium, cellules, cycle véhicule électrique',
    color: '#2dd4bf',
    ref_etf: 'LIT',
    parent_sector: 'xlb',
    tickers: [
      { ticker: 'ALB', name: 'Albemarle', exchange: 'NYSE' },
      { ticker: 'SQM', name: 'Sociedad Química y Minera', exchange: 'NYSE' },
      { ticker: 'LAC', name: 'Lithium Americas', exchange: 'NYSE' },
    ],
  },
  {
    name: 'Agribusiness',
    description: 'Équipement agricole, semences, engrais — sécurité alimentaire',
    color: '#84cc16',
    ref_etf: 'MOO',
    parent_sector: 'xlb',
    tickers: [
      { ticker: 'DE',   name: 'Deere & Co.', exchange: 'NYSE' },
      { ticker: 'CTVA', name: 'Corteva', exchange: 'NYSE' },
      { ticker: 'ADM',  name: 'Archer-Daniels-Midland', exchange: 'NYSE' },
      { ticker: 'NTR',  name: 'Nutrien', exchange: 'NYSE' },
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
    ref_etf: 'FINX',
    parent_sector: 'xlf',
    tickers: [
      { ticker: 'SQ',   name: 'Block Inc.', exchange: 'NYSE' },
      { ticker: 'PYPL', name: 'PayPal', exchange: 'NASDAQ' },
      { ticker: 'COIN', name: 'Coinbase', exchange: 'NASDAQ' },
      { ticker: 'HOOD', name: 'Robinhood Markets', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Assurance US',
    description: 'Assureurs P&C et multirisques — cycle de tarification',
    color: '#fbbf24',
    ref_etf: 'IAK',
    parent_sector: 'xlf',
    tickers: [
      { ticker: 'PGR', name: 'Progressive', exchange: 'NYSE' },
      { ticker: 'CB',  name: 'Chubb', exchange: 'NYSE' },
      { ticker: 'TRV', name: 'Travelers', exchange: 'NYSE' },
      { ticker: 'AIG', name: 'American International Group', exchange: 'NYSE' },
    ],
  },

  // ── Blockchain & Crypto ───────────────────────────────────────────────────
  {
    name: 'Mineurs Bitcoin',
    description: 'Mining BTC — levier sur le cours, pivot data centers IA',
    color: '#f59e0b',
    ref_etf: 'WGMI',
    parent_sector: 'blok',
    tickers: [
      { ticker: 'MARA', name: 'MARA Holdings', exchange: 'NASDAQ' },
      { ticker: 'RIOT', name: 'Riot Platforms', exchange: 'NASDAQ' },
      { ticker: 'CLSK', name: 'CleanSpark', exchange: 'NASDAQ' },
      { ticker: 'CIFR', name: 'Cipher Mining', exchange: 'NASDAQ' },
    ],
  },
  {
    name: 'Actifs numériques',
    description: 'Exchanges, treasuries BTC, infrastructure crypto',
    color: '#fb923c',
    ref_etf: 'DAPP',
    parent_sector: 'blok',
    tickers: [
      { ticker: 'COIN', name: 'Coinbase', exchange: 'NASDAQ' },
      { ticker: 'MSTR', name: 'Strategy (MicroStrategy)', exchange: 'NASDAQ' },
      { ticker: 'HOOD', name: 'Robinhood Markets', exchange: 'NASDAQ' },
    ],
  },
];
