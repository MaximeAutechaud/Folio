import { useState, useEffect, useRef } from 'react';
import type { AssetType, PositionInput } from '../../types';
import { searchYahoo, detectCurrency, type YahooSuggestion } from '../../lib/api/yahoo';
import { searchCoinGecko, type CoinGeckoSuggestion } from '../../lib/api/coingecko';
import styles from './PositionForm.module.css';

interface Props {
  onSubmit: (input: PositionInput) => Promise<void>;
  onClose: () => void;
  initial?: PositionInput;
  editMode?: boolean;
}

const EMPTY: PositionInput = {
  ticker: '',
  name: '',
  asset_type: 'stock',
  currency: 'EUR',
  quantity: 0,
  cost_basis: 0,
};

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'];

type Suggestion =
  | { kind: 'stock'; data: YahooSuggestion }
  | { kind: 'crypto'; data: CoinGeckoSuggestion };

export function PositionForm({ onSubmit, onClose, initial, editMode = false }: Props) {
  const [form, setForm] = useState<PositionInput>(initial ?? EMPTY);
  // Keep raw strings for numeric inputs to preserve "0.", "0.00" while typing
  const [qtyRaw, setQtyRaw] = useState(initial?.quantity ? String(initial.quantity) : '');
  const [costRaw, setCostRaw] = useState(initial?.cost_basis ? String(initial.cost_basis) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function set<K extends keyof PositionInput>(key: K, value: PositionInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleTickerChange(value: string) {
    set('ticker', value);
    if (form.asset_type === 'stock' && value.includes('.')) {
      set('currency', detectCurrency(value));
    }
    if (value.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (form.asset_type === 'stock') {
        const results = await searchYahoo(value);
        setSuggestions(results.map((d) => ({ kind: 'stock' as const, data: d })));
        setShowSuggestions(results.length > 0);
      } else {
        const results = await searchCoinGecko(value);
        setSuggestions(results.map((d) => ({ kind: 'crypto' as const, data: d })));
        setShowSuggestions(results.length > 0);
      }
    }, 300);
  }

  function pickSuggestion(s: Suggestion) {
    if (s.kind === 'stock') {
      setForm((prev) => ({
        ...prev,
        ticker: s.data.symbol,
        name: prev.name || s.data.shortname || '',
        currency: detectCurrency(s.data.symbol),
      }));
    } else {
      // Store CoinGecko ID as ticker — symbolToId will return it directly
      setForm((prev) => ({
        ...prev,
        ticker: s.data.id,
        name: prev.name || `${s.data.name} (${s.data.symbol.toUpperCase()})`,
        currency: 'USD',
      }));
    }
    setSuggestions([]);
    setShowSuggestions(false);
  }

  // Default currency when switching type (only in add mode)
  useEffect(() => {
    if (editMode) return;
    set('currency', form.asset_type === 'crypto' ? 'USD' : 'EUR');
    setSuggestions([]);
    setShowSuggestions(false);
  }, [form.asset_type]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ticker.trim()) return setError('Ticker is required');
    if (form.quantity <= 0) return setError('Quantity must be > 0');
    if (form.cost_basis < 0) return setError('Cost basis must be ≥ 0');
    setSaving(true);
    setError(null);
    try {
      // Stocks: uppercase ticker. Crypto: keep lowercase ID as-is.
      const ticker = form.asset_type === 'stock'
        ? form.ticker.trim().toUpperCase()
        : form.ticker.trim().toLowerCase();
      await onSubmit({ ...form, ticker });
      setForm(EMPTY);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span>{editMode ? 'Edit position' : 'Add position'}</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.row}>
            <label className={styles.label}>Type</label>
            <div className={styles.toggle}>
              {(['stock', 'crypto'] as AssetType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.toggleBtn} ${form.asset_type === t ? styles.active : ''}`}
                  onClick={() => { set('asset_type', t); setSuggestions([]); }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.label} htmlFor="ticker">
              {form.asset_type === 'crypto' ? 'Coin' : 'Ticker'}
            </label>
            <div className={styles.autocompleteWrap}>
              <input
                id="ticker"
                className={styles.input}
                value={form.ticker}
                onChange={(e) => handleTickerChange(e.target.value)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder={form.asset_type === 'crypto'
                  ? 'Rechercher — "bitcoin", "eth"…'
                  : 'Ticker ou nom — "air liquide", "MSFT"…'}
                autoComplete="off"
                autoFocus
              />
              {showSuggestions && (
                <ul className={styles.dropdown}>
                  {suggestions.map((s) =>
                    s.kind === 'stock' ? (
                      <li
                        key={s.data.symbol}
                        className={styles.dropdownItem}
                        onMouseDown={() => pickSuggestion(s)}
                      >
                        <span className={styles.suggTicker}>{s.data.symbol}</span>
                        <span className={styles.suggName}>{s.data.shortname}</span>
                        <span className={styles.suggExch}>{s.data.exchDisp}</span>
                      </li>
                    ) : (
                      <li
                        key={s.data.id}
                        className={styles.dropdownItem}
                        onMouseDown={() => pickSuggestion(s)}
                      >
                        <span className={styles.suggTicker}>{s.data.symbol.toUpperCase()}</span>
                        <span className={styles.suggName}>{s.data.name}</span>
                        {s.data.market_cap_rank && (
                          <span className={styles.suggExch}>#{s.data.market_cap_rank}</span>
                        )}
                      </li>
                    )
                  )}
                </ul>
              )}
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.label} htmlFor="name">Name (optional)</label>
            <input
              id="name"
              className={styles.input}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Apple Inc."
            />
          </div>

          <div className={styles.twoCol}>
            <div className={styles.row}>
              <label className={styles.label} htmlFor="qty">Quantity</label>
              <input
                id="qty"
                type="text"
                inputMode="decimal"
                className={styles.input}
                value={qtyRaw}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^[0-9]*\.?[0-9]*$/.test(v)) {
                    setQtyRaw(v);
                    set('quantity', parseFloat(v) || 0);
                  }
                }}
                placeholder={form.asset_type === 'crypto' ? '0.005' : '10'}
              />
            </div>

            <div className={styles.row}>
              <label className={styles.label} htmlFor="currency">Currency</label>
              <select
                id="currency"
                className={styles.input}
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.label} htmlFor="cost">
              Cost basis (per unit, {form.currency})
            </label>
            <input
              id="cost"
              type="text"
              inputMode="decimal"
              className={styles.input}
              value={costRaw}
              onChange={(e) => {
                const v = e.target.value;
                if (/^[0-9]*\.?[0-9]*$/.test(v)) {
                  setCostRaw(v);
                  set('cost_basis', parseFloat(v) || 0);
                }
              }}
              placeholder="150.00"
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn} disabled={saving}>
              {saving ? 'Saving…' : editMode ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
