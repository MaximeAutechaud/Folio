import { invoke } from '@tauri-apps/api/core';
import { getSetting } from './db';

// Modèle par défaut — synthèse structurée, pas de raisonnement lourd. Sonnet 5
// pour le rapport coût/qualité ; passer à 'claude-opus-4-8' ici pour la qualité max.
export const ANTHROPIC_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_API_KEY_SETTING = 'anthropic_api_key';

export interface AnthropicOptions {
  system?: string;
  maxTokens?: number;
  /** Si fourni, contraint la sortie à ce schéma JSON (structured outputs). */
  jsonSchema?: object;
  model?: string;
}

/**
 * Appel unique à l'API Anthropic via le command Rust (contourne le CORS WebView2).
 * thinking désactivé = coût minimal (on ne facture que la sortie). Retourne le
 * texte concaténé des blocs assistant (= le JSON si jsonSchema est fourni).
 */
export async function callAnthropic(userContent: string, opts: AnthropicOptions = {}): Promise<string> {
  const apiKey = await getSetting(ANTHROPIC_API_KEY_SETTING);
  if (!apiKey) throw new Error('Aucune clé API Anthropic configurée.');

  const body: Record<string, unknown> = {
    model: opts.model ?? ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: userContent }],
  };
  if (opts.system) body.system = opts.system;
  if (opts.jsonSchema) {
    body.output_config = { format: { type: 'json_schema', schema: opts.jsonSchema } };
  }

  const raw = await invoke<string>('anthropic_message', {
    apiKey,
    body: JSON.stringify(body),
  });

  let parsed: {
    type?: string;
    error?: { message?: string };
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Réponse illisible de l\'API Anthropic.');
  }

  if (parsed.type === 'error') {
    throw new Error(parsed.error?.message ?? 'Erreur API Anthropic.');
  }
  if (parsed.stop_reason === 'refusal') {
    throw new Error('Requête refusée par le modèle.');
  }

  return (parsed.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('');
}
