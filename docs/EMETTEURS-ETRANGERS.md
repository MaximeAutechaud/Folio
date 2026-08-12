# Émetteurs étrangers — ce qui bloquait, et ce qui a été fait

Mesure du 2026-08-11, mise en œuvre le 2026-08-13.
Contexte : l'onglet **Fonda** ne couvrait que les sociétés américaines. On a voulu
savoir ce qu'il faudrait pour lever cette limite — la réponse n'était pas celle
qu'on croyait, et la mise en œuvre en a révélé une autre encore.

## Le constat de départ

Le resolver (`lib/xbrl.ts`) lisait le namespace `us-gaap` et l'unité `USD`, tous
deux en dur. Deux causes d'échec distinctes se cachaient derrière la même page
vide, et **ce n'était pas la devise qui dominait**.

Échantillon de 15 ADR majeurs, interrogés sur `companyconcept` (`Assets`) :

| Société | Taxonomie | Unités publiées | Ce qui bloquait |
|---|---|---|---|
| Shell, AstraZeneca, BP, TotalEnergies, Novartis, Rio Tinto, Infosys | `ifrs-full` | USD | la taxonomie seule |
| SAP | `ifrs-full` | EUR, **USD** | la taxonomie seule |
| Diageo | `ifrs-full` | GBP, **USD** | la taxonomie seule |
| TSMC | `ifrs-full` | TWD, **USD** | la taxonomie seule |
| Novo Nordisk | `ifrs-full` | DKK | taxonomie **et** devise |
| Unilever | `ifrs-full` | EUR | taxonomie **et** devise |
| Toyota | `us-gaap` | JPY, **USD** | rien — exploitable en l'état |
| ASML | `us-gaap` | EUR | la devise seule |
| Sony | `us-gaap` | JPY | la devise seule |

**12 sur 15 déposaient en IFRS**, et le cas « us-gaap mais devise étrangère » —
celui qu'ASML avait révélé — ne concernait que 2 sociétés.

> Piège de mesure, rencontré en écrivant cette note : un premier passage ne
> lisait que `Object.keys(units)[0]` et comptait 7 sociétés en USD au lieu de 10.
> Plusieurs émetteurs publient **plusieurs unités** pour le même concept —
> toujours lire la liste complète.

## Ce que le scoring exige réellement

Rien, en matière de conversion.

Les 9 tests de Piotroski sont des ratios ou des comparaisons d'une année sur
l'autre **dans la même unité** : ROA = résultat / actif, marge = marge brute /
CA, levier = dette / actif moyen. Les 4 termes d'Altman Z″ sont pareillement des
ratios de grandeurs homogènes. **Une société publiant en yens est notable telle
quelle, sans jamais voir un taux de change.**

Trois éléments seulement mélangent deux devises, parce qu'ils confrontent la
capitalisation (en devise de *cotation*) à des comptes (en devise de
*publication*) : le PER, l'EV/résultat opérationnel et le rendement du FCF —
tous **déjà hors score** — plus la ligne « lecture marché », qui n'est pas le
verdict non plus.

## Ce qui a été implémenté

Une seconde table de chaînes (`IFRS_CHAINS`) et une **détection** du couple
taxonomie/devise, `detectReporting`. Toute la machinerie existante est
réutilisée telle quelle : `collectAnnualDurations`, `collectInstants`,
`resolveSeries`, la déduplication par dépôt, le filtre 350-380 jours et
`sharesChangeWithinFiling` ne sont spécifiques à aucune taxonomie.

Résultat sur les 15 sociétés de l'échantillon plus les 6 américaines de
référence : **21 sur 21 produisent une série**, et aucune américaine ne bouge.

| | avant | après |
|---|---|---|
| Américaines (AAPL, MSFT, CAT, KO, MRVL, JPM) | inchangées | inchangées |
| ASML, Sony, Toyota | page vide | 19, 5 et 6 exercices |
| 12 déposants IFRS | page vide | 4 à 11 exercices |

### La devise ne se choisit pas, elle se mesure

Le point qui a fait abandonner l'idée initiale (« lire l'USD quand il existe ») :
publier *quelques* faits en dollars n'est pas publier *sa série* en dollars. SAP
expose 11 exercices en euros et **un seul** en dollars ; Diageo 8 en livres
contre 4 en dollars. Préférer le dollar par principe aurait donné une série d'un
exercice — donc aucun F-Score, qui exige trois bilans consécutifs.

`detectReporting` essaie donc chaque couple (taxonomie, devise) et compte les
couples (poste, exercice) réellement résolus.

### Le défaut que seules de vraies sociétés pouvaient révéler

Maximiser cette seule complétude était faux, et le test sur comptes réels l'a
montré : **trois sociétés changent de combinaison en cours de route, et
l'ancienne série est toujours la plus longue.**

- **Diageo** passe de la livre au dollar en 2024 → le rapport s'arrêtait à
  l'exercice 2023.
- **Toyota** et **Sony** passent de us-gaap à IFRS en 2021 → le rapport de Sony
  s'arrêtait à l'exercice **2021**, avec un chiffre d'affaires de 9 000 Md¥ au
  lieu de 12 957.

Rien ne le signalait : la page était complète, cohérente, et périmée de quatre
ans. D'où la règle retenue — **la récence prime sur la longueur de
l'historique** : les combinaisons en retard de plus d'un exercice
(`MAX_STALENESS_DAYS`) sont écartées, et la complétude ne départage que celles
qui restent.

### La capitalisation est refusée, pas approximée

Mesure sur 9 ADR : `dei:EntityCommonStockSharesOutstanding` compte les **actions
ordinaires**, alors que le cours Yahoo porte l'**ADS**, qui en représente souvent
plusieurs. Le rapport entre les deux n'est publié nulle part dans les données
SEC.

| | actions × cours | réalité | facteur |
|---|---|---|---|
| SAP, Novartis, Unilever, Rio Tinto, Infosys | correct | correct | 1 |
| Shell | 512 Md$ | ~256 Md$ | **2** |
| Diageo | 228 Md$ | ~57 Md$ | **4** |
| TSMC | **11 130 Md$** | ~1 100 Md$ | **10** |

Un PER faux d'un facteur 10 aurait l'air parfaitement normal. Le déclencheur
retenu est le formulaire annuel — 20-F ou 40-F contre 10-K — seul marqueur
fiable d'une cotation par ADR. Pour ces sociétés, les trois ratios de
valorisation et la ligne « lecture marché » ne sont pas affichés vides mais
**retirés**, avec la raison en clair. Le verdict, lui, est complet : ni le
F-Score ni le Z″ n'utilisent de cours.

## Limites connues, mesurées et assumées

- **Pas de repli sur le résultat avant impôt.** Shell ne publie aucun
  `ProfitLossFromOperatingActivities`, TotalEnergies plus depuis 2023. Les
  rabattre sur `ProfitLossBeforeTax` ferait sauter le Δ ROA sur un simple
  changement de définition — le piège Caterpillar appliqué au compte de
  résultat. Ces deux-là sortent à 6 et 5 tests sur 9, **sans verdict**, ce que
  l'UI dit déjà.
- **Marge brute absente chez les pétrolières et les minières** (SHEL, BP, TTE,
  RIO) : elles ne présentent pas de sous-total de marge. BP est rattrapé par
  `CostOfInventoriesRecognisedAsExpenseDuringPeriod`, sa ligne « Purchases ».
- **BP et TotalEnergies ne publient aucun décompte d'actions** : le test de
  dilution est non calculable, pas échoué.
- **`RetainedEarnings` manque chez BP, TotalEnergies, Novartis et Unilever** :
  pas de Z″ pour elles, X2 étant indispensable.
- **Altman sur un groupe à filiale financière.** Sony ressort à Z″ 0,62, sous le
  seuil de détresse, uniquement parce que son activité d'assurance gonfle
  l'actif sans besoin en fonds de roulement et porte un levier normal pour ce
  métier. Faux positif structurel, de la même famille que l'exclusion des
  financières par code SIC — sauf que Sony est classée en électronique. Pas de
  correctif : ajouter un seuil ici trahirait le principe qui a fait choisir
  Piotroski et Altman. L'encart de détresse le dit.

## Reproduire la mesure

`companyconcept` renvoie un seul concept, quelques Ko, contre ~1 Mo pour
`companyfacts` chez un déposant IFRS (~4 Mo en us-gaap) — c'est l'appel à
privilégier pour sonder un émetteur.

```bash
UA="Folio Portfolio Tracker <ton-email>"
CIK=0001000184   # SAP

# La taxonomie : celle qui répond 200 est la bonne
curl -s -o /dev/null -w "us-gaap  %{http_code}\n" -A "$UA" \
  "https://data.sec.gov/api/xbrl/companyconcept/CIK$CIK/us-gaap/Assets.json"
curl -s -o /dev/null -w "ifrs     %{http_code}\n" -A "$UA" \
  "https://data.sec.gov/api/xbrl/companyconcept/CIK$CIK/ifrs-full/Assets.json"

# La devise : les clés de `units`
curl -s -A "$UA" \
  "https://data.sec.gov/api/xbrl/companyconcept/CIK$CIK/ifrs-full/Assets.json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s).units)))"
```

Rappel : `data.sec.gov` accepte le UA navigateur, mais **rejette en 403 un UA
sans adresse e-mail** — cf. le piège correspondant dans CLAUDE.md.
