import { useState } from 'react';
import { SectorDashboard } from './SectorDashboard';
import { NarrativeDashboard } from './NarrativeDashboard';
import { MacroPulse } from './MacroPulse';
import styles from './MarketView.module.css';

type MarketSubTab = 'rotation' | 'narratives';

export function MarketView() {
  const [subTab, setSubTab] = useState<MarketSubTab>('rotation');

  return (
    <div className={styles.root}>
      <MacroPulse />

      <div className={styles.subNav}>
        <button
          className={`${styles.subNavBtn} ${subTab === 'rotation' ? styles.subNavActive : ''}`}
          onClick={() => setSubTab('rotation')}
        >
          Rotation sectorielle
        </button>
        <button
          className={`${styles.subNavBtn} ${subTab === 'narratives' ? styles.subNavActive : ''}`}
          onClick={() => setSubTab('narratives')}
        >
          Narratives
        </button>
      </div>

      {subTab === 'rotation'   && <SectorDashboard />}
      {subTab === 'narratives' && <NarrativeDashboard />}
    </div>
  );
}
