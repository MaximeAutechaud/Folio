import { invoke } from '@tauri-apps/api/core';

export interface FearGreed {
  /** Valeur du jour, 0 = peur extreme, 100 = avidite extreme. */
  value: number | null;
  /** Valeur d'il y a 7 jours — alimente la fleche de tendance du score. */
  value7dAgo: number | null;
  /** Libelle fourni par l'API ("Fear", "Extreme Greed"…). */
  classification: string | null;
}

/**
 * Crypto Fear & Greed index (alternative.me). Gratuit, sans cle. Passe par
 * `fetch_url` comme tout appel HTTP (cf. CLAUDE.md — WebView2 bloque le CORS).
 *
 * On demande 8 points pour disposer de la valeur d'il y a une semaine sans un
 * second appel : l'index est quotidien, donc l'indice 7 est J-7.
 */
export async function fetchFearGreed(): Promise<FearGreed> {
  const empty: FearGreed = { value: null, value7dAgo: null, classification: null };
  try {
    const raw: string = await invoke('fetch_url', { url: 'https://api.alternative.me/fng/?limit=8' });
    const rows = JSON.parse(raw)?.data;
    if (!Array.isArray(rows) || rows.length === 0) return empty;
    // L'API renvoie les valeurs en *chaine* ("28"), pas en nombre.
    const num = (r: unknown): number | null => {
      const n = Number((r as { value?: unknown } | undefined)?.value);
      return Number.isFinite(n) ? n : null;
    };
    return {
      value: num(rows[0]),
      value7dAgo: rows.length > 7 ? num(rows[7]) : null,
      classification: typeof rows[0]?.value_classification === 'string'
        ? rows[0].value_classification
        : null,
    };
  } catch {
    return empty;
  }
}
