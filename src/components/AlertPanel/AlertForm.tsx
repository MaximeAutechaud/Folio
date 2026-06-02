import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNarratives, insertAlertRule } from '../../lib/db';
import { SECTORS } from '../../lib/sectors';
import type { AlertType, AlertScope, AlertRuleInput } from '../../types';
import styles from './AlertForm.module.css';

interface Props {
  onClose: () => void;
  prefillTicker?: string;
}

type RsiSubScope = 'sector' | 'narrative';

const TYPE_LABELS: Record<AlertType, string> = {
  rsi_overbought:     'RSI Overbought',
  rsi_oversold:       'RSI Oversold',
  macro_regime_change:'Changement de régime macro',
  price_target:       'Prix cible',
  stop_loss:          'Stop loss',
};

const DEFAULT_THRESHOLD: Partial<Record<AlertType, string>> = {
  rsi_overbought: '70',
  rsi_oversold:   '30',
};

export function AlertForm({ onClose, prefillTicker }: Props) {
  const queryClient = useQueryClient();

  const initialType: AlertType = prefillTicker ? 'price_target' : 'rsi_overbought';
  const [type, setType] = useState<AlertType>(initialType);
  const [rsiSubScope, setRsiSubScope] = useState<RsiSubScope>('sector');
  const [sectorId, setSectorId] = useState(SECTORS[0].id);
  const [narrativeId, setNarrativeId] = useState('');
  const [ticker, setTicker] = useState(prefillTicker ? prefillTicker.toUpperCase() : '');
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD[initialType] ?? '');
  const [saving, setSaving] = useState(false);

  const { data: narratives = [] } = useQuery({
    queryKey: ['narratives'],
    queryFn: () => fetchNarratives(true),
    staleTime: 60_000,
  });

  // Set default narrative once loaded
  if (!narrativeId && narratives.length > 0) {
    setNarrativeId(String(narratives[0].id));
  }

  function handleTypeChange(t: AlertType) {
    setType(t);
    setThreshold(DEFAULT_THRESHOLD[t] ?? '');
  }

  function buildInput(): AlertRuleInput | null {
    if (type === 'rsi_overbought' || type === 'rsi_oversold') {
      const thr = parseFloat(threshold);
      if (isNaN(thr) || thr <= 0 || thr >= 100) return null;

      if (rsiSubScope === 'sector') {
        const sector = SECTORS.find(s => s.id === sectorId);
        if (!sector) return null;
        return {
          type,
          scope: 'sector' as AlertScope,
          scope_id: sector.id,
          label: `${sector.name} (${sector.etf})`,
          threshold: String(thr),
        };
      } else {
        const narrative = narratives.find(n => String(n.id) === narrativeId);
        if (!narrative) return null;
        return {
          type,
          scope: 'narrative' as AlertScope,
          scope_id: String(narrative.id),
          label: narrative.ref_etf ? `${narrative.name} (${narrative.ref_etf})` : narrative.name,
          threshold: String(thr),
        };
      }
    }

    if (type === 'macro_regime_change') {
      return {
        type,
        scope: 'macro' as AlertScope,
        scope_id: '',
        label: 'MacroScore',
        threshold: null,
      };
    }

    if (type === 'price_target' || type === 'stop_loss') {
      const sym = ticker.trim().toUpperCase();
      const thr = parseFloat(threshold);
      if (!sym || isNaN(thr) || thr <= 0) return null;
      return {
        type,
        scope: 'ticker' as AlertScope,
        scope_id: sym,
        label: sym,
        threshold: String(thr),
      };
    }

    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    try {
      await insertAlertRule(input);
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const needsThreshold = type !== 'macro_regime_change';
  const isRsiType = type === 'rsi_overbought' || type === 'rsi_oversold';
  const isTickerType = type === 'price_target' || type === 'stop_loss';

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Nouvelle alerte</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Type
            <select
              className={styles.select}
              value={type}
              onChange={e => handleTypeChange(e.target.value as AlertType)}
            >
              {(Object.keys(TYPE_LABELS) as AlertType[]).map(t => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>

          {type === 'macro_regime_change' && (
            <p className={styles.hint}>
              Déclenche une alerte à chaque changement de régime macro (Risk-On → Favorable → Neutre → Défavorable → Risk-Off).
            </p>
          )}

          {isRsiType && (
            <>
              <label className={styles.label}>
                Cible
                <div className={styles.segmented}>
                  <button
                    type="button"
                    className={`${styles.seg} ${rsiSubScope === 'sector' ? styles.segActive : ''}`}
                    onClick={() => setRsiSubScope('sector')}
                  >
                    Secteur
                  </button>
                  <button
                    type="button"
                    className={`${styles.seg} ${rsiSubScope === 'narrative' ? styles.segActive : ''}`}
                    onClick={() => setRsiSubScope('narrative')}
                  >
                    Narrative
                  </button>
                </div>
              </label>

              {rsiSubScope === 'sector' ? (
                <label className={styles.label}>
                  Secteur
                  <select
                    className={styles.select}
                    value={sectorId}
                    onChange={e => setSectorId(e.target.value)}
                  >
                    {SECTORS.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.etf})</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className={styles.label}>
                  Narrative
                  <select
                    className={styles.select}
                    value={narrativeId}
                    onChange={e => setNarrativeId(e.target.value)}
                  >
                    {narratives.map(n => (
                      <option key={n.id} value={String(n.id)}>
                        {n.name}{n.ref_etf ? ` (${n.ref_etf})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          {isTickerType && (
            <label className={styles.label}>
              Ticker
              <input
                className={styles.input}
                type="text"
                placeholder="ex: NVDA, AAPL, AIR.PA"
                value={ticker}
                onChange={e => setTicker(e.target.value)}
                autoFocus
              />
            </label>
          )}

          {needsThreshold && (
            <label className={styles.label}>
              {isRsiType ? 'Seuil RSI' : isTickerType && type === 'price_target' ? 'Prix cible' : 'Prix stop'}
              <input
                className={styles.input}
                type="text"
                inputMode="decimal"
                placeholder={isRsiType ? '70' : '0.00'}
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
              />
            </label>
          )}

          <div className={styles.footer}>
            <button type="button" className={styles.cancel} onClick={onClose}>Annuler</button>
            <button type="submit" className={styles.submit} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
