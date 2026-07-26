import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSignalLogs } from '../../lib/db';
import { useSignalRebuild } from '../../hooks/useSignalRebuild';
import { SignalSlices } from './SignalSlices';
import {
  computeSignalStats,
  SIGNAL_META,
  LOW_SAMPLE_THRESHOLD,
  MIN_EPISODES,
  orient,
  type SignalKind,
  type HorizonStat,
  type ExcursionStat,
} from '../../lib/signalStats';
import styles from './SignalStats.module.css';

function fmtPerf(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtRatio(v: number | null): string {
  if (v == null) return '—';
  return `×${v.toFixed(2)}`;
}

function fmtRate(v: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

/**
 * Colorisation **selon le sens du signal**, et non selon le signe brut.
 *
 * `exhaustion` est un signal d'évitement : une performance relative de +0,1 %
 * ensuite est un échec de détection. L'afficher en vert parce qu'elle est
 * positive contredisait la définition posée juste au-dessus du tableau, et
 * inversait la lecture de la seule ligne où l'erreur est facile à faire.
 */
function perfClass(signal: SignalKind, v: number | null): string {
  if (v == null) return '';
  return orient(signal, v) >= 0 ? styles.pos : styles.neg;
}

function HorizonCell({ signal, stat }: { signal: SignalKind; stat: HorizonStat }) {
  return (
    <span
      className={perfClass(signal, stat.avgRelPerf)}
      data-tooltip={
        stat.n === 0 ? 'Aucune mesure disponible'
          : `médiane ${fmtPerf(stat.medianRelPerf)} · n=${stat.n}`
      }
    >
      {fmtPerf(stat.avgRelPerf)}
    </span>
  );
}

/** Espérance orientée : positive = favorable à ce que le signal annonçait. */
function ExpectancyCell({ stat }: { stat: HorizonStat }) {
  if (stat.expectancy == null) return <span>—</span>;
  return (
    <span
      className={stat.expectancy >= 0 ? styles.pos : styles.neg}
      data-tooltip={
        `gain moyen ${fmtPerf(stat.avgWin)} · perte moyenne ${fmtPerf(stat.avgLoss)}`
        + ` · ratio ${fmtRatio(stat.winLossRatio)}`
      }
    >
      {fmtPerf(stat.expectancy)}
    </span>
  );
}

/**
 * Asymétrie du parcours. C'est la mesure qui dit si une sortie asymétrique
 * (stop court, laisser courir les gagnants) a quelque chose à récolter : un
 * ratio proche de 1 signifie que le parcours est symétrique, donc qu'aucune
 * règle de sortie ne créera d'espérance là où la moyenne est nulle.
 */
function ExcursionCell({ stat }: { stat: ExcursionStat }) {
  if (stat.ratio == null) return <span>—</span>;
  return (
    <span
      className={stat.ratio >= 1 ? styles.pos : styles.neg}
      data-tooltip={
        `excursion favorable ${fmtPerf(stat.avgFavorable)}`
        + ` · adverse ${fmtPerf(stat.avgAdverse)} · n=${stat.n}`
      }
    >
      {fmtRatio(stat.ratio)}
    </span>
  );
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
              recalculé depuis 2010 à partir des cours de clôture ajustés.
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
          Performance relative <strong>vs RSP</strong> après chaque signal{' '}
          {scope === 'sector' ? 'secteur' : 'narrative-ETF'}, sur {sessionDays} séances relevées.
          Entrée à l'<strong>ouverture de J+1</strong> (le signal n'est connu qu'à la clôture de J),
          sortie en clôture. La colonne qui décide est l'<strong>espérance</strong>, pas le win% :
          40 % de gagnants à +5 % battent 60 % de gagnants à +0,5 % contre −1 %.
          Pour <em>exhaustion</em> — un signal d'évitement — la réussite ={' '}
          <strong>sous-performance</strong> ensuite, et tous les chiffres sont orientés en conséquence.
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
                <th data-tooltip="Esperance par episode a l'horizon primaire (J+20), orientee dans le sens du signal. C'est la grandeur qui decide : survoler pour voir gain moyen, perte moyenne et ratio.">E J+20</th>
                <th data-tooltip="% de cas favorables a J+20. A lire avec le ratio gain/perte : un win rate bas est acceptable si les gagnants sont nettement plus gros.">Win% J+20</th>
                <th data-tooltip="Excursion favorable moyenne / adverse moyenne sur 20 seances. > 1 = asymetrie qu'une sortie asymetrique pourrait recolter ; proche de 1 = parcours symetrique, aucun stop ne creera d'esperance.">MFE/MAE 20</th>
                <th data-tooltip="Meme ratio sur 40 seances — un gros gagnant a besoin de place pour se deployer.">MFE/MAE 40</th>
                <th>relPerf J+5</th>
                <th>relPerf J+10</th>
                <th>relPerf J+20</th>
                <th data-tooltip="Horizon long : la perf relative tient-elle au-dela de 20 seances ?">relPerf J+40</th>
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
                      {st.total >= LOW_SAMPLE_THRESHOLD && st.underpowered && (
                        <span
                          className={styles.lowSample}
                          data-tooltip={`Moins de ${MIN_EPISODES} episodes : sous le plancher de puissance statistique. Un resultat flatteur ne se distingue pas de la chance a cette taille d'echantillon.`}
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td>{st.avgScore ?? '—'}</td>
                    <td><ExpectancyCell stat={st.j20} /></td>
                    <td className={styles.winCell}>{fmtRate(st.j20.winRate)}</td>
                    <td><ExcursionCell stat={st.excursion20} /></td>
                    <td><ExcursionCell stat={st.excursion40} /></td>
                    <td><HorizonCell signal={st.signal} stat={st.j5} /></td>
                    <td><HorizonCell signal={st.signal} stat={st.j10} /></td>
                    <td><HorizonCell signal={st.signal} stat={st.j20} /></td>
                    <td><HorizonCell signal={st.signal} stat={st.j40} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Découpes : le tableau ci-dessus est l'agrégat, celui-ci répond à la
          seule question que le plan laisse ouverte — une sous-population fait-elle
          exception ? Réservé aux secteurs : les bornes de score ne sont pas
          calibrées pour les ETF thématiques, découper y ajouterait une couche de
          multiplicité sur une base déjà non validée. */}
      {scope === 'sector' && totalLogged > 0 && <SignalSlices rows={rows} />}
    </div>
  );
}
