# Folio — Investment Portfolio Tracker

## Stack
- Tauri 2 (Rust desktop shell)
- React + Vite + TypeScript (frontend)
- TanStack Query v5 (price fetching & cache)
- Lightweight Charts v5 by TradingView (charts)
- Zustand (portfolio state)
- SQLite via tauri-plugin-sql (local persistence)

## Features implémentées

### Portfolio tab
- Ajout / édition / suppression de positions (ticker, quantité, cost basis, devise)
- Autocomplete ticker : Yahoo Finance search pour les stocks, CoinGecko search pour la crypto
- Prix actions & ETF via Yahoo Finance v8/finance/chart (un appel par ticker, pas de batch)
- Prix crypto via CoinGecko simple/price (IDs CoinGecko stockés directement comme ticker)
- Taux de change EURUSD via Yahoo Finance (EURUSD=X), rafraîchi toutes les 60s
- Multi-devise par position (EUR, USD, GBP…) avec conversion dans une devise de base toggleable (EUR/USD)
- Dashboard : valeur totale, coût total, P&L global + par ligne, filtre ALL/STOCK/CRYPTO
- Strip de périodes P&L dans la summary bar (1W / 1M / 3M / YTD / 1Y) calculée depuis les snapshots locaux
- Drawer latéral au clic sur une ligne : prix d'entrée, valeur actuelle, P&L, break-even, jours détenus
- Graphique d'évolution du portefeuille (area chart) avec downsampling adaptatif selon la durée
- Snapshots sauvegardés automatiquement à chaque refresh de prix (debounce 5s)
- Toutes les données en local (SQLite), aucun cloud

### Market tab — Rotation sectorielle
- 13 secteurs (dont ITA Défense, BLOK Blockchain) avec ETF de référence et 5 holdings chacun
- `useSectorPerfs(period)` : perf ETF + relPerf vs SPY + momentum sur 1W/1M/3M
- `SectorDashboard` : cartes triées par relPerf, sparklines prix inline (SVG, zéro requête extra)
- `MacroScore` : score macro pondéré 0–100 (7 indicateurs : VIX 25%, courbe 20%, HYG 15%, IWM/SPY 15%, DXY 10%, cuivre 10%, or 5%) + régime (Risk-On → Risk-Off)
  - Taux 10Y (`^TNX`) et 30Y (`^TYX`) affichés comme indicateurs contextuels **hors score**, avec variation hebdo en bp et implication sectorielle
  - `MacroScoreChart` : courbe historique du score sur 2Y hebdomadaire (sélecteur 6M/1Y/2Y), lignes de seuil des régimes — powered by `useMacroScoreHistory`
- `SectorDrawer` : chart + table holdings avec perf vs SPY
- Tooltips harmonisés : pattern `data-tooltip` + CSS `::after` partout

### Market tab — Narratives
- `useNarrativePerfs(period)` : toujours 3M fetché, sous-périodes par slicing, ETF-first, basket synthétique en fallback
- RS trend [3M, 1M, 1W] vs SPY calculé — déplacé dans le NarrativeDrawer (stats row)
- `NarrativeDashboard` : cartes triées par relPerf, sparklines prix inline, icône secteur parent (emoji + tooltip CSS)
- `NarrativeDrawer` : chart ETF ou basket normalisé + table holdings + RS trend 3 fenêtres
- Bibliothèque de narratives presets activables/désactivables, + Narrative custom
- 20 narratives pré-seedées (DB migration v2)

### Système d'alertes (DB migration v3)
- 5 types : `rsi_overbought`, `rsi_oversold`, `macro_regime_change`, `price_target`, `stop_loss`
- `alert_rules` : règles persistantes (type, scope, scope_id, label, threshold, is_active, snoozed_until)
- `alert_events` : historique des déclenchements (consecutive_days, value_at_trigger, acknowledged)
- `useAlertEngine` : moteur d'évaluation piggyback sur les queries TanStack existantes, debounce 4min
  - Baseline silencieux au premier run pour `macro_regime_change` (pas de fausse alerte au démarrage)
  - `consecutive_days` : compte les jours consécutifs en comparant `triggered_at` à J-1
  - Notification OS via `tauri-plugin-notification` (permission demandée à la première alerte)
- `AlertPanel` : slide-in depuis la droite — section événements + section règles (toggle, snooze 24h, delete)
- `AlertForm` : modal de création (type → sous-scope secteur/narrative → seuil)
- Cloche SVG dans le header avec badge rouge (count non acquittés)
- Agnostique à la source du ticker : compatible watchlist future sans modification du moteur

## Contraintes
- Rust côté Tauri reste minimal : un seul command `fetch_url` qui proxyfie les appels HTTP (nécessaire pour contourner les restrictions CORS de Yahoo Finance dans WebView2)
- Les appels HTTP sont tous routés via `invoke('fetch_url', { url })` depuis le frontend
- UI dark mode, dense, inspirée Delta App (JetBrains Mono, palette GitHub dark)

## Data Model
- `positions` : id, ticker, name, asset_type (stock|crypto), currency, quantity, cost_basis, created_at
- `snapshots` : id, total_value, total_cost, recorded_at
- `narratives` + `narrative_tickers` + `narrative_keywords` : DB migration v2
- `alert_rules` : id, type, scope, scope_id, label, threshold, is_active, created_at, snoozed_until
- `alert_events` : id, rule_id, triggered_at, consecutive_days, value_at_trigger, message, acknowledged
- Migration inline au démarrage dans `db.ts` (pas de fichier SQL externe) — schema_version v3, migrations v2+v3 idempotentes (guard `parseInt(version) >= N`)

## Points techniques importants
- **Yahoo Finance** : endpoint v7 retourne Unauthorized — utiliser v8/finance/chart/{symbol}
- **Tickers stocks** : format Yahoo Finance requis (AIR.PA, ASML.AS, SAP.DE…). La devise est auto-détectée depuis le suffixe du ticker (`.PA` → EUR, pas de suffixe → USD…)
- **Tickers crypto** : on stocke le CoinGecko ID (`bitcoin`, `ethereum`) comme ticker. `symbolToId()` le retourne tel quel si inconnu du SYMBOL_TO_ID map. L'affichage extrait le symbole court depuis le champ `name` (pattern `(BTC)` en fin de chaîne)
- **Snapshots** : dédupliqués par timestamp avant affichage dans le chart, downsampling par buckets adaptatifs (5min / 30min / 2h / 1j selon la durée totale)
- **Quantités décimales** : les inputs numériques utilisent `type="text"` avec regex `/^[0-9]*\.?[0-9]*$/` pour préserver la saisie de `0.00001` sans perte
- **YAHOO_RANGE** : `1W→5d/1h`, `1M→1mo/1d`, `3M→3mo/1d`, `1Y→1y/1wk`, `2Y→2y/1wk`
- **Taux obligataires** : `^TNX` (10Y), `^TYX` (30Y), `^IRX` (3M T-bill) — tous disponibles via `fetchYahooPrices`/`fetchYahooHistory`
- **MacroScore contextOnly** : les indicateurs avec `contextOnly: true` sont affichés dans le tableau détail mais exclus du score pondéré (weight: 0)
- **Sparklines** : SVG inline pur, zéro dépendance — historique déjà en cache TanStack Query réutilisé
- **Tooltips** : pattern uniforme `data-tooltip` + CSS `::after` sur l'élément (position: relative requis sur le parent card si overflow: hidden — préférer border-radius sur colorBar)

## Project Structure
```
src/
  components/
    Dashboard/          # tableau positions + summary bar + strip périodes + filtre
    Drawer/             # PositionDrawer — slide-in latéral au clic sur une ligne
    PositionForm/       # modal add/edit avec autocomplete stock & crypto
    PortfolioChart/     # area chart + ligne coût, downsampling adaptatif
    Layout/             # shell + header "Folio"
    MarketView/
      MarketView.tsx          # tab switcher Rotation ↔ Narratives
      SectorDashboard.tsx     # grille secteurs + MacroScore + SectorDrawer
      SectorDrawer.tsx        # chart + table holdings secteur
      MacroScore.tsx          # barre macro collapsible + tableau indicateurs + MacroScoreChart
      MacroScoreChart.tsx     # courbe historique score macro (6M/1Y/2Y)
      NarrativeDashboard.tsx  # grille narratives + bibliothèque + NarrativeDrawer/Form
      NarrativeDrawer.tsx     # chart + table holdings + RS trend narrative
      NarrativeForm.tsx       # CRUD narrative custom
  hooks/
    usePrices.ts            # TanStack Query — Yahoo + CoinGecko + EURUSD, snapshots
    usePeriodPnl.ts         # calcul P&L par période depuis snapshots locaux
    useSectorData.ts        # useSectorPerfs(period), useSectorHoldings — expose history[]
    useMacroScore.ts        # score macro 0–100, 7 indicateurs pondérés + 2 contextuels taux
    useMacroScoreHistory.ts # historique hebdo 2Y du score macro pour MacroScoreChart
    useNarrativePerfs.ts    # useNarrativePerfs(period) — expose history[], rsTrend, momentum
    useAlertEngine.ts       # moteur alertes + useUnacknowledgedCount + useAlertRules
  components/
    AlertPanel/
      AlertPanel.tsx        # slide-in : liste événements + liste règles (toggle/snooze/delete)
      AlertForm.tsx         # modal création règle (type → scope → seuil)
  lib/
    db.ts               # SQLite helpers — migrations inline, CRUD positions & snapshots + alertes
    sectors.ts          # 13 SectorDef (id, name, etf, color, holdings[5])
    api/
      yahoo.ts          # fetchYahooPrices, fetchEurUsd, fetchYahooHistory, searchYahoo
      coingecko.ts      # fetchCryptoPrices, searchCoinGecko, symbolToId
  store/
    portfolio.ts        # Zustand — positions, prices, baseCurrency, eurUsd + computeTotals, convertCurrency
  types/
    index.ts
  styles/
    globals.css         # CSS variables dark theme (--bg-primary, --green, --red, --accent…)
src-tauri/
  src/lib.rs            # command fetch_url (reqwest) + tauri-plugin-sql + tauri-plugin-notification
  tauri.conf.json       # productName: Folio, 1280x800
  capabilities/default.json  # permissions sql:allow-* + notification:default
```

## Repo
https://github.com/MaximeAutechaud/Folio
