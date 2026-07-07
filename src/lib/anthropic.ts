import { invoke } from '@tauri-apps/api/core';
import { getSetting } from './db';

// Modèle par défaut ; surchargeable via le réglage 'anthropic_model' (panneau Briefing).
// À 1 briefing/jour l'écart de coût Sonnet/Opus est négligeable — le choix est qualitatif.
export const ANTHROPIC_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_API_KEY_SETTING = 'anthropic_api_key';
export const ANTHROPIC_MODEL_SETTING = 'anthropic_model';

export const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — rapide, économique' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 — qualité max' },
] as const;

/** Modèle effectif : réglage utilisateur s'il existe, sinon le défaut. */
export async function getAnthropicModel(): Promise<string> {
  return (await getSetting(ANTHROPIC_MODEL_SETTING)) || ANTHROPIC_MODEL;
}

export interface AnthropicOptions {
  system?: string;
  maxTokens?: number;
  /** Si fourni, contraint la sortie à ce schéma JSON (structured outputs). */
  jsonSchema?: object;
  model?: string;
}

/**
 * Appel unique à l'API Anthropic via le command Rust (contourne le CORS WebView2).
 * thinking adaptatif : avec les structured outputs, priver le modèle d'espace de
 * réflexion le pousse à faire toute l'analyse DANS le premier champ string du
 * schéma — mode d'échec observé (tout le briefing entassé dans postureMacro.resume,
 * champs suivants remplis de "placeholder"). Le coût thinking est compté dans
 * max_tokens. Retourne le texte concaténé des blocs assistant (= le JSON si
 * jsonSchema est fourni).
 */
export async function callAnthropic(userContent: string, opts: AnthropicOptions = {}): Promise<string> {
  const apiKey = await getSetting(ANTHROPIC_API_KEY_SETTING);
  if (!apiKey) throw new Error('Aucune clé API Anthropic configurée.');

  const body: Record<string, unknown> = {
    model: opts.model ?? (await getAnthropicModel()),
    max_tokens: opts.maxTokens ?? 4096,
    thinking: { type: 'adaptive' },
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
  if (parsed.stop_reason === 'max_tokens') {
    throw new Error('Réponse tronquée (max_tokens atteint) — augmenter maxTokens.');
  }

  return (parsed.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('');
}
