import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSignalLogs } from '../../lib/db';
import { useSignalRebuild } from '../../hooks/useSignalRebuild';
import {
  computeSignalStats,
  SIGNAL_META,
  LOW_SAMPLE_THRESHOLD,
  type HorizonStat,
} from '../../lib/signalStats';
import styles from './SignalStats.module.css';

function fmtPerf(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtRate(v: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

function perfClass(v: number | null): string {
  if (v == null) return '';
  return v >= 0 ? styles.pos : styles.neg;
}

function HorizonCell({ stat }: { stat: HorizonStat }) {
  return <span className={perfClass(stat.avgRelPerf)}>{fmtPerf(stat.avgRelPerf)}</span>;
}

type Scope = 'sector' | 'narrative';

export function SignalStats() {
  // Stats jamais mélangées entre scopes : les bornes du score n'étant pas
  // calibrées pour les ETF thématiques, agréger polluerait la seule mesure
  // de fiabilité disponible.
  const [scope, setScope] = useState<Scope>('sector');
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['signal-logs', scope],
    queryFn: () => fetchSignalLogs(scope),
    staleTime: 60_000,
  });

  const stats = computeSignalStats(rows);
  const totalLogged = stats.reduce((s, x) => s + x.total, 0);

  const rebuild = useSignalRebuild();
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const busy = rebuild.progress.phase === 'fetching'
    || rebuild.progress.phase === 'computing'
    || rebuild.progress.phase === 'writing';

  // Jours de releve reellement couverts : rend visible que la statistique
  // repose sur des seances observees, pas sur une duree calendaire.
  const sessionDays = new Set(rows.map((r) => r.date)).size;

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
      <div className={styles.scopeToggle}>
        {([['sector', 'Secteurs'], ['narrative', 'Narratives']] as [Scope, string][]).map(([s, label]) => (
          <button
            key={s}
            className={`${styles.scopeBtn} ${scope === s ? styles.scopeActive : ''}`}
            onClick={() => setScope(s)}
          >
            {label}
          </button>
        ))}
      </div>
        <button
          className={styles.rebuildBtn}
          onClick={() => setConfirmRebuild(true)}
          disabled={busy}
          data-tooltip="Recalculer tout l'historique des signaux depuis les cours de cloture"
        >
          {busy ? rebuild.progress.message : "↻ Reconstruire l'historique"}
        </button>
      </div>

      {busy && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar} style={{ width: `${Math.round(rebuild.progress.ratio * 100)}%` }} />
        </div>
      )}

      {rebuild.progress.phase === 'done' && rebuild.progress.result && (
        <div className={styles.rebuildDone}>
          ✓ {rebuild.progress.result.sessions} séances reconstruites du {rebuild.progress.result.from} au{' '}
          {rebuild.progress.result.to} — {rebuild.progress.result.sectorRows} lignes secteurs,{' '}
          {rebuild.progress.result.narrativeRows} lignes narratives.
          <button className={styles.dismiss} onClick={rebuild.reset}>×</button>
        </div>
      )}

      {rebuild.progress.phase === 'error' && (
        <div className={styles.rebuildError}>
          ⚠ {rebuild.progress.message}
          <button className={styles.dismiss} onClick={rebuild.reset}>×</button>
        </div>
      )}

      {confirmRebuild && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox}>
            <div className={styles.confirmTitle}>Reconstruire l'historique des signaux ?</div>
            <p className={styles.confirmBody}>
              Les {rows.length} lignes actuelles seront <strong>remplacées</strong> par un historique
              recalculé sur deux ans à partir des cours de clôture.
            </p>
            <p className={styles.confirmBody}>
              C'est le but : les lignes existantes mélangent des mesures prises en séance, des dates
              de week-end et des trous. Mais l'opération est irréversible — assure-toi d'avoir une
              sauvegarde récente.
            </p>
            <div className={styles.confirmActions}>
              <button className={styles.cancelBtn} onClick={() => setConfirmRebuild(false)}>Annuler</button>
              <button
                className={styles.dangerBtn}
                onClick={() => { setConfirmRebuild(false); rebuild.run(); }}
              >
                Reconstruire
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.intro}>
        <p className={styles.introText}>
          Performance relative vs SPY après chaque signal {scope === 'sector' ? 'secteur' : 'narrative-ETF'},
          mesurée à J+5 / J+10 / J+20, sur {sessionDays} séances relevées.
          Le <strong>win%</strong> mesure la fiabilité (J+10). Pour <em>exhaustion</em> — un signal
          d'évitement — la réussite = <strong>sous-performance</strong> ensuite.
          {scope === 'narrative' && (
            <> Les bornes du score ont été calibrées sur les secteurs — ces stats mesurent
            précisément si elles tiennent sur les ETF thématiques (plus volatils).</>
          )}
        </p>
      </div>

      {isLoading && totalLogged === 0 ? (
        <div className={styles.empty}>Chargement…</div>
      ) : totalLogged === 0 ? (
        <div className={styles.empty}>
          Aucun signal enregistré pour l'instant.<br />
          Les statistiques se remplissent au fil des jours où {scope === 'sector' ? 'un secteur' : 'une narrative-ETF'} émet
          un signal (dip, reversal, accelerating, exhaustion), puis se calibrent après ~20 jours de bourse.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Signal</th>
                <th data-tooltip="Nombre de detections distinctes. Un signal qui tient plusieurs jours compte une fois : les fenetres de perf se chevaucheraient sinon, et un seul mouvement suffirait a valider un signal.">n</th>
                <th data-tooltip="Score d'opportunité moyen au moment du signal">Score moy.</th>
                <th data-tooltip="% de cas où le signal a « réussi » à J+10">Win% J+10</th>
                <th>relPerf J+5</th>
                <th>relPerf J+10</th>
                <th>relPerf J+20</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(st => {
                const meta = SIGNAL_META[st.signal];
                return (
                  <tr key={st.signal} className={st.total === 0 ? styles.rowEmpty : ''}>
                    <td className={styles.thLeft}>
                      <span
                        className={styles.badge}
                        style={{ background: meta.color + '22', color: meta.color, borderColor: meta.color + '44' }}
                      >
                        {meta.label}
                      </span>
                      {!meta.bullish && (
                        <span className={styles.avoid} data-tooltip="Signal d'évitement : réussite = sous-performance">
                          évitement
                        </span>
                      )}
                    </td>
                    <td>
                      {st.total}
                      {st.total > 0 && st.total < LOW_SAMPLE_THRESHOLD && (
                        <span className={styles.lowSample} data-tooltip="Échantillon faible — à interpréter avec prudence">
                          ⚠
                        </span>
                      )}
                    </td>
                    <td>{st.avgScore ?? '—'}</td>
                    <td className={styles.winCell}>{fmtRate(st.j10.winRate)}</td>
                    <td><HorizonCell stat={st.j5} /></td>
                    <td><HorizonCell stat={st.j10} /></td>
                    <td><HorizonCell stat={st.j20} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
