import { SP500_SEED, SP400_SEED } from './universe-seed';

/**
 * Univers de détection du scanner de narratives.
 *
 * ## Pourquoi un univers large alors qu'on ne trade que du mid cap
 *
 * L'univers de **détection** et l'univers **tradable** ne sont pas le même objet.
 * Un cluster « mémoire » a besoin de Micron pour être reconnaissable — c'est le
 * poids lourd qui atteste que le mouvement est un thème et pas un accident sur
 * une valeur isolée. Exclure les large caps de la détection casse le cluster et
 * ne montre rien, alors même qu'on n'a aucune intention d'acheter Micron.
 *
 * Règle générale du scanner, valable ici comme pour les secteurs : **on ne
 * filtre pas l'entrée, on filtre la sortie.** Chaque membre d'un cluster est
 * annoté, et seul l'affichage retient le mid cap.
 *
 * ## Source de vérité
 *
 * S&P licencie ses compositions : il n'existe pas d'API publique fiable. La
 * source est donc un CSV de holdings d'ETF (IJH pour le S&P 400, IVV ou SPY pour
 * le S&P 500), publié par l'émetteur et importable par l'utilisateur — cf.
 * `parseHoldingsCsv`. `universe-seed.ts` en est un instantané, uniquement pour
 * que l'application démarre avant le premier import.
 *
 * ## Biais de survivance : sans objet ici
 *
 * Une liste figée serait fatale pour un backtest (les sociétés sorties de
 * l'indice manqueraient). Elle est inoffensive pour de la **détection live** :
 * on ne mesure que vers l'avant, avec l'univers du jour. C'est précisément ce
 * qui rend ce chantier faisable là où la breadth historique ne l'était pas.
 */

export type UniverseSource = 'seed' | 'import';

export interface UniverseEntry {
  /** Ticker au format Yahoo (`MOG-A`, pas `MOG.A`). */
  ticker: string;
  /**
   * Secteur GICS, identifiant de `lib/sectors.ts`.
   *
   * Fourni par le fichier de holdings, ce qui évite d'avoir à le déduire : le
   * scanner en a besoin deux fois, pour résidualiser contre le bon ETF sectoriel
   * et pour savoir si un cluster traverse plusieurs secteurs.
   */
  sectorId: string | null;
  source: UniverseSource;
}

/**
 * Classes d'actions qu'aucune règle ne peut deviner.
 *
 * iShares écrit `BRKB`, `BFB`, `MOGA` — **sans aucun séparateur**. Yahoo exige
 * `BRK-B`, `BF-B`, `MOG-A`. Il n'y a donc rien à convertir, seulement à savoir.
 *
 * Et une règle générale du type « un ticker finissant par A ou B prend un
 * tiret » serait pire que le problème : `FOXA`, `NWSA`, `CMCSA` et `GOOGL` sont
 * de vrais tickers Yahoo, les transformer les casserait. Les deux familles sont
 * indiscernables à partir du seul ticker — d'où cette table, tenue à la main.
 *
 * Le garde-fou général reste le rapport de résolution au premier téléchargement :
 * tout ticker qui revient vide doit être signalé, jamais ignoré en silence.
 */
const ISSUER_TICKER_FIXES: Record<string, string> = {
  BRKB: 'BRK-B',  // Berkshire Hathaway B
  BFB: 'BF-B',    // Brown-Forman B
  BFA: 'BF-A',    // Brown-Forman A
  MOGA: 'MOG-A',  // Moog A
};

/**
 * Ticker d'émetteur → ticker Yahoo.
 *
 * Deux corrections, dans cet ordre :
 *
 * 1. **Point → tiret** pour les fichiers qui notent la classe avec un point
 *    (`MOG.A` → `MOG-A`). Sans toucher aux suffixes de place (`AIR.PA`,
 *    `ASML.AS`), qui gardent le point : la règle est « suffixe d'une **seule**
 *    lettre = classe d'action ».
 * 2. **Table d'exceptions** pour les tickers concaténés sans séparateur.
 *
 * Un ticker mal converti renvoie une réponse vide et le titre **disparaît
 * silencieusement de l'univers** — le pire mode de défaillance possible,
 * puisqu'un cluster amputé d'un membre ne se signale pas comme incomplet.
 */
export function toYahooTicker(raw: string): string {
  const t = raw.trim().toUpperCase();
  const dotted = /^[A-Z]{1,5}\.[A-Z]$/.test(t) ? t.replace('.', '-') : t;
  return ISSUER_TICKER_FIXES[dotted] ?? dotted;
}

/**
 * Univers de démarrage : S&P 500 + S&P MidCap 400, normalisé et dédoublonné.
 *
 * Les large caps sont là comme **contexte de cluster**, pas comme cibles : un
 * groupe « mémoire » a besoin de Micron pour être reconnaissable, même si on
 * n'achètera que ses membres mid cap. Le tri par capitalisation appartient à
 * l'affichage, pas à la détection.
 */
export function seedUniverse(): UniverseEntry[] {
  const seen = new Set<string>();
  const out: UniverseEntry[] = [];
  for (const [raw, sectorId] of [...SP500_SEED, ...SP400_SEED]) {
    const ticker = toYahooTicker(raw);
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({ ticker, sectorId, source: 'seed' });
  }
  return out;
}

/** Une ligne de holdings retenue : ticker Yahoo + secteur GICS si le fichier le porte. */
export interface HoldingRow {
  ticker: string;
  /** Identifiant de `lib/sectors.ts` (`xlk`, `xli`…), `null` si non résolu. */
  sectorId: string | null;
}

/**
 * Libellés GICS des émetteurs → identifiants de `SECTORS`.
 *
 * Les libellés varient légèrement d'un fichier à l'autre : iShares écrit
 * « Communication » là où la nomenclature dit « Communication Services ».
 * On compare donc sur un préfixe normalisé plutôt qu'en égalité stricte.
 */
const GICS_TO_SECTOR: [string, string][] = [
  ['information technology', 'xlk'],
  ['health care', 'xlv'],
  ['financials', 'xlf'],
  ['consumer discretionary', 'xly'],
  ['industrials', 'xli'],
  ['communication', 'xlc'],
  ['energy', 'xle'],
  ['consumer staples', 'xlp'],
  ['materials', 'xlb'],
  ['real estate', 'xlre'],
  ['utilities', 'xlu'],
];

export function gicsToSectorId(label: string): string | null {
  const l = label.trim().toLowerCase();
  return GICS_TO_SECTOR.find(([k]) => l.startsWith(k))?.[1] ?? null;
}

/** Repli quand le fichier ne porte pas de colonne « Asset Class » exploitable. */
const NON_TICKERS = new Set(['CASH', 'USD', 'CASH_USD', 'XTSLA', 'MARGIN', '-', '--', 'N/A']);

/**
 * Extrait les positions d'un CSV de holdings d'émetteur (iShares, SPDR, Vanguard).
 *
 * Ces fichiers ne partagent aucun format : préambule de longueur variable,
 * en-tête nommé `Ticker`, `Symbol` ou `Holding Ticker`, lignes de note en fin de
 * fichier. On cherche donc la première ligne portant un en-tête reconnaissable,
 * puis on lit les colonnes par leur nom.
 *
 * Trois pièges rencontrés sur un fichier réel, tous silencieux :
 *
 * 1. **Séparateur `;`** — un export Excel en locale française n'utilise pas la
 *    virgule. Le délimiteur est donc détecté sur la ligne d'en-tête, qui ne
 *    contient jamais de valeur échappée.
 * 2. **Lignes de collatéral et de futures** aux tickers parfaitement plausibles
 *    (`PARSW`, `GSISW`, `HSBBK`, `FAU6`) : aucune liste noire ne les attraperait.
 *    On filtre sur la colonne `Asset Class` — structurée et fiable — et la liste
 *    noire ne sert plus que de repli pour les fichiers qui n'en ont pas.
 * 3. **Doublons `EQUITY` / `SWAP`** : un même titre détenu physiquement et via
 *    swap apparaît deux fois. La déduplication s'en charge.
 *
 * Note pratique pour l'écran d'import : le bouton par défaut d'iShares sert un
 * classeur `.xls` à plusieurs onglets, pas un CSV. C'est l'onglet **Holdings**
 * qu'il faut exporter.
 */
export function parseHoldingsCsv(csv: string): HoldingRow[] {
  const lines = csv.split(/\r?\n/);

  let headerIdx = -1;
  let delim = ',';
  let cTicker = -1;
  let cSector = -1;
  let cAsset = -1;

  for (let i = 0; i < lines.length && headerIdx < 0; i++) {
    for (const d of [',', ';', '\t']) {
      const cells = splitCsvLine(lines[i], d).map(c => c.trim().toLowerCase());
      const idx = cells.findIndex(c => c === 'ticker' || c === 'symbol' || c === 'holding ticker');
      // Un vrai en-tête a plusieurs colonnes : avec le mauvais délimiteur on
      // n'en obtient qu'une, ce qui écarte les faux positifs.
      if (idx >= 0 && cells.length > 1) {
        headerIdx = i;
        delim = d;
        cTicker = idx;
        cSector = cells.findIndex(c => c === 'sector');
        cAsset = cells.findIndex(c => c === 'asset class');
        break;
      }
    }
  }
  if (headerIdx < 0) return [];

  const seen = new Set<string>();
  const out: HoldingRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const raw = (cells[cTicker] ?? '').trim().replace(/^"|"$/g, '');
    if (!raw) continue;

    if (cAsset >= 0) {
      // Seule la ligne d'actions est un titre : écarte trésorerie, collatéral,
      // futures et money market, dont certains tickers passeraient la regex.
      if ((cells[cAsset] ?? '').trim().toLowerCase() !== 'equity') continue;
    } else if (NON_TICKERS.has(raw.toUpperCase())) {
      continue;
    }

    const upper = raw.toUpperCase();
    // Écarte les libellés de total (« Total », « Net Assets ») et les notes.
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(upper)) continue;

    const ticker = toYahooTicker(upper);
    if (seen.has(ticker)) continue;
    seen.add(ticker);

    const label = cSector >= 0 ? (cells[cSector] ?? '').trim() : '';
    out.push({ ticker, sectorId: label ? gicsToSectorId(label) : null });
  }
  return out;
}

/** Découpe une ligne CSV en respectant les guillemets (les noms contiennent des virgules). */
function splitCsvLine(line: string, delim = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delim && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}
