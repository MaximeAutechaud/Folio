# POC scanner de cassures narratives

**Branche :** `poc-scanner-breakouts`  
**Statut :** preuve de concept, paramètres non validés financièrement.

## Objectif

Détecter des groupes de titres qui :

1. viennent de franchir une base ;
2. connaissent une expansion robuste de dollar-volume ;
3. améliorent leur force relative face au marché et à leur secteur ;
4. restent corrélés après retrait de ces deux facteurs ;
5. effectuent cette transition dans une fenêtre temporelle rapprochée.

Le résultat est un routeur d'attention. Un cluster n'est pas une recommandation.

## Configuration centrale

### Univers

- prix ajusté minimum : 5 USD ;
- historique minimum : 260 séances ;
- dollar-volume médian sur 60 séances : 10 M USD/jour.

### Cassure

- pivot : plus haut des 120 séances précédentes, séance courante exclue ;
- fraîcheur : 10 séances depuis le franchissement ;
- réservoir de propagation : 15 séances ; un membre âgé de 11 à 15 séances
  apporte du contexte mais ne compte plus dans la breadth des cassures fraîches ;
- base : 120 séances, profondeur maximale 35 % ;
- tendance : cours au-dessus de l'EMA50, EMA50 supérieure à sa valeur 20 séances auparavant ;
- extension : exprimée en unités d'amplitude moyenne des variations de clôture sur 20 séances.

Le cache ne contient pas `high`/`low`. L'extension n'est donc pas un ATR véritable,
mais un proxy explicitement présenté comme tel.

### Liquidité

Baseline robuste : médiane et MAD du dollar-volume sur les 60 séances précédant
la fenêtre récente.

Deux chemins de qualification :

- impulsion : au moins 2 jours sur 5 avec `z robuste >= 1,5` et ratio moyen `>= 1,4` ;
- accumulation : au moins 4 jours sur 10 avec `z robuste >= 1,0` et ratio moyen `>= 1,3`.

### Force relative

- pente à 20 séances positive contre SPY ;
- pente à 20 séances positive contre l'ETF sectoriel ;
- pente sectorielle 10 séances supérieure à la pente 40 séances ;
- momentum résiduel 20 séances positif ;
- rang transversal du momentum résiduel au moins au 70e percentile.

Le POC n'a pas encore d'historique quotidien du rang transversal. Le champ
`rankImprovement` utilise donc le percentile transversal de l'accélération de
force relative comme proxy. Il ne doit pas être interprété comme une variation
historique de rang.

### Cluster

- corrélation résiduelle calculée sur 60 séances ;
- séries alignées par timestamp et par intervalle de cotation ;
- lien minimal : 0,40 ;
- cohésion moyenne minimale : 0,45 ;
- corrélation moyenne minimale de chaque membre : 0,25 ;
- taille : 3 à 12 titres ;
- dispersion maximale des dates de cassure : 15 séances.

### Score

Score sur 100 :

- cohésion : 25 ;
- breadth des cassures : 20 ;
- expansion de liquidité : 20 ;
- rang résiduel : 15 ;
- fraîcheur collective : 10 ;
- compression de base : 5 ;
- accélération relative : 5.

Interprétation :

- moins de 65 : observation ;
- 65 à 79 : candidat ;
- 80 et plus : confirmé.

## Différences avec le scanner précédent

- recherche une cassure plutôt qu'un repli sous le plus haut ;
- mesure la fraîcheur par l'âge du franchissement ;
- accepte une impulsion de volume ou une accumulation progressive ;
- exige une amélioration relative contre deux contrôles ;
- réduit la taille minimale du cluster de quatre à trois ;
- aligne les rendements par date avant toute corrélation ;
- rejette un membre faiblement relié au reste du groupe ;
- ajoute une cohérence temporelle des cassures ;
- classe les clusters avec un score explicable.

## Protocole de validation

Cette branche ne doit pas être jugée sur un seul thème mémoire.

Première passe :

- nombre de candidats quotidiens ;
- nombre de clusters annuels ;
- taille des clusters ;
- distribution des scores ;
- taux de blobs rejetés ;
- âge médian des cassures au moment de la détection ;
- stabilité selon les années ;
- interprétabilité humaine des groupes.

Critères de faisabilité proposés :

- 3 à 30 clusters par an ;
- taille médiane comprise entre 3 et 8 ;
- aucun cluster de plus de 12 membres ;
- absence de détection quotidienne permanente ;
- détection avant que la médiane des membres soit manifestement consommée.

La performance future constitue une seconde hypothèse. Elle ne doit être testée
qu'après gel de la définition et sur une période non utilisée pour choisir les
seuils.

## Limites connues

- univers historique construit avec les constituants actuels ;
- pas de véritable ATR faute de `high`/`low` dans le cache ;
- pas encore de variation historique du rang transversal ;
- composantes connexes : un sous-thème dense noyé dans un blob peut être rejeté ;
- paramètres non calibrés et non validés hors échantillon ;
- aucune promesse d'alpha.
