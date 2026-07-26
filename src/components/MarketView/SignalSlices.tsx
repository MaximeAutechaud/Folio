import { useMemo, useState } from 'react';
import {
  sliceSignal,
  meetsPrimaryThreshold,
  anySurvivingBucket,
  PRIMARY_TARGET,
  OUT_OF_SAMPLE_FROM,
  type SliceAxis,
} from '../../lib/signalSlices';
import {
  SIGNAL_KINDS,
  SIGNAL_META,
  MIN_EPISODES,
  orient,
  type SignalKind,
} from '../../lib/signalStats';
import type { SignalLogRow } from '../../types';
import styles from './SignalSlices.module.css';

const AXES: { key: SliceAxis; label: string }[] = [
  { key: 'score',  label: 'Tranche de score' },
  { key: 'ma50',   label: 'MA50' },
  { key: 'macro',  label: 'Macro' },
  { key: 'sector', label: 'Secteur' },
  { key: 'year',   label: 'Année' },
];

const HORIZONS = [20, 40] as const;

function fmt(v: number | null, digits = 1): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function fmtRatio(v: number | null): string {
  return v == null ? '—' : `×${v.toFixed(2)}`;
}

function fmtRate(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function cls(v: number | null, good: (x: number) => boolean): string {
  if (v == null) return '';
  return good(v) ? styles.pos : styles.neg;
}

/**
 * Découpes de diagnostic de la Phase 1.
 *
 * Le tableau agrégé au-dessus répond « non » : espérance ≈ 0, win rate posé sur
 * la baseline de 49 %, MFE/MAE ≈ 1. Ce panneau répond à la seule question que le
 * plan laisse ouverte — une sous-population fait-elle exception ?
 *
 * Il est conçu pour rendre le surapprentissage visible plutôt que confortable :
 * les buckets sous le plancher de puissance sont montrés mais barrés d'un
 * avertissement, l'écart à la cible pré-enregistrée est annoncé, et le segment
 * hors-échantillon reste derrière une action explicite.
 */
export function SignalSlices({ rows }: { rows: SignalLogRow[] }) {
  const [axis, setAxis] = useState<SliceAxis>('score');
  const [signal, setSignal] = useState<SignalKind>(PRIMARY_TARGET.signal);
  const [horizon, setHorizon] = useState<number>(PRIMARY_TARGET.horizon);
  const [oos, setOos] = useState(false);

  const result = useMemo(
    () => sliceSignal(rows, { axis, signal, horizon, includeOutOfSample: oos }),
    [rows, axis, signal, horizon, oos],
  );

  // Verdict du critère d'arrêt : évalué sur **toutes** les découpes des cinq
  // axes, pas seulement celle affichée — sinon il suffirait de changer d'onglet
  // pour se convaincre qu'il reste quelque chose.
  const surviving = useMemo(
    () => anySurvivingBucket(
      AXES.flatMap(a => SIGNAL_KINDS.flatMap(s => HORIZONS.map(h =>
        sliceSignal(rows, { axis: a.key, signal: s, horizon: h, includeOutOfSample: oos }),
      ))),
    ),
    [rows, oos],
  );

  const meta = SIGNAL_META[signal];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Diagnostic — découpes</span>
        {result.exploratory ? (
          <span
            className={styles.exploratory}
            data-tooltip={`Cible pre-enregistree : ${PRIMARY_TARGET.signal} a J+${PRIMARY_TARGET.horizon} vs ${PRIMARY_TARGET.benchmark}. Toute autre combinaison est exploratoire : un resultat trouve ici demande une validation sur une periode neuve pour valoir quelque chose.`}
          >
            exploratoire
          </span>
        ) : (
          <span
            className={styles.registered}
            data-tooltip="Cible pre-enregistree, declaree dans le code avant consultation des resultats."
          >
            cible pré-enregistrée
          </span>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.group}>
          {AXES.map(a => (
            <button
              key={a.key}
              className={`${styles.chip} ${axis === a.key ? styles.chipActive : ''}`}
              onClick={() => setAxis(a.key)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className={styles.group}>
          {SIGNAL_KINDS.map(s => (
            <button
              key={s}
              className={`${styles.chip} ${signal === s ? styles.chipActive : ''}`}
              onClick={() => setSignal(s)}
              style={signal === s ? { color: SIGNAL_META[s].color, borderColor: SIGNAL_META[s].color + '66' } : undefined}
            >
              {SIGNAL_META[s].label}
            </button>
          ))}
        </div>
        <div className={styles.group}>
          {HORIZONS.map(h => (
            <button
              key={h}
              className={`${styles.chip} ${horizon === h ? styles.chipActive : ''}`}
              onClick={() => setHorizon(h)}
            >
              J+{h}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.note}>
        Espérance et excursions <strong>vs RSP</strong>, orientées dans le sens du signal
        {!meta.bullish && <> (<em>{meta.label}</em> = évitement : la réussite est une sous-performance)</>}.
        Un bucket ne « franchit » que si les trois conditions tiennent ensemble :
        espérance ≥ {PRIMARY_TARGET.minExpectancy} % (≈ 3× les frais aller-retour),
        MFE/MAE ≥ {PRIMARY_TARGET.minExcursionRatio} (3σ de 1), et n ≥ {MIN_EPISODES}.
        Deux sur trois n'est pas « presque » un résultat, c'est un résultat négatif.
      </p>

      {!oos ? (
        <div className={styles.sealed}>
          <span>
            Segment <strong>hors-échantillon</strong> (≥ {OUT_OF_SAMPLE_FROM}) écarté. C'est une
            cartouche unique : une fois consultée, tout test ultérieur sur cette période est
            in-sample et ne prouve plus rien. À dépenser sur la cible pré-enregistrée, pas sur un balayage.
          </span>
          <button className={styles.revealBtn} onClick={() => setOos(true)}>
            Inclure quand même
          </button>
        </div>
      ) : (
        <div className={styles.spent}>
          ⚠ Hors-échantillon inclus — les résultats ci-dessous ne sont plus hors-échantillon.
          <button className={styles.revealBtn} onClick={() => setOos(false)}>Réarmer</button>
        </div>
      )}

      {result.buckets.length === 0 ? (
        <div className={styles.empty}>
          Aucun épisode pour ce signal sur la période retenue.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>{AXES.find(a => a.key === axis)!.label}</th>
                <th data-tooltip="Episodes distincts. Un signal persistant sur un meme secteur compte une fois.">n</th>
                <th data-tooltip="Esperance par episode, orientee. La grandeur qui decide.">E</th>
                <th>Win%</th>
                <th data-tooltip="Mediane brute : dit si l esperance repose sur le cas typique ou sur quelques extremes.">Médiane</th>
                <th data-tooltip="Pire decile brut. Une esperance positive portee par une queue gauche intolerable n'est pas tradable — c'est ce decile qui fixe la taille de position.">Pire décile</th>
                <th data-tooltip="Excursion favorable moyenne / adverse moyenne. Proche de 1 = parcours symetrique, aucune sortie ne creera d'esperance.">MFE/MAE</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.buckets.map(b => {
                const ok = meetsPrimaryThreshold(b);
                return (
                  <tr key={b.label} className={ok ? styles.rowPass : ''}>
                    <td className={styles.thLeft}>{b.label}</td>
                    <td>
                      {b.total}
                      {b.underpowered && (
                        <span
                          className={styles.warn}
                          data-tooltip={`Moins de ${MIN_EPISODES} episodes : sous le plancher de puissance. A cette taille, un resultat flatteur ne se distingue pas de la chance — quelle que soit sa valeur.`}
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className={cls(b.stat.expectancy, x => x >= 0)}>
                      {fmt(b.stat.expectancy, 2)}
                    </td>
                    <td>{fmtRate(b.stat.winRate)}</td>
                    <td className={cls(b.stat.medianRelPerf, x => orient(signal, x) >= 0)}>
                      {fmt(b.stat.medianRelPerf)}
                    </td>
                    <td className={styles.muted}>{fmt(b.stat.p10)}</td>
                    <td className={cls(b.excursion.ratio, x => x >= PRIMARY_TARGET.minExcursionRatio)}>
                      {fmtRatio(b.excursion.ratio)}
                    </td>
                    <td className={styles.verdict}>{ok ? '✓' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.unclassified > 0 && (
        <p className={styles.note}>
          {result.unclassified} épisode{result.unclassified > 1 ? 's' : ''} non classé
          {result.unclassified > 1 ? 's' : ''} sur cet axe (valeur absente) — écarté
          {result.unclassified > 1 ? 's' : ''} plutôt que rangé d'office dans un bucket.
        </p>
      )}

      <div className={surviving ? styles.verdictPass : styles.verdictStop}>
        {surviving ? (
          <>
            <strong>Au moins un bucket franchit les trois seuils</strong> sur l'ensemble des
            découpes. À confirmer sur le hors-échantillon avant d'en tirer quoi que ce soit —
            c'est une découpe parmi ~40, pas encore un résultat.
          </>
        ) : (
          <>
            <strong>Critère d'arrêt de la Phase 1 atteint</strong> : aucune sous-population ne
            franchit les trois seuils, sur aucun des cinq axes, pour aucun des quatre signaux.
            La conclusion à assumer est que les signaux restent des <strong>descriptions
            contextuelles</strong> — et qu'il ne faut pas poursuivre l'optimisation de leurs seuils.
          </>
        )}
      </div>
    </div>
  );
}
