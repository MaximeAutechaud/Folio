# Folio

Application desktop de suivi de portefeuille d'investissement — actions, ETF et crypto — entièrement locale, sans compte, sans cloud.

![dark mode](https://img.shields.io/badge/UI-dark%20mode-1f2937?style=flat-square)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&logo=tauri)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript)

---

## Fonctionnalités

- **Portefeuille multi-actifs** — actions, ETF (Yahoo Finance) et crypto (CoinGecko)
- **Prix en temps réel** — rafraîchissement automatique toutes les 60 secondes
- **Multi-devise** — EUR, USD, GBP… conversion automatique avec taux de change live
- **P&L global et par ligne** — valeur actuelle, plus-value, rendement %
- **Historique** — graphique d'évolution de la valeur du portefeuille dans le temps
- **Périodes** — P&L sur 1W / 1M / 3M / YTD / 1Y dès que l'historique est disponible
- **Détail position** — drawer latéral avec prix d'entrée, break-even, jours détenus
- **Autocomplete** — recherche de ticker par nom ou symbole (Yahoo Finance + CoinGecko)
- **100% local** — toutes les données sont stockées en SQLite sur votre machine

---

## Stack technique

| Couche | Technologie |
|---|---|
| Shell desktop | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | React 18 + Vite + TypeScript |
| State | Zustand |
| Data fetching | TanStack Query v5 |
| Graphiques | Lightweight Charts v5 (TradingView) |
| Base de données | SQLite via `tauri-plugin-sql` |
| Prix actions | Yahoo Finance (non-officiel, v8) |
| Prix crypto | CoinGecko API (gratuite, sans clé) |

---

## Prérequis

### Node.js
Version **18 ou supérieure** — [nodejs.org](https://nodejs.org)

```bash
node --version   # >= 18
npm --version
```

### Rust
Version stable récente — [rustup.rs](https://rustup.rs)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustc --version  # >= 1.77
```

### Dépendances système Tauri

**Windows** — Visual Studio Build Tools avec les workloads C++ et le Windows SDK  
→ [Guide officiel Windows](https://tauri.app/start/prerequisites/#windows)

**macOS**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu)**
```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

→ [Guide officiel Linux](https://tauri.app/start/prerequisites/#linux)

---

## Installation

```bash
# 1. Cloner le dépôt
git clone https://github.com/<votre-user>/folio.git
cd folio

# 2. Installer les dépendances npm
npm install

# 3. Lancer en mode développement
npm run tauri dev
```

> La première compilation Rust peut prendre **5 à 15 minutes** le temps de compiler toutes les dépendances. Les compilations suivantes sont beaucoup plus rapides grâce au cache Cargo.

---

## Build de production

```bash
npm run tauri build
```

L'installeur se trouve dans `src-tauri/target/release/bundle/`.

---

## Structure du projet

```
folio/
├── src/                        # Frontend React + TypeScript
│   ├── components/
│   │   ├── Dashboard/          # Tableau des positions + résumé
│   │   ├── Drawer/             # Panneau latéral de détail
│   │   ├── Layout/             # Shell de l'application
│   │   ├── PortfolioChart/     # Graphique Lightweight Charts
│   │   └── PositionForm/       # Modal d'ajout / édition
│   ├── hooks/
│   │   ├── usePrices.ts        # Fetch prix + sauvegarde snapshots
│   │   └── usePeriodPnl.ts     # Calcul P&L par période
│   ├── lib/
│   │   ├── db.ts               # Couche SQLite (tauri-plugin-sql)
│   │   └── api/
│   │       ├── yahoo.ts        # Yahoo Finance — prix & recherche
│   │       └── coingecko.ts    # CoinGecko — prix & recherche
│   ├── store/
│   │   └── portfolio.ts        # Store Zustand + helpers de conversion
│   └── types/
│       └── index.ts
├── src-tauri/                  # Backend Rust (Tauri)
│   ├── src/lib.rs              # Commande fetch_url (proxy HTTP sans CORS)
│   └── tauri.conf.json
└── CLAUDE.md                   # Contexte projet pour Claude Code
```

---

## Modèle de données

```sql
-- Positions du portefeuille
CREATE TABLE positions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker     TEXT    NOT NULL,       -- ex: AIR.PA, MSFT, bitcoin
  name       TEXT    NOT NULL,
  asset_type TEXT    NOT NULL,       -- 'stock' | 'crypto'
  currency   TEXT    NOT NULL,       -- EUR, USD, GBP…
  quantity   REAL    NOT NULL,
  cost_basis REAL    NOT NULL,       -- prix d'entrée par unité
  created_at INTEGER NOT NULL
);

-- Historique de valeur (1 snapshot par minute de marché ouvert)
CREATE TABLE snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  total_value REAL    NOT NULL,
  total_cost  REAL    NOT NULL,
  recorded_at INTEGER NOT NULL
);
```

La base de données SQLite est stockée dans le répertoire de données de l'application (`%APPDATA%\folio\` sur Windows).

---

## Notes

- **Tickers actions** : utiliser le format Yahoo Finance — `AIR.PA` pour Euronext Paris, `ASML.AS` pour Amsterdam, `SAP.DE` pour Frankfurt, `MSFT` pour le NYSE/NASDAQ. L'autocomplete dans le formulaire vous guide.
- **Tickers crypto** : l'autocomplete utilise CoinGecko — sélectionner dans la liste stocke l'ID CoinGecko directement (`bitcoin`, `ethereum`…).
- **Historique** : les indicateurs de période (1W, 1M…) apparaissent automatiquement une fois que suffisamment de snapshots sont enregistrés.

---

## Licence

MIT
