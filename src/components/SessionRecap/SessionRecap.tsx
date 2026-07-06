import { useEffect, useState } from 'react';
import { getSetting, setSetting, fetchAlertEventsSince } from '../../lib/db';
import { usePortfolioStore, computeTotals, resolvePositions } from '../../store/portfolio';
import type { AlertEvent, Snapshot } from '../../types';
import styles from './SessionRecap.module.css';

const LAST_SESSION_SETTING = 'last_session_at';
const RECAP_THRESHOLD_SECONDS = 3 * 3600;

interface Props {
  snapshots: Snapshot[];
}

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}j`;
}

export function SessionRecap({ snapshots }: Props) {
  const [recapSince, setRecapSince] = useState<number | null>(null);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const positions = usePortfolioStore((s) => s.positions);
  const transactions = usePortfolioStore((s) => s.transactions);
  const prices = usePortfolioStore((s) => s.prices);
  const baseCurrency = usePortfolioStore((s) => s.baseCurrency);
  const eurUsd = usePortfolioStore((s) => s.eurUsd);

  useEffect(() => {
    (async () => {
      const now = Math.floor(Date.now() / 1000);
      const prev = await getSetting(LAST_SESSION_SETTING);
      await setSetting(LAST_SESSION_SETTING, String(now));
      if (!prev) return;
      const prevTs = parseInt(prev, 10);
      if (!Number.isFinite(prevTs) || now - prevTs < RECAP_THRESHOLD_SECONDS) return;
      const evs = await fetchAlertEventsSince(prevTs);
      setRecapSince(prevTs);
      setEvents(evs);
    })();
  }, []);

  if (recapSince == null || dismissed) return null;

  // Snapshot le plus récent enregistré avant la dernière session — même méthodologie
  // que le recorder (resolvePositions sans exclure le fiat, cf. usePrices.ts).
  const prevSnapshot = [...snapshots].reverse().find((s) => s.recorded_at <= recapSince) ?? null;
  const { totalValue: currentValue } = computeTotals(
    resolvePositions(positions, transactions), prices, baseCurrency, eurUsd
  );
  const valueDelta = prevSnapshot && prevSnapshot.total_value > 0 && currentValue > 0
    ? {
        abs: currentValue - prevSnapshot.total_value,
        pct: ((currentValue - prevSnapshot.total_value) / prevSnapshot.total_value) * 100,
      }
    : null;

  if (events.length === 0 && valueDelta == null) return null;

  return (
    <div className={styles.banner}>
      <div className={styles.header}>
        <span className={styles.title}>Depuis ta dernière session ({formatElapsed(Math.floor(Date.now() / 1000) - recapSince)})</span>
        <button className={styles.close} onClick={() => setDismissed(true)}>✕</button>
      </div>

      {valueDelta && (
        <p className={`${styles.valueLine} ${valueDelta.abs >= 0 ? styles.up : styles.down}`}>
          Portefeuille : {valueDelta.abs >= 0 ? '+' : ''}
          {valueDelta.abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency}
          {' '}({valueDelta.pct >= 0 ? '+' : ''}{valueDelta.pct.toFixed(1)}%)
        </p>
      )}

      {events.length > 0 && (
        <ul className={styles.events}>
          {events.map((e) => (
            <li key={e.id} className={styles.eventItem}>{e.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
