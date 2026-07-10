import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from './components/Layout/Layout';
import { Dashboard } from './components/Dashboard/Dashboard';
import { PositionForm } from './components/PositionForm/PositionForm';
import { PortfolioChart } from './components/PortfolioChart/PortfolioChart';
import { PositionDrawer } from './components/Drawer/PositionDrawer';
import { ChartsView } from './components/ChartsView/ChartsView';
import { MarketView, type MarketSubTab } from './components/MarketView/MarketView';
import { WatchlistView } from './components/WatchlistView/WatchlistView';
import { TradesView } from './components/TradesView/TradesView';
import { AlertPanel } from './components/AlertPanel/AlertPanel';
import { BriefingSettings } from './components/Briefing/BriefingSettings';
import { BriefingTab } from './components/Briefing/BriefingTab';
import { CorporateActionModal } from './components/CorporateActionModal/CorporateActionModal';
import { SessionRecap } from './components/SessionRecap/SessionRecap';
import { OnboardingTour } from './components/OnboardingTour/OnboardingTour';
import { usePortfolioStore } from './store/portfolio';
import { usePrices } from './hooks/usePrices';
import { useAlertEngine, useUnacknowledgedCount } from './hooks/useAlertEngine';
import { useSignalBackfill } from './hooks/useSignalBackfill';
import { useCorporateActionSync } from './hooks/useCorporateActionSync';
import { fetchSnapshots, getSetting, setSetting } from './lib/db';
import type { PendingCorporateAction, PositionInput, TransactionInput } from './types';
import styles from './App.module.css';

type Tab = 'portfolio' | 'charts' | 'market' | 'watchlist' | 'trades' | 'ia';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drawerPositionId, setDrawerPositionId] = useState<number | null>(null);

  const [alertOpen, setAlertOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourMarketSubTab, setTourMarketSubTab] = useState<MarketSubTab | null>(null);
  const [briefingSettingsOpen, setBriefingSettingsOpen] = useState(false);
  const [corpActionModal, setCorpActionModal] = useState<PendingCorporateAction | null>(null);

  const positions = usePortfolioStore((s) => s.positions);
  const loadPositions = usePortfolioStore((s) => s.loadPositions);
  const addPosition = usePortfolioStore((s) => s.addPosition);
  const updatePosition = usePortfolioStore((s) => s.updatePosition);
  const removePosition = usePortfolioStore((s) => s.removePosition);
  const addTransaction = usePortfolioStore((s) => s.addTransaction);
  const storeTransactions = usePortfolioStore((s) => s.transactions);

  useEffect(() => { loadPositions(); }, []);

  useEffect(() => {
    getSetting('onboarding_done').then((v) => { if (v !== '1') setTourOpen(true); });
  }, []);

  function closeTour() {
    setTourOpen(false);
    setTourMarketSubTab(null);
    setSetting('onboarding_done', '1');
  }

  usePrices();
  useAlertEngine();
  useSignalBackfill();
  const corpActionSync = useCorporateActionSync();

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
        note: editingPosition.note,
        sector_id: editingPosition.sector_id,
      }
    : undefined;

  const drawerPosition = drawerPositionId != null ? positions.find((p) => p.id === drawerPositionId) : null;

  function handleEdit(id: number) { setEditingId(id); setShowForm(true); }
  function handleClose() { setShowForm(false); setEditingId(null); }
  async function handleSubmit(input: PositionInput) {
    if (editingId != null) await updatePosition(editingId, input);
    else await addPosition(input);
  }

  async function handleCorporateActionConfirm(input: TransactionInput) {
    await addTransaction(input);
    if (corpActionModal) corpActionSync.confirmAction(corpActionModal);
    setCorpActionModal(null);
  }

  async function handleCorporateActionDismiss() {
    if (corpActionModal) await corpActionSync.dismissAction(corpActionModal);
    setCorpActionModal(null);
  }

  const TAB_LABELS: Record<Tab, string> = { portfolio: 'Portfolio', charts: 'Charts', market: 'Market', watchlist: 'Watchlist', trades: 'Trades', ia: 'IA' };

  const nav = (
    <>
      {(['portfolio', 'charts', 'market', 'watchlist', 'trades', 'ia'] as Tab[]).map((tab) => (
        <button
          key={tab}
          data-tour={`tab-${tab}`}
          className={`${styles.tabBtn} ${activeTab === tab ? styles.tabActive : ''}`}
          onClick={() => setActiveTab(tab)}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </>
  );

  const actions = (
    <>
      {activeTab === 'portfolio' && (
        <button
          data-tour="sync"
          className={`${styles.syncBtn} ${corpActionSync.isSyncing ? styles.syncSpinning : ''}`}
          onClick={corpActionSync.syncNow}
          disabled={corpActionSync.isSyncing}
          title="Vérifier les événements corporate (splits, dividendes)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          {corpActionSync.pendingActions.length > 0 && (
            <span className={styles.syncBadge}>{corpActionSync.pendingActions.length}</span>
          )}
        </button>
      )}
      <button data-tour="alerts" className={styles.bellBtn} onClick={() => setAlertOpen(v => !v)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unackCount > 0 && <span className={styles.badge}>{unackCount > 99 ? '99+' : unackCount}</span>}
      </button>
      <button
        className={styles.bellBtn}
        onClick={() => setBriefingSettingsOpen(true)}
        title="Briefing IA — réglages"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <button
        className={styles.bellBtn}
        onClick={() => setTourOpen(true)}
        title="Visite guidée de l'application"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </button>
    </>
  );

  return (
    <Layout nav={nav} actions={actions}>
      <SessionRecap snapshots={snapshots} />

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
              pendingActions={corpActionSync.pendingActions}
              onCorporateActionClick={setCorpActionModal}
            />
          </div>
        </>
      ) : activeTab === 'charts' ? (
        <ChartsView />
      ) : activeTab === 'market' ? (
        <MarketView forcedSubTab={tourMarketSubTab} />
      ) : activeTab === 'watchlist' ? (
        <WatchlistView />
      ) : activeTab === 'trades' ? (
        <TradesView />
      ) : (
        <BriefingTab
          settingsOpen={briefingSettingsOpen}
          onOpenSettings={() => setBriefingSettingsOpen(true)}
        />
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

      {briefingSettingsOpen && <BriefingSettings onClose={() => setBriefingSettingsOpen(false)} />}

      {tourOpen && (
        <OnboardingTour
          onClose={closeTour}
          onTabChange={setActiveTab}
          onMarketSubTab={setTourMarketSubTab}
        />
      )}

      {corpActionModal && (() => {
        const modalPosition = positions.find((p) => p.id === corpActionModal.positionId);
        if (!modalPosition) return null;
        return (
          <CorporateActionModal
            action={corpActionModal}
            position={modalPosition}
            transactions={storeTransactions[corpActionModal.positionId] ?? []}
            onConfirm={handleCorporateActionConfirm}
            onDismiss={handleCorporateActionDismiss}
            onClose={() => setCorpActionModal(null)}
          />
        );
      })()}
    </Layout>
  );
}
