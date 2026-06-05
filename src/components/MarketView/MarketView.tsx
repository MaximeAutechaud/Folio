import { useState } from 'react';
import { SectorDashboard } from './SectorDashboard';
import { NarrativeDashboard } from './NarrativeDashboard';
import { MacroScore } from './MacroScore';
import { MacroPulse } from './MacroPulse';
import styles from './MarketView.module.css';

type MarketSubTab = 'macro' | 'secteurs' | 'narratives';

const TABS: { id: MarketSubTab; label: string; hint: string }[] = [
  { id: 'macro',      label: 'Macro',      hint: 'régime & indicateurs' },
  { id: 'secteurs',   label: 'Secteurs',   hint: 'rotation & opportunités' },
  { id: 'narratives', label: 'Narratives', hint: 'thèmes & tickers' },
];

export function MarketView() {
  const [subTab, setSubTab] = useState<MarketSubTab>('macro');

  return (
    <div className={styles.root}>
      <MacroPulse />

      <div className={styles.subNav}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            className={`${styles.subNavBtn} ${subTab === t.id ? styles.subNavActive : ''}`}
            onClick={() => setSubTab(t.id)}
          >
            <span className={styles.tabIndex}>{i + 1}</span>
            {t.label}
            <span className={styles.tabHint}>{t.hint}</span>
          </button>
        ))}
      </div>

      {subTab === 'macro'      && <MacroScore />}
      {subTab === 'secteurs'   && <SectorDashboard />}
      {subTab === 'narratives' && <NarrativeDashboard />}
    </div>
  );
}
