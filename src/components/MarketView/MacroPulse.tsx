import { useMacroScore } from '../../hooks/useMacroScore';
import type { Signal, Regime } from '../../hooks/useMacroScore';
import styles from './MacroPulse.module.css';

const REGIME_COLOR: Record<Regime, string> = {
  'risk-on':     '#3fb950',
  'favorable':   '#56d364',
  'neutral':     '#e3b341',
  'unfavorable': '#f0883e',
  'risk-off':    '#f85149',
};

const REGIME_LABEL: Record<Regime, string> = {
  'risk-on':     'Risk-On',
  'favorable':   'Favorable',
  'neutral':     'Neutre',
  'unfavorable': 'Défavorable',
  'risk-off':    'Risk-Off',
};

function signalColor(s: Signal): string {
  return s === 'bullish' ? 'var(--green)' : s === 'bearish' ? 'var(--red)' : 'var(--text-muted)';
}

function shortenValue(id: string, value: string): string {
  if (id === 'iwm')       return value.replace(' vs SPY', '');
  if (id === 'tyx-level') return value.split('·')[0].trim();
  return value.replace(/\s{2,}/g, ' ');
}

export function MacroPulse() {
  const { data, isFetching } = useMacroScore();
  if (!data) return null;

  const { score, regime, indicators } = data;
  const rc = REGIME_COLOR[regime];

  return (
    <div className={styles.strip}>
      <span className={styles.label}>Macro</span>

      <span className={styles.badge} style={{ color: rc, borderColor: rc + '55' }}>
        <span className={styles.scoreNum}>{score}</span>
        <span className={styles.badgeDot}>·</span>
        {REGIME_LABEL[regime]}
      </span>

      <span className={styles.divider}>|</span>

      {indicators.map(ind => (
        <span
          key={ind.id}
          className={styles.item}
          title={ind.explanation}
        >
          <span className={styles.chip}>{ind.chip}</span>
          <span style={{ color: signalColor(ind.signal) }}>
            {shortenValue(ind.id, ind.value)}
          </span>
        </span>
      ))}

      {isFetching && <span className={styles.spin}>↻</span>}
    </div>
  );
}
