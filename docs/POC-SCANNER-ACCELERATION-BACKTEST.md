# Comparatif cassure / accélération post-cassure

**Date :** 27 juillet 2026  
**Période :** snapshot du 25 juillet 2024 au 23 juillet 2026  
**Séances effectivement rejouées :** 199  
**Statut :** comparaison exploratoire in-sample, plus contrôles par tirage
aléatoire apparié.

La période avait déjà été consultée lors du POC cassure. Aucun résultat de ce
document ne constitue donc une validation hors échantillon.

## Protocole commun

- 917 instruments résolus sur 918 ;
- univers de constituants 2026, avec biais de survivance ;
- 260 séances de warm-up ;
- 40 séances futures réservées ;
- entrée théorique à l'ouverture J+1 ;
- panier équipondéré comparé à SPY à J+20 et J+40 ;
- fusion des grappes proches partageant au moins 50 % de leurs membres dans une
  fenêtre de cinq séances.

## Élargissement de la v2

La v1 exigeait un percentile d'accélération d'au moins 70 et un percentile de
momentum résiduel d'au moins 60. Ces deux portes éliminaient 82 % du réservoir
avant même le clustering.

La v2 conserve les mêmes mesures dans le score et le classement, mais ne les
utilise plus comme filtres éliminatoires. C'est cohérent avec la fonction du
scanner : proposer des pistes de réflexion et non produire une action.

## Correction du 27 juillet 2026

Trois défauts de mesure ont été trouvés dans le moteur d'accélération, puis
corrigés. Aucun ne touche aux portes d'admission : le rejeu produit 14,77
candidats par séance contre 14,8 avant correction, l'admission n'a pas bougé
d'un titre.

- **Largeur d'accélération** — comptait les membres à `trueDays >= 3`, déjà une
  condition d'admission. Valait toujours 1, donc la porte à 50 % ne se
  déclenchait jamais et les 15 % de score correspondants étaient une constante
  ajoutée à toutes les grappes. Mesure désormais la part du groupe qui accélère
  encore à la dernière séance.
- **Largeur de liquidité** — comptait les membres à `liquidityAge <
  validityBars`, vrai par construction. Devient une **fraîcheur** continue,
  `moyenne(1 − âge / validityBars)`, sans nouveau paramètre.
- **Dénominateur des percentiles** — calculé sur le réservoir qualifié du jour,
  soit 4 à 60 titres. Devient l'univers éligible de la séance, 898 instruments
  en moyenne. Les scores sont désormais comparables d'un jour à l'autre.

Le snapshot retéléchargé retombe exactement sur la fenêtre du rejeu initial
(2024-07-25 → 2026-07-23, 199 séances, 917/918 résolus, 14,8 candidats par
séance) : la comparaison avant/après est appariée.

### Effet de la correction

| | Avant | Après |
|---|---:|---:|
| Grappes journalières | 56 | 35 |
| Jours détectés | 48 | 31 |
| Épisodes | 27 | 22 |
| Candidats/séance | 14,8 | 14,77 |
| Cohésion moyenne | 0,558 | 0,568 |
| Taille moyenne | 3,4 | 3,41 |
| J+20 moyen | +5,31 pt | +6,91 pt |
| J+40 moyen | +6,52 pt | +7,38 pt |

Les deux critères ressuscités filtrent réellement : 38 % de grappes
journalières en moins. Ce qu'ils éliminent est de moins bonne qualité, d'où des
métriques forward légèrement supérieures.

**L'échelle du score s'est déplacée.** Score moyen 86,2 contre 71,5, et 21
épisodes sur 22 au-dessus de 80, 1 entre 65 et 80, aucun en dessous. C'est la
conséquence attendue du changement de dénominateur : un titre qui accélère est
au sommet d'un classement de 898 instruments. Les bornes 65 / 80 héritées ne
discriminent plus rien et sont à recalibrer avant tout usage d'affichage.

## Résultats comparés

| Version | Épisodes | Jours détectés | Candidats/séance | J+20 moyen | Médiane J+20 | σ J+20 | Win J+20 | J+40 moyen | Médiane J+40 | σ J+40 | Win J+40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cassures | 20 | 38 | 11,1 | +1,24 pt | +1,37 pt | — | 55 % | +1,31 pt | +2,77 pt | — | 55 % |
| Accélération v1 stricte | 3 | 3 | 2,7 | +4,73 pt | +6,70 pt | — | 67 % | +11,49 pt | +12,72 pt | — | 100 % |
| Accélération v2, avant correction | 27 | 48 | 14,8 | +5,31 pt | +3,74 pt | — | 78 % | +6,52 pt | +6,66 pt | — | 70 % |
| **Accélération v2 corrigée** | **22** | **31** | **14,8** | **+6,91 pt** | **+4,09 pt** | **7,48** | **86 %** | **+7,38 pt** | **+6,71 pt** | **13,07** | **73 %** |

Les lignes « Cassures » et « v1 stricte » viennent du moteur d'origine et n'ont
pas été rejouées après correction ; le moteur de cassure est indépendant et ses
propres critères de largeur ne sont pas dégénérés. La ligne v1 ne compte que
trois épisodes et ne mesure rien.

## Concentration thématique

Les 22 épisodes ne sont pas 22 observations indépendantes.

| | n | J+20 moyen | σ | Win J+20 | J+40 moyen | σ | Win J+40 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Semi-conducteurs et distribution électronique | 7 | +15,31 pt | 5,45 | 100 % | +15,13 pt | 11,91 | 86 % |
| Tout le reste | 15 | +2,99 pt | 4,41 | 80 % | +3,76 pt | 12,30 | 67 % |

Sept détections du même cycle semi-conducteurs portent l'essentiel du
résultat. Hors semis, +2,99 pt à J+20 pour un panier équipondéré de momentum
contre SPY, sans contrôle de bêta, sur un marché haussier — c'est dans le bruit.

La fusion en épisodes sous-fusionne également. `DD EXPD SANM` (10 novembre) et
`DD EXPD HSIC MAR` (13 novembre) partagent deux membres sur cinq, soit un
Jaccard de 0,40, sous le seuil de 0,50 : deux épisodes pour un mouvement. Même
chose pour `JBHT KNX LSTR` (9 décembre) et `KNX LSTR ODFL R SAIA` (11 décembre),
Jaccard 0,33. Le nombre d'observations indépendantes est plus proche de 18 que
de 22, avant même la corrélation thématique.

### Épisodes

| Date | Score | Cohésion | J+20 | J+40 | Membres |
|---|---:|---:|---:|---:|---|
| 2025-08-13 | 85 | 0,50 | +0,6 | −3,6 | BCO BKH LIVN |
| 2025-09-17 | 89 | 0,55 | +16,0 | +25,9 | LRCX MKSI MU |
| 2025-09-22 | 88 | 0,55 | +9,1 | +12,0 | KLAC LRCX MU ONTO |
| 2025-09-24 | 81 | 0,49 | +2,3 | +3,5 | DY JBL STRL |
| 2025-10-23 | 83 | 0,48 | +1,5 | −3,9 | BG FR PLD REXR STAG |
| 2025-10-29 | 84 | 0,49 | +5,0 | +6,8 | BC CRS HXL LVS |
| 2025-11-05 | 94 | 0,70 | +2,2 | +4,3 | CAH CHRW VIAV WCC |
| 2025-11-10 | 91 | 0,57 | +1,9 | +1,7 | DD EXPD SANM |
| 2025-11-12 | 86 | 0,66 | −3,8 | −12,8 | CNX EQT EXE |
| 2025-11-13 | 84 | 0,54 | −1,8 | −7,9 | AFL CINF THG TRV |
| 2025-11-13 | 80 | 0,55 | +4,5 | +6,7 | DD EXPD HSIC MAR |
| 2025-12-04 | 80 | 0,49 | +12,6 | +9,9 | ADI ANF KEYS |
| 2025-12-09 | 84 | 0,61 | +9,3 | +15,5 | JBHT KNX LSTR |
| 2025-12-11 | 83 | 0,61 | +3,1 | +13,2 | KNX LSTR ODFL R SAIA |
| 2026-01-13 | 78 | 0,48 | +14,0 | −0,4 | AMKR ENTG SLB |
| 2026-01-15 | 85 | 0,48 | −1,2 | −16,2 | FBIN LOW UFPI |
| 2026-02-03 | 87 | 0,57 | +11,4 | +10,9 | ARW AVT IPGP |
| 2026-04-17 | 81 | 0,51 | +25,6 | +35,8 | ARW AVT INTC |
| 2026-04-24 | 95 | 0,60 | +18,5 | +11,7 | MCHP ON SITM |
| 2026-04-28 | 94 | 0,67 | +3,7 | +4,2 | NUE RS STLD |
| 2026-05-12 | 93 | 0,65 | +3,2 | +11,4 | DOC DVA NBIX |
| 2026-05-19 | 92 | 0,76 | +14,3 | +33,6 | CRWD FTNT PANW |

## Contrôles par tirage aléatoire

Le résultat mesuré est celui de deux étapes empilées : un filtre d'accélération,
puis un regroupement par corrélation résiduelle. Les contrôles rejouent les
mêmes 22 dates de détection avec des paniers de même taille tirés au hasard dans
trois urnes, 10 000 stratégies synthétiques par urne, générateur à graine fixe.
Le protocole détaillé est dans `POC-SCANNER-ACCELERATION.md`.

| Urne | Taille moyenne | J+20 moyen | J+40 moyen |
|---|---:|---:|---:|
| B — univers éligible | 898 | +1,02 pt | +2,15 pt |
| A — réservoir qualifié | 17,7 | +4,00 pt | +4,85 pt |
| A′ — réservoir moins les membres de la grappe | 14,7 | +3,29 pt | +4,06 pt |
| Grappe réelle | 3,4 | +6,91 pt | +7,38 pt |

Décomposition du +6,91 pt à J+20 :

- **+1,02 pt** — être investi ces jours-là dans un panier équipondéré de trois à
  cinq titres, contre SPY. Socle de bêta, de biais small-mid et de timing. Non
  attribuable au scanner.
- **+3,0 pt** — apport de l'écran d'accélération, soit A moins B. p < 0,0001.
- **+2,9 pt** — apport du clustering, à date et réservoir identiques. p =
  0,0077, et p = 0,0007 contre A′, l'urne débarrassée des membres de la grappe.

Par épisode, la grappe bat un tirage individuel dans 63 % des cas, 66 % contre
A′.

### Ce que les contrôles établissent

Le clustering n'est pas décoratif sur cette période. C'est aussi le test qui
répond à l'objection de concentration thématique : les jours de détection semis,
le réservoir qualifié est lui-même plein de semis, donc le tirage aléatoire en
achète également. Le surcroît de 3,6 pt n'est donc pas « être long semis », mais
de la sélection à l'intérieur du thème.

### Ce qu'ils n'établissent pas

L'apport du clustering décroche à J+40 : p = 0,062 contre A, 0,018 contre A′.
L'avantage est concentré sur l'horizon court et s'effrite ensuite, ce qui est
cohérent avec un routeur d'attention et non avec une détention de deux mois.

Le rééchantillonnage contrôle la date, la taille du panier et la composition du
réservoir. Il ne contrôle pas le fait que les 22 épisodes sont peu nombreux,
thématiquement corrélés, et que le pipeline a été réglé sur cette période. Le
p-value répond à « le clustering trie-t-il mieux que le hasard, ces jours-là »,
pas à « le scanner a-t-il un edge ». Cette dernière question reste entière et
reste hors-échantillon.

## Décision proposée

Conserver la v2 corrigée comme routeur d'attention :

- afficher toutes les grappes admissibles triées par score ;
- présenter accélération, persistance, liquidité, percentile et cohésion comme
  éléments de contexte, jamais comme recommandation ;
- ne pas réintroduire de seuil dur sur les percentiles ;
- recalibrer les bornes d'affichage sur la nouvelle échelle de score avant tout
  usage, les valeurs 65 et 80 étant devenues inopérantes ;
- privilégier J+20 comme horizon de lecture, l'apport du clustering n'étant pas
  établi à J+40 ;
- distinguer visuellement les grappes cohérentes des idées plus spéculatives,
  sans masquer ces dernières.

## Prochain test

Rejouer la période 2010-2024, jamais consultée, avec les mêmes contrôles A et B.
Ce n'est pas une optimisation rétrospective mais le hors-échantillon réel, et
c'est le seul test qui peut invalider le pipeline complet. Il doit être fait
avant d'ouvrir un journal prospectif : à environ onze épisodes par an et une
dispersion cross-sectionnelle de l'ordre de 7 à 13 points, un journal prospectif
ne conclurait rien avant trois à cinq ans.

La période vierge ne se consomme qu'une fois. Les contrôles A et B ayant établi
que les deux étapes du pipeline contribuent séparément, il n'y a plus de raison
de la dépenser pour valider une machinerie dont on ignorerait quelle moitié est
utile.
