import { useState, useEffect, useRef } from 'react';
import type { AssetType, PositionInput } from '../../types';
import { searchYahoo, detectCurrency, type YahooSuggestion } from '../../lib/api/yahoo';
import { searchCoinGecko, type CoinGeckoSuggestion } from '../../lib/api/coingecko';
import { usePortfolioStore, computeTotals, resolvePositions, convertCurrency } from '../../store/portfolio';
import { getSetting, setSetting } from '../../lib/db';
import { useMacroScore } from '../../hooks/useMacroScore';
import { evaluateEntryChecks } from '../../lib/entryChecks';
import { SECTORS } from '../../lib/sectors';
import styles from './PositionForm.module.css';

const RISK_PCT_SETTING = 'risk_pct';
const DEFAULT_RISK_PCT = '1';

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
  stop_price: null,
  target_price: null,
  target_price_2: null,
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
  const [stopRaw, setStopRaw] = useState(initial?.stop_price ? String(initial.stop_price) : '');
  const [targetRaw, setTargetRaw] = useState(initial?.target_price ? String(initial.target_price) : '');
  const [target2Raw, setTarget2Raw] = useState(initial?.target_price_2 ? String(initial.target_price_2) : '');
  const [riskOpen, setRiskOpen] = useState(!!(initial?.stop_price));
  const [riskPctRaw, setRiskPctRaw] = useState(DEFAULT_RISK_PCT);
  const mountedRef = useRef(false);
  // true = user has manually edited the field → stop changes no longer override it
  const t1ManualRef = useRef(false);
  const t2ManualRef = useRef(false);
  const sectorManualRef = useRef(false);
  const nameManualRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prices = usePortfolioStore((s) => s.prices);
  const baseCurrency = usePortfolioStore((s) => s.baseCurrency);
  const eurUsd = usePortfolioStore((s) => s.eurUsd);
  const storePositions = usePortfolioStore((s) => s.positions);
  const storeTransactions = usePortfolioStore((s) => s.transactions);
  const { data: macroScore } = useMacroScore();

  const { totalValue } = computeTotals(
    resolvePositions(storePositions, storeTransactions).filter((p) => p.asset_type !== 'fiat'),
    prices, baseCurrency, eurUsd
  );

  const stopVal = parseFloat(stopRaw) || 0;
  const R = stopVal > 0 && form.cost_basis > 0 ? form.cost_basis - stopVal : 0;
  const riskAmount = R > 0 && form.quantity > 0 ? R * form.quantity : null;
  const riskBase = riskAmount != null
    ? convertCurrency(riskAmount, form.currency, baseCurrency, eurUsd)
    : null;
  const riskPct = riskBase != null && totalValue > 0
    ? (riskBase / totalValue) * 100
    : null;

  const riskPctSetting = parseFloat(riskPctRaw) || 0;
  const riskBudgetBase = riskPctSetting > 0 && totalValue > 0
    ? (riskPctSetting / 100) * totalValue
    : null;
  const riskBudgetPosCcy = riskBudgetBase != null
    ? convertCurrency(riskBudgetBase, baseCurrency, form.currency, eurUsd)
    : null;
  const suggestedQtyRaw = R > 0 && riskBudgetPosCcy != null ? riskBudgetPosCcy / R : null;
  const suggestedQty = suggestedQtyRaw != null && suggestedQtyRaw > 0
    ? (form.asset_type === 'crypto'
        ? Math.floor(suggestedQtyRaw * 1e6) / 1e6
        : Math.floor(suggestedQtyRaw))
    : null;

  function applySuggestedQty() {
    if (suggestedQty == null || suggestedQty <= 0) return;
    setQtyRaw(String(suggestedQty));
    set('quantity', suggestedQty);
  }

  const positionValueBase = form.quantity > 0 && form.cost_basis > 0
    ? convertCurrency(form.quantity * form.cost_basis, form.currency, baseCurrency, eurUsd)
    : null;
  const positionWeightPct = positionValueBase != null && (totalValue + positionValueBase) > 0
    ? (positionValueBase / (totalValue + positionValueBase)) * 100
    : null;

  const entryWarnings = form.asset_type !== 'fiat' && form.quantity > 0 && form.cost_basis > 0
    ? evaluateEntryChecks({
        hasStop: stopVal > 0,
        riskPct,
        riskBudgetPct: riskPctSetting,
        positionWeightPct,
        macroRegime: macroScore?.regime ?? null,
      })
    : [];

  const decimals = form.asset_type === 'crypto' ? 6 : 2;
  const rPct = R > 0 && form.cost_basis > 0 ? ((R / form.cost_basis) * 100).toFixed(1) : null;
  const t1Label = `TP 1 — 1R${rPct ? ` (+${rPct}%)` : ''}`;
  const t2Label = `TP 2 — 2R${rPct ? ` (+${(parseFloat(rPct) * 2).toFixed(1)}%)` : ''}`;

  const stopSuggestion = form.cost_basis > 0
    ? (form.cost_basis * (form.asset_type === 'crypto' ? 0.85 : 0.92)).toFixed(decimals)
    : (form.asset_type === 'crypto' ? '−15%' : '−8%');

  // Recalculate T1/T2 on every stop change, unless the user has manually edited them.
  // Skip the first run (mount) so saved TP values are preserved when opening edit mode.
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    const stop = parseFloat(stopRaw);
    if (!stop || form.cost_basis <= 0) return;
    const r = form.cost_basis - stop;
    if (r <= 0) return;
    const dec = form.asset_type === 'crypto' ? 6 : 2;
    if (!t1ManualRef.current) {
      const t1 = (form.cost_basis + r).toFixed(dec);
      setTargetRaw(t1);
      set('target_price', parseFloat(t1));
    }
    if (!t2ManualRef.current) {
      const t2 = (form.cost_basis + 2 * r).toFixed(dec);
      setTarget2Raw(t2);
      set('target_price_2', parseFloat(t2));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRaw]);

  function set<K extends keyof PositionInput>(key: K, value: PositionInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleTickerChange(value: string) {
    set('ticker', value);
    if (form.asset_type === 'stock') {
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
    // Écrase le name auto-rempli par une sélection précédente, mais préserve
    // un nom réellement saisi par l'utilisateur (nameManualRef).
    const keepName = nameManualRef.current;
    if (s.kind === 'stock') {
      setForm((prev) => ({
        ...prev,
        ticker: s.data.symbol,
        name: keepName && prev.name ? prev.name : s.data.shortname || '',
        currency: detectCurrency(s.data.symbol),
      }));
    } else {
      // Store CoinGecko ID as ticker — symbolToId will return it directly
      setForm((prev) => ({
        ...prev,
        ticker: s.data.id,
        name: keepName && prev.name ? prev.name : `${s.data.name} (${s.data.symbol.toUpperCase()})`,
        currency: 'USD',
      }));
    }
    setSuggestions([]);
    setShowSuggestions(false);
  }

  // Default currency when switching type (only in add mode)
  useEffect(() => {
    if (editMode) return;
    if (form.asset_type === 'crypto') set('currency', 'USD');
    else if (form.asset_type === 'fiat') set('currency', form.ticker || 'EUR');
    else set('currency', 'EUR');
    setSuggestions([]);
    setShowSuggestions(false);
  }, [form.asset_type]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Sector auto-suggestion (add mode only) — convenience only: the holdings
  // lists are short (top 5-6 per sector), so most tickers won't match and
  // manual selection stays the primary path.
  useEffect(() => {
    if (editMode || sectorManualRef.current || form.asset_type !== 'stock') return;
    const tickerUpper = form.ticker.trim().toUpperCase();
    if (!tickerUpper) return;
    const match = SECTORS.find((s) => s.holdings.some((h) => h.ticker.toUpperCase() === tickerUpper));
    if (match) set('sector_id', match.id);
  }, [form.ticker, form.asset_type, editMode]);

  useEffect(() => {
    getSetting(RISK_PCT_SETTING).then((v) => setRiskPctRaw(v ?? DEFAULT_RISK_PCT));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ticker.trim()) return setError('Ticker is required');
    if (form.asset_type !== 'fiat' && form.quantity <= 0) return setError('Quantity must be > 0');
    if (form.cost_basis < 0) return setError('Cost basis must be ≥ 0');
    setSaving(true);
    setError(null);
    try {
      let ticker: string;
      if (form.asset_type === 'fiat') ticker = form.ticker.trim().toUpperCase();
      else if (form.asset_type === 'stock') ticker = form.ticker.trim().toUpperCase();
      else ticker = form.ticker.trim().toLowerCase();
      const stop_price = parseFloat(stopRaw) || null;
      const target_price = parseFloat(targetRaw) || null;
      const target_price_2 = parseFloat(target2Raw) || null;
      await onSubmit({ ...form, ticker, stop_price, target_price, target_price_2 });
      setForm(EMPTY);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span>{editMode ? 'Edit position' : 'Add position'}</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.row}>
            <label className={styles.label}>Type</label>
            <div className={styles.toggle}>
              {(['stock', 'crypto', 'fiat'] as AssetType[]).map((t) => (
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
              {form.asset_type === 'crypto' ? 'Coin' : form.asset_type === 'fiat' ? 'Currency' : 'Ticker'}
            </label>
            {form.asset_type === 'fiat' ? (
              <select
                id="ticker"
                className={styles.input}
                value={form.ticker}
                onChange={(e) => {
                  set('ticker', e.target.value);
                  set('currency', e.target.value);
                  set('name', e.target.value);
                  set('cost_basis', 1);
                }}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
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
            )}
          </div>

          <div className={styles.row}>
            <label className={styles.label} htmlFor="name">Name (optional)</label>
            <input
              id="name"
              className={styles.input}
              value={form.name}
              onChange={(e) => {
                // champ vidé = retour au remplissage auto à la prochaine sélection
                nameManualRef.current = e.target.value !== '';
                set('name', e.target.value);
              }}
              placeholder="Apple Inc."
            />
          </div>

          {form.asset_type === 'stock' && (
            <div className={styles.row}>
              <label className={styles.label} htmlFor="sector">Secteur (optionnel)</label>
              <select
                id="sector"
                className={styles.input}
                value={form.sector_id ?? ''}
                onChange={(e) => {
                  sectorManualRef.current = true;
                  set('sector_id', e.target.value || null);
                }}
              >
                <option value="">—</option>
                {SECTORS.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.twoCol}>
            <div className={styles.row}>
              <label className={styles.label} htmlFor="qty">
                {form.asset_type === 'fiat' ? 'Balance' : 'Quantity'}
              </label>
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
                placeholder={form.asset_type === 'crypto' ? '0.005' : form.asset_type === 'fiat' ? '1000' : '10'}
              />
            </div>

            {form.asset_type !== 'fiat' && (
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
            )}
          </div>

          {form.asset_type !== 'fiat' && (
            <div className={styles.row}>
              <label className={styles.label} htmlFor="cost">
                Prix de revient (par unité, {form.currency})
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
          )}

          {form.asset_type !== 'fiat' && (
            <>
              <div className={styles.riskToggle} onClick={() => setRiskOpen((v) => !v)}>
                <span className={styles.riskChevron}>{riskOpen ? '▼' : '▶'}</span>
                Risk management
              </div>
              {riskOpen && (
                <div className={styles.riskBody}>
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Risque max (% du portefeuille) — <span className={styles.riskPctValue}>{riskPctRaw}%</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={0.1}
                      className={styles.slider}
                      value={riskPctRaw}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRiskPctRaw(v);
                        void setSetting(RISK_PCT_SETTING, v);
                      }}
                    />
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>Stop loss ({form.currency})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={styles.input}
                      value={stopRaw}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^[0-9]*\.?[0-9]*$/.test(v)) {
                          setStopRaw(v);
                          set('stop_price', parseFloat(v) || null);
                        }
                      }}
                      placeholder={stopSuggestion}
                    />
                  </div>
                  {R > 0 && (
                    suggestedQty != null ? (
                      <p className={styles.riskHintRow}>
                        <span>
                          Budget {riskBudgetPosCcy!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {form.currency}
                          {' '}→ quantité suggérée : <strong>{suggestedQty}</strong>
                        </span>
                        <button type="button" className={styles.applyBtn} onClick={applySuggestedQty}>
                          Appliquer
                        </button>
                      </p>
                    ) : riskPctSetting <= 0 ? (
                      <p className={styles.riskHint}>
                        Règle un risque {'>'} 0 % pour calculer une quantité suggérée.
                      </p>
                    ) : (
                      <p className={styles.riskHint}>
                        Renseigne le prix de revient et le nombre de titres du portefeuille pour calculer une quantité suggérée.
                      </p>
                    )
                  )}
                  {R <= 0 && (
                    <p className={styles.riskHint}>
                      Renseigne un stop loss pour calculer une quantité suggérée à partir du budget de risque.
                    </p>
                  )}
                  {riskBase != null && (
                    <p className={styles.riskHint}>
                      Risque :{' '}
                      <span>
                        {riskBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency}
                      </span>
                      {riskPct != null && <> ({riskPct.toFixed(1)}% du portefeuille)</>}
                    </p>
                  )}
                  <div className={styles.row}>
                    <label className={styles.label}>{t1Label} ({form.currency})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={styles.input}
                      value={targetRaw}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^[0-9]*\.?[0-9]*$/.test(v)) {
                          t1ManualRef.current = true;
                          setTargetRaw(v);
                          set('target_price', parseFloat(v) || null);
                        }
                      }}
                      placeholder="—"
                    />
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>{t2Label} ({form.currency})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={styles.input}
                      value={target2Raw}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^[0-9]*\.?[0-9]*$/.test(v)) {
                          t2ManualRef.current = true;
                          setTarget2Raw(v);
                          set('target_price_2', parseFloat(v) || null);
                        }
                      }}
                      placeholder="—"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <div className={styles.row}>
            <label className={styles.label} htmlFor="note">Note / contexte (optionnel)</label>
            <textarea
              id="note"
              className={styles.input}
              rows={2}
              value={form.note ?? ''}
              onChange={(e) => set('note', e.target.value || null)}
              placeholder="Ex : ligne héritée, conservation long terme, hors gestion active"
            />
          </div>

          {entryWarnings.length > 0 && (
            <ul className={styles.warnings}>
              {entryWarnings.map((w) => (
                <li key={w.id} className={styles.warningItem}>⚠ {w.message}</li>
              ))}
            </ul>
          )}

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
