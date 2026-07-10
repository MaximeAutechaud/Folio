import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Narrative, NarrativeInput, NarrativeTickerInput } from '../../types';
import {
  insertNarrative, updateNarrative,
  fetchNarrativeTickers,
  replaceNarrativeTickers,
} from '../../lib/db';
import { SECTORS } from '../../lib/sectors';
import { searchYahoo, type YahooSuggestion } from '../../lib/api/yahoo';
import styles from './NarrativeForm.module.css';

interface Props {
  narrative?: Narrative;
  onClose: () => void;
  onSaved: () => void;
}

const PRESET_COLORS = [
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#a855f7', '#d97706',
  '#f97316', '#14b8a6', '#0ea5e9',
];

export function NarrativeForm({ narrative, onClose, onSaved }: Props) {
  const editMode = !!narrative;

  const [name, setName] = useState(narrative?.name ?? '');
  const [description, setDescription] = useState(narrative?.description ?? '');
  const [color, setColor] = useState(narrative?.color ?? '#6366f1');
  const [refEtf, setRefEtf] = useState(narrative?.ref_etf ?? '');
  const [parentSector, setParentSector] = useState(narrative?.parent_sector ?? '');

  const [tickers, setTickers] = useState<NarrativeTickerInput[]>([]);

  const [tickerSearch, setTickerSearch] = useState('');
  const [suggestions, setSuggestions] = useState<YahooSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const { data: existingTickers = [], isLoading: loadingTickers } = useQuery({
    queryKey: ['narrative-tickers-edit', narrative?.id],
    queryFn: () => fetchNarrativeTickers(narrative!.id),
    enabled: editMode,
  });

  useEffect(() => {
    if (initialized.current) return;
    if (editMode && loadingTickers) return;
    setTickers(existingTickers.map(t => ({ ticker: t.ticker, name: t.name, exchange: t.exchange })));
    initialized.current = true;
  }, [loadingTickers, existingTickers, editMode]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function handleTickerSearch(value: string) {
    setTickerSearch(value);
    if (value.length < 1) { setSuggestions([]); setShowSuggestions(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const results = await searchYahoo(value);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    }, 300);
  }

  function addTicker(s: YahooSuggestion) {
    if (tickers.some(t => t.ticker === s.symbol)) return;
    setTickers(prev => [...prev, { ticker: s.symbol, name: s.shortname || s.symbol, exchange: s.exchDisp || '' }]);
    setTickerSearch('');
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Sans ETF, la narrative est un pool de candidats affiché dans le drawer
    // de son secteur parent — sans secteur, elle ne serait visible nulle part.
    if (!refEtf.trim() && !parentSector) {
      setError('Une narrative sans ETF de référence est un pool de candidats : rattachez-la à un secteur parent pour qu\'elle apparaisse dans son drawer.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const input: NarrativeInput = {
        name: name.trim(),
        description: description.trim(),
        color,
        ref_etf: refEtf.trim() || null,
        parent_sector: parentSector || null,
      };
      let id = narrative?.id;
      if (editMode) {
        await updateNarrative(id!, input);
      } else {
        id = await insertNarrative(input);
      }
      await replaceNarrativeTickers(id!, tickers);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span>{editMode ? 'Modifier la narrative' : 'Nouvelle narrative'}</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.row}>
            <label className={styles.label}>Nom</label>
            <input
              className={styles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ex: IA Infrastructure"
              autoFocus
              required
            />
          </div>

          <div className={styles.row}>
            <label className={styles.label}>Description</label>
            <input
              className={styles.input}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Courte description..."
            />
          </div>

          <div className={styles.twoCol}>
            <div className={styles.row}>
              <label className={styles.label}>ETF de référence (optionnel)</label>
              <input
                className={styles.input}
                value={refEtf}
                onChange={e => setRefEtf(e.target.value.toUpperCase())}
                placeholder="SOXX, GDX, CIBR..."
                title="Avec ETF : narrative scorée dans l'onglet Narratives. Sans ETF : pool de candidats dans le drawer du secteur parent."
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Secteur parent{refEtf.trim() ? ' (optionnel)' : ''}</label>
              <select
                className={styles.input}
                value={parentSector}
                onChange={e => setParentSector(e.target.value)}
              >
                <option value="">— Aucun —</option>
                {SECTORS.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.label}>Couleur</label>
            <div className={styles.colorRow}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorDot} ${color === c ? styles.colorSelected : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Tickers</span>
            {tickers.length > 0 && (
              <div className={styles.tickerList}>
                {tickers.map(t => (
                  <div key={t.ticker} className={styles.tickerRow}>
                    <span className={styles.tickerSymbol}>{t.ticker}</span>
                    <span className={styles.tickerName}>{t.name}</span>
                    <span className={styles.tickerExch}>{t.exchange}</span>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => setTickers(prev => prev.filter(x => x.ticker !== t.ticker))}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.autocompleteWrap}>
              <input
                className={styles.input}
                value={tickerSearch}
                onChange={e => handleTickerSearch(e.target.value)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder='Rechercher — "air liquide", "MSFT"…'
              />
              {showSuggestions && (
                <ul className={styles.dropdown}>
                  {suggestions.map(s => (
                    <li key={s.symbol} className={styles.dropdownItem} onMouseDown={() => addTicker(s)}>
                      <span className={styles.suggTicker}>{s.symbol}</span>
                      <span className={styles.suggName}>{s.shortname}</span>
                      <span className={styles.suggExch}>{s.exchDisp}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {error && <p className={styles.formError}>{error}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Annuler</button>
            <button type="submit" className={styles.submitBtn} disabled={saving || !name.trim()}>
              {saving ? 'Enregistrement…' : editMode ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
