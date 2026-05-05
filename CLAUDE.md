# Folio — Investment Portfolio Tracker

## Stack
- Tauri 2 (Rust desktop shell)
- React + Vite + TypeScript (frontend)
- TanStack Query (price fetching & cache)
- Lightweight Charts v5 by TradingView (charts)
- Zustand (portfolio state)
- SQLite via tauri-plugin-sql (local persistence)

## MVP Features
- Add/remove positions (ticker, quantity, cost basis)
- Stock & ETF prices via Yahoo Finance (unofficial)
- Crypto prices via CoinGecko API (free, no key)
- Dashboard: total portfolio value, global P&L and per-position P&L
- Portfolio value evolution chart over time
- Prices auto-refreshed every 60 seconds (market open)

## Constraints
- All user data stays local (SQLite), no cloud
- No authentication — single-user app
- Dense dark UI inspired by Delta App: dark mode by default, readable numbers, red/green for P&L
- Rust side (Tauri) stays minimal: HTTP calls are made from the frontend via fetch

## Data Model
- `positions` table: id, ticker, name, asset_type (stock|crypto), quantity, cost_basis, created_at
- `snapshots` table: id, total_value, total_cost, recorded_at

## Project Structure
```
src/
  components/
    Dashboard/        # positions table + summary bar
    PositionForm/     # modal to add a position
    PortfolioChart/   # Lightweight Charts area chart
    Layout/           # app shell + header
  hooks/
    usePrices.ts      # TanStack Query — Yahoo + CoinGecko, saves snapshots
  lib/
    db.ts             # SQLite helpers (tauri-plugin-sql)
    api/
      yahoo.ts        # Yahoo Finance fetch
      coingecko.ts    # CoinGecko fetch + symbol→ID map
  store/
    portfolio.ts      # Zustand store
  types/
    index.ts
  styles/
    globals.css       # CSS variables dark theme
src-tauri/
  src/lib.rs          # Tauri builder — registers sql plugin
  tauri.conf.json
  capabilities/default.json
```
