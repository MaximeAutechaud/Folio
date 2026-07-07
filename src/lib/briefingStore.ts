import { getSetting, setSetting } from './db';
import type { Briefing } from './briefingPrompt';

// « Dernier briefing seulement » : on garde une seule entrée en base (table
// settings, clé unique) — à la ré-ouverture de l'onglet on ré-affiche le dernier
// sans re-payer un appel API. Historique = chantier ultérieur (table dédiée).
const LAST_BRIEFING_KEY = 'last_briefing';

export interface StoredBriefing {
  generatedAt: string;   // ISO — quand le briefing a été généré
  snapshotDate: string;  // meta.date du snapshot analysé (YYYY-MM-DD)
  model: string;         // modèle Anthropic utilisé
  briefing: Briefing;
}

export async function loadLastBriefing(): Promise<StoredBriefing | null> {
  const raw = await getSetting(LAST_BRIEFING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredBriefing;
  } catch {
    return null; // entrée corrompue → on repart de zéro
  }
}

export async function saveLastBriefing(b: StoredBriefing): Promise<void> {
  await setSetting(LAST_BRIEFING_KEY, JSON.stringify(b));
}
