import { useState } from 'react';
import { useMacroScore } from '../../hooks/useMacroScore';
import type { Signal, Regime, MacroScoreData } from '../../hooks/useMacroScore';
import { MacroScoreChart } from './MacroScoreChart';
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

function TrendArrow({ trend, scorePrev, score }: { trend: MacroScoreData['trend']; scorePrev: number | null; score: number }) {
  if (trend === 'flat') return <span className={styles.trendFlat}>→</span>;
  const delta = scorePrev != null ? score - scorePrev : 0;
  const label = (delta >= 0 ? '+' : '') + delta;
  return trend === 'up'
    ? <span className={styles.trendUp}>↑ {label}</span>
    : <span className={styles.trendDown}>↓ {label}</span>;
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

  const { score, scorePrev, trend, regime, indicators } = data;
  const rc = REGIME_CONFIG[regime];
  const scoredIndicators  = indicators.filter(i => !i.contextOnly);
  const contextIndicators = indicators.filter(i => i.contextOnly);

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
        <TrendArrow trend={trend} scorePrev={scorePrev} score={score} />

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
                <th>Valeur</th>
                <th>Signal</th>
                <th className={styles.thExpl}>Lecture</th>
                <th>Poids</th>
              </tr>
            </thead>
            <tbody>
              {scoredIndicators.map(ind => (
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
              {contextIndicators.length > 0 && (
                <>
                  <tr className={styles.sectionRow}>
                    <td colSpan={5}>Contexte taux obligataires — hors score</td>
                  </tr>
                  {contextIndicators.map(ind => (
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
                      <td className={styles.tdWeight}>—</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
          <div className={styles.footnote}>
            Score de 0 (Risk-Off total) à 100 (Risk-On total) — données Yahoo Finance, rafraîchies toutes les 5 min.
          </div>
          <MacroScoreChart />
        </div>
      )}
    </div>
  );
}
