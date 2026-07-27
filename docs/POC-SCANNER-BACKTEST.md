# Backtest du POC scanner de cassures

**Date d'exécution :** 27 juillet 2026  
**Branche :** `poc-scanner-breakouts`  
**Configuration :** `BREAKOUT_POC`, sans modification des seuils après lecture.

## Données

- univers demandé : 918 instruments ;
- instruments résolus : 917 ;
- historique SPY : 500 séances, du 25 juillet 2024 au 23 juillet 2026 ;
- univers : constituants connus en 2026, donc biais de survivance assumé ;
- prix ajustés dividendes et splits ;
- rejeu sans données futures dans les métriques du scanner.

Le POC exige 260 séances de warm-up. Quarante séances futures sont réservées à
la mesure J+40. Il reste 199 séances effectivement rejouées, approximativement
d'août 2025 à mai 2026.

## Méthode

À chaque séance :

1. toutes les séries sont tronquées à la date ;
2. le même `runBreakoutPoc` que l'application est exécuté ;
3. les clusters persistants ou évolutifs sont fusionnés en épisodes ;
4. deux clusters sont considérés comme une même narrative si leur Jaccard est
   au moins égal à 50 % et s'ils sont vus à moins de cinq séances d'écart ;
5. l'entrée est simulée à l'ouverture suivante ;
6. la sortie est mesurée à J+20 et J+40 ;
7. la performance d'un cluster est le panier équipondéré de ses membres moins
   SPY.

Cette règle d'épisode évite de compter plusieurs fois un groupe dont un membre
entre ou sort.

## Résultats de faisabilité

| Mesure | Résultat |
|---|---:|
| Séances rejouées | 199 |
| Séances avec au moins un cluster | 38 |
| Clusters quotidiens cumulés | 44 |
| Candidats moyens par séance | 11,1 |
| Épisodes distincts | 20 |
| Taille moyenne | 3,8 |
| Taille médiane | 3 |
| Cohésion moyenne | 0,524 |
| Score moyen | 54,7 |
| Observations `< 65` | 17 |
| Candidats `65–79` | 2 |
| Confirmés `>= 80` | 1 |

Le débit est compatible avec un routeur d'attention : environ un épisode toutes
les dix séances, sans blob supérieur à douze membres.

## Performance future de tous les épisodes

| Horizon | n | Moyenne vs SPY | Médiane vs SPY | Win rate | IC 95 % naïf de la moyenne |
|---|---:|---:|---:|---:|---:|
| J+20 | 20 | +1,24 pt | +1,37 pt | 55 % | [−1,83 ; +4,31] |
| J+40 | 20 | +1,31 pt | +2,77 pt | 55 % | [−3,60 ; +6,21] |

Les deux moyennes sont positives, mais les intervalles sont extrêmement larges
et contiennent zéro. L'intervalle est en outre naïf : il ne corrige ni le
chevauchement des périodes de détention ni la dépendance de marché. Il ne faut
donc pas présenter ce résultat comme une preuve d'alpha.

## Performance par seuil du score

### Score `>= 65`

Seulement trois épisodes :

| Horizon | n | Moyenne | Médiane | Win rate |
|---|---:|---:|---:|---:|
| J+20 | 3 | +1,58 pt | −0,53 pt | 33 % |
| J+40 | 3 | +6,11 pt | +3,03 pt | 67 % |

### Score `>= 80`

Un seul épisode (`AKAM`, `EXPE`, `GMED`, score 91) :

- J+20 : −0,53 pt ;
- J+40 : +3,03 pt.

Le score n'est pas validé. Il filtre presque tous les épisodes et son échantillon
est inutilisable. Plusieurs bons résultats proviennent de scores inférieurs à
65. En l'état, le score doit rester descriptif et ne doit pas masquer les
clusters `< 65`.

## Exemples de groupes plausibles

Plusieurs groupes sont lisibles a posteriori :

- `BXP KRC VNO` : immobilier de bureaux ;
- `JBHT KNX SAIA` : transport routier ;
- `ADM BG DAR` : agriculture/commodities ;
- `EME ETN GEV PWR STRL` : électrification et infrastructures ;
- `APA AR CHRD OXY` : énergie ;
- `AAON FTNT PANW`, puis ajout de `CRWD` : infrastructure/cybersécurité.

D'autres assemblages sont peu interprétables :

- `GL GLW INCY` ;
- `CRH HL WMS` ;
- `AKAM EXPE GMED`.

Cela montre que la cohésion résiduelle seule peut encore fabriquer des proximités
statistiques sans narrative économique évidente.

## Conclusions

### Ce que le POC a réussi

- il produit une fréquence raisonnable ;
- il évite les blobs observés dans le scanner précédent ;
- il détecte plusieurs groupes économiquement reconnaissables ;
- les performances brutes ne sont pas négatives ;
- la médiane positive indique que la moyenne n'est pas uniquement portée par un
  seul extrême.

### Ce qu'il n'a pas démontré

- aucune significativité statistique ;
- aucune stabilité multi-régimes ;
- aucune validité hors échantillon ;
- aucune supériorité à un breakout individuel ou à un momentum simple ;
- aucune utilité démontrée du score 0–100 ;
- aucune robustesse à un univers point-in-time.

## Décision recommandée

Conserver le POC comme routeur d'attention expérimental. Ne pas produire
d'alertes de trading ni optimiser les seuils à partir de ces vingt épisodes.

La prochaine validation utile est une comparaison pré-enregistrée :

1. membres de clusters contre toutes les cassures individuelles qualifiées ;
2. clusters contre une sélection aléatoire appariée par date, secteur, taille et
   momentum ;
3. extension à une période réellement neuve ;
4. mesure de la stabilité du résultat à paramètres inchangés.

Le score doit être soit recalibré sur une cible distincte, soit retiré de la
décision. Son seuil actuel de 65 ne possède aucun support empirique dans ce
rejeu.

## Défaut de cache découvert

La synchronisation décidait la profondeur à partir de la seule date la plus
récente. Un cache d'un an mais à jour n'était donc jamais complété à deux ans,
malgré `RETENTION_DAYS = 760`.

La branche corrige ce défaut en utilisant `MIN(date)` et `MAX(date)` : un cache
de moins de 500 jours calendaires demande désormais une passe `2y`.
