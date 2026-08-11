import { invoke } from '@tauri-apps/api/core';
import type { CompanyFacts } from '../xbrl';

/**
 * Acces aux donnees financieres de la SEC (EDGAR). Gratuit, sans cle d'API.
 *
 * Politique de User-Agent, telle que **mesuree** et non telle que documentee :
 *
 * | endpoint                        | UA navigateur | UA + URL | UA + e-mail |
 * |---------------------------------|---------------|----------|-------------|
 * | `data.sec.gov` (comptes/profil) | 200           | **403**  | 200         |
 * | `www.sec.gov`  (annuaire)       | **403**       | **403**  | 200         |
 *
 * Deux consequences contre-intuitives :
 *
 * 1. `data.sec.gov` se contente du UA navigateur par defaut de `fetch_url` — on
 *    ne surcharge donc rien pour les comptes et le profil. Y envoyer un UA
 *    "propre" mais sans adresse e-mail ferait **regresser** ces appels de 200
 *    a 403.
 * 2. Le filtre de `www.sec.gov` cherche une adresse e-mail, pas une identite :
 *    `Folio (+https://github.com/...)` est rejete. Seul l'annuaire est
 *    concerne, et c'est le seul appel qui exige un e-mail de contact.
 *
 * L'adresse n'est pas en dur ici : ce fichier vit dans un depot public. Elle est
 * fournie par l'appelant, qui la lit depuis `settings`.
 */

/** Cle `settings` ou vit l'adresse de contact envoyee a la SEC. */
export const SEC_CONTACT_EMAIL_SETTING = 'sec_contact_email';

/** Construit le UA conforme attendu par `www.sec.gov`. */
export function secContactUserAgent(contactEmail: string): string {
  return `Folio Portfolio Tracker ${contactEmail}`;
}

/**
 * Rappel `fetch_url` : la command ne verifie **pas** le statut HTTP et renvoie
 * le corps quel qu'il soit. Un 403 arrive donc comme une page HTML parfaitement
 * valide, jamais comme une exception — d'ou le parsing defensif systematique
 * ici. Retourne `null` plutot que de laisser filtrer un objet aux champs
 * `undefined`.
 *
 * `userAgent` omis => `fetch_url` garde sa chaine navigateur historique.
 */
async function secJson<T>(
  url: string,
  isValid: (v: unknown) => boolean,
  userAgent?: string,
): Promise<T | null> {
  let raw: string;
  try {
    raw = await invoke('fetch_url', userAgent ? { url, userAgent } : { url });
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Page d'erreur HTML : c'est le cas nominal d'un 403 ou d'un 404.
    return null;
  }

  return isValid(parsed) ? (parsed as T) : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** La SEC attend un CIK sur 10 chiffres, zeros de tete compris. */
export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, '').padStart(10, '0');
}

// ── Annuaire ticker → CIK ────────────────────────────────────────────────────

export interface CikEntry {
  cik: string;
  ticker: string;
  title: string;
}

interface RawTickerRow {
  cik_str: number;
  ticker: string;
  title: string;
}

/**
 * Annuaire des societes cotees aux Etats-Unis (~800 Ko, ~10 000 lignes), pour
 * resoudre un ticker saisi en CIK.
 *
 * **Seul appel du projet qui exige un e-mail de contact** : sans lui, 403. Son
 * contenu ne bouge qu'a la marge (introductions, changements de ticker), il est
 * donc fait pour etre mis en cache longuement, pas rappele a chaque recherche.
 */
export async function fetchTickerDirectory(contactEmail: string): Promise<CikEntry[] | null> {
  if (!contactEmail.includes('@')) return null;

  const data = await secJson<Record<string, RawTickerRow>>(
    'https://www.sec.gov/files/company_tickers.json',
    (v) => isRecord(v) && Object.keys(v).length > 0,
    secContactUserAgent(contactEmail),
  );
  if (!data) return null;

  const out: CikEntry[] = [];
  for (const row of Object.values(data)) {
    if (!row || typeof row.ticker !== 'string' || typeof row.cik_str !== 'number') continue;
    out.push({ cik: padCik(row.cik_str), ticker: row.ticker.toUpperCase(), title: row.title });
  }
  return out.length > 0 ? out : null;
}

// ── Profil de la societe ─────────────────────────────────────────────────────

export interface CompanyProfile {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  /** Code SIC — sert a ecarter les financieres, dont le bilan ne se lit pas comme les autres. */
  sic: string;
  sicDescription: string;
  /** `MMJJ`, ex. `0926`. Informatif : les cloturees reelles viennent des faits XBRL. */
  fiscalYearEnd: string;
  /** Dernier rapport annuel depose — test de fraicheur du cache, bien moins couteux que companyfacts. */
  lastAnnualReport: { form: string; filed: string; accn: string } | null;
}

interface RawSubmissions {
  cik: string;
  name: string;
  tickers?: string[];
  exchanges?: string[];
  sic?: string;
  sicDescription?: string;
  fiscalYearEnd?: string;
  filings?: {
    recent?: {
      form?: string[];
      filed?: string[];
      filingDate?: string[];
      accessionNumber?: string[];
    };
  };
}

/**
 * Metadonnees de la societe : secteur, calendrier fiscal, historique de depots.
 * Payload ~160 Ko, contre ~4 Mo pour `companyfacts` — c'est ce qui en fait un
 * bon signal d'invalidation de cache.
 */
export async function fetchCompanyProfile(cik: string | number): Promise<CompanyProfile | null> {
  const padded = padCik(cik);
  const data = await secJson<RawSubmissions>(
    `https://data.sec.gov/submissions/CIK${padded}.json`,
    (v) => isRecord(v) && typeof v.name === 'string',
  );
  if (!data) return null;

  const recent = data.filings?.recent;
  // `filingDate` dans la doc, `filed` sur certaines reponses : on accepte les deux.
  const dates = recent?.filingDate ?? recent?.filed ?? [];
  const forms = recent?.form ?? [];
  const accns = recent?.accessionNumber ?? [];

  // 20-F / 40-F : equivalents du 10-K pour les emetteurs etrangers cotes aux US.
  const idx = forms.findIndex((f) => f === '10-K' || f === '20-F' || f === '40-F');
  const lastAnnualReport =
    idx >= 0 ? { form: forms[idx], filed: dates[idx] ?? '', accn: accns[idx] ?? '' } : null;

  return {
    cik: padded,
    name: data.name,
    tickers: data.tickers ?? [],
    exchanges: data.exchanges ?? [],
    sic: data.sic ?? '',
    sicDescription: data.sicDescription ?? '',
    fiscalYearEnd: data.fiscalYearEnd ?? '',
    lastAnnualReport,
  };
}

// ── Donnees comptables ───────────────────────────────────────────────────────

/**
 * Historique XBRL complet de la societe (~4 Mo chez Apple : 500 concepts,
 * toutes periodes confondues). A passer a `buildAnnualSeries` pour en tirer des
 * exercices exploitables, et a mettre en cache — les fondamentaux ne bougent
 * qu'a chaque publication trimestrielle.
 */
export async function fetchCompanyFacts(cik: string | number): Promise<CompanyFacts | null> {
  const padded = padCik(cik);
  return secJson<CompanyFacts>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
    (v) => isRecord(v) && isRecord((v as Record<string, unknown>).facts),
  );
}
