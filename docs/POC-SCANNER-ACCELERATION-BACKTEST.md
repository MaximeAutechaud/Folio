# Comparatif cassure / accélération post-cassure

**Date :** 27 juillet 2026

## Verdict

**Le scanner d'accélération est invalidé.** Rejoué sur 2009-2024, période jamais
consultée, il produit 191 épisodes pour une performance relative de **−0,39 pt à
J+20** et **+0,02 pt à J+40**, avec 45 % de gagnants. Ni l'écran d'accélération
ni le regroupement par corrélation résiduelle n'ajoutent quoi que ce soit à un
tirage au hasard : les deux étages battent le hasard dans moins d'un cas sur
deux, p = 0,78 et p = 0,91.

Le +6,94 pt mesuré sur 2024-2026 était un cycle semi-conducteurs, pas un edge.

La suite du document conserve le détail des deux rejeux, parce que la manière
dont un résultat in-sample convaincant s'est effondré hors échantillon est plus
instructive que le verdict lui-même.

---

**Période in-sample :** snapshot du 25 juillet 2024 au 23 juillet 2026, 199
séances rejouées. Déjà consultée lors du POC cassure.  
**Période hors échantillon :** 2 janvier 2009 au 23 juillet 2024, 3 613 séances
rejouées. Jamais consultée, et sans chevauchement d'un seul jour avec
l'in-sample.

## Protocole commun

- 917 instruments résolus sur 918 en in-sample, 911 sur 918 hors échantillon ;
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

Quatre défauts de mesure ont été trouvés dans le moteur d'accélération, puis
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
- **Fenêtre d'estimation des bêtas résiduels** — non bornée, donc égale à ce que
  l'appelant avait sous la main : 261 séances au début du rejeu, 459 à la fin,
  quinze ans sur un snapshot long. Bornée à 250 séances. Sans cette correction,
  le rejeu hors échantillon n'aurait pas mesuré la même chose que l'in-sample.

Le snapshot retéléchargé retombe exactement sur la fenêtre du rejeu initial
(2024-07-25 → 2026-07-23, 199 séances, 917/918 résolus, 14,8 candidats par
séance) : la comparaison avant/après est appariée.

### Effet de la correction

| | Avant | Après |
|---|---:|---:|
| Grappes journalières | 56 | 37 |
| Jours détectés | 48 | 33 |
| Épisodes | 27 | 24 |
| Candidats/séance | 14,8 | 14,77 |
| Cohésion moyenne | 0,558 | 0,557 |
| Taille moyenne | 3,4 | 3,38 |
| J+20 moyen | +5,31 pt | +6,94 pt |
| J+40 moyen | +6,52 pt | +6,64 pt |

Les deux critères ressuscités filtrent réellement : un tiers de grappes
journalières en moins. Ce qu'ils éliminent est de moins bonne qualité, d'où des
métriques forward légèrement supérieures.

**L'échelle du score s'est déplacée.** Score moyen 85,5 contre 71,5, et 21
épisodes sur 24 au-dessus de 80, 3 entre 65 et 80, aucun en dessous. C'est la
conséquence attendue du changement de dénominateur : un titre qui accélère est
au sommet d'un classement de 898 instruments. Les bornes 65 / 80 héritées ne
discriminent plus rien et sont à recalibrer avant tout usage d'affichage.

## Résultats comparés

| Version | Épisodes | Jours détectés | Candidats/séance | J+20 moyen | Médiane J+20 | σ J+20 | Win J+20 | J+40 moyen | Médiane J+40 | σ J+40 | Win J+40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cassures | 20 | 38 | 11,1 | +1,24 pt | +1,37 pt | — | 55 % | +1,31 pt | +2,77 pt | — | 55 % |
| Accélération v1 stricte | 3 | 3 | 2,7 | +4,73 pt | +6,70 pt | — | 67 % | +11,49 pt | +12,72 pt | — | 100 % |
| Accélération v2, avant correction | 27 | 48 | 14,8 | +5,31 pt | +3,74 pt | — | 78 % | +6,52 pt | +6,66 pt | — | 70 % |
| **Accélération v2 corrigée** | **24** | **33** | **14,8** | **+6,94 pt** | **+4,09 pt** | **8,00** | **83 %** | **+6,64 pt** | **+6,71 pt** | **13,57** | **71 %** |

Les lignes « Cassures » et « v1 stricte » viennent du moteur d'origine et n'ont
pas été rejouées après correction ; le moteur de cassure est indépendant et ses
propres critères de largeur ne sont pas dégénérés. La ligne v1 ne compte que
trois épisodes et ne mesure rien.

## Concentration thématique

Les 24 épisodes ne sont pas 24 observations indépendantes.

| | n | J+20 moyen | σ | Win J+20 | J+40 moyen | σ | Win J+40 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Semi-conducteurs et distribution électronique | 8 | +15,83 pt | 5,26 | 100 % | +15,05 pt | 11,03 | 88 % |
| Tout le reste | 16 | +2,50 pt | 4,69 | 75 % | +2,44 pt | 13,00 | 63 % |

Huit détections du même cycle semi-conducteurs portent l'essentiel du
résultat. Hors semis, +2,50 pt à J+20 pour un panier équipondéré de momentum
contre SPY, sans contrôle de bêta, sur un marché haussier — c'est dans le bruit.
C'est le signal d'alerte que le rejeu hors échantillon a confirmé.

La fusion en épisodes sous-fusionne également. `DD EXPD SANM` (10 novembre) et
`DD EXPD HSIC MAR` (13 novembre) partagent deux membres sur cinq, soit un
Jaccard de 0,40, sous le seuil de 0,50 : deux épisodes pour un mouvement. Même
chose pour `JBHT KNX LSTR` (9 décembre) et `KNX LSTR ODFL R SAIA` (11 décembre),
Jaccard 0,33. Le nombre d'observations indépendantes est plus proche de 20 que
de 24, avant même la corrélation thématique.

### Épisodes

| Date | Score | Cohésion | J+20 | J+40 | Membres |
|---|---:|---:|---:|---:|---|
| 2025-08-13 | 85 | 0,50 | +0,6 | -3,6 | BCO BKH LIVN |
| 2025-09-03 | 78 | 0,45 | -4,8 | -17,3 | PKG SW WYNN |
| 2025-09-17 | 89 | 0,55 | +16,0 | +25,9 | LRCX MKSI MU |
| 2025-09-22 | 88 | 0,54 | +9,1 | +12,0 | KLAC LRCX MU ONTO |
| 2025-09-24 | 81 | 0,49 | +2,3 | +3,5 | DY JBL STRL |
| 2025-10-23 | 83 | 0,48 | +1,5 | -3,9 | BG FR PLD REXR STAG |
| 2025-10-29 | 84 | 0,48 | +5,0 | +6,8 | BC CRS HXL LVS |
| 2025-11-05 | 94 | 0,70 | +2,2 | +4,3 | CAH CHRW VIAV WCC |
| 2025-11-10 | 91 | 0,57 | +1,9 | +1,7 | DD EXPD SANM |
| 2025-11-12 | 86 | 0,66 | -3,8 | -12,8 | CNX EQT EXE |
| 2025-11-13 | 85 | 0,55 | -1,8 | -7,9 | AFL CINF THG TRV |
| 2025-11-13 | 80 | 0,54 | +4,5 | +6,7 | DD EXPD HSIC MAR |
| 2025-12-04 | 80 | 0,48 | +12,6 | +9,9 | ADI ANF KEYS |
| 2025-12-09 | 84 | 0,62 | +9,3 | +15,5 | JBHT KNX LSTR |
| 2025-12-11 | 83 | 0,61 | +3,1 | +13,2 | KNX LSTR ODFL R SAIA |
| 2026-01-13 | 78 | 0,47 | +14,0 | -0,4 | AMKR ENTG SLB |
| 2026-01-15 | 85 | 0,46 | -1,2 | -16,2 | FBIN LOW UFPI |
| 2026-02-03 | 87 | 0,57 | +11,4 | +10,9 | ARW AVT IPGP |
| 2026-04-15 | 76 | 0,45 | +19,5 | +14,5 | GL ITT SITM |
| 2026-04-17 | 81 | 0,51 | +25,6 | +35,8 | ARW AVT INTC |
| 2026-04-24 | 95 | 0,59 | +18,5 | +11,7 | MCHP ON SITM |
| 2026-04-28 | 94 | 0,68 | +3,7 | +4,2 | NUE RS STLD |
| 2026-05-12 | 93 | 0,65 | +3,2 | +11,4 | DOC DVA NBIX |
| 2026-05-19 | 92 | 0,76 | +14,3 | +33,6 | CRWD FTNT PANW |

## Contrôles par tirage aléatoire, in-sample

Le résultat mesuré est celui de deux étapes empilées : un filtre d'accélération,
puis un regroupement par corrélation résiduelle. Les contrôles rejouent les
mêmes 24 dates de détection avec des paniers de même taille tirés au hasard dans
trois urnes, 10 000 stratégies synthétiques par urne, générateur à graine fixe.
Le protocole détaillé est dans `POC-SCANNER-ACCELERATION.md`.

| Urne | Taille moyenne | J+20 moyen | J+40 moyen |
|---|---:|---:|---:|
| B — univers éligible | 898 | +0,61 pt | +1,76 pt |
| A — réservoir qualifié | 18,3 | +3,56 pt | +4,49 pt |
| A′ — réservoir moins les membres de la grappe | 15,3 | +2,87 pt | +3,88 pt |
| Grappe réelle | 3,4 | +6,94 pt | +6,64 pt |

Décomposition du +6,94 pt à J+20 :

- **+0,61 pt** — être investi ces jours-là dans un panier équipondéré de trois à
  cinq titres, contre SPY. Socle de bêta, de biais small-mid et de timing. Non
  attribuable au scanner.
- **+3,0 pt** — apport de l'écran d'accélération, soit A moins B. p < 0,0001.
- **+3,4 pt** — apport du clustering, à date et réservoir identiques. p =
  0,0049, et p = 0,0003 contre A′, l'urne débarrassée des membres de la grappe.

Par épisode, la grappe bat un tirage individuel dans 63 % des cas, 66 % contre
A′. À J+40 l'apport du clustering est déjà nettement plus faible : p = 0,10
contre A, 0,047 contre A′.

Sur cette période, donc, les deux étages contribuent séparément et le clustering
n'est pas décoratif. C'est aussi ce qui répondait à l'objection de concentration
thématique : les jours de détection semis, le réservoir qualifié est lui-même
plein de semis, donc le tirage aléatoire en achète également, et le surcroît de
3,4 pt n'était pas « être long semis » mais de la sélection à l'intérieur du
thème.

Cette conclusion était correcte et n'a pas survécu.

## Rejeu hors échantillon 2009-2024

**3 613 séances, 911 instruments résolus sur 918, 3,17 M bougies.** Le snapshot
s'arrête le 23 juillet 2024, la veille du premier jour de la période in-sample :
aucun chevauchement. Paramètres identiques, aucun réglage, une seule exécution.

| | In-sample 2024-2026 | Hors échantillon 2009-2024 |
|---|---:|---:|
| Séances rejouées | 199 | 3 613 |
| Épisodes | 24 | 191 |
| Épisodes par an | 12,0 | 12,3 |
| Candidats/séance | 14,8 | 10,4 |
| Cohésion moyenne | 0,557 | 0,521 |
| **J+20 moyen** | **+6,94 pt** | **−0,39 pt** |
| Médiane J+20 | +4,09 pt | −0,41 pt |
| σ J+20 | 8,00 | 5,19 |
| Win J+20 | 83 % | 45 % |
| **J+40 moyen** | **+6,64 pt** | **+0,02 pt** |
| Win J+40 | 71 % | 51 % |

Le moteur se comporte de façon stable — il détecte au même rythme, produit des
grappes de même taille et de cohésion comparable. Seule la performance
disparaît, et passe légèrement sous zéro.

### Les contrôles hors échantillon

| Urne | J+20 moyen | p-value | J+40 moyen | p-value |
|---|---:|---:|---:|---:|
| B — univers éligible | +0,00 pt | 0,91 | +0,13 pt | 0,60 |
| A — réservoir qualifié | −0,19 pt | 0,78 | +0,27 pt | 0,75 |
| A′ — sans les membres de la grappe | −0,20 pt | 0,78 | +0,24 pt | 0,71 |
| Grappe réelle | −0,39 pt | — | +0,02 pt | — |

Les trois urnes sont indiscernables et la grappe fait légèrement moins bien
qu'elles. La grappe bat un tirage individuel dans **47,8 %** des cas à J+20 —
c'est-à-dire moins souvent qu'une pièce.

Les deux étages du pipeline sont donc invalidés séparément :

- l'**écran d'accélération** n'apporte rien : tirer dans le réservoir qualifié
  (−0,19 pt) ne vaut pas mieux que tirer dans l'univers entier (+0,00 pt) ;
- le **clustering** n'apporte rien : la grappe (−0,39 pt) ne vaut pas mieux que
  le tirage dans le même réservoir.

Le contrôle B éclaire aussi rétrospectivement l'in-sample. Le socle de +0,61 pt
mesuré sur 2024-2026 tombe à 0,00 pt sur quinze ans : ce n'était pas une prime
structurelle des paniers équipondérés, c'était le régime de 2024-2026.

### Aucune année ne sauve le résultat

J+20 moyen par année de détection :

| 2010 | 2011 | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −1,23 | −0,41 | −0,76 | −0,22 | −0,11 | −0,77 | −0,15 | +1,48 |

| 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 |
|---:|---:|---:|---:|---:|---:|---:|
| −0,42 | −1,74 | +2,32 | −2,75 | −2,31 | −0,03 | +0,14 |

Onze années sur quinze sont négatives. La meilleure, 2020, ne compte que neuf
épisodes. Il n'existe pas de régime identifiable où le scanner fonctionne — ce
n'est pas un outil qui marche seulement en marché haussier, c'est un outil qui
ne marche pas.

### Ce que le rejeu ne corrige pas

Le biais de survivance joue **en faveur** du scanner et le résultat reste nul :
l'univers est celui des constituants de 2026, rejoué sur 2009-2024, et les
secteurs sont eux aussi ceux de 2026. Un univers point-in-time ne pourrait que
dégrader ces chiffres.

## Décision

**Ne pas construire l'interface. Ne pas ouvrir de journal prospectif.** Il n'y a
rien à router : le scanner ne concentre pas l'attention sur des situations
meilleures que la moyenne de son propre réservoir.

Le code reste sur la branche, non mergé, avec ce document. Il n'y a pas de
version à sauver par réglage : ce ne sont pas les seuils qui échouent, ce sont
les deux hypothèses de fond, indépendamment l'une de l'autre.

## Ce que cet épisode apprend

Le résultat in-sample n'était pas faible. Il était de +6,94 pt à J+20, 83 % de
gagnants, avec un contrôle par rééchantillonnage à p = 0,0003 — un test conçu
précisément pour neutraliser la date, la taille du panier et la composition du
réservoir, et qui a fait ce qu'on lui demandait. Ce contrôle a correctement
établi que la cohésion triait mieux que le hasard **ces jours-là**. Il ne pouvait
pas établir que ces jours-là ressemblaient aux autres, et ils ne leur
ressemblaient pas.

Aucun raffinement méthodologique appliqué à une seule période ne remplace une
période non consultée. Les deux signaux d'alerte qui pointaient dans la bonne
direction étaient les plus simples : huit épisodes sur vingt-quatre issus d'un
seul cycle thématique, et un résultat hors semis à +2,50 pt déjà dans le bruit.

Même conclusion que la validation des signaux de 2026-07-26, et par le même
chemin : un résultat convaincant sur deux ans, un null sur quinze.
