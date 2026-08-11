# Émetteurs étrangers — pourquoi ils ne sont pas notés, et ce qu'il faudrait

Mesure du 2026-08-11, à l'issue du chantier « analyse fondamentale ».
Contexte : l'onglet **Fonda** ne couvre que les sociétés américaines. On a voulu
savoir ce qu'il faudrait pour lever cette limite — et la réponse n'est pas celle
qu'on croyait.

## Le constat

Le resolver (`lib/xbrl.ts`) lit le namespace `us-gaap` et l'unité `USD`, tous
deux en dur. Deux causes d'échec distinctes se cachent derrière la même page
vide, et **ce n'est pas la devise qui domine**.

Échantillon de 15 ADR majeurs, interrogés sur `companyconcept` (`Assets`) :

| Société | Taxonomie | Unités publiées | Ce qui bloque |
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

**12 sur 15 déposent en IFRS**, et le cas « us-gaap mais devise étrangère » —
celui qu'ASML avait révélé et que `reportingCurrency` sait nommer — ne concerne
que 2 sociétés.

Le résultat décisif : **10 des 12 déposants IFRS publient en dollars**, souvent
en double devise à côté de leur monnaie domestique. Pour eux, la devise n'est
pas un problème du tout.

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
capitalisation (en devise de *cotation*, via Yahoo) à des comptes (en devise de
*publication*) :

- le PER, l'EV/résultat opérationnel et le rendement du FCF — **déjà hors
  score** par construction ;
- la ligne « lecture marché », qui n'est pas le verdict non plus.

Les montants absolus (FCF, dette nette) ne demandent pas de conversion, juste le
bon symbole.

## Le chemin recommandé

**Les chaînes IFRS avant la devise**, pour trois raisons :

1. **Le gain est plus large et immédiat.** Elles débloquent à elles seules 10
   des 12 sociétés IFRS de l'échantillon, qui publient en dollars — donc zéro
   travail de change. Ne resteraient hors périmètre que 4 sociétés sur 15 :
   Novo Nordisk, Unilever, ASML et Sony.
2. **Toute la machinerie est réutilisable.** `collectAnnualDurations`,
   `collectInstants`, `resolveSeries`, la déduplication par dépôt, le filtre
   350-380 jours et `sharesChangeWithinFiling` ne sont pas spécifiques à
   us-gaap. Seuls changent les **noms de tags** et la constante de namespace :
   une seconde table `CHAINS` et un paramètre, pas un second resolver.
3. **La devise devient ensuite un problème d'affichage**, pas de calcul : lire
   la série dans sa monnaie native, formater avec le bon symbole, et masquer le
   bloc valorisation tant qu'on n'a pas le taux. L'app ne dispose que d'EUR/USD,
   en dur, et CLAUDE.md est explicite sur le fait de ne pas faire mentir ce
   garde-fou (`detectCurrency` reste fidèle, c'est lui qui déclenche le blocage).

**L'écueil à prévoir est le même que pour us-gaap** : les noms de tags IFRS ne
seront pas universels non plus. Il faudra les mesurer société par société avant
de figer les chaînes — c'est cette méthode, et elle seule, qui a fait sortir les
six défauts silencieux du chantier initial (splits, ordre des chaînes, devise,
Altman hors domaine, grille écrasée, infobulles découpées).

## Reproduire la mesure

`companyconcept` renvoie un seul concept, quelques Ko, contre ~4 Mo pour
`companyfacts` — c'est l'appel à privilégier pour sonder un émetteur.

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
