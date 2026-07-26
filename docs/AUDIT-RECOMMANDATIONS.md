# Audit produit et technique — Folio

**Date de l'audit :** 22 juillet 2026  
**Périmètre :** application desktop Folio, frontend React/TypeScript, backend Tauri/Rust, stockage SQLite, logique de portefeuille et fonctionnalités d'aide au swing trading.  
**Public cible :** investisseurs débutants et intermédiaires pratiquant le swing trading.

## 1. Résumé exécutif

Folio est une application locale de suivi de portefeuille et d'aide à la décision pour le swing trading. Le projet dépasse largement le cadre d'un simple portfolio tracker : il relie le contexte macroéconomique, la rotation sectorielle, la sélection de thèmes, la gestion du risque, les alertes, le journal de trades et un briefing IA optionnel.

Le produit possède une vision cohérente et une base technique sérieuse. Sa principale force est de couvrir le cycle complet d'un trade : recherche, préparation, suivi, sortie et retour d'expérience.

Le prochain palier de maturité ne dépend pas prioritairement de nouveaux indicateurs. Il dépend surtout de quatre axes :

1. fiabiliser les calculs financiers ;
2. rendre les limites des données et des scores plus visibles ;
3. simplifier l'expérience des débutants ;
4. renforcer la sécurité, les sauvegardes et la maintenabilité.

### Évaluation synthétique

| Domaine | Appréciation | Commentaire |
|---|---:|---|
| Vision produit | Très bonne | Parcours cohérent avec la discipline du swing trading |
| Architecture | Bonne | Adaptée à une application locale mono-utilisateur |
| Logique métier | Bonne à très bonne | Calculs purs isolés et largement testés |
| Pertinence pour un intermédiaire | Forte | Véritable cockpit personnel de trading |
| Accessibilité pour un débutant | Moyenne | Densité fonctionnelle et vocabulaire avancé |
| Fiabilité financière | À consolider | Devises, cash-flows, snapshots et frais |
| Sécurité locale | À renforcer | Clé API en clair, CSP absente, proxy HTTP permissif |
| Maturité de diffusion | Prototype avancé | Solide pour usage personnel, encore perfectible pour le public |

## 2. Compréhension du produit

Folio comporte six espaces fonctionnels :

1. **Portfolio** : positions, liquidités, transactions, prix, P&L et événements corporate.
2. **Charts** : graphiques individuels par actif.
3. **Market** : rotation sectorielle, narratives et contexte macro.
4. **Watchlist** : suivi des candidats et classement par catégories.
5. **Trades** : journal des opérations clôturées et statistiques par setup.
6. **IA** : briefing généré à partir d'un snapshot déterministe des données de l'application.

Le parcours produit implicite est le suivant :

```text
Contexte macro
      ↓
Secteurs et thèmes forts
      ↓
Watchlist et sélection d'un actif
      ↓
Entrée avec stop et taille suggérée
      ↓
Alertes et objectifs
      ↓
Sortie
      ↓
Journal et analyse des résultats
```

Ce parcours est particulièrement pertinent pour le swing trading, car il impose une logique de préparation et d'apprentissage plutôt qu'une simple observation du rendement.

## 3. Architecture actuelle

### 3.1 Technologies

| Couche | Technologie | Rôle |
|---|---|---|
| Interface | React 19 + TypeScript | Écrans et interactions |
| État local | Zustand | Portefeuille, prix et transactions en mémoire |
| Données distantes | TanStack Query | Cache, rafraîchissement et gestion des appels marché |
| Graphiques | Lightweight Charts | Visualisations financières |
| Persistance | SQLite | Données entièrement locales |
| Shell desktop | Tauri 2 | Packaging et intégration système |
| Backend | Rust | Proxy HTTP et appels Anthropic |
| Données actions/ETF | Yahoo Finance | Cotations, historiques et événements corporate |
| Données crypto | CoinGecko | Prix, recherche et historiques crypto |
| Briefing optionnel | Anthropic | Synthèse des données calculées par Folio |

### 3.2 Points forts techniques

- La logique financière pure est isolée dans `src/lib`.
- Les appels distants sont centralisés et mis en cache.
- Le stockage local est cohérent avec le positionnement confidentiel du produit.
- Le backend Rust reste volontairement mince.
- Les calculs sensibles disposent d'une bonne couverture unitaire.
- La gestion des opérations distingue achats, ventes, swaps, splits, actions gratuites et dividendes.
- Le briefing IA reçoit des métriques déjà calculées au lieu de recalculer librement les données.

### 3.3 État des validations au moment de l'audit

- **Tests :** 128 tests réussis sur 128, répartis dans 9 fichiers.
- **TypeScript/Vite :** build de production réussi.
- **Rust :** `cargo check` réussi.
- **Bundle initial :** environ 687 Ko de JavaScript minifié, 215 Ko compressé.
- **Avertissement de build :** l'import dynamique de `db.ts` ne produit pas de découpage, car le module est aussi importé statiquement.

## 4. Forces produit à préserver

### 4.1 Gestion du risque avant l'entrée

Folio propose déjà plusieurs mécanismes précieux :

- stop loss ;
- TP1 et TP2 ;
- raisonnement en multiples de R ;
- taille de position suggérée selon un budget de risque ;
- avertissement de concentration ;
- prise en compte du régime macro ;
- avertissement en l'absence de stop.

Cette logique doit rester au centre du produit. Elle apporte plus de valeur pédagogique qu'une accumulation d'indicateurs supplémentaires.

### 4.2 Journal et boucle d'apprentissage

Le journal permet d'étudier :

- le taux de réussite ;
- le rendement moyen ;
- l'expectancy ;
- les multiples de R ;
- la durée des trades gagnants et perdants ;
- les résultats par setup.

Cette boucle est essentielle pour aider l'utilisateur à comprendre si son processus fonctionne réellement.

### 4.3 Lecture structurée du marché

Le score sectoriel combine force relative, RSI, drawdown et alignement macro. Les signaux sont explicites et hiérarchisés. La présence d'un suivi des performances futures des signaux est une bonne base pour éviter que le score ne reste purement théorique.

### 4.4 Positionnement local-first

L'absence de compte et de cloud central est différenciante. Elle protège la confidentialité et réduit les coûts d'infrastructure. Cette promesse doit cependant être accompagnée d'outils fiables de sauvegarde et de restauration.

## 5. Recommandations prioritaires

## 5.1 Priorité P0 — Fiabilité financière

Les éléments P0 doivent être traités avant d'utiliser Folio comme source de performance fiable ou avant une diffusion large.

### P0.1 — Corriger la conversion multi-devise

#### Constat

L'interface autorise notamment EUR, USD, GBP, CAD, AUD, JPY et CHF. La fonction de conversion ne dispose pourtant que du taux EUR/USD. Toute devise autre que l'EUR est implicitement traitée comme de l'USD.

#### Risques

- valorisation incorrecte des positions britanniques, canadiennes, japonaises ou suisses ;
- P&L incorrect ;
- poids de position incorrect ;
- taille suggérée et budget de risque incorrects ;
- briefing IA alimenté par des montants erronés.

#### Recommandation

Choisir l'une des deux stratégies suivantes :

1. limiter explicitement le produit à EUR et USD à court terme ;
2. mettre en place une table de taux vers une devise canonique, avec source, date et statut de fraîcheur.

La seconde solution est préférable pour la vision produit actuelle.

#### Critères d'acceptation

- chaque devise proposée possède un taux réel ;
- une devise sans taux est signalée et n'est pas valorisée silencieusement ;
- les conversions EUR → GBP, GBP → USD et JPY → EUR sont testées ;
- l'heure et la source du taux sont disponibles ;
- les calculs de risque utilisent la même infrastructure de conversion que la valorisation.

### P0.2 — Séparer performance et apports/retraits

#### Constat

Le P&L par période compare la valeur actuelle à un ancien snapshot. Un apport de liquidités ressemble alors à un gain et un retrait à une perte.

#### Risques

- rendement historique trompeur ;
- graphiques difficiles à interpréter ;
- mauvaise évaluation de la stratégie ;
- décisions prises sur une performance artificielle.

#### Recommandation

- enregistrer explicitement les apports et retraits ;
- calculer un rendement pondéré dans le temps, ou TWR ;
- proposer éventuellement un rendement pondéré par les flux, ou XIRR, dans une vue avancée ;
- distinguer visuellement « variation de valeur » et « performance de marché ».

#### Critères d'acceptation

- un apport de 5 000 € ne modifie pas le pourcentage de performance ;
- un retrait ne crée pas de perte artificielle ;
- les tests couvrent plusieurs flux entrants et sortants ;
- l'utilisateur peut consulter le capital net versé séparément de la performance.

### P0.3 — Normaliser la devise des snapshots

#### Constat

Les snapshots enregistrent une valeur et un coût sans enregistrer leur devise. Si l'utilisateur change sa devise d'affichage, une série peut mélanger des montants EUR et USD.

#### Recommandation

- conserver tous les snapshots dans une devise canonique unique ; ou
- ajouter la devise et le taux appliqué au snapshot, puis normaliser à la lecture.

La devise canonique est la solution la plus simple et la plus robuste.

#### Critères d'acceptation

- changer la devise d'affichage ne crée aucun saut dans l'historique ;
- les anciens snapshots peuvent être migrés ou clairement invalidés ;
- le graphique convertit toute la série de manière homogène.

### P0.4 — Intégrer tous les frais dans le journal

#### Constat

Les frais d'acquisition entrent dans le PRU, mais le P&L des trades clôturés ne retire pas complètement les frais de sortie et ne répartit pas nécessairement les frais sur les lots consommés.

#### Recommandation

- répartir les frais d'entrée au prorata des lots ;
- soustraire les frais de vente ;
- calculer le P&L brut et net ;
- utiliser le P&L net dans l'expectancy et les statistiques par setup.

#### Critères d'acceptation

- un aller-retour au même prix avec frais produit une perte ;
- une vente partielle répartit correctement les frais ;
- P&L brut et net sont identifiables ;
- les tests couvrent achats multiples, vente partielle et frais dans des devises différentes.

### P0.5 — Clarifier le fonctionnement des alertes

#### Constat

Le moteur d'alertes est exécuté par l'interface React. Les seuils ne sont donc plus surveillés lorsque Folio est fermé.

#### Recommandation court terme

- afficher clairement « alertes actives uniquement lorsque Folio est ouvert » ;
- afficher la dernière heure d'évaluation ;
- indiquer les erreurs ou données manquantes.

#### Recommandation long terme

Déplacer l'évaluation dans un service Tauri en arrière-plan ou une tâche système, si cela est compatible avec le positionnement et les plateformes ciblées.

## 5.2 Priorité P1 — Transparence et maîtrise du risque

### P1.1 — Afficher la fraîcheur et la qualité des données

#### Constat

Un rafraîchissement toutes les 60 secondes ne garantit pas une cotation temps réel. Yahoo Finance est une source non officielle et certaines données peuvent être retardées, absentes ou correspondre à la dernière clôture.

#### Recommandation

Pour chaque donnée importante, afficher si possible :

- source ;
- heure de dernière cotation ;
- état du marché ;
- dernière clôture ou donnée intraday ;
- indicateur de retard ;
- état d'erreur explicite.

Une donnée absente ne doit jamais être confondue avec zéro.

### P1.2 — Présenter le score comme une heuristique, pas une probabilité

#### Constat

Le score sectoriel est construit de manière cohérente, mais ses pondérations et seuils restent heuristiques. Un score de 72 ne signifie pas automatiquement 72 % de chances de réussite.

#### Recommandation

- ajouter une mention courte à proximité du score ;
- afficher le nombre d'observations historiques par signal ;
- conserver le badge « échantillon faible » tant que nécessaire ;
- afficher performance moyenne, médiane et dispersion ;
- segmenter les résultats par régime macro et volatilité ;
- valider les seuils en walk-forward ;
- séparer les périodes de calibration et d'évaluation.

### P1.3 — Calculer le risque ouvert total

#### Objectif

Passer d'un contrôle position par position à une vision portefeuille.

#### Métriques suggérées

- risque ouvert total en euros et en pourcentage ;
- risque par secteur ;
- exposition brute et nette ;
- nombre de positions sans stop ;
- concentration par actif et secteur ;
- scénarios de perte si tous les stops sont touchés ;
- corrélation approximative entre positions.

#### Point pédagogique

Dix positions risquant chacune 1 % ne représentent pas forcément seulement 1 % de risque global, notamment lorsqu'elles sont corrélées.

### P1.4 — Ajouter les événements et contraintes propres au swing trading

Ordre recommandé :

1. calendrier des résultats ;
2. ATR et stop basé sur la volatilité ;
3. liquidité moyenne ;
4. volume relatif ;
5. exposition sectorielle ;
6. trailing stop ;
7. règle de sortie temporelle ;
8. checklist personnalisable avant entrée.

Ces fonctionnalités sont plus utiles que l'ajout de nouveaux oscillateurs redondants.

### P1.5 — Créer une expérience progressive pour les débutants

#### Recommandation

Introduire deux niveaux de lecture :

**Mode Essentiel**

- portefeuille ;
- watchlist ;
- stop ;
- taille de position ;
- risque ouvert ;
- journal simple.

**Mode Avancé**

- macro ;
- rotation sectorielle ;
- narratives ;
- scoring détaillé ;
- alertes techniques avancées ;
- statistiques approfondies.

#### Compléments pédagogiques

- glossaire contextuel ;
- explication « pourquoi cet avertissement ? » ;
- exemples concrets de R et de taille de position ;
- checklist d'entrée ;
- message explicite lorsqu'un indicateur ne constitue pas un signal d'achat.

## 5.3 Priorité P1 — Sécurité et résilience

### P1.6 — Protéger la clé API Anthropic

#### Constat

La clé est locale, mais stockée en clair dans la table SQLite des paramètres.

#### Recommandation

Utiliser le coffre du système d'exploitation :

- Windows Credential Manager ;
- macOS Keychain ;
- Secret Service sous Linux.

L'interface doit distinguer « stockée localement » et « chiffrée/protégée par le système ».

### P1.7 — Restreindre le proxy HTTP Rust

#### Constat

Le command `fetch_url` accepte une URL arbitraire. La Content Security Policy est également désactivée.

#### Recommandation

- autoriser uniquement HTTPS ;
- ajouter une liste blanche de domaines ;
- définir des timeouts ;
- vérifier les statuts HTTP ;
- limiter la taille des réponses ;
- retourner des erreurs structurées ;
- configurer une CSP explicite ;
- vérifier si le plugin opener est réellement nécessaire.

### P1.8 — Mettre en place sauvegarde, export et restauration

#### Constat

Une base locale unique protège la confidentialité, mais devient aussi un point unique de perte.

#### Recommandation

- export complet versionné ;
- import avec validation avant mutation ;
- sauvegarde automatique rotative ;
- restauration guidée ;
- export CSV des positions, transactions et trades ;
- vérification d'intégrité de la base.

#### Critères d'acceptation

- une sauvegarde peut recréer un profil complet sur une installation neuve ;
- un import incompatible est refusé sans altérer la base ;
- les sauvegardes ne contiennent pas la clé API en clair ;
- l'utilisateur connaît l'emplacement et la date de sa dernière sauvegarde.

## 5.4 Priorité P2 — Architecture et maintenance

### P2.1 — Découper la couche SQLite

`src/lib/db.ts` regroupe actuellement migrations et accès à tous les domaines. Une structure possible :

```text
src/lib/db/
  connection.ts
  migrations/
    index.ts
    v001.ts
    ...
  positions.ts
  transactions.ts
  alerts.ts
  watchlist.ts
  narratives.ts
  signals.ts
  settings.ts
```

Ce découpage doit préserver une seule connexion partagée et éviter les dépendances circulaires.

### P2.2 — Normaliser les migrations

#### Constat

Le code migre jusqu'à une version supérieure à la constante de schéma déclarée. Certaines migrations sont protégées par présence de table ou de colonne, ce qui les rend robustes, mais l'état global est difficile à lire.

#### Recommandation

- une migration par fichier ;
- numéro écrit explicitement dans chaque migration ;
- exécution transactionnelle ;
- version mise à jour seulement après succès ;
- test sur base vide ;
- test depuis chaque version ancienne soutenue ;
- documentation du schéma générée ou maintenue avec le code.

### P2.3 — Réduire le bundle initial

Charger à la demande les vues lourdes :

- Market ;
- Charts ;
- Trades ;
- IA.

Utiliser `React.lazy` et des frontières de chargement par onglet. Examiner également un découpage manuel des bibliothèques graphiques et des fonctions de briefing.

### P2.4 — Étendre les tests d'intégration

La couverture de logique pure est bonne. Les prochains tests devraient viser :

1. migrations SQLite réelles ;
2. transaction complète achat → vente → journal ;
3. swaps liés et suppression ;
4. événements corporate ;
5. changement de devise ;
6. erreurs réseau et données partielles ;
7. alertes one-shot et réarmement ;
8. composants critiques React ;
9. commandes Rust et restrictions d'URL ;
10. sauvegarde et restauration.

### P2.5 — Ajouter une gestion structurée des erreurs

Plusieurs appels absorbent les erreurs ou les envoient seulement dans la console. Pour une application financière, il faut distinguer :

- donnée absente ;
- source indisponible ;
- ticker invalide ;
- limite d'API ;
- donnée obsolète ;
- erreur de conversion ;
- erreur locale de base.

Une bannière globale non intrusive et un panneau de diagnostic pourraient centraliser ces états.

## 5.5 Priorité P2 — UX et cohérence produit

### P2.6 — Sécuriser les suppressions

Les suppressions de positions ou transactions peuvent altérer l'historique et les statistiques.

Ajouter :

- confirmation explicite ;
- résumé des conséquences ;
- possibilité d'annuler pendant quelques secondes ;
- sauvegarde recommandée avant une opération importante ;
- option d'archivage d'une position à la place de la suppression.

### P2.7 — Mettre la documentation à jour

Le README décrit encore largement le tracker initial. Il doit refléter :

- les six onglets ;
- le journal ;
- les alertes ;
- la gestion du risque ;
- les événements corporate ;
- le scoring ;
- le briefing IA ;
- les limites des sources de données ;
- le fonctionnement local des alertes ;
- la procédure de sauvegarde.

La documentation d'architecture et les numéros de migration doivent également être réalignés avec le code.

### P2.8 — Améliorer l'accessibilité

Prévoir un audit spécifique portant sur :

- navigation clavier ;
- focus visible ;
- noms accessibles des boutons icônes ;
- contraste ;
- alternatives aux informations transmises uniquement par couleur ;
- comportement des modales ;
- annonces des erreurs et chargements ;
- taille minimale des zones cliquables.

## 6. Proposition de feuille de route

## Phase A — Exactitude des chiffres

**Objectif :** rendre les valorisations et performances fiables.

- infrastructure multi-devise ;
- devise canonique des snapshots ;
- modèle d'apports/retraits ;
- rendement TWR ;
- frais complets dans le journal ;
- tests d'intégration financiers.

**Condition de sortie :** les chiffres restent cohérents lors d'un changement de devise, d'un apport, d'un retrait et d'une vente avec frais.

## Phase B — Sécurité et résilience

**Objectif :** protéger les secrets et les données locales.

- coffre système pour la clé API ;
- proxy HTTP restreint ;
- CSP ;
- sauvegarde/export/import ;
- confirmations de suppression ;
- tests de restauration.

**Condition de sortie :** une installation peut être restaurée sans perte et aucune clé n'est présente dans les exports ordinaires.

## Phase C — Transparence des signaux et des données

**Objectif :** réduire la surconfiance.

- fraîcheur et source des cotations ;
- erreurs réseau visibles ;
- taille d'échantillon des signaux ;
- statistiques par régime ;
- validation walk-forward ;
- distinction score/probabilité.

**Condition de sortie :** l'utilisateur comprend ce que mesure chaque score, ce qu'il ne mesure pas et sur combien d'observations il repose.

## Phase D — Risque portefeuille

**Objectif :** dépasser la gestion position par position.

- risque ouvert total ;
- exposition sectorielle ;
- scénarios aux stops ;
- corrélations ;
- limite de risque configurable ;
- tableau de bord des positions sans stop.

**Condition de sortie :** l'utilisateur peut estimer la perte prévue si plusieurs trades évoluent défavorablement ensemble.

## Phase E — Expérience débutant

**Objectif :** rendre Folio accessible sans retirer sa profondeur.

- mode Essentiel/Avancé ;
- glossaire ;
- checklist d'entrée ;
- explications contextuelles ;
- onboarding orienté processus ;
- exemples de calcul du risque.

**Condition de sortie :** un nouvel utilisateur peut préparer un trade avec stop et taille cohérente sans comprendre immédiatement tous les indicateurs macro.

## Phase F — Enrichissement swing trading

**Objectif :** intégrer les risques événementiels et la volatilité.

- earnings ;
- ATR ;
- liquidité ;
- volume relatif ;
- trailing stops ;
- sorties temporelles ;
- checklists personnalisables.

## Phase G — Maintenabilité et performance

**Objectif :** préparer la croissance du code.

- découpage de `db.ts` ;
- migrations normalisées ;
- chargement paresseux des onglets ;
- tests UI et Rust ;
- documentation alignée ;
- diagnostic centralisé.

## 7. Backlog recommandé

| ID | Sujet | Priorité | Impact | Effort estimatif |
|---|---|---:|---:|---:|
| FIN-01 | Conversion multi-devise réelle | P0 | Très élevé | Moyen |
| FIN-02 | Devise canonique des snapshots | P0 | Très élevé | Moyen |
| FIN-03 | Apports/retraits et TWR | P0 | Très élevé | Élevé |
| FIN-04 | Frais nets dans le journal | P0 | Élevé | Moyen |
| ALT-01 | Limites et dernière évaluation des alertes | P0 | Élevé | Faible |
| DATA-01 | Fraîcheur, source et statut des cotations | P1 | Élevé | Moyen |
| RISK-01 | Risque ouvert total | P1 | Très élevé | Moyen |
| RISK-02 | Exposition sectorielle et corrélation | P1 | Élevé | Élevé |
| SCORE-01 | Échantillons et validation walk-forward | P1 | Très élevé | Élevé |
| SEC-01 | Clé API dans le coffre système | P1 | Élevé | Moyen |
| SEC-02 | Restriction du proxy et CSP | P1 | Élevé | Moyen |
| DATA-02 | Sauvegarde, export et restauration | P1 | Très élevé | Moyen |
| UX-01 | Mode Essentiel/Avancé | P1 | Élevé | Élevé |
| SWING-01 | Calendrier des earnings | P1 | Élevé | Moyen |
| SWING-02 | ATR et stops de volatilité | P1 | Élevé | Moyen |
| ARCH-01 | Découpage de la couche DB | P2 | Moyen | Moyen |
| ARCH-02 | Migrations versionnées et testées | P2 | Élevé | Moyen |
| PERF-01 | Lazy loading des onglets | P2 | Moyen | Faible à moyen |
| TEST-01 | Tests DB, UI et Rust | P2 | Élevé | Élevé |
| UX-02 | Confirmations et archivage | P2 | Moyen | Faible |
| DOC-01 | Mise à jour de la documentation | P2 | Moyen | Faible |
| A11Y-01 | Audit et corrections d'accessibilité | P2 | Moyen | Moyen |

## 8. Principes directeurs proposés

Les évolutions futures peuvent être évaluées selon les principes suivants :

1. **Exactitude avant richesse fonctionnelle.** Un chiffre incomplet doit être signalé plutôt qu'affiché comme certain.
2. **Risque avant rendement.** Le produit doit montrer ce qui peut être perdu avant ce qui peut être gagné.
3. **Processus avant prédiction.** Folio aide à préparer et évaluer une décision ; il ne prédit pas le marché.
4. **Heuristique visible.** Chaque score indique ce qu'il mesure, ce qu'il ignore et la qualité de son historique.
5. **Progressivité.** La profondeur reste disponible sans être imposée au débutant.
6. **Local-first résilient.** Le stockage local implique sauvegarde, restauration et protection des secrets.
7. **Une source de vérité par calcul.** Conversion, score, performance et risque ne doivent pas être dupliqués dans plusieurs composants.
8. **Échec explicite.** Une donnée indisponible ne devient ni zéro ni une ancienne valeur sans indication.

## 9. Conclusion

Folio possède déjà un cœur produit pertinent et différenciant. Son architecture est saine pour son échelle, sa logique métier est lisible et les tests existants apportent une bonne confiance dans les fonctions pures.

Le projet doit maintenant consolider ses fondations financières et opérationnelles. Les sujets les plus urgents sont la conversion multi-devise, le traitement des cash-flows, l'unité des snapshots et l'intégration complète des frais. Ils conditionnent directement la confiance que l'utilisateur peut accorder aux chiffres.

Après cette consolidation, le meilleur axe de développement est la maîtrise du risque portefeuille et la pédagogie. Les earnings, l'ATR, la liquidité et les corrélations enrichiront ensuite utilement le produit, à condition de ne pas transformer les scores en promesses prédictives.

La vision générale est solide : Folio peut devenir un véritable journal de décision et de progression pour swing traders, à condition de rester un outil de processus, de transparence et de discipline plutôt qu'une machine à produire des signaux.
