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

/**
 * ## RÉSULTAT — chantier abandonné le 26 juillet 2026
 *
 * Testé : remplacer l'ETF sectoriel par un composite **équipondéré** des membres
 * du secteur présents dans l'univers. Motif : un ETF pondéré par la
 * capitalisation ne représente pas son secteur mais ses plus grosses lignes, donc
 * XLF ne retire pas le facteur « banques régionales ».
 *
 * **Échec du critère**, mesuré sur le calibrage seul :
 *
 * ```text
 * détections   34 → 32     (>= 20)   OK
 * part xlf     26 % → 22 % (<= 10 %) ÉCHEC
 * ```
 *
 * Les clusters de banques ont bien diminué — et l'**assurance** a pris leur
 * place. Le composite retire le facteur « financières en moyenne », pas la
 * scission interne banques/assureurs, qui réagissent en sens opposé aux taux.
 * La pondération était corrigée, la granularité non.
 *
 * ## Pourquoi on n'est pas allé plus loin
 *
 * En vérifiant, le problème s'est révélé **mal posé dès le départ** : la part des
 * financières n'avait jamais été comparée à leur poids dans l'univers.
 *
 * ```text
 * secteur   détections   poids univers   ratio
 * xlv            18,8 %        10,5 %     1,79   ← plus déviant, jamais remarqué
 * xlf            21,9 %        15,6 %     1,40
 * xlk            15,6 %        13,6 %     1,15
 * xli            15,6 %        18,6 %     0,84
 * ```
 *
 * À 32 détections sur 11 secteurs, l'espérance est de 2,9 par secteur et le bruit
 * de Poisson de ±1,7 : xlf est à +0,9 écart-type de son attendu. **Aucun secteur
 * n'est significativement sur-représenté.** Le « 18 % de banques régionales » qui
 * a motivé le chantier était un chiffre sans dénominateur.
 *
 * S'y ajoutent deux raisons de fond :
 *
 * - **Le coût d'un faux positif est de cinq secondes.** Le scanner est un routeur
 *   d'attention, pas un système d'exécution : devant `FITB MTB PNC RF` on
 *   reconnaît des banques et on passe. Sept clusters de ce type par an ne
 *   justifient pas une table industrie à maintenir.
 * - **Le trou est sans fond et sur-résidualiser a un coût.** Banques corrigées →
 *   assurance ; assurance corrigée → marchés de capitaux, types de REIT, logiciel
 *   contre semis. Chaque niveau retire de la variance, et le cluster mémoire — la
 *   seule détection dont on sait qu'elle était juste — finirait par disparaître
 *   avec le bruit.
 *
 * **Ne pas rouvrir sans une raison neuve**, et surtout pas sur la seule
 * observation qu'un secteur revient souvent : la comparer d'abord à son poids.
 *
 * La cartouche hors-échantillon est **intacte** — rien de tout ceci ne l'a
 * consultée.
 */
export const CONTROLS_OUTCOME = 'abandonne-2026-07-26' as const;

/**
 * ## Mode « naissance » — paramètres gelés le 27 juillet 2026, avant implémentation
 *
 * Le mode actuel exige d'être **3 % sous** le plus haut 52 semaines. Une naissance
 * de mouvement étant par définition une cassure vers de nouveaux plus hauts, ce
 * filtre l'exclut par construction : il ne laisse passer que les replis dans un
 * mouvement déjà installé. C'est ce qui explique que le cluster mémoire ne soit
 * détecté que le 2026-02-04, après +255 % sur MU.
 *
 * ### D'où viennent ces valeurs
 *
 * Elles ne sont **pas** choisies par moi. Ce sont des conventions de praticiens,
 * codifiées il y a des décennies :
 *
 * - **O'Neil (CAN SLIM)** : point d'achat au sommet de la base, et ne jamais
 *   acheter à plus de **5 %** au-dessus de ce pivot — au-delà le titre est
 *   « étendu ». Profondeur de base admissible jusqu'à ~33 %.
 * - **Weinstein (analyse par étapes)** : l'entrée se fait à la transition
 *   étape 1 → étape 2, quand le titre casse sa base et que sa moyenne mobile
 *   30 semaines (**150 séances**) cesse de baisser.
 *
 * Leur intérêt épistémique n'est pas d'être prouvées — **elles ne le sont pas**,
 * ce sont des conventions de métier, pas des résultats académiques. Il est que
 * leurs auteurs les ont écrites sans connaître le thème mémoire. C'est du
 * pré-enregistrement gratuit, là où des seuils choisis par moi aujourd'hui
 * seraient choisis par quelqu'un qui connaît déjà la réponse.
 *
 * ### Le choix de N = 252
 *
 * Arbitré par Maxime, en connaissance du compromis : un nouveau plus haut d'un an
 * est nettement plus rare qu'une cassure à 3 mois, donc moins de signaux, mais
 * plus proche d'une vraie naissance. « Moins de signaux, qualité potentiellement
 * supérieure. » Une cassure à 60 séances risquait de reproduire l'existant en
 * attrapant des replis déguisés.
 *
 * ### Réserve connue
 *
 * Ces méthodes visent des small et mid caps de croissance. Notre univers est le
 * S&P 900 : sociétés plus grosses, bases moins profondes, mouvements amortis. Les
 * règles structurelles se transposent ; les profondeurs de base sont peut-être
 * trop larges pour ce type de titre.
 */
export const BIRTH_PARAMS = {
  /** Pivot = plus haut des 252 séances précédentes. Cassure = le dépasser. */
  pivotBars: 252,
  /** Zone d'achat O'Neil : au-delà, le mouvement est déjà entamé. */
  maxAbovePivot: 5,
  /** Fenêtre servant à juger la base qui précède la cassure. */
  baseBars: 120,
  /** Profondeur de base admissible, en % du plus haut de la base. */
  maxBaseDepth: 35,
  /** Moyenne mobile de régime — les 30 semaines de Weinstein. */
  trendBars: 150,
  /** Recul sur lequel la MM150 ne doit pas baisser. */
  trendLookback: 21,
} as const;

/**
 * Critère primaire, déclaré avant la passe.
 *
 * La naissance du thème mémoire — septembre à novembre 2025 — tombe dans la
 * fenêtre de calibrage, donc la question se tranche **sans toucher au
 * hors-échantillon**.
 */
export const BIRTH_CRITERIA = {
  /** Le cluster mémoire doit être détecté avant cette date (référence : 2026-02-04). */
  memoryDetectedBefore: '2025-12-01',
  /** Garde-fou : ni zéro détection, ni une avalanche. */
  minDetections: 3,
  maxDetections: 60,
} as const;
