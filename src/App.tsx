import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from './components/Layout/Layout';
import { Dashboard } from './components/Dashboard/Dashboard';
import { PositionForm } from './components/PositionForm/PositionForm';
import { PortfolioChart } from './components/PortfolioChart/PortfolioChart';
import { PositionDrawer } from './components/Drawer/PositionDrawer';
import { usePortfolioStore } from './store/portfolio';
import { usePrices } from './hooks/usePrices';
import { fetchSnapshots } from './lib/db';
import type { PositionInput } from './types';

export default function App() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drawerPositionId, setDrawerPositionId] = useState<number | null>(null);

  const positions = usePortfolioStore((s) => s.positions);
  const loadPositions = usePortfolioStore((s) => s.loadPositions);
  const addPosition = usePortfolioStore((s) => s.addPosition);
  const updatePosition = usePortfolioStore((s) => s.updatePosition);
  const removePosition = usePortfolioStore((s) => s.removePosition);

  useEffect(() => { loadPositions(); }, []);

  usePrices();

  const { data: snapshots = [] } = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => fetchSnapshots(90),
    refetchInterval: 60_000,
  });

  const editingPosition = editingId != null ? positions.find((p) => p.id === editingId) : null;
  const editingInitial: PositionInput | undefined = editingPosition
    ? { ticker: editingPosition.ticker, name: editingPosition.name, asset_type: editingPosition.asset_type, currency: editingPosition.currency, quantity: editingPosition.quantity, cost_basis: editingPosition.cost_basis }
    : undefined;

  const drawerPosition = drawerPositionId != null ? positions.find((p) => p.id === drawerPositionId) : null;

  function handleEdit(id: number) { setEditingId(id); setShowForm(true); }
  function handleClose() { setShowForm(false); setEditingId(null); }
  async function handleSubmit(input: PositionInput) {
    if (editingId != null) await updatePosition(editingId, input);
    else await addPosition(input);
  }

  return (
    <Layout>
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
    </Layout>
  );
}
