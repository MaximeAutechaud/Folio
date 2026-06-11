# Plan d'action — Folio : du générateur de signaux à l'outil de swing complet

> Contexte : audit fonctionnel 2026-06-11. Public cible : investisseurs peu expérimentés (crypto + bourse)
> cherchant à capter rotations sectorielles / retournements pour du swing trade.
> Diagnostic : l'app génère de bons signaux d'entrée mais n'a ni gestion de sortie, ni sizing,
> ni feedback loop. Priorités ci-dessous dans l'ordre d'exécution recommandé.
>
> Conventions à respecter (voir CLAUDE.md) : HTTP via `invoke('fetch_url')` uniquement, migrations
> inline dans `db.ts` (chaque `migrateToVN` écrit son numéro en dur), UI dark dense, tooltips
> `data-tooltip` + CSS `::after`, inputs décimaux en `type="text"` + regex.

---

## Phase 1 — Risk management intégré au flux d'entrée (priorité absolue)

### Fonctionnel
- À la création/édition d'une position ou transaction d'achat, proposer (non bloquant) :
  - un **stop loss** (prix ou %, défaut suggéré : -8% pour stock, -15% pour crypto)
  - un **objectif** (take profit) optionnel
- Afficher en live dans le formulaire : « Risque : X € (Y% du portefeuille) » calculé comme
  `(prix_entrée - stop) × quantité`, converti en devise de base via `convertCurrency`.
- Dashboard : badge discret ⚠ sur les lignes **sans stop défini** (tooltip pédagogique).
- PositionDrawer : afficher stop / objectif / risque actuel, distance au stop en %.
- Le stop défini crée automatiquement une `alert_rule` de type `stop_loss` (le moteur existe déjà
  dans `useAlertEngine` — réutiliser, ne pas dupliquer).

### Technique
- **Migration v6** : `ALTER TABLE positions ADD COLUMN stop_price REAL` + `ADD COLUMN target_price REAL`.
  Guard par `pragma_table_info` (pattern existant de la colonne `currency`, voir `migrateToV5`).
- `types/index.ts` : étendre `Position` / `PositionInput`.
- `PositionForm.tsx` : section repliable "Risk" (2 inputs + ligne de calcul live).
  Le calcul du % portefeuille utilise `computeTotals` du store.
- `Dashboard.tsx` : badge conditionnel `!position.stop_price`.
- `PositionDrawer.tsx` : stats row stop/target/risque.
- Sync alerte : à l'insert/update de position avec stop, upsert d'une `alert_rule`
  (`scope: 'ticker'`, `scope_id: ticker`, `threshold: stop_price`). Supprimer la règle si stop retiré.

---

## Phase 2 — Journal de trades avec raison d'entrée

### Fonctionnel
- À chaque transaction buy (et au swap), champ optionnel **« Setup / raison »** : un select de
  setups prédéfinis (`dip secteur`, `reversal RS`, `breakout`, `macro favorable`, `conviction long terme`, `autre`)
  - texte libre court.
- Capturer automatiquement le **contexte au moment de l'entrée** : MacroScore + régime, score du
  secteur parent si identifiable, RSI du ticker. Stocké en JSON — c'est la matière du feedback loop (Phase 3).
- Nouvelle vue « Journal » (sous-tab du Portfolio ou section du PositionDrawer) : liste chronologique
  des trades clôturés avec : setup déclaré, contexte capturé, P&L réalisé, durée de détention.

### Technique
- **Migration v7** : `ALTER TABLE transactions ADD COLUMN setup TEXT`, `ADD COLUMN note_context TEXT`
  (JSON : `{ macroScore, regime, sectorScore?, rsi? }`).
- `TransactionForm.tsx` : select setup (réutiliser le composant `Select`) + le contexte est capturé
  silencieusement depuis le cache TanStack (`queryClient.getQueryData(['macro-score'])` etc. —
  ne PAS déclencher de fetch pour ça ; si absent du cache, stocker null).
- P&L réalisé : appairer les sells aux buys en FIFO dans un helper `lib/tradeJournal.ts`
  (pur, testable) — entrée : `Transaction[]` d'une position, sortie : trades clôturés avec P&L.
- Composant `TradeJournal/` : table dense, filtres par setup, total P&L par setup
  (c'est LA stat utile : « mes dips marchent, mes breakouts perdent »).

---

## Phase 3 — Tracking de la performance des signaux

### Fonctionnel
- Chaque jour où un secteur/narrative émet un signal (`dip`, `reversal`, `accelerating`, `exhaustion`),
  l'enregistrer silencieusement. Mesurer ensuite la perf relative vs SPY à J+5, J+10, J+20.
- Vue « Signaux » (section dans Market tab) : table par type de signal — taux de réussite
  (% de cas où relPerf J+10 > 0), perf moyenne, nombre d'occurrences. Badge "échantillon faible" si n < 10.
- But : calibrer les seuils de `scoring.ts` sur du réel, et apprendre à l'utilisateur la fiabilité
  relative de chaque signal.

### Technique
- **Migration v8** : table `signal_log` (id, date TEXT unique avec scope, scope ('sector'|'narrative'),
  scope_id, signal TEXT, score INTEGER, rel_perf_at REAL NULL ×3 colonnes j5/j10/j20).
  Index sur (scope, scope_id, date). `UNIQUE(date, scope, scope_id)` + INSERT OR IGNORE → 1 log/jour max.
- Enregistrement : piggyback dans `useAlertEngine` (il observe déjà les queries sector-perfs,
  même pattern que le moteur d'alertes — debounce déjà en place).
- Backfill des perfs : au démarrage (après migrations), job qui prend les rows avec `rel_perf_j5 IS NULL`
  et `date <= today-5`, recalcule depuis `fetchYahooHistory(etf, '3M')` vs SPY (réutiliser le cache
  `['sector-raw']` quand possible). Idem j10/j20.
- Composant `SignalStats.tsx` dans MarketView : agrégation SQL simple
  (`AVG(rel_perf_j10)`, `COUNT(*)`, `SUM(rel_perf_j10 > 0)` GROUP BY signal).

---

## Phase 4 — Volet rotation crypto

### Fonctionnel
- Le Market tab actuel est actions-only (référentiel SPY) — l'assumer dans l'UI (sous-titre "Actions US").
- Nouveau sous-tab « Crypto » dans MarketView avec les référentiels propres au crypto :
  - **BTC Dominance** (proxy : ratio market caps via CoinGecko `/global`)
  - **ETH/BTC** (signal alt-season classique)
  - Top catégories CoinGecko (L1, L2, DeFi, AI…) : perf 7d/30d relative à BTC — l'équivalent
    des secteurs vs SPY, mais vs BTC.
- Même grammaire visuelle que la rotation actions : cartes, relPerf, sparklines, momentum.

### Technique
- API : CoinGecko `/global` (dominance), `/coins/markets?category=X` (catégories),
  `/coins/{id}/market_chart` (historiques). Respecter le rate limit free tier (10-30 req/min) :
  staleTime 10 min minimum, fetch séquentiel avec délai si besoin.
- `lib/cryptoSectors.ts` : liste statique des catégories suivies (id CoinGecko, label, couleur) —
  miroir de `sectors.ts`.
- `useCryptoRotation.ts` : hook calqué sur `useSectorPerfs` mais benchmark = BTC.
  Réutiliser `sliceByDays`/`calcPerf` → **les extraire d'abord dans `lib/perf.ts`**
  (ils sont actuellement dupliqués dans useSectorData / useNarrativePerfs / useMacroScore).
- `CryptoDashboard.tsx` : copier la structure de `SectorDashboard` (cartes + drawer).

---

## Phase 5 — Garde-fous anti-surconfiance (quick wins UI)

### Fonctionnel
- **Earnings à venir** : dans SectorDrawer/NarrativeDrawer, badge "📅 earnings J-X" sur les holdings
  publiant sous 7 jours. Un signal `dip` pré-earnings est un piège — le rendre visible.
- Encart fixe sous le score d'opportunité : « Ce score ignore : earnings, news, liquidité.
  Il mesure uniquement le momentum relatif. » (texte statique, tooltip).
- Disclaimer une fois par session si MacroScore < 40 et l'utilisateur consulte un signal d'achat :
  « Contexte macro défavorable — les signaux d'entrée sont moins fiables en régime risk-off. »

### Technique
- Earnings : Yahoo `v8/finance/chart` ne les fournit pas — utiliser
  `query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}?modules=calendarEvents`
  (via `fetch_url`, vérifier que l'endpoint répond encore — sinon fallback : ne pas afficher).
  Query TanStack `['earnings', ticker]`, staleTime 24h, fetch uniquement à l'ouverture du drawer.
- Encart score : texte statique dans `SectorDashboard`/carte, zéro logique.
- Disclaimer : flag `useRef` en mémoire session dans MarketView, modal légère.

---

## Ordre d'exécution et dépendances

| Phase | Effort estimé | Dépend de | Migration DB |
|-------|--------------|-----------|--------------|
| 1 — Risk | moyen | — | v6 |
| 2 — Journal | moyen | v6 (pattern) | v7 |
| 3 — Signal tracking | moyen+ | — | v8 |
| 5 — Garde-fous | faible | — | — |
| 4 — Crypto | élevé | extraction `lib/perf.ts` | — |

Recommandation : 1 → 2 → 5 → 3 → 4. La phase 5 peut s'intercaler n'importe où (indépendante).
La phase 4 est la plus grosse et la moins critique — à faire en dernier ou à découper.

## Règles pour l'exécution (Sonnet)
- Une phase = une session/branche. Vérifier `npx tsc --noEmit` après chaque étape.
- Ne pas modifier `lib/scoring.ts` ni `lib/macroScore.ts` (calibration en cours via Phase 3).
- Toute nouvelle migration suit le pattern v4/v5 : guard par existence de table/colonne, numéro en dur.
- Pas de nouvelle dépendance npm sans validation.
- Mettre à jour `docs/ARCHITECTURE.md` (pas CLAUDE.md, sauf nouveau piège technique) à la fin de chaque phase.
