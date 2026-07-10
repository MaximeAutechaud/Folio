import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNarratives, insertAlertRule, updateAlertRule } from '../../lib/db';
import { searchYahoo, fetchYahooPrices, type YahooSuggestion } from '../../lib/api/yahoo';
import { SECTORS } from '../../lib/sectors';
import type { AlertType, AlertScope, AlertRule, AlertRuleInput } from '../../types';
import styles from './AlertForm.module.css';

interface Props {
  onClose: () => void;
  prefillTicker?: string;
  /** mode édition : paramètres modifiables (seuil/direction), identité verrouillée */
  editRule?: AlertRule;
}

type RsiSubScope = 'sector' | 'narrative';
type EmaDir = 'golden' | 'death' | 'both';
type PriceDir = 'above' | 'below';

const TYPE_LABELS: Record<AlertType, string> = {
  signal_change:           'Signal émis (dip, reversal…)',
  rsi_overbought:          'RSI Overbought',
  rsi_oversold:            'RSI Oversold',
  macro_regime_change:     'Changement de régime macro',
  price_target:            'Prix cible',
  stop_loss:               'Stop loss',
  price_below_ma200:       'Prix sous MA200',
  ema_cross:               'Croisement EMA (Golden/Death)',
  sector_score_threshold:  'Score secteur ≥ seuil',
};

const DEFAULT_THRESHOLD: Partial<Record<AlertType, string>> = {
  rsi_overbought:         '70',
  rsi_oversold:           '30',
  sector_score_threshold: '70',
};

export function AlertForm({ onClose, prefillTicker, editRule }: Props) {
  const queryClient = useQueryClient();
  const isEdit = editRule != null;

  const initialType: AlertType = editRule ? editRule.type : prefillTicker ? 'price_target' : 'rsi_overbought';
  const [type, setType] = useState<AlertType>(initialType);
  const [rsiSubScope, setRsiSubScope] = useState<RsiSubScope>(editRule?.scope === 'narrative' ? 'narrative' : 'sector');
  const [sectorId, setSectorId] = useState(editRule?.scope === 'sector' ? editRule.scope_id : SECTORS[0].id);
  const [narrativeId, setNarrativeId] = useState(editRule?.scope === 'narrative' ? editRule.scope_id : '');
  const [ticker, setTicker] = useState(
    editRule?.scope === 'ticker' ? editRule.scope_id : prefillTicker ? prefillTicker.toUpperCase() : ''
  );
  const [threshold, setThreshold] = useState(
    editRule && editRule.type !== 'ema_cross'
      ? editRule.threshold ?? ''
      : DEFAULT_THRESHOLD[initialType] ?? ''
  );
  const [emaDir, setEmaDir] = useState<EmaDir>(
    editRule?.type === 'ema_cross' ? ((editRule.threshold as EmaDir) ?? 'both') : 'both'
  );
  const [priceDir, setPriceDir] = useState<PriceDir>(editRule?.direction === 'below' ? 'below' : 'above');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<YahooSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const { data: narratives = [] } = useQuery({
    queryKey: ['narratives'],
    queryFn: () => fetchNarratives(true),
    staleTime: 60_000,
  });

  // Seules les narratives avec ETF de référence sont évaluables par le moteur
  // (useNarrativeEtfPerfs) — en proposer d'autres créerait des règles mortes.
  const etfNarratives = narratives.filter(n => n.ref_etf);

  if (!narrativeId && etfNarratives.length > 0) {
    setNarrativeId(String(etfNarratives[0].id));
  }

  function handleTypeChange(t: AlertType) {
    setType(t);
    setThreshold(DEFAULT_THRESHOLD[t] ?? '');
    setError(null);
  }

  function handleTickerChange(value: string) {
    setTicker(value);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      const results = await searchYahoo(value).catch(() => []);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    }, 300);
  }

  function pickSuggestion(s: YahooSuggestion) {
    setTicker(s.symbol);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  // Retourne l'input prêt à insérer, ou un message d'erreur à afficher.
  function buildInput(): AlertRuleInput | string {
    if (type === 'rsi_overbought' || type === 'rsi_oversold' || type === 'signal_change') {
      let thr: string | null = null;
      if (type !== 'signal_change') {
        const parsed = parseFloat(threshold);
        if (isNaN(parsed) || parsed <= 0 || parsed >= 100) return 'Seuil RSI invalide — entre 1 et 99.';
        thr = String(parsed);
      }

      if (rsiSubScope === 'sector') {
        const sector = SECTORS.find(s => s.id === sectorId);
        if (!sector) return 'Choisis un secteur.';
        return {
          type,
          scope: 'sector' as AlertScope,
          scope_id: sector.id,
          label: `${sector.name} (${sector.etf})`,
          threshold: thr,
        };
      } else {
        const narrative = etfNarratives.find(n => String(n.id) === narrativeId);
        if (!narrative) return 'Choisis une narrative avec ETF de référence.';
        return {
          type,
          scope: 'narrative' as AlertScope,
          scope_id: String(narrative.id),
          label: `${narrative.name} (${narrative.ref_etf})`,
          threshold: thr,
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
      if (!sym) return 'Ticker requis.';
      const thr = parseFloat(threshold);
      if (isNaN(thr) || thr <= 0) return 'Prix invalide.';
      return {
        type,
        scope: 'ticker' as AlertScope,
        scope_id: sym,
        label: sym,
        threshold: String(thr),
        direction: type === 'price_target' ? priceDir : null,
      };
    }

    if (type === 'price_below_ma200') {
      const sym = ticker.trim().toUpperCase();
      if (!sym) return 'Ticker requis.';
      return {
        type,
        scope: 'ticker' as AlertScope,
        scope_id: sym,
        label: sym,
        threshold: null,
      };
    }

    if (type === 'ema_cross') {
      const sym = ticker.trim().toUpperCase();
      if (!sym) return 'Ticker requis.';
      return {
        type,
        scope: 'ticker' as AlertScope,
        scope_id: sym,
        label: sym,
        threshold: emaDir,
      };
    }

    if (type === 'sector_score_threshold') {
      const thr = parseFloat(threshold);
      if (isNaN(thr) || thr < 0 || thr > 100) return 'Score invalide — entre 0 et 100.';
      const sector = SECTORS.find(s => s.id === sectorId);
      if (!sector) return 'Choisis un secteur.';
      return {
        type,
        scope: 'sector' as AlertScope,
        scope_id: sector.id,
        label: `${sector.name} (${sector.etf})`,
        threshold: String(thr),
      };
    }

    return 'Type d\'alerte inconnu.';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = buildInput();
    if (typeof input === 'string') { setError(input); return; }
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await updateAlertRule(editRule!.id, input.threshold, input.direction ?? null);
        queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
        onClose();
        return;
      }
      // Garde anti-règle morte : un ticker qui ne résout aucun prix Yahoo ne
      // serait jamais évalué par le moteur (typo, id CoinGecko…).
      if (input.scope === 'ticker') {
        const prices = await fetchYahooPrices([input.scope_id]);
        if (prices[input.scope_id] == null) {
          setError(`${input.scope_id} introuvable sur Yahoo — format requis : NVDA, AIR.PA, BTC-USD…`);
          return;
        }
      }
      await insertAlertRule(input);
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const isRsiType = type === 'rsi_overbought' || type === 'rsi_oversold';
  const hasScopePicker = isRsiType || type === 'signal_change';
  const isTickerType = type === 'price_target' || type === 'stop_loss' || type === 'price_below_ma200' || type === 'ema_cross';
  const needsNumericThreshold = type !== 'macro_regime_change' && type !== 'price_below_ma200' && type !== 'ema_cross' && type !== 'signal_change';
  const isSectorScoped = isRsiType && rsiSubScope === 'sector' || type === 'sector_score_threshold';

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{isEdit ? 'Modifier l\'alerte' : 'Nouvelle alerte'}</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Type
            <select
              className={styles.select}
              value={type}
              onChange={e => handleTypeChange(e.target.value as AlertType)}
              disabled={isEdit}
            >
              {(Object.keys(TYPE_LABELS) as AlertType[]).map(t => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>

          {type === 'signal_change' && (
            <p className={styles.hint}>
              Déclenche quand le secteur ou la narrative émet un nouveau signal
              (dip, reversal, accelerating, exhaustion) ou en change. Exhaustion
              est un signal d'évitement.
            </p>
          )}

          {type === 'macro_regime_change' && (
            <p className={styles.hint}>
              Déclenche une alerte à chaque changement de régime macro (Risk-On → Favorable → Neutre → Défavorable → Risk-Off).
            </p>
          )}

          {type === 'price_below_ma200' && (
            <p className={styles.hint}>
              Déclenche une alerte quand le prix du ticker passe sous sa moyenne mobile 200j.
            </p>
          )}

          {type === 'ema_cross' && (
            <p className={styles.hint}>
              Déclenche quand l'EMA50 croise l'EMA200 (Golden Cross = signal haussier, Death Cross = signal baissier).
            </p>
          )}

          {hasScopePicker && (
            <>
              <label className={styles.label}>
                Cible
                <div className={styles.segmented}>
                  <button
                    type="button"
                    className={`${styles.seg} ${rsiSubScope === 'sector' ? styles.segActive : ''}`}
                    onClick={() => setRsiSubScope('sector')}
                    disabled={isEdit}
                  >
                    Secteur
                  </button>
                  <button
                    type="button"
                    className={`${styles.seg} ${rsiSubScope === 'narrative' ? styles.segActive : ''}`}
                    onClick={() => setRsiSubScope('narrative')}
                    disabled={isEdit}
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
                    disabled={isEdit}
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
                    disabled={isEdit}
                  >
                    {etfNarratives.map(n => (
                      <option key={n.id} value={String(n.id)}>
                        {n.name} ({n.ref_etf})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          {type === 'sector_score_threshold' && (
            <label className={styles.label}>
              Secteur
              <select
                className={styles.select}
                value={sectorId}
                onChange={e => setSectorId(e.target.value)}
                disabled={isEdit}
              >
                {SECTORS.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.etf})</option>
                ))}
              </select>
            </label>
          )}

          {isTickerType && (
            <label className={styles.label}>
              Ticker
              <div className={styles.autocompleteWrap}>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="ex: NVDA, AAPL, AIR.PA"
                  value={ticker}
                  onChange={e => handleTickerChange(e.target.value)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  autoComplete="off"
                  autoFocus={!prefillTicker && !isEdit}
                  disabled={isEdit}
                />
                {showSuggestions && (
                  <ul className={styles.dropdown}>
                    {suggestions.map(s => (
                      <li
                        key={s.symbol}
                        className={styles.dropdownItem}
                        onMouseDown={() => pickSuggestion(s)}
                      >
                        <span className={styles.suggTicker}>{s.symbol}</span>
                        <span className={styles.suggName}>{s.shortname}</span>
                        <span className={styles.suggExch}>{s.exchDisp}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>
          )}

          {type === 'price_target' && (
            <label className={styles.label}>
              Condition
              <div className={styles.segmented}>
                <button
                  type="button"
                  className={`${styles.seg} ${priceDir === 'above' ? styles.segActive : ''}`}
                  onClick={() => setPriceDir('above')}
                >
                  ≥ Au-dessus
                </button>
                <button
                  type="button"
                  className={`${styles.seg} ${priceDir === 'below' ? styles.segActive : ''}`}
                  onClick={() => setPriceDir('below')}
                >
                  ≤ En-dessous
                </button>
              </div>
            </label>
          )}

          {type === 'ema_cross' && (
            <label className={styles.label}>
              Croisement
              <div className={styles.segmented}>
                {(['golden', 'death', 'both'] as EmaDir[]).map(dir => (
                  <button
                    key={dir}
                    type="button"
                    className={`${styles.seg} ${emaDir === dir ? styles.segActive : ''}`}
                    onClick={() => setEmaDir(dir)}
                  >
                    {dir === 'golden' ? 'Golden Cross' : dir === 'death' ? 'Death Cross' : 'Les deux'}
                  </button>
                ))}
              </div>
            </label>
          )}

          {needsNumericThreshold && (
            <label className={styles.label}>
              {isRsiType
                ? 'Seuil RSI'
                : type === 'sector_score_threshold'
                  ? 'Score minimum (0–100)'
                  : type === 'price_target'
                    ? 'Prix cible'
                    : 'Prix stop'}
              <input
                className={styles.input}
                type="text"
                inputMode="decimal"
                placeholder={isSectorScoped && type === 'sector_score_threshold' ? '70' : isRsiType ? '70' : '0.00'}
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
              />
            </label>
          )}

          {error && <p className={styles.error}>⚠ {error}</p>}

          <div className={styles.footer}>
            <button type="button" className={styles.cancel} onClick={onClose}>Annuler</button>
            <button type="submit" className={styles.submit} disabled={saving}>
              {saving ? (isEdit ? 'Enregistrement…' : 'Vérification…') : isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
