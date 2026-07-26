/**
 * Périmètre de validation du scanner — **gelé avant toute optimisation**.
 *
 * Ce fichier ne contient aucune logique. Il existe pour qu'une révision des
 * critères après avoir vu les résultats apparaisse au diff, et pour que la date
 * du commit atteste qu'ils précèdent le réglage qu'ils jugent. Un critère choisi
 * après coup n'est pas un critère, c'est une description.
 *
 * ## Pourquoi ce garde-fou ici précisément
 *
 * Les corrections apportées jusqu'ici relevaient de la **définition** : rejeter
 * un « cluster » de 166 titres à 0,06 de cohésion, ou ajuster un ticker que
 * Yahoo ne résout pas, ne sont pas des choix ajustés aux données. Le chantier
 * suivant — remplacer le contrôle sectoriel — en est un : il est motivé par ce
 * qu'on a observé, sur les données qu'on a observées.
 *
 * C'est exactement le moment où l'expérience des signaux sectoriels s'est
 * révélée coûteuse : y ajuster des seuils jusqu'à ce que 2021 fonctionne, puis
 * découvrir que rien ne tenait ailleurs. On ne recommence pas.
 */

/**
 * Fin de la fenêtre de calibrage. Tout réglage se juge sur 2024-07 → 2025-12.
 *
 * ~250 séances, ~34 détections avec les seuils actuels : peu, mais c'est ce dont
 * on dispose, et c'est une raison de traiter les résultats comme indicatifs, pas
 * d'élargir la fenêtre jusqu'à ce qu'ils plaisent.
 */
export const CALIBRATION_END = '2025-12-31';

/**
 * Début du segment hors-échantillon. **Cartouche unique** : une fois consulté,
 * tout test ultérieur sur cette période est in-sample et ne prouve plus rien.
 *
 * ~130 séances, ~15 détections. À ne dépenser que sur un réglage figé, jamais
 * pour arbitrer entre deux variantes.
 */
export const OUT_OF_SAMPLE_FROM = '2026-01-01';

/**
 * Critères de réussite du remplacement du contrôle sectoriel, déclarés le
 * 26 juillet 2026, avant implémentation.
 *
 * Les deux sont **conjonctifs**, et le second existe parce que le premier est
 * trivialement satisfiable : résidualiser assez fort fait disparaître toutes les
 * détections, banques comprises. Un scanner qui ne trouve plus rien n'a pas
 * réglé le problème, il l'a supprimé avec le reste.
 */
export const CONTROL_CRITERIA = {
  /**
   * Part des détections dont le secteur dominant est `xlf`.
   *
   * Référence mesurée avant changement : 9 sur 34 en calibrage, soit 26 %. Ces
   * clusters sont des banques régionales que XLF — dominé par Berkshire,
   * JPMorgan, Visa et Mastercard — ne représente pas, et ne retire donc pas.
   */
  maxFinancialsShare: 0.10,

  /**
   * Détections minimales sur la fenêtre de calibrage.
   *
   * Référence avant changement : 34. Le plancher tolère une perte de 40 %, au-delà
   * de quoi on a sur-résidualisé — retiré tant de facteurs qu'il ne reste plus
   * rien à corréler.
   */
  minDetections: 20,
} as const;

/** Références mesurées avant tout changement, pour que la comparaison soit vérifiable. */
export const BASELINE_BEFORE_CONTROLS = {
  detectionsCalibration: 34,
  financialsShareCalibration: 9 / 34,
  detectionsOutOfSample: 15,
} as const;
