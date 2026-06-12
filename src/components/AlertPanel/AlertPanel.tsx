import { useState } from 'react';
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
  rsi_overbought:     { label: 'RSI OB',  color: '#f85149' },
  rsi_oversold:       { label: 'RSI OS',  color: '#3fb950' },
  macro_regime_change:{ label: 'Régime',  color: '#d29922' },
  price_target:       { label: 'Cible',   color: '#58a6ff' },
  stop_loss:          { label: 'Stop',    color: '#f85149' },
};

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

  const { data: events = [] } = useQuery({
    queryKey: ['alert-events'],
    queryFn: () => fetchAlertEvents(50),
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
  const userRules = rules.filter(r => !r.is_system);

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
    await deleteAlertRule(rule.id);
    invalidate();
  }

  async function handleToggle(rule: AlertRule) {
    await toggleAlertRule(rule.id, !rule.is_active);
    invalidate();
  }

  async function handleSnooze(rule: AlertRule) {
    await snoozeAlertRule(rule.id, 24);
    invalidate();
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

          {unacknowledged.length === 0 && events.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionTitle}>Historique récent</div>
              {events.slice(0, 10).map(event => (
                <div key={event.id} className={`${styles.eventRow} ${styles.eventAcked}`}>
                  <div className={styles.eventContent}>
                    <span className={styles.eventTime}>{relativeTime(event.triggered_at)}</span>
                    <span className={styles.eventMsg}>{event.message}</span>
                  </div>
                </div>
              ))}
            </section>
          )}

          {events.length === 0 && (
            <div className={styles.empty}>Aucune alerte déclenchée</div>
          )}

          {/* Rules section */}
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              Règles actives
              <button className={styles.addBtn} onClick={() => setShowForm(true)}>+ Nouvelle</button>
            </div>

            {userRules.length === 0 && (
              <div className={styles.empty}>Aucune règle configurée</div>
            )}

            {userRules.map(rule => {
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
                    {rule.threshold && (
                      <span className={styles.ruleThreshold}>
                        {rule.type === 'rsi_overbought' ? '>' : rule.type === 'rsi_oversold' ? '<' : rule.type === 'price_target' ? '≥' : '≤'} {rule.threshold}
                      </span>
                    )}
                    {isSnoozed && <span className={styles.snoozed}>snoozé</span>}
                  </div>
                  <div className={styles.ruleActions}>
                    <button
                      className={`${styles.iconBtn} ${rule.is_active ? styles.iconBtnActive : ''}`}
                      onClick={() => handleToggle(rule)}
                      data-tooltip={rule.is_active ? 'Désactiver' : 'Activer'}
                    >
                      {rule.is_active ? '●' : '○'}
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => handleSnooze(rule)}
                      data-tooltip="Snooze 24h"
                    >
                      ⏸
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={() => handleDelete(rule)}
                      data-tooltip="Supprimer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      </div>

      {showForm && <AlertForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
