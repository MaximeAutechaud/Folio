import type { Snapshot } from '../types';

export interface PeriodPnl {
  label: string;
  pnl: number;
  pct: number;
}

function snapshotAt(snapshots: Snapshot[], targetTs: number): Snapshot | null {
  // Most recent snapshot at or before targetTs
  const candidates = snapshots.filter((s) => s.recorded_at <= targetTs);
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

export function usePeriodPnl(snapshots: Snapshot[], currentValue: number): PeriodPnl[] {
  if (snapshots.length < 2 || currentValue === 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const oldest = snapshots[0].recorded_at;

  const periods: { label: string; daysAgo: number }[] = [
    { label: '1W',  daysAgo: 7   },
    { label: '1M',  daysAgo: 30  },
    { label: '3M',  daysAgo: 90  },
    { label: 'YTD', daysAgo: Math.floor((now - new Date(new Date().getFullYear(), 0, 1).getTime() / 1000) / 86400) },
    { label: '1Y',  daysAgo: 365 },
  ];

  return periods.flatMap(({ label, daysAgo }) => {
    const targetTs = now - daysAgo * 86400;
    if (oldest > targetTs) return []; // not enough history
    const ref = snapshotAt(snapshots, targetTs);
    if (!ref || ref.total_value === 0) return [];
    const pnl = currentValue - ref.total_value;
    const pct = (pnl / ref.total_value) * 100;
    return [{ label, pnl, pct }];
  });
}
