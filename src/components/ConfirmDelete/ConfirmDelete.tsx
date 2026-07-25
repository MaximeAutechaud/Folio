import { useState } from 'react';
import type { Position } from '../../types';
import { isDestructive, type DeleteImpact } from '../../lib/deleteImpact';
import styles from './ConfirmDelete.module.css';

interface Props {
  position: Position;
  impact: DeleteImpact;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function fmtQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

/**
 * Confirmation avant suppression d'une position. Annonce ce qui part avec elle
 * plutôt qu'un « êtes-vous sûr ? » : le CASCADE sur les transactions détruit
 * aussi l'historique du journal, ce que rien ne laisse deviner dans l'UI.
 *
 * Pas de fermeture au clic overlay — action destructive et irréversible.
 */
export function ConfirmDelete({ position, impact, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const destructive = isDestructive(impact);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span>Supprimer cette position ?</span>
          {!busy && <button className={styles.closeBtn} onClick={onClose}>×</button>}
        </div>

        <div className={styles.body}>
          <div>
            <div className={styles.subject}>{position.ticker.toUpperCase()}</div>
            {position.name && <div className={styles.subjectName}>{position.name}</div>}
          </div>

          {destructive ? (
            <>
              <div className={styles.losses}>
                {impact.transactions > 0 && (
                  <div className={styles.lossItem}>
                    <span className={styles.lossCount}>{impact.transactions}</span>
                    <span>
                      transaction{impact.transactions > 1 ? 's' : ''} effacée
                      {impact.transactions > 1 ? 's' : ''} — achats, ventes, splits, dividendes
                    </span>
                  </div>
                )}
                {impact.closedTrades > 0 && (
                  <div className={styles.lossItem}>
                    <span className={styles.lossCount}>{impact.closedTrades}</span>
                    <span>
                      trade{impact.closedTrades > 1 ? 's' : ''} clôturé
                      {impact.closedTrades > 1 ? 's' : ''} retiré
                      {impact.closedTrades > 1 ? 's' : ''} du journal — win rate, R moyen et
                      statistiques par setup s'en trouveront modifiés
                    </span>
                  </div>
                )}
              </div>
              <p className={styles.hint}>
                Ces données ne sont pas récupérables. Si tu veux seulement sortir cette ligne du
                portefeuille, sache qu'une position soldée reste consultable dans « Positions
                clôturées » sans peser sur les totaux.
              </p>
            </>
          ) : (
            <p className={styles.hint}>
              Aucune transaction n'est rattachée à cette position : rien d'autre ne sera perdu.
            </p>
          )}

          {impact.stillOpen && (
            <div className={styles.warning}>
              ⚠ Cette position détient encore {fmtQty(impact.quantity)} unité
              {impact.quantity > 1 ? 's' : ''}. La supprimer ne comptabilise aucune vente : elle
              disparaît simplement du portefeuille.
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>

        {!busy && (
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={onClose}>Annuler</button>
            <button className={styles.dangerBtn} onClick={handleConfirm}>
              Supprimer définitivement
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
