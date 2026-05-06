import { useState, useEffect } from 'react';
import type { Position } from '../../types';
import { usePortfolioStore } from '../../store/portfolio';
import { useSwapRate } from '../../hooks/useSwapRate';
import styles from './TransactionForm.module.css';

interface Props {
  position: Position;
  onClose: () => void;
}

type TxType = 'buy' | 'sell' | 'swap';

function toLocalDatetime(ts: number): string {
  const d = new Date(ts * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fromLocalDatetime(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000);
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { maximumSignificantDigits: 8 });
}

export function TransactionForm({ position, onClose }: Props) {
  const addTransaction = usePortfolioStore((s) => s.addTransaction);
  const addSwap = usePortfolioStore((s) => s.addSwap);
  const positions = usePortfolioStore((s) => s.positions);
  const prices = usePortfolioStore((s) => s.prices);

  const [type, setType] = useState<TxType>('buy');
  const [qtyRaw, setQtyRaw] = useState('');
  const [priceRaw, setPriceRaw] = useState('');
  const [feeRaw, setFeeRaw] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(toLocalDatetime(Math.floor(Date.now() / 1000)));

  // Swap fields
  const [otherId, setOtherId] = useState<number | ''>('');
  // 'out' = current sends → other receives | 'in' = other sends → current receives
  const [swapDir, setSwapDir] = useState<'out' | 'in'>('out');
  const [swapRateRaw, setSwapRateRaw] = useState('');
  // true = user typed in the field manually, stop auto-filling
  const [rateManuallyEdited, setRateManuallyEdited] = useState(false);

  const [priceFetched, setPriceFetched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherPosition = positions.find((p) => p.id === otherId);
  const isSwap = type === 'swap' && position.asset_type === 'crypto';

  const canFetchRate = isSwap && !!otherPosition
    && position.asset_type === 'crypto'
    && otherPosition.asset_type === 'crypto';

  // Rate is always position/other (e.g. ANKR/BTC), regardless of direction
  const swapRateQuery = useSwapRate(
    position.ticker,
    otherPosition?.ticker ?? '',
    canFetchRate
  );

  // Pre-fill buy/sell price
  useEffect(() => {
    if (isSwap || priceFetched) return;
    const p = prices[position.ticker];
    if (p != null) {
      setPriceRaw(p.toFixed(6).replace(/\.?0+$/, ''));
      setPriceFetched(true);
    }
  }, [prices, position.ticker, isSwap]);

  // Pre-fill swap rate from CoinGecko — only if user hasn't manually edited the field
  useEffect(() => {
    if (!rateManuallyEdited && swapRateQuery.data != null) {
      setSwapRateRaw(swapRateQuery.data.toFixed(8).replace(/\.?0+$/, ''));
    }
  }, [swapRateQuery.data, rateManuallyEdited]);

  // Reset rate only when the other asset changes (rate is direction-invariant)
  useEffect(() => {
    setRateManuallyEdited(false);
    setSwapRateRaw('');
    setQtyRaw('');
  }, [otherId]);

  // Only reset qty when direction flips, keep the rate
  useEffect(() => {
    setQtyRaw('');
  }, [swapDir]);

  const swapTargets = positions.filter(
    (p) => p.id !== position.id && p.asset_type === 'crypto'
  );

  const qty = parseFloat(qtyRaw) || 0;
  const price = parseFloat(priceRaw) || 0;
  // displayRate = position/other (e.g. ANKR/BTC): how much "other" per 1 "position"
  const displayRate = parseFloat(swapRateRaw) || 0;

  // qty always refers to the current position's asset (ANKR)
  // 'out': send qty ANKR → receive qty*rate BTC
  // 'in':  receive qty ANKR ← send qty*rate BTC
  const qtyPosition = qty;
  const qtyOther = qty * displayRate;

  const positionPriceUSD = prices[position.ticker] ?? 0;

  // Cost basis of the asset received in the swap
  // 'out': receive BTC → PRU = value given up / qty received = positionPrice / displayRate = otherPrice
  // 'in':  receive ANKR → PRU = value given up / qty received = otherPrice * displayRate = positionPrice
  const targetPrice = swapDir === 'out'
    ? (displayRate > 0 ? positionPriceUSD / displayRate : 0)
    : positionPriceUSD;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (qty <= 0) return setError('La quantité doit être > 0');
    const ts = fromLocalDatetime(date);

    try {
      setSaving(true);
      if (type === 'buy' || type === 'sell') {
        if (price <= 0) return setError('Le prix doit être > 0');
        await addTransaction({
          position_id: position.id,
          ticker: position.ticker,
          type,
          quantity: qty,
          price,
          currency: position.currency,
          fee: parseFloat(feeRaw) || 0,
          note,
          created_at: ts,
        });
      } else {
        if (!otherPosition) return setError('Sélectionne une position');
        if (displayRate <= 0) return setError('Le taux de swap doit être > 0');

        // 'out': position sends qtyPosition, other receives qtyOther
        // 'in':  other sends qtyOther, position receives qtyPosition
        const swapOutPos = swapDir === 'out' ? position : otherPosition;
        const swapInPos  = swapDir === 'out' ? otherPosition : position;
        const swapOutQty = swapDir === 'out' ? qtyPosition : qtyOther;
        const swapInQty  = swapDir === 'out' ? qtyOther : qtyPosition;
        const swapInPrice = targetPrice;
        const swapInCurrency = swapDir === 'out' ? otherPosition.currency : position.currency;

        await addSwap(
          {
            position_id: swapOutPos.id,
            ticker: swapOutPos.ticker,
            type: 'swap_out',
            quantity: swapOutQty,
            price: displayRate,
            currency: swapInPos.ticker,
            fee: parseFloat(feeRaw) || 0,
            note,
            created_at: ts,
          },
          {
            position_id: swapInPos.id,
            ticker: swapInPos.ticker,
            type: 'swap_in',
            quantity: swapInQty,
            price: swapInPrice,
            currency: swapInCurrency,
            note,
            created_at: ts,
          }
        );
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span>Ajouter une transaction — {position.ticker.toUpperCase()}</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          {/* Type toggle */}
          <div className={styles.row}>
            <label className={styles.label}>Type</label>
            <div className={styles.toggle}>
              {(['buy', 'sell', ...(position.asset_type === 'crypto' ? ['swap'] : [])] as TxType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.toggleBtn} ${type === t ? styles.active : ''} ${styles[`toggle_${t}`]}`}
                  onClick={() => setType(t)}
                >
                  {t === 'buy' ? 'Achat' : t === 'sell' ? 'Vente' : 'Swap'}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div className={styles.row}>
            <label className={styles.label}>Date</label>
            <input
              type="datetime-local"
              className={styles.input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Buy / Sell */}
          {!isSwap && (
            <>
              <div className={styles.row}>
                <label className={styles.label}>Quantité {position.ticker.toUpperCase()}</label>
                <input
                  type="text" inputMode="decimal" className={styles.input}
                  value={qtyRaw}
                  onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setQtyRaw(e.target.value); }}
                  placeholder="0.05" autoFocus
                />
              </div>
              <div className={styles.row}>
                <label className={styles.label}>
                  Prix unitaire ({position.currency})
                  {priceFetched && <span className={styles.fetched}> live</span>}
                </label>
                <input
                  type="text" inputMode="decimal" className={styles.input}
                  value={priceRaw}
                  onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setPriceRaw(e.target.value); }}
                  placeholder="150.00"
                />
              </div>
            </>
          )}

          {/* Swap */}
          {isSwap && (
            <>
              {/* Direction + asset select */}
              <div className={styles.row}>
                <label className={styles.label}>Direction</label>
                <div className={styles.dirRow}>
                  <span className={`${styles.dirAsset} ${swapDir === 'out' ? styles.dirSend : styles.dirMuted}`}>
                    {position.ticker.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    className={styles.dirFlipBtn}
                    onClick={() => setSwapDir((d) => d === 'out' ? 'in' : 'out')}
                    title="Inverser"
                  >⇄</button>
                  <span className={`${styles.dirAsset} ${swapDir === 'in' ? styles.dirSend : styles.dirMuted}`}>
                    {position.ticker.toUpperCase()}
                  </span>
                  <select
                    className={`${styles.input} ${styles.dirSelect}`}
                    value={otherId}
                    onChange={(e) => setOtherId(Number(e.target.value) || '')}
                  >
                    <option value="">— autre crypto —</option>
                    {swapTargets.map((p) => (
                      <option key={p.id} value={p.id}>{p.ticker.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                {otherPosition && (
                  <p className={styles.dirHint}>
                    {swapDir === 'out'
                      ? `Vous envoyez ${position.ticker.toUpperCase()}, vous recevez ${otherPosition.ticker.toUpperCase()}`
                      : `Vous envoyez ${otherPosition.ticker.toUpperCase()}, vous recevez ${position.ticker.toUpperCase()}`}
                  </p>
                )}
              </div>

              {otherPosition && (
                <>
                  {/* Qty — label adapts to direction */}
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Quantité {position.ticker.toUpperCase()} à {swapDir === 'out' ? 'envoyer' : 'recevoir'}
                    </label>
                    <input
                      type="text" inputMode="decimal" className={styles.input}
                      value={qtyRaw}
                      onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setQtyRaw(e.target.value); }}
                      placeholder={swapDir === 'in' ? '25000' : '0.001'}
                      autoFocus
                    />
                  </div>

                  {/* Rate */}
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Taux ({position.ticker.toUpperCase()}/{otherPosition?.ticker.toUpperCase()})
                      {swapRateQuery.isFetching && <span className={styles.fetching}> récup…</span>}
                      {!rateManuallyEdited && swapRateQuery.data != null && <span className={styles.fetched}> CoinGecko</span>}
                    </label>
                    <input
                      type="text" inputMode="decimal" className={styles.input}
                      value={swapRateRaw}
                      onChange={(e) => {
                        if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) {
                          setSwapRateRaw(e.target.value);
                          setRateManuallyEdited(true);
                        }
                      }}
                      placeholder="0.0003"
                    />
                  </div>

                  {/* Summary */}
                  {qty > 0 && displayRate > 0 && (
                    <div className={styles.swapSummary}>
                      <span>{fmt(swapDir === 'out' ? qtyPosition : qtyOther)} {(swapDir === 'out' ? position : otherPosition)?.ticker.toUpperCase()}</span>
                      <span className={styles.arrow}>→</span>
                      <span className={styles.qtyIn}>{fmt(swapDir === 'out' ? qtyOther : qtyPosition)} {(swapDir === 'out' ? otherPosition : position)?.ticker.toUpperCase()}</span>
                      {targetPrice > 0 && (
                        <span className={styles.targetPriceInfo}>
                          PRU {targetPrice.toLocaleString('en-US', { maximumSignificantDigits: 6 })} {swapDir === 'out' ? otherPosition?.currency : position.currency}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className={styles.twoCol}>
            <div className={styles.row}>
              <label className={styles.label}>Frais ({position.currency})</label>
              <input
                type="text" inputMode="decimal" className={styles.input}
                value={feeRaw}
                onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setFeeRaw(e.target.value); }}
                placeholder="0"
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Note</label>
              <input
                type="text" className={styles.input}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="optionnel"
              />
            </div>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Annuler</button>
            <button type="submit" className={styles.submitBtn} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Confirmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
