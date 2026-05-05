# Folio — Investment Portfolio Tracker

## Stack
- Tauri 2 (Rust desktop shell)
- React + Vite + TypeScript (frontend)
- TanStack Query v5 (price fetching & cache)
- Lightweight Charts v5 by TradingView (charts)
- Zustand (portfolio state)
- SQLite via tauri-plugin-sql (local persistence)

## Features implémentées
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

## Contraintes
- Rust côté Tauri reste minimal : un seul command `fetch_url` qui proxyfie les appels HTTP (nécessaire pour contourner les restrictions CORS de Yahoo Finance dans WebView2)
- Les appels HTTP sont tous routés via `invoke('fetch_url', { url })` depuis le frontend
- UI dark mode, dense, inspirée Delta App (JetBrains Mono, palette GitHub dark)

## Data Model
- `positions` : id, ticker, name, asset_type (stock|crypto), currency, quantity, cost_basis, created_at
- `snapshots` : id, total_value, total_cost, recorded_at
- Migration inline au démarrage dans `db.ts` (pas de fichier SQL externe) — inclut un ALTER TABLE pour ajouter `currency` aux DBs existantes

## Points techniques importants
- **Yahoo Finance** : endpoint v7 retourne Unauthorized — utiliser v8/finance/chart/{symbol}
- **Tickers stocks** : format Yahoo Finance requis (AIR.PA, ASML.AS, SAP.DE…). La devise est auto-détectée depuis le suffixe du ticker (`.PA` → EUR, pas de suffixe → USD…)
- **Tickers crypto** : on stocke le CoinGecko ID (`bitcoin`, `ethereum`) comme ticker. `symbolToId()` le retourne tel quel si inconnu du SYMBOL_TO_ID map. L'affichage extrait le symbole court depuis le champ `name` (pattern `(BTC)` en fin de chaîne)
- **Snapshots** : dédupliqués par timestamp avant affichage dans le chart, downsampling par buckets adaptatifs (5min / 30min / 2h / 1j selon la durée totale)
- **Quantités décimales** : les inputs numériques utilisent `type="text"` avec regex `/^[0-9]*\.?[0-9]*$/` pour préserver la saisie de `0.00001` sans perte

## Project Structure
```
src/
  components/
    Dashboard/          # tableau positions + summary bar + strip périodes + filtre
    Drawer/             # PositionDrawer — slide-in latéral au clic sur une ligne
    PositionForm/       # modal add/edit avec autocomplete stock & crypto
    PortfolioChart/     # area chart + ligne coût, downsampling adaptatif
    Layout/             # shell + header "Folio"
  hooks/
    usePrices.ts        # TanStack Query — Yahoo + CoinGecko + EURUSD, snapshots
    usePeriodPnl.ts     # calcul P&L par période depuis snapshots locaux
  lib/
    db.ts               # SQLite helpers — migrations inline, CRUD positions & snapshots
    api/
      yahoo.ts          # fetchYahooPrices, fetchEurUsd, searchYahoo, detectCurrency
      coingecko.ts      # fetchCryptoPrices, searchCoinGecko, symbolToId
  store/
    portfolio.ts        # Zustand — positions, prices, baseCurrency, eurUsd + computeTotals, convertCurrency
  types/
    index.ts
  styles/
    globals.css         # CSS variables dark theme (--bg-primary, --green, --red, --accent…)
src-tauri/
  src/lib.rs            # command fetch_url (reqwest) + tauri-plugin-sql
  tauri.conf.json       # productName: Folio, 1280x800
  capabilities/default.json  # permissions sql:allow-*
```

## Repo
https://github.com/MaximeAutechaud/Folio
