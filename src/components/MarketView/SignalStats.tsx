import { useQuery } from '@tanstack/react-query';
import { fetchSignalLogs } from '../../lib/db';
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

export function SignalStats() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['signal-logs', 'sector'],
    queryFn: () => fetchSignalLogs('sector'),
    staleTime: 60_000,
  });

  const stats = computeSignalStats(rows);
  const totalLogged = stats.reduce((s, x) => s + x.total, 0);

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <p className={styles.introText}>
          Performance relative vs SPY après chaque signal secteur, mesurée à J+5 / J+10 / J+20.
          Le <strong>win%</strong> mesure la fiabilité (J+10). Pour <em>exhaustion</em> — un signal
          d'évitement — la réussite = <strong>sous-performance</strong> ensuite.
        </p>
      </div>

      {isLoading && totalLogged === 0 ? (
        <div className={styles.empty}>Chargement…</div>
      ) : totalLogged === 0 ? (
        <div className={styles.empty}>
          Aucun signal enregistré pour l'instant.<br />
          Les statistiques se remplissent au fil des jours où un secteur émet un signal
          (dip, reversal, accelerating, exhaustion), puis se calibrent après ~20 jours de bourse.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Signal</th>
                <th>n</th>
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
