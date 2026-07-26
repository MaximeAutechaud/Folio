# Audit du système de signaux de rotation sectorielle

**Date :** 26 juillet 2026  
**Périmètre :** signaux `reversal`, `dip`, `accelerating` et `exhaustion`, journalisation, reconstruction historique et mesure de leur performance future.

## 1. Résumé exécutif

Le système de journalisation remplit correctement son rôle : il permet désormais de mesurer honnêtement les signaux sur des séances clôturées, de reconstruire leur historique sans utiliser de données futures et de ne compter qu'une fois un signal persistant.

Cette mesure révèle toutefois que les règles de détection actuelles ne produisent pas d'avantage prédictif global exploitable. Sur la reconstruction couvrant 3 888 séances :

| Signal | Épisodes | Score moyen | Win rate J+10 | RelPerf J+5 | RelPerf J+10 | RelPerf J+20 |
|---|---:|---:|---:|---:|---:|---:|
| Dip | 2 859 | 64 | 50 % | −0,0 % | −0,1 % | −0,1 % |
| Reversal | 1 787 | 72 | 47 % | −0,1 % | −0,1 % | −0,2 % |
| Accelerating | 1 085 | 63 | 50 % | −0,2 % | −0,1 % | −0,1 % |
| Exhaustion | 618 | 30 | 50 % | +0,1 % | +0,1 % | −0,0 % |

Pour `exhaustion`, une performance relative positive est défavorable : le signal est conçu comme un avertissement d'évitement, et sa réussite suppose une sous-performance ultérieure.

La conclusion principale n'est pas que la rotation sectorielle est indétectable. Le moteur actuel détecte surtout des configurations ponctuelles — rebond hebdomadaire, pullback ou accélération courte — alors que l'objectif du produit exige d'identifier une **transition persistante de leadership relatif**.

Le problème est donc principalement :

1. un problème de définition du phénomène recherché ;
2. un problème de sélectivité et de confirmation des signaux ;
3. un problème de méthodologie de validation ;
4. accompagné de plusieurs incohérences de calcul à corriger.

Cette conclusion ne justifie pas à elle seule une refonte longue. Le marché des
ETF sectoriels américains en clôture journalière est très étudié et très
arbitré. Les phases proposées plus loin doivent être comprises comme une suite
d'expériences falsifiables, chacune assortie d'un critère d'arrêt, et non comme
la promesse qu'un meilleur modèle produira nécessairement de l'alpha.

## 2. Ce qui fonctionne correctement

### 2.1 Journalisation sur séance clôturée

Les signaux consignés reposent sur la dernière séance terminée et non sur une bougie journalière intraday. C'est un garde-fou important : une comparaison antérieure avait montré qu'environ 19 % des signaux observés en séance n'existaient plus à la clôture.

L'affichage peut continuer à présenter une estimation intraday, mais la donnée utilisée pour les statistiques et les alertes doit rester la classification de clôture.

### 2.2 Reconstruction sans look-ahead dans les indicateurs

Pour chaque séance historique, les métriques sont calculées à partir d'une série tronquée à cette date. Les fenêtres de calcul ne contiennent donc pas de bougies futures.

La reconstruction réutilise le même calcul que le moteur quotidien, ce qui évite de comparer deux définitions différentes d'un signal.

### 2.3 Comptage par épisodes

Un signal présent pendant cinq séances consécutives compte comme une seule détection, prise le premier jour. Sans cette réduction, cinq performances futures largement chevauchantes seraient comptées comme cinq observations alors qu'elles mesurent le même mouvement.

Cette unité d'observation est pertinente : elle correspond au moment où une décision nouvelle aurait pu être prise.

### 2.4 Séparation des secteurs et des narratives

Les seuils ont été conçus pour des ETF sectoriels. Les narratives thématiques, souvent plus volatiles et moins homogènes, ne doivent pas être agrégées avec eux tant que leurs seuils ne sont pas validés séparément.

### 2.5 Valeur du résultat négatif

Le backtest nul ne rend pas le système de log inutile. Au contraire, il démontre que cette infrastructure remplit sa mission : empêcher qu'une impression visuelle ou quelques exemples récents soient confondus avec un avantage statistique.

## 3. Interprétation des résultats

### 3.1 Aucun signal ne présente d'avantage global

Les win rates sont compris entre 47 % et 50 %, et les performances relatives moyennes sont proches de zéro ou légèrement négatives. Même si certaines différences pouvaient être statistiquement détectables grâce au grand nombre de lignes, elles ne sont pas économiquement intéressantes.

Quelques centièmes de point ne constitueraient pas un avantage exploitable après prise en compte :

- du spread ;
- du slippage ;
- du décalage entre clôture du signal et exécution réelle ;
- de la fiscalité ;
- des erreurs de données ou d'exécution.

### 3.2 Le win rate n'est pas l'espérance de gain

Un taux de réussite de 47 % ou 50 % ne suffit pas à invalider une stratégie. Une
stratégie peut être rentable avec peu de gagnants si ses gains moyens sont
nettement supérieurs à ses pertes moyennes. Inversement, 60 % de gagnants
peuvent perdre de l'argent si les rares pertes sont trop importantes.

La grandeur déterminante est l'espérance nette :

```text
E = P(gain) × gain moyen − P(perte) × perte moyenne − coûts
```

Les performances relatives moyennes proches de zéro constituent ici une
indication défavorable, mais elles ne remplacent pas un backtest de règle de
sortie. Les horizons fixes J+5/J+10/J+20 mesurent la qualité prédictive d'un
signal ; ils ne mesurent pas encore l'espérance d'un swing utilisant stop,
objectif, sortie temporelle ou sortie de régime.

### 3.3 Le score ne paraît pas ordonner la qualité future

`Reversal` possède le score moyen le plus élevé, 72, mais le plus mauvais taux de réussite et la plus mauvaise performance à J+20. Cela indique que le score mesure une apparence d'opportunité selon des règles heuristiques, mais pas encore une probabilité empirique de surperformance.

Avant toute utilisation opérationnelle, la performance doit être analysée par tranches de score. Une propriété minimale d'un bon score est la monotonie : les scores élevés doivent avoir de meilleurs résultats que les scores faibles.

### 3.4 La fréquence des signaux révèle un manque de sélectivité

Les 2 859 épisodes de `dip` et 1 787 épisodes de `reversal` montrent que les règles décrivent des états fréquents du marché. Or une transition de leadership sectoriel confirmée devrait être plus rare.

Le système répond actuellement plutôt à la question :

> Quelle configuration technique générale le secteur présente-t-il ?

L'objectif du produit demande de répondre à :

> Quel secteur vient de passer d'un régime de faiblesse à un régime de surperformance suffisamment robuste pour offrir un swing ?

### 3.5 Les observations ne sont pas totalement indépendantes

Plusieurs secteurs peuvent déclencher le même jour sous l'effet d'un choc macro commun. Les nombres d'épisodes affichés surestiment donc le nombre d'observations réellement indépendantes.

Cette dépendance ne crée pas l'absence d'avantage observée, mais elle empêche de considérer les grands `n` comme une garantie de précision sans correction statistique.

## 4. Diagnostic par type de problème

## 4.1 Problème principal : définition insuffisante du retournement

Le `reversal` actuel repose essentiellement sur deux conditions :

- le secteur sous-performe sur trois mois ;
- il surperforme sur une semaine.

Cette combinaison détecte un rebond récent d'un ancien perdant, pas nécessairement un retournement de tendance. Un rebond de quelques séances peut survenir :

- dans une tendance relative toujours baissière ;
- sous une moyenne mobile importante ;
- sans amélioration de la participation des composants ;
- sans progression du rang du secteur ;
- avant une nouvelle jambe de baisse.

Un retournement pertinent doit être défini comme une **transition d'état**, par exemple d'une phase de détérioration vers une phase d'amélioration confirmée.

## 4.2 Incohérence de benchmark

La détection utilise les performances relatives à RSP, tandis que la validation future utilise SPY :

```text
Détection : ETF sectoriel − RSP
Validation : ETF sectoriel − SPY
```

Cette asymétrie peut classer comme échec un mouvement correctement détecté contre le marché équipondéré mais restant derrière SPY, notamment pendant les périodes dominées par les mégacapitalisations.

Le benchmark doit être cohérent entre les entrées et la cible. Pour une étude de rotation sectorielle, trois mesures complémentaires sont pertinentes :

1. performance contre RSP ;
2. performance contre SPY ;
3. performance contre la moyenne ou le portefeuille équipondéré des autres secteurs.

Une mesure doit être désignée comme cible principale avant le calibrage.

## 4.3 Le signal et le score utilisent des règles différentes

La classification d'un signal intervient avant que plusieurs éléments du score soient réellement pris en compte.

Exemples :

- `dip` peut être émis sous la MA50 ;
- `reversal` peut être émis sous la MA50 ;
- la macro influence le score, mais ne bloque pas nécessairement un signal incompatible ;
- deux occurrences du même signal, l'une avec un score faible et l'autre avec un score élevé, sont agrégées ensemble.

La MA50 et la macro deviennent alors des commentaires sur un signal déjà produit plutôt que des critères de qualité du setup.

## 4.4 Le `dip` n'exige pas une tendance haussière

La règle est décrite comme un « dip dans une tendance haussière », mais elle n'exige pas explicitement `ma50Above === true`. La cassure de la MA50 réduit le sous-score de drawdown sans retirer l'étiquette.

Un pullback sain et une baisse dans une tendance cassée sont donc regroupés dans la même catégorie, ce qui dilue toute éventuelle performance du premier groupe.

## 4.5 Accélération trop courte et sensible au bruit

L'accélération repose principalement sur la performance relative d'une semaine comparée au rythme hebdomadaire moyen du dernier mois. Cette mesure est sensible :

- à une seule séance extrême ;
- à un rebond de marché ;
- à une publication spécifique ;
- au point de départ des fenêtres ;
- à une accélération déjà trop avancée pour être achetée.

Elle ne mesure pas directement la pente d'une série continue de force relative ni la persistance de cette pente.

## 4.6 `Exhaustion` confond consolidation et fin de leadership

La combinaison force à trois mois, décélération courte et RSI élevé est cohérente comme alerte, mais une baisse de vitesse après une forte hausse peut être :

- une fin de mouvement ;
- une consolidation normale ;
- une rotation temporaire ;
- une pause avant continuation.

Sans cassure de tendance relative, détérioration du rang ou faiblesse de breadth, le signal ne distingue pas ces scénarios.

## 4.7 Univers non homogène

L'univers associe les secteurs classiques à des instruments thématiques comme ITA et BLOK. Ces ETF n'ont pas :

- le même rôle économique ;
- la même volatilité ;
- la même date de création ;
- la même diversification ;
- la même sensibilité aux facteurs de marché.

La recherche initiale doit porter sur les 11 secteurs GICS comparables. Les thèmes doivent ensuite être étudiés dans un second univers.

## 4.8 Données de prix et rendement total

Le téléchargement historique utilise le champ `close` de Yahoo, pas explicitement `adjclose`. Il faut vérifier et documenter le traitement effectif :

- des splits ;
- des dividendes ;
- des distributions exceptionnelles.

L'absence de rendement total peut biaiser la comparaison entre secteurs, notamment pour les ETF défensifs ou fortement distributifs.

Tous les instruments et benchmarks doivent utiliser la même définition de prix ajusté.

## 4.9 Hypothèse d'exécution

Le signal est connu après la clôture de la séance, mais la performance future commence à cette clôture. Une transaction réelle ne peut normalement être exécutée qu'après le calcul, par exemple à l'ouverture suivante.

Le backtest doit distinguer :

- date de calcul ;
- date et prix d'entrée ;
- date et prix de sortie.

Une convention prudente serait :

```text
Signal à la clôture J
Entrée à l'ouverture J+1
Sortie à la clôture J+5, J+10 ou J+20
```

Si les données d'ouverture ne sont pas disponibles, l'approximation `close J → close J+n` peut rester une mesure analytique, mais ne doit pas être présentée comme un rendement directement tradable.

## 4.10 Fenêtres calendaires

Les fenêtres de 7, 31 et 93 jours calendaires contiennent un nombre variable de séances. Pour un moteur de signaux quotidien, des fenêtres fixes en barres sont plus stables :

- 5 séances ;
- 20 ou 21 séances ;
- 63 séances ;
- 126 séances.

## 5. Architecture de détection proposée

## 5.1 Construire une série continue de force relative

Pour chaque ETF sectoriel :

```text
RS(t) = prix ajusté du secteur(t) / prix ajusté du benchmark(t)
```

À partir de cette série, calculer :

- pente courte sur 5 ou 10 séances ;
- pente intermédiaire sur 20 ou 40 séances ;
- accélération, c'est-à-dire variation de la pente ;
- distance à une EMA20 de la force relative ;
- volatilité de la force relative ;
- rang percentile du secteur dans l'univers ;
- variation du rang sur 5, 10 et 20 séances.

Cette représentation mesure directement l'évolution du leadership.

## 5.2 Transformer les étiquettes en machine à états

Une rotation se décrit mieux comme une séquence que comme quatre règles indépendantes.

Exemple de machine à états :

```text
Lagging → Bottoming → Emerging → Leading → Weakening → Lagging
```

Définitions initiales possibles :

### Lagging

- pente RS intermédiaire négative ;
- rang dans la moitié basse ;
- prix relatif sous son EMA20.

### Bottoming

- pente RS intermédiaire encore négative ou plate ;
- pente courte devenue positive ;
- accélération positive ;
- rang stabilisé ou en légère progression.

### Emerging

- pentes courte et intermédiaire positives ;
- RS au-dessus de son EMA20 ;
- rang en hausse significative ;
- confirmation pendant au moins deux clôtures.

### Leading

- rang dans le premier tiers ;
- pente intermédiaire positive ;
- force relative au-dessus de sa tendance.

### Weakening

- secteur encore bien classé ;
- pente courte devenue négative ;
- baisse de rang ;
- détérioration de breadth.

Le signal swing prioritaire serait la transition :

```text
Bottoming → Emerging
```

Le signal d'allègement serait plutôt :

```text
Leading → Weakening
```

## 5.3 Séparer setup et déclencheur

Le moteur doit distinguer deux niveaux.

### Setup de rotation

- amélioration de la force relative ;
- progression du rang ;
- stabilisation de la tendance intermédiaire ;
- contexte macro acceptable ;
- breadth interne en amélioration.

### Déclencheur d'entrée

- franchissement d'un plus haut à 5 ou 10 séances ;
- reprise d'une EMA20 ;
- retour au-dessus de la MA50 ;
- cassure d'une résistance ;
- expansion de volume ;
- chandelier de retournement confirmé.

Le setup sélectionne les secteurs à surveiller. Le déclencheur indique quand le swing devient actionnable.

## 5.4 Breadth sectorielle : piste conditionnelle, non backtestable avec les données actuelles

La hausse d'un ETF peut être portée par une ou deux capitalisations. Une véritable rotation sectorielle devrait être confirmée par ses composants.

Mesures candidates :

- pourcentage des composants au-dessus de leur MA20 ;
- pourcentage au-dessus de leur MA50 ;
- proportion dont la pente de force relative est positive ;
- proportion atteignant un plus haut à 20 séances ;
- performance médiane des composants ;
- ligne avance/déclin ;
- évolution de ces mesures sur 5 et 10 séances.

Une breadth qui passe, par exemple, de 25 % à 55 % apporte une confirmation plus forte qu'un simple rebond de l'ETF.

Cette piste ne doit toutefois **pas** être intégrée au backtest historique avec
la liste des composants présente dans `sectors.ts`. Cette liste décrit la
composition connue en 2026. L'appliquer à 2010 introduirait :

- un biais de survivance, puisque les entreprises sorties des indices seraient
  absentes ;
- un look-ahead majeur, puisque les futurs gagnants et futurs membres seraient
  connus dès le début du test ;
- des erreurs lors des changements de ticker, fusions, scissions et entrées en
  bourse.

Une breadth historique honnête exige une base de compositions **point-in-time**,
avec dates d'entrée et de sortie de chaque constituant, ainsi que des historiques
de prix ajustés incluant les titres disparus. Le téléchargement de centaines de
tickers sur 16 ans via Yahoo serait en outre fragile, lent et exposé au rate
limiting.

En l'absence de cette base, la breadth doit être :

- soit abandonnée ;
- soit réservée à une information live, explicitement non backtestée ;
- soit remplacée par une proxy disponible historiquement, dont les limites sont
  documentées.

Elle ne fait donc pas partie du chemin critique de la refonte proposée.

## 5.5 Employer la macro comme filtre contextuel

Le découpage actuel `risk_on`, `defensive`, `neutral` est utile mais trop général pour certaines industries.

La macro peut servir à :

- bloquer un setup cyclique dans un risk-off marqué ;
- renforcer les secteurs défensifs lorsque la breadth globale se détériore ;
- contextualiser les financières avec la courbe des taux ;
- contextualiser l'immobilier avec les taux longs ;
- contextualiser l'énergie avec le pétrole et les anticipations d'inflation.

Il est préférable que la macro module ou filtre un setup déjà observable dans les prix plutôt qu'elle ne crée directement le signal.

## 5.6 Introduire persistance et hystérésis

Pour réduire le bruit :

- exiger deux ou trois clôtures de confirmation ;
- utiliser des seuils différents pour entrer et sortir d'un état ;
- imposer une durée minimale avant de réémettre le même signal ;
- distinguer une transition nouvelle d'un état persistant.

Exemple :

```text
Entrée Emerging : pente20 > +seuil et rang en hausse pendant 2 séances
Sortie Emerging : pente20 < −seuil ou rang en baisse pendant 2 séances
```

L'hystérésis évite les changements d'état quotidiens autour d'un seuil unique.

## 6. Refonte du backtest

## 6.1 Pré-enregistrer une cible primaire

Avant tout diagnostic de sous-population ou réglage de seuil, il faut déclarer :

- un univers primaire ;
- un benchmark primaire ;
- une transition précise ;
- un horizon primaire ;
- une métrique principale ;
- une convention d'entrée et de sortie ;
- un segment de données hors échantillon qui ne sera pas consulté pendant le
  calibrage.

Toutes les autres combinaisons restent exploratoires. Cette discipline évite de
tester de nombreux secteurs, horizons, benchmarks, régimes et seuils jusqu'à
trouver fortuitement un résultat positif.

Exemple de cible de recherche pour la Phase 2, à confirmer avant implémentation :

```text
Univers : 11 ETF sectoriels GICS
Signal : première transition Bottoming → Emerging
Entrée : ouverture J+1
Horizon analytique primaire : 20 séances
Benchmark : RSP
Métrique primaire : espérance relative moyenne nette
```

### Cible pré-enregistrée de la Phase 1 — figée le 26 juillet 2026

Déclarée **avant** consultation de la moindre découpe, et vivant dans le code
(`PRIMARY_TARGET`, `lib/signalSlices.ts`) plutôt que dans ce document, pour
qu'elle ne puisse pas être révisée après coup sans que le diff le montre :

```text
Univers            : scope `sector`
Signal             : reversal
Horizon primaire   : 40 séances
Benchmark          : RSP
Entrée             : ouverture J+1, sortie clôture J+40
Seuils conjonctifs : espérance ≥ +0,5 % (≈ 3× les frais aller-retour)
                     ET MFE/MAE ≥ 1,15 (3σ de 1, clustering transversal corrigé)
                     ET n ≥ 100 épisodes (plancher de puissance)
Hors échantillon   : ≥ 2022-01-01, écarté par défaut de toute découpe
```

`reversal` à J+40 est retenu parce que c'est la **seule** cellule de l'agrégat qui
dépassait 2σ (R = 1,10 ; espérance +0,3 %) — donc la seule hypothèse que les
données justifient de tester, et non un choix libre. Les seuils sont dérivés de
`μ = M × (R−1)/(R+1)` avec `M ≈ 3 %` mesuré, pas arrondis à vue.

Toute autre combinaison signal × horizon est marquée `exploratory` par le code et
n'autorise aucune conclusion sans validation sur une période neuve.

## 6.2 Cibles secondaires à mesurer

La seule condition `relPerf SPY > 0 à J+10` est insuffisante. Le backtest doit mesurer :

- performance contre RSP ;
- performance contre SPY ;
- performance contre les autres secteurs ;
- rendement absolu ;
- entrée dans le top 3 ou le premier tiers du classement ;
- maximum favorable excursion ;
- maximum adverse excursion ;
- délai avant le maximum du swing ;
- persistance à J+5, J+10, J+20 et J+40.

Pour une rotation, une cible particulièrement pertinente est :

> Le secteur entre-t-il dans le premier tiers du classement relatif au cours des 10 ou 20 séances suivantes ?

Ces mesures secondaires servent à comprendre le signal. Elles ne doivent pas
être utilisées rétroactivement pour remplacer la cible primaire lorsqu'elle
échoue.

## 6.3 Statistiques à afficher

Pour chaque signal, état ou transition :

- nombre d'épisodes ;
- taux de réussite ;
- performance moyenne ;
- performance médiane ;
- écart-type ;
- quartiles ;
- intervalle de confiance ;
- pire décile ;
- maximum adverse excursion ;
- résultat par secteur ;
- résultat par régime ;
- résultat par tranche de score ;
- résultat par année.

La médiane et les quartiles empêchent quelques mouvements extrêmes de masquer une majorité de configurations médiocres.

Pour une stratégie de swing, ajouter :

- gain moyen des gagnants ;
- perte moyenne des perdants ;
- ratio gain/perte ;
- profit factor ;
- espérance brute et nette par trade ;
- distribution des durées de détention ;
- coûts et slippage.

## 6.4 Tester la monotonie du score

Créer des tranches, par exemple :

```text
0–49
50–59
60–69
70–79
80–100
```

Un score utile doit montrer une progression raisonnablement monotone de la performance ou du taux de réussite. Dans le cas contraire, ses pondérations et transformations doivent être recalibrées ou supprimées.

## 6.5 Réduire la dépendance entre observations

Plusieurs méthodes sont possibles :

- regrouper les signaux simultanés en événements de marché ;
- calculer des erreurs standards regroupées par date ;
- limiter l'analyse à un signal sélectionné par date ;
- backtester un portefeuille sectoriel réel plutôt que des épisodes isolés.

Le portefeuille simulé est la validation la plus proche de l'usage final : sélectionner chaque semaine les meilleurs setups et tenir un nombre limité de positions.

## 6.6 Validation walk-forward

Les seuils ne doivent pas être optimisés et validés sur les mêmes données.

Exemple :

```text
2010–2017 : conception et calibrage
2018–2021 : validation intermédiaire
2022–2026 : test final hors échantillon
```

Une autre possibilité consiste à utiliser des fenêtres glissantes :

```text
Entraînement 5 ans → test 1 an → déplacement d'un an
```

Les résultats doivent être stables dans plusieurs fenêtres et ne pas dépendre d'une seule période favorable.

## 6.7 Comparaisons de référence

Le nouveau moteur doit battre des règles simples :

- acheter le secteur au meilleur momentum 3 mois ;
- acheter les trois meilleurs secteurs par rang ;
- acheter un secteur lorsque sa RS dépasse son EMA20 ;
- portefeuille équipondéré des secteurs ;
- sélection aléatoire à fréquence comparable.

Une architecture complexe n'est justifiée que si elle apporte une amélioration robuste par rapport à ces références.

## 7. Feuille de route recommandée

## Phase 0 — Corrections de mesure

1. Vérifier et adopter des prix ajustés homogènes.
2. Aligner benchmark de détection et benchmark de validation.
3. Ajouter les performances contre RSP et contre le panier sectoriel.
4. Définir une hypothèse d'exécution réaliste.
5. Remplacer les fenêtres calendaires par des fenêtres en séances.
6. Corriger l'affichage d'`exhaustion` : une performance positive doit être affichée comme défavorable.
7. Corriger le texte de reconstruction qui mentionne encore deux ans alors que l'historique commence en 2010.

**Critère de sortie :** les mêmes entrées produisent des mesures cohérentes sur
le benchmark choisi, les prix ajustés et l'hypothèse d'exécution documentée.
Tant que cette phase n'est pas terminée, les résultats actuels ne doivent pas
servir à calibrer les seuils.

## Phase 1 — Diagnostic des règles actuelles

1. Pré-enregistrer une cible primaire et un jeu hors échantillon.
2. Résultats par tranche de score.
3. Résultats par secteur.
4. Résultats par année et régime.
5. Comparaison au-dessus/sous MA50.
6. Comparaison macro favorable/défavorable.
7. Analyse des distributions et non seulement des moyennes.

Cette phase peut révéler qu'une sous-population des signaux actuels possède déjà un avantage.

**Critère d'arrêt :** si aucune sous-population définie avant consultation du
jeu final ne présente une espérance nette positive, un nombre suffisant
d'événements raisonnablement indépendants et une stabilité minimale entre
régimes, les signaux actuels restent descriptifs. Il ne faut pas poursuivre
l'optimisation de leurs seuils.

## Phase 2 — Nouveau noyau de rotation relative

1. Construire la série RS secteur/benchmark.
2. Calculer pentes, accélération et EMA de RS.
3. Calculer rang et variation de rang.
4. Implémenter la machine à états.
5. Journaliser les transitions, pas les états quotidiens.
6. Backtester `Bottoming → Emerging` et `Leading → Weakening`.

Cette phase est une expérience de recherche, pas une feature promise. Un code
plus propre et une définition plus fidèle du retournement peuvent améliorer la
mesure sans produire d'alpha.

**Critère d'arrêt :** abandonner la mise en production si la transition
pré-enregistrée ne bat pas hors échantillon les références simples, ou si son
avantage disparaît après coûts et correction de la dépendance entre épisodes.

## Phase 3 — Confirmation actionnable

1. Séparer setup et déclencheur.
2. Ajouter confirmation sur deux ou trois clôtures.
3. Ajouter reprise MA50/EMA20 ou cassure d'un plus haut court.
4. Mesurer les entrées à partir de J+1.
5. Ajouter cooldown et hystérésis.

Cette phase doit être développée avec la phase 2, car l'entrée à J+1 et le
déclencheur font partie de la définition testable du signal, pas d'un
raffinement ultérieur.

**Critère d'arrêt :** ne pas multiplier les déclencheurs après échec de la cible
primaire. Toute variante supplémentaire doit être déclarée exploratoire et
validée sur une nouvelle période.

## Phase 4 — Contexte macro seulement

1. Raffiner les filtres macro par secteur.
2. Tester leur contribution marginale hors échantillon.
3. Conserver uniquement les variables apportant une amélioration stable.

La breadth historique est abandonnée tant qu'une base de constituants
point-in-time fiable n'est pas disponible. Chaque ajout macro doit prouver qu'il
améliore les résultats hors échantillon. Il ne faut pas conserver un indicateur
uniquement parce qu'il paraît intuitif.

**Critère d'arrêt :** ne pas poursuivre l'enrichissement contextuel si le noyau
des phases 2 et 3 n'a pas déjà produit un signal survivant.

## Phase 5 — Validation portefeuille

1. Simuler une sélection top 1/top 3.
2. Définir durée maximale, sortie de régime et stop éventuel.
3. Intégrer coûts et slippage.
4. Comparer à RSP, SPY et aux règles simples.
5. Mesurer rendement, volatilité, drawdown, turnover et stabilité annuelle.

Cette phase ne doit commencer que si les phases 1 à 3 ont produit un candidat
survivant. Le simulateur doit rester un outil de validation, pas devenir une
feature produit avant la démonstration d'une utilité.

**Critère d'arrêt :** ne pas promouvoir le signal si le portefeuille ne bat pas
les références simples après coûts avec un drawdown et un turnover acceptables.

## 8. Critères de réussite proposés

Cette section est un **kill switch**, pas une promesse de résultat. Si les
critères ne sont pas atteints, la conclusion correcte peut être de renoncer à
produire des recommandations à partir de ces données.

Avant de réactiver des alertes d'achat automatiques, une transition devrait satisfaire au minimum :

- espérance nette par trade positive hors échantillon ;
- gain moyen et perte moyenne compatibles avec l'usage swing ;
- performance relative médiane positive ;
- performance moyenne positive à J+10 et J+20 ;
- résultats positifs dans plusieurs régimes ;
- absence de dépendance à un seul secteur ou à une seule année ;
- progression des résultats avec le score ou le niveau de confiance ;
- avantage conservé après coûts réalistes ;
- fréquence suffisamment faible pour rester actionnable ;
- supériorité à une stratégie de momentum sectoriel simple.

Un taux de réussite supérieur à 55 % peut être recherché pour une stratégie au
ratio gain/perte proche de 1, mais ce n'est pas une condition universelle. Le
seuil doit découler de l'espérance et du profil de sortie.

Ces critères sont des conditions de poursuite ou d'arrêt, pas des paramètres à
optimiser directement. Leur non-respect doit conduire à conserver les signaux
comme descriptions contextuelles, et non à ouvrir une nouvelle boucle
indéfinie d'ajustement.

## 9. Décisions opérationnelles immédiates

En attendant la refonte :

- conserver les signaux comme descriptions contextuelles ;
- ne pas les présenter comme recommandations autonomes ;
- désactiver ou limiter les alertes automatiques fondées uniquement sur `reversal` ;
- ne pas ajouter d'autres indicateurs au score sans test marginal ;
- conserver le système de log et de reconstruction ;
- utiliser les données existantes pour rechercher des sous-groupes pertinents ;
- traiter les narratives séparément des secteurs.

## 10. Conclusion

L'application n'échoue pas entièrement : son infrastructure de mesure a réussi à invalider des règles qui semblaient plausibles. C'est une étape utile et nécessaire.

Le sous-système de détection échoue toutefois en l'état par rapport à son objectif central. Il assimile un rebond ponctuel à un retournement et une accélération courte à une rotation durable.

La priorité n'est pas d'empiler RSI, MACD ou autres indicateurs. Elle est de reformuler le phénomène sous forme de :

1. force relative continue ;
2. progression transversale du rang ;
3. transition d'état ;
4. confirmation de prix et de breadth ;
5. validation hors échantillon avec benchmark cohérent.

Cette architecture est plus proche de la réalité d'une rotation sectorielle et fournit un cadre testable pour isoler des retournements susceptibles de produire un swing exploitable.

Elle ne garantit toutefois pas qu'un avantage existe sur cet univers. La
décision la plus rationnelle peut être d'arrêter après les corrections de
mesure et le test pré-enregistré, puis d'assumer explicitement que les signaux
servent à décrire le marché plutôt qu'à recommander des transactions.
