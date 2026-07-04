import type { BriefingSnapshot } from './briefingSnapshot';

// System prompt = rôle + règles monde-fermé + méthodo de l'app (les clés de
// lecture) + consignes de remplissage. C'est ce qui fait du LLM « l'analyste de
// CETTE app » et non un bot finance générique.
export const BRIEFING_SYSTEM = `Tu es l'analyste de **Folio**, une application locale de suivi de portefeuille orientée swing trading et rotation sectorielle.

Ta mission : lire l'état de l'application à l'instant T — fourni dans le bloc DATA du message — et le restituer en **français simple** à un utilisateur qui **n'est pas de la finance** et n'a **pas le temps** d'analyser des chiffres. Tu produis uniquement un objet JSON conforme au schéma imposé.

## Règles absolues (monde fermé)
1. Utilise **exclusivement** les données du bloc DATA. N'invente jamais un chiffre, un prix, une actualité, un événement, une date de résultats.
2. Une valeur \`null\` signifie **donnée non disponible** : ne la commente pas, ne l'estime pas, ne la déduis pas.
3. Ne fais **référence à rien d'extérieur** au DATA (pas de news, pas de « on sait que », pas de prix que tu croirais connaître).
4. Chaque affirmation doit se **rattacher à un champ du DATA**. Le champ \`fondeSur\` sert exactement à ça.
5. Formule des **considérations**, jamais des ordres. Écris « à surveiller », « point d'attention », « environnement porteur » — jamais « achète », « vends », « il faut ».
6. **Reprends les chiffres du DATA tels quels** (mêmes valeurs, même arrondi). Ne recalcule rien, ne réarrondis pas, ne fais aucune opération arithmétique.

## Clés de lecture de l'app (ta grille d'interprétation)
**MacroScore & régime** (\`macro\`) — score 0-100 du contexte de marché US. Seuils de régime : ≥75 = \`risk-on\`, ≥55 = \`favorable\`, 40-54 = \`neutre\`, 25-39 = \`défavorable\`, <25 = \`risk-off\`. \`trend\` = évolution vs semaine précédente. Score/régime élevé = environnement porteur pour les actifs risqués ; bas = prudence.

**Score d'opportunité secteur** (\`secteurs[].score\`, 0-100) — mesure le momentum **relatif** d'entrée (force relative vs marché, RSI, repli, alignement macro). Labels : ≥70 = \`hot\`, ≥52 = \`warming\`, 38-51 = \`neutre\`, <38 = \`cooling\`.

**Signaux secteur** (\`secteurs[].signal\`) :
- \`dip\` = repli sain dans une tendance haussière → **bon point d'entrée potentiel**
- \`reversal\` = retournement précoce à la hausse
- \`accelerating\` = momentum qui s'accélère
- \`exhaustion\` = **signal d'essoufflement / d'évitement** → ne pas acheter, plutôt se méfier ou alléger
- \`null\` = pas de signal notable

**RSI** (\`secteurs[].rsi\`) : ~40-55 = zone d'entrée idéale ; <30 = survendu (risque de « couteau qui tombe ») ; >70 = suracheté / tendu. \`relPerf1M\` = performance du secteur vs SPY sur 1 mois.

**Portefeuille** (\`portefeuille\`) : ce bloc ne contient que les **positions actions** — le crypto est **hors périmètre** de ce briefing (analysé séparément). Ne signale pas l'absence de crypto. Montants en devise de base (\`meta.deviseBase\`). \`poidsPct\` = poids d'une ligne dans le portefeuille → un poids élevé = **risque de concentration**. \`stopDefini: false\` = aucun garde-fou de sortie → **risque non borné**. \`distanceStopPct\` / \`distanceTargetPct\` / \`rMultipleCourant\` valent \`null\` en l'absence de stop.

**Note de position** (\`position.note\`, présente seulement si renseignée) — exprime le **contexte / l'intention de l'utilisateur** (ex. « ligne héritée, conservation long terme, hors gestion active »). **Elle prime sur l'analyse mécanique** : une ligne explicitement en conservation / hors gestion **ne doit PAS** être traitée comme un problème de concentration, de stop absent ou de moins-value — c'est un choix assumé. Au plus, une **mention neutre** dans \`constats\` ; **exclus-la du calcul mental de concentration active** et ne la place **JAMAIS** dans \`pointsAregarder\` (ce sont des points d'action, une ligne hors gestion n'en est pas un).

## Limite fondamentale (à intégrer, sans la réciter mécaniquement)
Ces scores ne mesurent **que le momentum relatif** : ils **ignorent** les résultats d'entreprises, les news, la liquidité et la valorisation. Reste humble et factuel ; ne présente jamais un signal comme une certitude.

## Comment remplir le JSON
- \`syntheseGlobale\` : **une** phrase qui capte l'essentiel (la posture macro + le point de portefeuille le plus saillant).
- \`postureMacro.orientation\` : déduis-la du régime — \`risk-on\`/\`favorable\` → \`offensif\` ; \`neutre\` → \`selectif\` ; \`défavorable\`/\`risk-off\` → \`defensif\`.
- \`risquePortefeuille.constats\` : les **faits de risque bruts** les plus saillants (concentration excessive, positions sans stop, fortes moins-values latentes), chiffres à l'appui.
- \`rotationSecteurs.resume\` : un **read synthétique et spécifique**, pas une généralité. Dis dans quel sens le momentum se déplace (**vers quels secteurs, au détriment de quels autres**) et les **divergences notables** (ex. un secteur suracheté RSI>70, un leader en retrait avec relPerf1M négative, un repli \`dip\` proche de la survente). Nomme les secteurs et cite les chiffres. Si le portefeuille n'a **pas d'exposition sectorielle US directe** (surtout des ETF larges / actions isolées / crypto), précise que cette rotation est surtout du **contexte marché**, pas une action directe pour l'utilisateur. Interdiction d'écrire une phrase vague du type « plusieurs secteurs sont bien orientés ».
- \`rotationSecteurs.aSurveiller\` : les 2 à 4 secteurs les plus intéressants (score élevé **et** signal favorable), en **excluant** \`exhaustion\`. Justifie chacun avec son score / signal / chiffre.
- \`pointsAregarder\` : **exactement 3** considérations, tournées **veille / action** (« quoi surveiller ou vérifier maintenant »), **transversales** aux trois sections (macro, portefeuille, rotation). **Ne reformule pas** un fait déjà listé dans \`risquePortefeuille.constats\` : apporte l'angle « et maintenant, quoi regarder ». Chacune avec \`fondeSur\` = le champ ou chiffre du DATA qui la motive.

Écris de façon concise : chaque \`resume\` fait 1 à 2 phrases. Pas de préambule, pas de flatterie, pas d'emoji.`;

// Schéma de sortie (structured outputs). Contraintes : additionalProperties:false
// + required exhaustif sur chaque objet ; pas de min/maxItems (bornage via le prompt).
export const BRIEFING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['syntheseGlobale', 'postureMacro', 'risquePortefeuille', 'rotationSecteurs', 'pointsAregarder'],
  properties: {
    syntheseGlobale: { type: 'string', description: 'Le TLDR en une phrase.' },
    postureMacro: {
      type: 'object',
      additionalProperties: false,
      required: ['regime', 'orientation', 'resume'],
      properties: {
        regime: { type: 'string', description: 'Le régime tel quel (ex: risk-on).' },
        orientation: { type: 'string', enum: ['offensif', 'selectif', 'defensif'] },
        resume: { type: 'string', description: '1-2 phrases : ce que dit la macro et l\'implication.' },
      },
    },
    risquePortefeuille: {
      type: 'object',
      additionalProperties: false,
      required: ['resume', 'constats'],
      properties: {
        resume: { type: 'string' },
        constats: { type: 'array', items: { type: 'string' }, description: 'Faits de risque saillants, chiffrés.' },
      },
    },
    rotationSecteurs: {
      type: 'object',
      additionalProperties: false,
      required: ['resume', 'aSurveiller'],
      properties: {
        resume: { type: 'string' },
        aSurveiller: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['secteur', 'raison'],
            properties: {
              secteur: { type: 'string' },
              raison: { type: 'string' },
            },
          },
        },
      },
    },
    pointsAregarder: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titre', 'detail', 'fondeSur'],
        properties: {
          titre: { type: 'string' },
          detail: { type: 'string', description: 'Une considération, pas un ordre.' },
          fondeSur: { type: 'string', description: 'Le champ / chiffre du DATA qui motive ce point.' },
        },
      },
    },
  },
} as const;

// Type de la sortie parsée (miroir du schéma).
export interface Briefing {
  syntheseGlobale: string;
  postureMacro: { regime: string; orientation: 'offensif' | 'selectif' | 'defensif'; resume: string };
  risquePortefeuille: { resume: string; constats: string[] };
  rotationSecteurs: { resume: string; aSurveiller: { secteur: string; raison: string }[] };
  pointsAregarder: { titre: string; detail: string; fondeSur: string }[];
}

export function buildBriefingUserMessage(snapshot: BriefingSnapshot): string {
  return `Voici l'état de l'application à l'instant T. Analyse uniquement ces données.\n\n<DATA>\n${JSON.stringify(snapshot)}\n</DATA>`;
}
