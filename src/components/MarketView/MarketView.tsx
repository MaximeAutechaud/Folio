import { useState, useRef } from 'react';
import { SectorDashboard } from './SectorDashboard';
import { NarrativeDashboard } from './NarrativeDashboard';
import { MacroScore } from './MacroScore';
import { MacroPulse } from './MacroPulse';
import { useMacroScore } from '../../hooks/useMacroScore';
import styles from './MarketView.module.css';

type MarketSubTab = 'macro' | 'secteurs' | 'narratives';

const TABS: { id: MarketSubTab; label: string; hint: string }[] = [
  { id: 'macro',      label: 'Macro',      hint: 'régime & indicateurs' },
  { id: 'secteurs',   label: 'Secteurs',   hint: 'rotation & opportunités' },
  { id: 'narratives', label: 'Narratives', hint: 'thèmes & tickers' },
];

export function MarketView() {
  const [subTab, setSubTab] = useState<MarketSubTab>('macro');
  const [showMacroDisclaimer, setShowMacroDisclaimer] = useState(false);
  const macroDisclaimerShown = useRef(false);
  const { data: macroData } = useMacroScore();

  function handleSubTabChange(tab: MarketSubTab) {
    if (
      tab === 'secteurs' &&
      !macroDisclaimerShown.current &&
      (macroData?.score ?? 100) < 40
    ) {
      setShowMacroDisclaimer(true);
    }
    setSubTab(tab);
  }

  function closeMacroDisclaimer() {
    macroDisclaimerShown.current = true;
    setShowMacroDisclaimer(false);
  }

  return (
    <div className={styles.root}>
      <MacroPulse />

      <div className={styles.subNav}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            className={`${styles.subNavBtn} ${subTab === t.id ? styles.subNavActive : ''}`}
            onClick={() => handleSubTabChange(t.id)}
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

      {showMacroDisclaimer && (
        <div className={styles.modalOverlay} onClick={closeMacroDisclaimer}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalIcon}>⚠</div>
            <p className={styles.modalText}>
              Contexte macro défavorable — les signaux d'entrée sont moins fiables en régime risk-off.
            </p>
            <button className={styles.modalBtn} onClick={closeMacroDisclaimer}>Compris</button>
          </div>
        </div>
      )}
    </div>
  );
}
