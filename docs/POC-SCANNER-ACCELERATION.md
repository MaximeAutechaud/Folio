# POC scanner d'accélération post-cassure

**Branche :** `poc-scanner-breakouts`  
**Statut :** **invalidé hors échantillon.** Le rejeu 2009-2024 ne montre aucune
valeur prédictive, ni pour l'écran d'accélération ni pour le clustering. Voir
`POC-SCANNER-ACCELERATION-BACKTEST.md`. Ce document reste la description exacte
de ce qui a été testé.  
**Dernière révision :** 27 juillet 2026 — correction des deux critères de
grappe tautologiques, du dénominateur des percentiles et de la fenêtre
d'estimation des bêtas.

## Hypothèse

Les membres d'une narrative ne cassent pas tous le même jour. Un moteur qui
cherche la cassure exacte exige une simultanéité artificielle. Le POC
d'accélération cherche un régime collectif plus durable :

- tendance déjà positive ;
- accélération du prix normalisée par la volatilité ;
- force relative positive contre SPY et le secteur ;
- persistance sur plusieurs séances ;
- expansion récente du dollar-volume ;
- cohésion résiduelle du groupe.

Il accepte une entrée plus tardive en échange d'une meilleure observabilité.

## Paramètres pré-enregistrés

### Régime

- prix minimum : 5 USD ;
- dollar-volume médian 60 séances : 10 M USD ;
- historique minimum : 260 séances ;
- clôture au-dessus de l'EMA50 ;
- EMA50 supérieure à sa valeur 20 séances auparavant ;
- distance au plus haut 120 séances supérieure ou égale à −10 %.

### Accélération

```text
accélération normalisée =
    (pente log-prix 10j − pente log-prix 40j)
    / volatilité journalière 20j
```

- seuil : `>= 0,5` ;
- pente RS contre SPY à 20 séances positive ;
- pente RS contre secteur à 20 séances positive ;
- conditions vraies au moins trois jours sur les cinq derniers.

### Liquidité

Qualification valable dix séances :

- impulsion : 2 jours sur 5 à `z >= 1,5`, ratio moyen `>= 1,3` ;
- accumulation : 4 jours sur 10 à `z >= 0,8`, ratio moyen `>= 1,2`.

### Rang transversal

- percentile d'accélération ;
- percentile de momentum résiduel 20 séances.

Depuis la v2, ces deux rangs servent au tri et au score, pas à l'admission. La
v1 supprimait 82 % des accélérations qualifiées avant le clustering et ne
produisait que trois épisodes. Un scanner exploratoire accepte davantage de
déchet plutôt que d'empêcher un groupe cohérent de remonter.

**Dénominateur.** Les percentiles sont calculés sur l'univers éligible de la
séance — prix, profondeur d'historique et dollar-volume médian 60 séances, soit
898 instruments en moyenne — et non sur le seul réservoir qualifié. Ce dernier
compte entre 4 et 60 titres selon les jours : une séance à quatre candidats
produisait quatre percentiles proches de 100, et les scores n'étaient donc pas
comparables d'une séance à l'autre. Le socle de référence est volontairement
disjoint des portes d'admission, qui restent inchangées.

Conséquence à ne pas perdre de vue : sur un dénominateur de 898 instruments, un
titre qui accélère est mécaniquement au sommet du classement. Les 45 % du score
portés par les deux percentiles saturent, et l'échelle du score s'est déplacée
vers le haut. Les bornes d'affichage héritées (65 / 80) ne veulent plus rien
dire et restent à recalibrer.

### Cluster

- fenêtre d'estimation des bêtas résiduels : 250 séances ;
- corrélation résiduelle : 60 séances ;
- lien minimal : 0,40 ;
- cohésion minimale : 0,45 ;
- corrélation moyenne minimale par membre : 0,25 ;
- taille : 3 à 12 membres ;
- dispersion maximale des qualifications : 15 séances ;
- largeur d'accélération minimale : 50 % ;
- fraîcheur de liquidité minimale : 0,50.

Ces deux derniers critères étaient tautologiques dans la version initiale et
sont corrigés :

- la **largeur d'accélération** comptait les membres à `trueDays >= 3`, qui est
  déjà une condition d'admission — elle valait donc toujours 1. Elle mesure
  désormais la part du groupe dont les conditions d'accélération sont encore
  vraies à la dernière séance ;
- la **fraîcheur de liquidité** comptait les membres à `liquidityAge <
  validityBars`, vrai par construction puisque la recherche de liquidité ne va
  pas au-delà. Elle devient une mesure continue, `moyenne(1 − âge /
  validityBars)` : 0,50 signifie un âge moyen de qualification inférieur à cinq
  séances. Pas de nouveau paramètre.

La largeur d'accélération pèse 15 % du score : tant qu'elle valait 1, ces 15
points étaient une constante ajoutée à toutes les grappes.

**Fenêtre d'estimation.** `alignedResiduals` régressait sur toute la série
fournie par l'appelant : la profondeur d'estimation des bêtas valait donc « ce
que le contexte d'appel avait sous la main » — 261 à 459 séances selon le moment
du rejeu, quinze ans sur un snapshot long. Deux rejeux de longueurs différentes
ne mesuraient pas la même chose. La fenêtre est désormais bornée à 250 séances,
passée explicitement par le moteur d'accélération. Le comportement du moteur de
cassure est inchangé : sans borne, `alignedResidualReturns` garde sa sémantique
d'origine.

Le score sert uniquement au tri. Aucun seuil d'affichage ou d'alerte n'est
déclaré avant validation.

## Protocole comparatif

Les moteurs cassure et accélération sont rejoués avec :

- le même snapshot ;
- les mêmes séances ;
- le même univers ;
- la même entrée à l'ouverture J+1 ;
- les mêmes sorties J+20/J+40 ;
- la même fusion des clusters évolutifs en épisodes.

La période a déjà été consultée lors du POC cassure. Le comparatif évalue donc
la faisabilité et la différence de comportement, pas une performance
hors-échantillon.

## Contrôles par tirage aléatoire

Le backtest mesure la sortie de deux étapes empilées : un **filtre**
d'accélération, puis un **regroupement** par corrélation résiduelle. Rien dans
le comparatif ne dit laquelle des deux produit le résultat, alors que c'est le
regroupement qui porte la thèse du produit. Deux contrôles emboîtés les
séparent, en rejouant les mêmes dates de détection avec des paniers de même
taille tirés au hasard :

- **A** — urne = réservoir qualifié de la séance : le clustering sélectionne-t-il
  mieux que le hasard à l'intérieur du réservoir ? Une variante retire les
  membres de la grappe de l'urne, pour éliminer la contamination du tirage.
- **B** — urne = univers éligible de la séance : l'écran d'accélération
  sélectionne-t-il quoi que ce soit ? C'est aussi le contrôle de bêta et de
  régime, les dates de détection n'étant pas des dates quelconques.

Une « stratégie synthétique » est un tirage par épisode, agrégé comme l'est le
scanner ; 10 000 stratégies donnent la distribution nulle et le p-value
empirique. Le tirage réutilisant les dates réelles, la date de détection n'est
jamais créditée au scanner. Générateur à graine fixe : les chiffres sont
reproductibles.
