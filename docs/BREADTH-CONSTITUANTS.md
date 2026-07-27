# Breadth de constituants — mesure et verdict

**Statut : FERMÉ (2026-07-27).** Le module `lib/breadth.ts` et ses tests
restent au dépôt ; rien ne les consomme en détection et rien ne doit le faire.

## D'où vient la question

Après l'invalidation du scanner d'accélération, la question posée était : la
source de données est-elle trop pauvre, et ajouter de l'analyse technique
aiderait-il ?

Non — et pour une raison qui ne dépend d'aucune mesure. RSI, MACD, Bollinger,
ATR, ADX sont des **transformations déterministes de OHLCV**. Elles n'ajoutent
aucune information à un moteur qui voit déjà cette série ; un modèle qui verrait
la série brute pourrait les reconstruire. Si le prédicteur n'est pas dans la
série, il n'est dans aucune fonction de la série. En ajouter augmente le nombre
de degrés de liberté à information constante, c'est-à-dire le surapprentissage —
le mécanisme exact du `p = 0,0003` in-sample de l'accélération.

La breadth de constituants était la seule exception accessible sans donnée
payante : elle lit le prix des ~900 **constituants**, que le moteur ne voit pas,
et non celui de l'ETF. Élargissement de la source, pas reprojection.

## Ce qui a été mesuré

Snapshot 2009-01-01 → 2022-03-31, 895 tickers résolus sur 918, 2,65 M de
bougies. Trois passes, dans cet ordre — la troisième n'ayant été déclarée
qu'après l'échec de la deuxième, et tirée une seule fois.

### Passe 1 — redondance (`scripts/breadth.analysis.test.ts`)

Question préalable, sans perf forward : la breadth dit-elle autre chose que le
momentum de l'ETF ? **Oui.**

| secteur | ETF | membres | effectif 2009 → 2022 | r₅ | r₂₀ | r₆₀ | r²₂₀ |
|---|---|---:|---:|---:|---:|---:|---:|
| xlk | VGT | 121 | 83 → 121 | 0,77 | 0,73 | 0,55 | 0,54 |
| xlv | XLV | 91 | 71 → 91 | 0,77 | 0,73 | 0,54 | 0,53 |
| xli | XLI | 160 | 132 → 159 | 0,74 | 0,71 | 0,55 | 0,51 |
| xly | XLY | 102 | 74 → 102 | 0,74 | 0,70 | 0,56 | 0,49 |
| xlf | XLF | 140 | 114 → 140 | 0,64 | 0,64 | 0,47 | 0,41 |

La breadth résidualisée du momentum garde **68 à 72 % de son écart-type**. Et
r **décroît** avec la fenêtre (0,74 à 5 séances, 0,55 à 60) : la breadth sature
sur 0-100 quand le momentum ne sature pas, donc les deux divergent d'autant plus
que l'horizon est long.

### Passe 2 — pouvoir prédictif (`scripts/breadth.forward.test.ts`)

Pré-enregistré avant le run : hypothèse directionnelle (breadth plus forte que
le prix ne l'implique → meilleure perf relative), horizon J+20, seuil Q5−Q1
≥ 0,20 pt, secteurs à ≥ 90 constituants, émission jusqu'au 31/12/2021.

15 010 observations (5 secteurs × 3 002 séances), perf relative SPY, entrée à
l'**ouverture J+1**, bêta de résidualisation **glissant sur 250 séances** (un
bêta plein échantillon ferait fuiter le futur dans le régresseur).

| variable | J+20 : Q1 → Q5 | Q5−Q1 |
|---|---|---:|
| breadth résiduelle | +0,24 / +0,16 / +0,24 / +0,06 / −0,13 | **−0,36** |
| breadth brute | +0,33 / +0,09 / +0,21 / −0,02 / −0,05 | −0,38 |
| momentum ETF seul | +0,25 / +0,26 / +0,08 / +0,02 / −0,04 | −0,30 |

Sur l'horizon de décision : **p = 0,85, IC95 % [−0,69 ; +0,22]** (bootstrap par
bloc de dates, stride 20, les 5 secteurs tirés ensemble — chevauchement des
fenêtres et corrélation transversale neutralisés simultanément).

### Passe 3 — variante intra-secteur

Déclarée **après** l'échec de la passe 2, avec le même seuil de 0,20 pt, et
tirée **une seule fois**. Quintiles classés à l'intérieur de chaque secteur puis
moyennés à poids égal : l'appartenance à un quintile ne peut plus corréler avec
le secteur, et la dérive sectorielle 2010-2021 s'annule par construction.

| spécification | J+20 : Q1 → Q5 | Q5−Q1 | p | IC95 % |
|---|---|---:|---:|---|
| poolée | +0,24 / +0,16 / +0,24 / +0,06 / −0,13 | −0,36 | 0,85 | [−0,69 ; +0,22] |
| **intra-secteur** | +0,23 / +0,14 / +0,26 / +0,04 / −0,09 | **−0,32** | **0,87** | **[−0,74 ; +0,21]** |

**Ferme aussi.** Retirer toute la dérive sectorielle déplace l'écart de 0,05 pt
— cinq fois moins que la marge qui manquait — et ne change pas le signe. Le
défaut de spécification était réel et **n'était pas la cause** : c'est la forme
forte du négatif, comme lorsque les corrections de la Phase 0 (prix ajustés,
benchmark RSP, entrée J+1) n'avaient rien sauvé sur les 4 signaux. L'égalité des
trois variables tient à l'identique (résiduelle −0,32 / brute −0,37 / momentum
seul −0,33).

## La leçon

**Les trois variables donnent le même spread.** La breadth résiduelle ne fait
pas mieux que la brute, qui ne fait pas mieux que le momentum de l'ETF tout
seul. Les 68-72 % de variance indépendante de la passe 1 sont réels et ne
portent aucune information sur le futur.

> **Information nouvelle ≠ information utile.** La passe 1 établissait la
> condition nécessaire, pas la conclusion. Les deux passes valaient d'être
> séparées : la première aurait pu clore la question pour une heure de travail,
> et son résultat positif n'a rien promis.

Le signe négatif ne doit pas être retourné en signal d'achat : l'IC traverse
zéro largement. Même faute que le « paradoxe » `exhaustion`, qui était un
artefact de période.

## Limites connues

- **Survivance.** `universe-seed.ts` est un relevé des holdings IVV/IJH de
  juillet 2026 : la breadth historique ne voit que les survivants, donc elle est
  surestimée dans le passé, et l'ampleur du biais décroît avec le temps.
  L'effectif dérive de +23 % à +46 % sur les secteurs primaires entre 2009 et
  2022. C'est pourquoi `BreadthPoint` porte son `count` et pourquoi seul
  `breadthDelta` est exposé pour l'usage : **aucun niveau n'est comparable entre
  deux époques**.
- **Dérive sectorielle : levée, sans effet.** La passe 3 ci-dessus l'a mesurée
  plutôt que supposée. C'était la seule faiblesse de spécification identifiée, et
  elle valait 0,05 pt. Une passe supplémentaire serait désormais du réglage :
  relancer des spécifications jusqu'à ce qu'une franchisse est précisément ce qui
  avait fabriqué le résultat in-sample de l'accélération.
- **Bornes de quintiles plein échantillon.** Les rangs sont calculés sur toute
  la période, dans les deux spécifications : un léger regard vers l'avant, commun
  à toutes les passes, donc sans effet sur leur comparaison. Il jouerait *en
  faveur* d'un résultat positif — et il n'y en a pas.
- **Benchmark SPY, pas RSP.** C'est `MARKET_TICKER` du scanner et RSP n'est pas
  dans `scanner_universe` : cohérent avec la détection, mais différent du banc
  `rebuildSignals`. D'où une baseline **positive** ici (+0,11 pt à J+20, σ 2,34 ;
  +0,22 à J+40) là où le banc secteurs donne −0,05 à J+10 — les 5 secteurs
  primaires incluent VGT et ont battu SPY sur la période.

## Cartouche hors échantillon

**≥ 2022 INTACTE.** Jamais consultée. Le snapshot va jusqu'à mars 2022
uniquement pour laisser les fenêtres forward des dernières émissions de 2021 se
résoudre — 2022 n'a servi à aucun test.

## Rejouer

```
python scripts/download_scanner_backtest.py OUT.json 2009-01-01 2022-03-31
SCANNER_BACKTEST_SNAPSHOT=OUT.json BREADTH_REPORT=report.json \
  NODE_OPTIONS=--max-old-space-size=8192 \
  npx vitest run scripts/breadth.forward.test.ts
```

Le snapshot fait ~137 Mo et n'est pas au dépôt. `console.log` étant intercepté
par le runner Vitest, le rapport se récupère via `BREADTH_REPORT`.
