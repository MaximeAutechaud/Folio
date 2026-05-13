import { useState } from 'react';
import { useMacroScore } from '../../hooks/useMacroScore';
import type { Signal, Regime } from '../../hooks/useMacroScore';
import styles from './MacroScore.module.css';

// ── Static config ─────────────────────────────────────────────────────────────

const REGIME_CONFIG: Record<Regime, { label: string; color: string }> = {
  'risk-on':     { label: 'Risk-On',     color: '#3fb950' },
  'favorable':   { label: 'Favorable',   color: '#56d364' },
  'neutral':     { label: 'Neutre',      color: '#e3b341' },
  'unfavorable': { label: 'Défavorable', color: '#f0883e' },
  'risk-off':    { label: 'Risk-Off',    color: '#f85149' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SignalDot({ signal }: { signal: Signal }) {
  return (
    <span className={
      signal === 'bullish' ? styles.dotBull :
      signal === 'bearish' ? styles.dotBear :
      styles.dotNeutral
    }>●</span>
  );
}

function SignalLabel({ signal }: { signal: Signal }) {
  return (
    <span className={
      signal === 'bullish' ? styles.sigBull :
      signal === 'bearish' ? styles.sigBear :
      styles.sigNeutral
    }>
      {signal === 'bullish' ? 'Haussier' : signal === 'bearish' ? 'Baissier' : 'Neutre'}
    </span>
  );
}

function ScoreGauge({ score }: { score: number }) {
  return (
    <div className={styles.gaugeTrack}>
      <div className={styles.gaugeMarker} style={{ left: `${score}%` }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MacroScore() {
  const { data, isFetching } = useMacroScore();
  const [expanded, setExpanded] = useState(false);

  if (!data) {
    return (
      <div className={styles.root}>
        <span className={styles.loading}>
          {isFetching ? 'Chargement du contexte macro…' : '—'}
        </span>
      </div>
    );
  }

  const { score, regime, indicators } = data;
  const rc = REGIME_CONFIG[regime];

  return (
    <div className={styles.root}>
      {/* ── Barre compacte (toujours visible) ── */}
      <div className={styles.bar} onClick={() => setExpanded(e => !e)}>
        <span className={styles.barTitle}>Contexte Macro</span>

        <span
          className={styles.regimeBadge}
          style={{ color: rc.color, background: rc.color + '22' }}
        >
          {rc.label}
        </span>

        <ScoreGauge score={score} />

        <span className={styles.scoreNum} style={{ color: rc.color }}>
          {score}
        </span>

        <div className={styles.chips}>
          {indicators.map(ind => (
            <span key={ind.id} className={styles.chip}>
              <SignalDot signal={ind.signal} />
              {ind.chip}
            </span>
          ))}
        </div>

        <span className={styles.toggle}>{expanded ? '▲' : '▼'}</span>
        {isFetching && <span className={styles.spinner}>↻</span>}
      </div>

      {/* ── Tableau détaillé (expandable) ── */}
      {expanded && (
        <div className={styles.detail}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Indicateur</th>
                <th>Valeur 1M</th>
                <th>Signal</th>
                <th className={styles.thExpl}>Lecture</th>
                <th>Poids</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map(ind => (
                <tr key={ind.id} className={styles.row}>
                  <td>
                    <div className={styles.indName}>{ind.label}</div>
                    <div className={styles.indTip}>{ind.tip}</div>
                  </td>
                  <td className={styles.tdValue}>{ind.value}</td>
                  <td className={styles.tdSignal}>
                    <SignalDot signal={ind.signal} />
                    <SignalLabel signal={ind.signal} />
                  </td>
                  <td className={styles.tdExpl}>{ind.explanation}</td>
                  <td className={styles.tdWeight}>{Math.round(ind.weight * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.footnote}>
            Score de 0 (Risk-Off total) à 100 (Risk-On total) — données Yahoo Finance, rafraîchies toutes les 5 min.
          </div>
        </div>
      )}
    </div>
  );
}
