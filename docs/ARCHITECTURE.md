# Folio — Architecture détaillée

## Features

4 tabs : **Portfolio · Charts · Market · Watchlist** + AlertPanel global (cloche header).

### Portfolio tab
- Ajout / édition / suppression de positions (ticker, quantité, cost basis, devise)
- Transactions par position : buy/sell/swap — les swaps crypto créent 2 transactions liées (`swap_out`/`swap_in` via `linked_tx_id`), taux de swap live via `useSwapRate` (CoinGecko)
- `resolvePositions(positions, transactions)` : quantité/cost basis effectifs dérivés des transactions
- Autocomplete ticker : Yahoo Finance search pour les stocks, CoinGecko search pour la crypto
- Prix actions & ETF via Yahoo Finance v8/finance/chart (un appel par ticker, pas de batch)
- Prix crypto via CoinGecko simple/price (IDs CoinGecko stockés directement comme ticker)
- Taux de change EURUSD via Yahoo Finance (EURUSD=X), rafraîchi toutes les 60s, fallback query2 puis Frankfurter (ECB)
- Multi-devise par position (EUR, USD, GBP…) avec conversion dans une devise de base toggleable (EUR/USD)
- Dashboard : valeur totale, coût total, P&L global + par ligne, filtre ALL/STOCK/CRYPTO
- Strip de périodes P&L dans la summary bar (1W / 1M / 3M / YTD / 1Y) calculée depuis les snapshots locaux
- Drawer latéral au clic sur une ligne : prix d'entrée, valeur actuelle, P&L, break-even, jours détenus, historique transactions, stop/TP1/TP2 + distance au stop
- **Risk management par position** (DB migration v6) : stop loss + TP1/TP2 (R-multiples) définis dans la section "Risk" de PositionForm
  - T1 = entry + 1R, T2 = entry + 2R, auto-calculés depuis le stop, modifiables (flag manuel via `useRef`)
  - Badge ⚠ sur les lignes sans stop dans le Dashboard
  - Sync alertes automatique : chaque stop crée une `alert_rule` `stop_loss` système, chaque TP crée une `price_target` système (`slot='tp1'|'tp2'`, `is_system=1`) — upsert à chaque édition de position
  - Règles système cachées dans l'AlertPanel (filtrées côté UI), notifications OS déclenchées normalement
  - Limite : le moteur d'alertes utilise Yahoo Finance pour évaluer les prix — fonctionne pour les stocks, pas pour les tickers crypto (CoinGecko IDs)
- Graphique d'évolution du portefeuille (area chart) avec downsampling adaptatif selon la durée
- Snapshots sauvegardés automatiquement à chaque refresh de prix (debounce 5s)

### Charts tab
- `ChartsView` : chart plein écran d'un ticker — sélection depuis le portfolio (Select) ou ticker arbitraire (`TickerSearch`)
- `TickerChart` : candlesticks/ligne Lightweight Charts + ligne de prix d'entrée si position du portfolio (convertie dans la devise du prix)

### Market tab — Rotation sectorielle
- 13 secteurs (dont ITA Défense, BLOK Blockchain) avec ETF de référence et 5 holdings chacun
- `useSectorPerfs(period)` : fetch systématique 1W+1M+3M par ETF — perf, relPerf vs SPY, momentum, RSI 14 (3M daily), drawdown vs high 3M, MA50 + position prix/MA50
- **Sector opportunity score** (`lib/scoring.ts`) : composite 0–100 — RS slope 40% / RSI entry 25% / drawdown 20% / macro align 15% — labels hot/warming/neutral/cooling + signaux `reversal`/`exhaustion`/`dip`/`accelerating` (ordre de priorité), pénalités MA50/décélération
- `SectorDashboard` : cartes triées par relPerf, sparklines prix inline (SVG, zéro requête extra), badge score + signal
- `MacroScore` : score macro pondéré 0–100 (7 indicateurs : VIX 25%, courbe 10Y−3M 20%, HYG 15%, IWM/SPY 15%, DXY 10%, cuivre 10%, or 5%) + régime (Risk-On → Risk-Off), trend vs t-1W (slice des historiques)
  - Taux 10Y (`^TNX`) et 30Y (`^TYX`) affichés comme indicateurs contextuels **hors score** (`contextOnly: true`), avec variation hebdo en bp, spread 30/10 et implication sectorielle
  - `MacroScoreChart` : courbe historique du score sur 2Y hebdomadaire (sélecteur 6M/1Y/2Y), lignes de seuil des régimes — powered by `useMacroScoreHistory`
- `MacroPulse` : bandeau macro permanent compact (score + régime + chips indicateurs) affiché en haut du Market tab
- `SectorDrawer` : chart + table holdings avec perf vs SPY
- Tooltips harmonisés : pattern `data-tooltip` + CSS `::after` partout

### Market tab — Narratives
- `useNarrativePerfs(period)` : toujours 3M fetché, sous-périodes par slicing (`sliceByDays`), ETF-first, basket synthétique (moyenne équipondérée normalisée base 100) en fallback
- RS trend [3M, 1M, 1W] vs SPY — affiché dans le NarrativeDrawer (stats row)
- `NarrativeDashboard` : cartes triées par relPerf, sparklines prix inline, icône secteur parent (emoji + tooltip CSS)
- `NarrativeDrawer` : chart ETF ou basket normalisé + table holdings + RS trend 3 fenêtres
- Bibliothèque de narratives presets activables/désactivables, + Narrative custom
- 20 narratives pré-seedées (DB migration v2)

### Market tab — Signaux (Phase 3, DB migration v9)
- `SignalStats` (4ᵉ sous-tab « Signaux ») : fiabilité historique des signaux secteurs (`dip`/`reversal`/`accelerating`/`exhaustion`) — win% + perf relative moyenne vs SPY à J+5/J+10/J+20, badge « échantillon faible » si n < 10
- `signal_log` (id, date `YYYY-MM-DD`, scope, scope_id, signal, score, rel_perf_j5/j10/j20) : `UNIQUE(date, scope, scope_id)` → 1 ligne/secteur/jour
- **Logging** : piggyback dans `useAlertEngine` (`logSectorSignals`) — au même cycle debounce 4min, calcule `scoreSector` (helper extrait, partagé avec l'alerte `sector_score_threshold`) pour les 13 secteurs et upsert la classification du jour (dernier signal observé, `ON CONFLICT DO UPDATE` qui ne touche jamais les `rel_perf_*`)
- **Backfill** : `useSignalBackfill` (job one-shot au démarrage, monté dans `App`) — réutilise le cache `['sector-raw']` (6M daily, zéro requête extra), remplit les perfs forward par offset en bougies de bourse ; un horizon non encore atteint reste NULL et se remplit au prochain lancement
- **Agrégation** : `lib/signalStats.ts` (pur, testable) — `exhaustion` est un signal d'évitement : sa réussite = perf relative **négative** ensuite (`isWin` inversé)
- Scope = secteurs uniquement (les narratives n'ont pas de primitive `signal` — extension future)

### Watchlist tab (DB migrations v4 + v5)
- `WatchlistView` : layout split chart/panel — table par catégories + `TickerChart` avec sub-chart RSI
- `useWatchlist` : `useQueries` par ticker (1 query/ticker, cache partagé) — prix, change 1d, RSI 14, distance MA50, drawdown
- Catégories : CRUD (`watchlist_categories`), assignation par item, tri par `sort_order`
- Ajout via TickerSearch (stocks Yahoo + crypto CoinGecko), `INSERT OR IGNORE` sur ticker unique

### Système d'alertes (DB migration v3)
- 5 types : `rsi_overbought`, `rsi_oversold`, `macro_regime_change`, `price_target`, `stop_loss`
- `alert_rules` : règles persistantes (type, scope, scope_id, label, threshold, is_active, snoozed_until, `is_system`, `slot`)
  - `is_system=1` : règle créée automatiquement depuis une position (stop/TP) — cachée dans l'AlertPanel, gérée via le PositionDrawer
  - `slot` : `'stop'|'tp1'|'tp2'` pour distinguer les règles système d'une même position
- `alert_events` : historique des déclenchements (consecutive_days, value_at_trigger, acknowledged)
- `useAlertEngine` : moteur d'évaluation piggyback sur les queries TanStack existantes, debounce 4min
  - Baseline silencieux au premier run pour `macro_regime_change` (pas de fausse alerte au démarrage)
  - `consecutive_days` : compte les jours consécutifs en comparant `triggered_at` à J-1
  - Notification OS via `tauri-plugin-notification` (permission demandée à la première alerte)
- `AlertPanel` : slide-in depuis la droite — section événements + section règles utilisateur (toggle, snooze 24h, delete) — règles système exclues
- `AlertForm` : modal de création (type → sous-scope secteur/narrative → seuil)
- Cloche SVG dans le header avec badge rouge (count non acquittés)
- Agnostique à la source du ticker : compatible watchlist sans modification du moteur

## Project Structure
```
src/
  components/
    Dashboard/          # tableau positions + summary bar + strip périodes + filtre
    Drawer/             # PositionDrawer — slide-in latéral au clic sur une ligne
    PositionForm/       # modal add/edit avec autocomplete stock & crypto
    TransactionForm/    # modal buy/sell/swap (swaps liés, taux live)
    PortfolioChart/     # area chart + ligne coût, downsampling adaptatif
    ChartsView/         # tab Charts — TickerChart plein écran, portfolio ou ticker libre
    TickerChart/        # chart Lightweight Charts réutilisable + sub-chart RSI
    TickerSearch/       # autocomplete Yahoo + CoinGecko réutilisable
    WatchlistView/      # tab Watchlist — split chart/panel, catégories
    Select/             # select custom stylé
    InfoTooltip/        # tooltip "?" réutilisable
    Layout/             # shell + header "Folio" + nav tabs + actions
    MarketView/
      MarketView.tsx          # tab switcher Rotation ↔ Narratives
      MacroPulse.tsx          # bandeau macro permanent compact
      SectorDashboard.tsx     # grille secteurs + MacroScore + SectorDrawer
      SectorDrawer.tsx        # chart + table holdings secteur
      MacroScore.tsx          # barre macro collapsible + tableau indicateurs + MacroScoreChart
      MacroScoreChart.tsx     # courbe historique score macro (6M/1Y/2Y)
      SignalStats.tsx         # tab Signaux — fiabilité historique des signaux secteurs (Phase 3)
      NarrativeDashboard.tsx  # grille narratives + bibliothèque + NarrativeDrawer/Form
      NarrativeDrawer.tsx     # chart + table holdings + RS trend narrative
      NarrativeForm.tsx       # CRUD narrative custom
    AlertPanel/
      AlertPanel.tsx        # slide-in : liste événements + liste règles (toggle/snooze/delete)
      AlertForm.tsx         # modal création règle (type → scope → seuil)
  hooks/
    usePrices.ts            # TanStack Query — Yahoo + CoinGecko + EURUSD, snapshots
    usePeriodPnl.ts         # calcul P&L par période depuis snapshots locaux
    useTransactions.ts      # CRUD transactions par position
    useSwapRate.ts          # taux de swap crypto live (CoinGecko)
    useSectorData.ts        # useSectorPerfs(period), useSectorHoldings — expose history[]
    useMacroScore.ts        # score macro 0–100, 7 indicateurs pondérés + 2 contextuels taux
    useMacroScoreHistory.ts # historique hebdo 2Y du score macro pour MacroScoreChart
    useNarrativePerfs.ts    # useNarrativePerfs(period) — expose history[], rsTrend, momentum
    useWatchlist.ts         # rows watchlist (prix, RSI, MA50, drawdown) + catégories
    useAlertEngine.ts       # moteur alertes + logging signaux (Phase 3) + useUnacknowledgedCount + useAlertRules
    useSignalBackfill.ts    # job one-shot : perfs forward J+5/10/20 des signaux loggés
  lib/
    db.ts               # SQLite helpers — migrations inline, CRUD complet
    sectors.ts          # 13 SectorDef (id, name, etf, color, macroProfile, holdings[5])
    scoring.ts          # calcSectorScore — opportunity score composite + signaux
    signalStats.ts      # agrégation pure des signal_log (win% + perf/horizon, exhaustion inversé)
    indicators.ts       # calcRsi, calcRsiSeries (Wilder)
    narratives-seed.ts  # 20 narratives presets (migration v2)
    api/
      yahoo.ts          # fetchYahooPrices, fetchEurUsd, fetchYahooHistory, fetchYahooDailyOHLCV, searchYahoo, detectCurrency
      coingecko.ts      # fetchCryptoPrices, searchCoinGecko, symbolToId
      alphavantage.ts   # sentiment news (NON UTILISÉ actuellement)
  store/
    portfolio.ts        # Zustand — positions, transactions, prices, baseCurrency, eurUsd + computeTotals, convertCurrency, resolvePositions
  types/
    index.ts
  styles/
    globals.css         # CSS variables dark theme (--bg-primary, --green, --red, --accent…)
src-tauri/
  src/lib.rs            # command fetch_url (reqwest) + tauri-plugin-sql + tauri-plugin-notification
  tauri.conf.json       # productName: Folio, 1280x800
  capabilities/default.json  # permissions sql:allow-* + notification:default
```
