import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAlertEvents,
  fetchAlertRules,
  acknowledgeAlertEvent,
  acknowledgeAllAlertEvents,
  deleteAlertRule,
  toggleAlertRule,
  snoozeAlertRule,
} from '../../lib/db';
import { AlertForm } from './AlertForm';
import type { AlertRule } from '../../types';
import styles from './AlertPanel.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  rsi_overbought:          { label: 'RSI OB',   color: '#f85149' },
  rsi_oversold:            { label: 'RSI OS',   color: '#3fb950' },
  macro_regime_change:     { label: 'Régime',   color: '#d29922' },
  price_target:            { label: 'Cible',    color: '#58a6ff' },
  stop_loss:               { label: 'Stop',     color: '#f85149' },
  price_below_ma200:       { label: 'MA200',    color: '#f85149' },
  ema_cross:               { label: 'EMA ✕',   color: '#a78bfa' },
  sector_score_threshold:  { label: 'Score',    color: '#f59e0b' },
  signal_change:           { label: 'Signal',   color: '#39c5cf' },
};

function ruleThresholdLabel(rule: AlertRule): string | null {
  if (rule.type === 'rsi_overbought') return `> ${rule.threshold}`;
  if (rule.type === 'rsi_oversold')   return `< ${rule.threshold}`;
  if (rule.type === 'price_target')   return `${rule.direction === 'below' ? '≤' : '≥'} ${rule.threshold}`;
  if (rule.type === 'stop_loss')      return `≤ ${rule.threshold}`;
  if (rule.type === 'sector_score_threshold') return `≥ ${rule.threshold}`;
  if (rule.type === 'ema_cross') {
    const dir = rule.threshold;
    if (dir === 'golden') return 'Golden Cross';
    if (dir === 'death')  return 'Death Cross';
    return 'Golden + Death';
  }
  if (rule.type === 'price_below_ma200') return 'Prix < MA200';
  if (rule.type === 'signal_change') return 'au changement';
  return null;
}

function formatSnoozeUntil(ts: number): string {
  const d = new Date(ts * 1000);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  const sameDay = d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
  return sameDay ? `→ ${time}` : `→ ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${time}`;
}

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 2) return 'hier';
  return `il y a ${Math.floor(diff / 86400)}j`;
}

export function AlertPanel({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  // Suppression en deux clics : premier clic arme le bouton 3s, second supprime.
  const [armedDeleteId, setArmedDeleteId] = useState<number | null>(null);
  const disarmRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const HISTORY_PREVIEW = 3;

  const { data: events = [] } = useQuery({
    queryKey: ['alert-events'],
    queryFn: () => fetchAlertEvents(100),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: open,
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: fetchAlertRules,
    staleTime: 60_000,
    enabled: open,
  });

  const unacknowledged = events.filter(e => !e.acknowledged);
  const acked = events.filter(e => e.acknowledged);
  const userRules = rules.filter(r => !r.is_system);
  const systemRules = rules.filter(r => r.is_system);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['alert-events'] });
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
    queryClient.invalidateQueries({ queryKey: ['alert-unack-count'] });
  }

  async function handleAck(id: number) {
    await acknowledgeAlertEvent(id);
    invalidate();
  }

  async function handleAckAll() {
    await acknowledgeAllAlertEvents();
    invalidate();
  }

  async function handleDelete(rule: AlertRule) {
    if (armedDeleteId !== rule.id) {
      setArmedDeleteId(rule.id);
      if (disarmRef.current) clearTimeout(disarmRef.current);
      disarmRef.current = setTimeout(() => setArmedDeleteId(null), 3000);
      return;
    }
    if (disarmRef.current) clearTimeout(disarmRef.current);
    setArmedDeleteId(null);
    await deleteAlertRule(rule.id);
    invalidate();
  }

  async function handleToggle(rule: AlertRule) {
    await toggleAlertRule(rule.id, !rule.is_active);
    invalidate();
  }

  async function handleSnooze(rule: AlertRule, isSnoozed: boolean) {
    // Toggle : re-snooze 24h ou annulation immédiate (until = maintenant)
    await snoozeAlertRule(rule.id, isSnoozed ? 0 : 24);
    invalidate();
  }

  // deletable=false pour les règles système : leur cycle de vie appartient à la
  // position (une suppression serait recréée au prochain save de la position).
  function ruleRow(rule: AlertRule, deletable: boolean) {
    const badge = TYPE_BADGE[rule.type] ?? { label: '?', color: '#6e7681' };
    const isSnoozed = rule.snoozed_until != null && rule.snoozed_until > Math.floor(Date.now() / 1000);
    return (
      <div key={rule.id} className={`${styles.ruleRow} ${!rule.is_active ? styles.ruleInactive : ''}`}>
        <span
          className={styles.typeBadge}
          style={{ background: badge.color + '22', color: badge.color, borderColor: badge.color + '44' }}
        >
          {badge.label}
        </span>
        <div className={styles.ruleInfo}>
          <span className={styles.ruleLabel}>{rule.label}</span>
          {ruleThresholdLabel(rule) && (
            <span className={styles.ruleThreshold}>{ruleThresholdLabel(rule)}</span>
          )}
          {isSnoozed && (
            <span className={styles.snoozed}>snoozé {formatSnoozeUntil(rule.snoozed_until!)}</span>
          )}
        </div>
        <div className={styles.ruleActions}>
          <button
            className={`${styles.iconBtn} ${rule.is_active ? styles.iconBtnActive : ''}`}
            onClick={() => handleToggle(rule)}
            data-tooltip={rule.is_active ? 'Désactiver' : deletable ? 'Activer' : 'Ré-armer'}
          >
            {rule.is_active ? '●' : '○'}
          </button>
          <button
            className={`${styles.iconBtn} ${isSnoozed ? styles.iconBtnActive : ''}`}
            onClick={() => handleSnooze(rule, isSnoozed)}
            data-tooltip={isSnoozed ? 'Annuler le snooze' : 'Snooze 24h'}
          >
            ⏸
          </button>
          {deletable && (
            <button
              className={`${styles.iconBtn} ${styles.iconBtnDanger} ${armedDeleteId === rule.id ? styles.iconBtnArmed : ''}`}
              onClick={() => handleDelete(rule)}
              data-tooltip={armedDeleteId === rule.id ? 'Confirmer la suppression' : 'Supprimer'}
            >
              {armedDeleteId === rule.id ? 'sûr ?' : '✕'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Alertes</span>
          <div className={styles.headerActions}>
            {unacknowledged.length > 0 && (
              <button className={styles.ackAllBtn} onClick={handleAckAll}>
                Tout acquitter
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        <div className={styles.body}>
          {/* Events section */}
          {unacknowledged.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                Événements <span className={styles.count}>{unacknowledged.length}</span>
              </div>
              {unacknowledged.map(event => (
                  <div key={event.id} className={styles.eventRow}>
                    <div className={styles.eventContent}>
                      <span className={styles.eventTime}>{relativeTime(event.triggered_at)}</span>
                      <span className={styles.eventMsg}>{event.message}</span>
                    </div>
                    <button className={styles.ackBtn} onClick={() => handleAck(event.id)}>✓</button>
                  </div>
              ))}
            </section>
          )}

          {acked.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                Historique récent
                {acked.length > HISTORY_PREVIEW && (
                  <button
                    className={styles.linkBtn}
                    onClick={() => setShowAllHistory(v => !v)}
                  >
                    {showAllHistory ? 'Réduire' : `Voir tout (${acked.length})`}
                  </button>
                )}
              </div>
              <div className={showAllHistory ? styles.historyList : styles.section}>
                {(showAllHistory ? acked : acked.slice(0, HISTORY_PREVIEW)).map(event => (
                  <div key={event.id} className={`${styles.eventRow} ${styles.eventAcked}`}>
                    <div className={styles.eventContent}>
                      <span className={styles.eventTime}>{relativeTime(event.triggered_at)}</span>
                      <span className={styles.eventMsg}>{event.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {events.length === 0 && (
            <div className={styles.empty}>Aucune alerte déclenchée</div>
          )}

          {/* Rules section */}
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              Mes règles
              <button className={styles.addBtn} onClick={() => setShowForm(true)}>+ Nouvelle</button>
            </div>

            {userRules.length === 0 && (
              <div className={styles.empty}>Aucune règle configurée</div>
            )}

            {userRules.map(rule => ruleRow(rule, true))}
          </section>

          {/* System rules (stop/TP des positions) */}
          {systemRules.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionTitle}>Alertes de positions</div>
              <p className={styles.sectionHint}>
                Générées par les stops/objectifs de tes positions. One-shot : elles se
                désactivent après déclenchement — ré-arme avec ●/○.
              </p>
              {systemRules.map(rule => ruleRow(rule, false))}
            </section>
          )}
        </div>
      </div>

      {showForm && <AlertForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
