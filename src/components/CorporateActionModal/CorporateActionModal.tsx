import { useState } from 'react';
import type { PendingCorporateAction, Position, Transaction, TransactionInput } from '../../types';
import { computePRU } from '../../lib/pru';
import styles from './CorporateActionModal.module.css';

interface Props {
  action: PendingCorporateAction;
  position: Position;
  transactions: Transaction[];
  onConfirm: (input: TransactionInput) => Promise<void>;
  onDismiss: () => Promise<void>;
  onClose: () => void;
}

function fmt(n: number, decimals = 4): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

export function CorporateActionModal({ action, position, transactions, onConfirm, onDismiss, onClose }: Props) {
  const current = computePRU(transactions, position.quantity, position.cost_basis);

  // A Yahoo "split" with a small ratio (e.g. 1.1 = Air Liquide 1-for-10 loyalty)
  // is usually a free-share attribution, not a genuine stock split. Default
  // accordingly; the user can override.
  const defaultSplitKind: 'split' | 'bonus' = action.value > 1 && action.value <= 1.25 ? 'bonus' : 'split';

  const [valueRaw, setValueRaw] = useState(String(action.value));
  const [sharesRaw, setSharesRaw] = useState(String(action.sharesAtDate));
  const [splitKind, setSplitKind] = useState<'split' | 'bonus'>(defaultSplitKind);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);

  const value = parseFloat(valueRaw) || 0;
  const shares = parseFloat(sharesRaw) || 0;

  const afterQty = action.type === 'split' ? current.quantity * value : current.quantity;
  const afterPru = action.type === 'split' && value > 0 ? current.costBasis / value : current.costBasis;
  const bonusShares = action.type === 'split' ? current.quantity * (value - 1) : 0;
  const totalDividend = action.type === 'dividend' ? shares * value : 0;

  const dateStr = new Date(action.date * 1000).toLocaleDateString('fr-FR');
  const title = action.type === 'dividend'
    ? `Dividende détecté — ${action.ticker}`
    : splitKind === 'bonus'
      ? `Action gratuite détectée — ${action.ticker}`
      : `Split détecté — ${action.ticker}`;

  async function handleConfirm() {
    if (value <= 0) { setError('La valeur doit être > 0'); return; }
    setSaving(true);
    setError(null);
    try {
      if (action.type === 'split' && splitKind === 'bonus') {
        // Store as a free-share attribution: qty added at ex-date, price 0.
        // sharesAtDate × (ratio − 1) is mathematically equivalent to the split.
        await onConfirm({
          position_id: action.positionId,
          ticker: action.ticker,
          type: 'bonus_share',
          quantity: action.sharesAtDate * (value - 1),
          price: 0,
          currency: position.currency,
          created_at: action.date,
        });
      } else {
        await onConfirm({
          position_id: action.positionId,
          ticker: action.ticker,
          type: action.type,
          quantity: action.type === 'split' ? 0 : shares,
          price: value,
          currency: position.currency,
          created_at: action.date,
        });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDismissConfirmed() {
    setSaving(true);
    try { await onDismiss(); } finally { setSaving(false); }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span>{title}</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.source}>Source Yahoo Finance · ex-date {dateStr}</div>

          {action.type === 'split' && (
            <>
              <div className={styles.row}>
                <label className={styles.label}>Nature de l'événement</label>
                <div className={styles.kindToggle}>
                  <button
                    type="button"
                    className={`${styles.kindBtn} ${splitKind === 'split' ? styles.kindActive : ''}`}
                    onClick={() => setSplitKind('split')}
                  >
                    Split d'actions
                  </button>
                  <button
                    type="button"
                    className={`${styles.kindBtn} ${splitKind === 'bonus' ? styles.kindActive : ''}`}
                    onClick={() => setSplitKind('bonus')}
                  >
                    Action gratuite
                  </button>
                </div>
              </div>
              <div className={styles.row}>
                <label className={styles.label}>{splitKind === 'bonus' ? 'Ratio (1 + part gratuite)' : 'Ratio détecté'}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={styles.input}
                  value={valueRaw}
                  onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setValueRaw(e.target.value); }}
                />
              </div>
              <div className={styles.preview}>
                {splitKind === 'bonus' && (
                  <div className={styles.previewRow}>
                    <span className={styles.previewLabel}>Reçu</span>
                    <span className={styles.previewAfter}>+{fmt(bonusShares)} actions gratuites</span>
                  </div>
                )}
                <div className={styles.previewRow}>
                  <span className={styles.previewLabel}>Avant</span>
                  <span>{fmt(current.quantity)} actions · PRU {fmt(current.costBasis, 2)} {position.currency}</span>
                </div>
                <div className={styles.previewArrow}>↓</div>
                <div className={styles.previewRow}>
                  <span className={styles.previewLabel}>Après</span>
                  <span className={styles.previewAfter}>
                    {fmt(afterQty)} actions · PRU {fmt(afterPru, 2)} {position.currency}
                  </span>
                </div>
              </div>
            </>
          )}

          {action.type === 'dividend' && (
            <>
              <div className={styles.twoCol}>
                <div className={styles.row}>
                  <label className={styles.label}>Montant / action ({position.currency})</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={styles.input}
                    value={valueRaw}
                    onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setValueRaw(e.target.value); }}
                  />
                </div>
                <div className={styles.row}>
                  <label className={styles.label}>Actions à l'ex-date</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={styles.input}
                    value={sharesRaw}
                    onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setSharesRaw(e.target.value); }}
                  />
                </div>
              </div>
              <div className={styles.preview}>
                <div className={styles.previewRow}>
                  <span className={styles.previewLabel}>Dividende perçu</span>
                  <span className={styles.previewAfter}>{fmt(totalDividend, 2)} {position.currency}</span>
                </div>
              </div>
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {confirmingDismiss ? (
            <div className={styles.dismissConfirm}>
              <p className={styles.dismissWarning}>
                {action.type === 'dividend'
                  ? `En ignorant cet événement, vous reconnaissez ne pas avoir perçu le dividende de ${fmt(totalDividend, 2)} ${position.currency}. Cet événement ne sera plus proposé.`
                  : `En ignorant ce split, il ne sera plus proposé. Vérifiez que votre quantité reflète déjà le ratio ${fmt(value, 4)}.`}
              </p>
              <div className={styles.actions}>
                <button className={styles.dismissBtn} onClick={() => setConfirmingDismiss(false)} disabled={saving}>
                  Retour
                </button>
                <button className={styles.dismissFinalBtn} onClick={handleDismissConfirmed} disabled={saving}>
                  {saving ? 'Enregistrement…' : 'Confirmer l\'ignorance'}
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <button className={styles.dismissBtn} onClick={() => setConfirmingDismiss(true)} disabled={saving}>
                Ignorer
              </button>
              <button className={styles.confirmBtn} onClick={handleConfirm} disabled={saving || value <= 0}>
                {saving ? 'Enregistrement…' : 'Appliquer'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
