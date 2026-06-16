# Folio — Investment Portfolio Tracker

Tauri 2 (Rust) + React + Vite + TypeScript. TanStack Query v5, Lightweight Charts v5, Zustand, SQLite (tauri-plugin-sql).
4 tabs : Portfolio · Charts · Market · Watchlist. Architecture détaillée → `docs/ARCHITECTURE.md`.

## Contraintes
- **Un seul command Rust** : `fetch_url` (reqwest) — tous les appels HTTP passent par `invoke('fetch_url', { url })` pour contourner le CORS de Yahoo dans WebView2. Ne jamais appeler fetch() directement.
- UI dark mode dense, JetBrains Mono, palette GitHub dark (variables dans `globals.css`).
- Toutes les données en local (SQLite), aucun cloud.

## Data Model (schema_version v8)
- `positions` : id, ticker, name, asset_type (stock|crypto|fiat), currency, quantity, cost_basis, stop_price, target_price, target_price_2
- `transactions` : position_id (FK CASCADE), type (buy|sell|swap_out|swap_in|split|bonus_share|dividend), linked_tx_id (paire swap), setup, note_context
- `snapshots` : total_value, total_cost, recorded_at
- `narratives` + `narrative_tickers` + `narrative_keywords` (migration v2)
- `alert_rules` + `alert_events` (migration v3)
- `watchlist` + `watchlist_categories` (migrations v4/v5)
- `dismissed_corporate_actions` (ticker, type, ex_date) : événements Yahoo (split/dividende) ignorés par l'user, pour ne plus les re-proposer (migration v8)
- `settings` : key/value
- Migrations inline dans `db.ts` — v2/v3 guardées par `schema_version`, v4/v5/v8 par existence de table dans `sqlite_master` (auto-répare les DBs mal estampillées par un ancien bug).

## Pièges à éviter absolument
- **Yahoo Finance** : v7 → 401. Toujours `v8/finance/chart/{symbol}`.
- **Tickers crypto** : on stocke le CoinGecko ID (`bitcoin`, `ethereum`), pas le symbole. `symbolToId()` retourne l'ID. L'affichage extrait le symbole depuis le champ `name` (pattern `(BTC)` en fin de chaîne).
- **Tickers stocks** : format Yahoo requis (AIR.PA, ASML.AS…). Devise auto-détectée par `detectCurrency(ticker)` (suffixe `.PA` → EUR etc.).
- **Inputs quantité** : `type="text"` + regex `/^[0-9]*\.?[0-9]*$/` — ne pas passer à `type="number"`, ça casse `0.00001`.
- **MacroScore dupliqué** : `calcScore()` dans `useMacroScore.ts` (pour t-1W) ré-implémente la même pondération que le corps du hook. Tout changement de poids/bornes doit être fait aux deux endroits (et dans `useMacroScoreHistory`).
- **Code dormant** : `lib/api/alphavantage.ts` non utilisé. Les helpers `price_history`/`sentiment_history`/`fundamentals_history` dans `db.ts` pointent vers des tables droppées en v2 — ne pas appeler.
- **Migrations** : chaque `migrateToVN` doit écrire son propre numéro en dur, pas la constante `SCHEMA_VERSION`.
- **Transactions corporate — sémantique `price`/`quantity` surchargée** : pour les types `split`/`bonus_share`/`dividend`, ces deux champs ne veulent PAS dire « prix unitaire × quantité » comme pour buy/sell. `split` → `price`=ratio (2.0 = 2:1, 0.5 = regroupement), `quantity`=0. `bonus_share` → `quantity`=actions gratuites reçues, `price`=0 (dilue le PRU dans la branche `buy` de `computePRU`). `dividend` → `price`=montant/action, `quantity`=actions détenues à l'ex-date (no-op sur qty/PRU, sert au cumul revenus). Toute logique qui itère le ledger (`computePRU`, affichage drawer, stats) doit traiter ces types à part — ne jamais faire `quantity * price` aveuglément.
- **Split vs action gratuite** : Yahoo rapporte une attribution gratuite de fidélité (ex. Air Liquide 1-pour-10) comme un `split` de ratio 1.1. La modal laisse choisir Split/Action gratuite ; en mode gratuite on stocke un `bonus_share` de `sharesAtDate × (ratio−1)` (math identique au split). `isAlreadyLogged` (dans `useCorporateActionSync`) compte donc `bonus_share` comme satisfaisant un événement split, sinon re-proposition à chaque sync.

## Patterns établis
- Appels Yahoo : `YAHOO_RANGE` → `1W=5d/1h`, `1M=1mo/1d`, `3M=3mo/1d`, `1Y=1y/1wk`, `2Y=2y/1wk`
- Taux obligataires : `^TNX` (10Y), `^TYX` (30Y), `^IRX` (3M T-bill)
- RSI : `lib/indicators.ts` — `calcRsi` (valeur unique, Wilder) + `calcRsiSeries` (série)
- Sparklines : SVG inline pur, réutilise l'historique déjà en cache TanStack Query
- Tooltips : `data-tooltip` + CSS `::after` — `position: relative` requis sur le parent (préférer `border-radius` sur `colorBar` plutôt que `overflow: hidden`)
- Sector opportunity score : `lib/scoring.ts` — RS slope 40% / RSI entry 25% / drawdown 20% / macro align 15%
- `resolvePositions(positions, transactions)` : quantité/cost basis effectifs pour le portfolio

## Repo
https://github.com/MaximeAutechaud/Folio
