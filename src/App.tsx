import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from './components/Layout/Layout';
import { Dashboard } from './components/Dashboard/Dashboard';
import { PositionForm } from './components/PositionForm/PositionForm';
import { PortfolioChart } from './components/PortfolioChart/PortfolioChart';
import { PositionDrawer } from './components/Drawer/PositionDrawer';
import { ChartsView } from './components/ChartsView/ChartsView';
import { MarketView } from './components/MarketView/MarketView';
import { WatchlistView } from './components/WatchlistView/WatchlistView';
import { AlertPanel } from './components/AlertPanel/AlertPanel';
import { usePortfolioStore } from './store/portfolio';
import { usePrices } from './hooks/usePrices';
import { useAlertEngine, useUnacknowledgedCount } from './hooks/useAlertEngine';
import { fetchSnapshots } from './lib/db';
import type { PositionInput } from './types';
import styles from './App.module.css';

type Tab = 'portfolio' | 'charts' | 'market' | 'watchlist';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drawerPositionId, setDrawerPositionId] = useState<number | null>(null);

  const [alertOpen, setAlertOpen] = useState(false);

  const positions = usePortfolioStore((s) => s.positions);
  const loadPositions = usePortfolioStore((s) => s.loadPositions);
  const addPosition = usePortfolioStore((s) => s.addPosition);
  const updatePosition = usePortfolioStore((s) => s.updatePosition);
  const removePosition = usePortfolioStore((s) => s.removePosition);

  useEffect(() => { loadPositions(); }, []);

  usePrices();
  useAlertEngine();

  const { data: unackCount = 0 } = useUnacknowledgedCount();

  const { data: snapshots = [] } = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => fetchSnapshots(90),
    refetchInterval: 60_000,
  });

  const editingPosition = editingId != null ? positions.find((p) => p.id === editingId) : null;
  const editingInitial: PositionInput | undefined = editingPosition
    ? {
        ticker: editingPosition.ticker,
        name: editingPosition.name,
        asset_type: editingPosition.asset_type,
        currency: editingPosition.currency,
        quantity: editingPosition.quantity,
        cost_basis: editingPosition.cost_basis,
        stop_price: editingPosition.stop_price,
        target_price: editingPosition.target_price,
        target_price_2: editingPosition.target_price_2,
      }
    : undefined;

  const drawerPosition = drawerPositionId != null ? positions.find((p) => p.id === drawerPositionId) : null;

  function handleEdit(id: number) { setEditingId(id); setShowForm(true); }
  function handleClose() { setShowForm(false); setEditingId(null); }
  async function handleSubmit(input: PositionInput) {
    if (editingId != null) await updatePosition(editingId, input);
    else await addPosition(input);
  }

  const TAB_LABELS: Record<Tab, string> = { portfolio: 'Portfolio', charts: 'Charts', market: 'Market', watchlist: 'Watchlist' };

  const nav = (
    <>
      {(['portfolio', 'charts', 'market', 'watchlist'] as Tab[]).map((tab) => (
        <button
          key={tab}
          className={`${styles.tabBtn} ${activeTab === tab ? styles.tabActive : ''}`}
          onClick={() => setActiveTab(tab)}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </>
  );

  const actions = (
    <button className={styles.bellBtn} onClick={() => setAlertOpen(v => !v)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      {unackCount > 0 && <span className={styles.badge}>{unackCount > 99 ? '99+' : unackCount}</span>}
    </button>
  );

  return (
    <Layout nav={nav} actions={actions}>
      {activeTab === 'portfolio' ? (
        <>
          <PortfolioChart snapshots={snapshots} />
          <div style={{ marginTop: 20 }}>
            <Dashboard
              snapshots={snapshots}
              onAddClick={() => { setEditingId(null); setShowForm(true); }}
              onEdit={handleEdit}
              onRemove={removePosition}
              onRowClick={(id) => setDrawerPositionId(drawerPositionId === id ? null : id)}
            />
          </div>
        </>
      ) : activeTab === 'charts' ? (
        <ChartsView />
      ) : activeTab === 'market' ? (
        <MarketView />
      ) : (
        <WatchlistView />
      )}

      {showForm && (
        <PositionForm
          onSubmit={handleSubmit}
          onClose={handleClose}
          initial={editingInitial}
          editMode={editingId != null}
        />
      )}

      {drawerPosition && (
        <PositionDrawer
          position={drawerPosition}
          onClose={() => setDrawerPositionId(null)}
        />
      )}

      <AlertPanel open={alertOpen} onClose={() => setAlertOpen(false)} />
    </Layout>
  );
}
