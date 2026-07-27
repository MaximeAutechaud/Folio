import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUniverseSync, type ImportOutcome } from '../../hooks/useUniverseSync';
import { useScanner, type ScanCluster } from '../../hooks/useScanner';
import { SECTORS } from '../../lib/sectors';
import styles from './ScannerView.module.css';

const SECTOR_NAME = new Map(SECTORS.map(s => [s.id, s.name]));

function fmtM(v: number): string {
  return v >= 1e9 ? `${(v / 1e9).toFixed(1)} Md$` : `${Math.round(v / 1e6)} M$`;
}

/**
 * Un cluster candidat — jamais un titre isolé.
 *
 * L'étage 1 du scanner produit une liste de titres où l'argent arrive. Elle
 * n'est délibérément pas exposée : quinze tickers affichés sans thèse produisent
 * quinze achats sans thèse, et un titre seul avec un pic de volume n'est pas une
 * trouvaille — c'est du bruit avec un résultat trimestriel derrière.
 *
 * Ce qui remonte est un groupe de titres qui bougent ensemble pour une raison
 * qui n'est ni le marché ni leur secteur. C'est un candidat au statut de
 * narrative, à nommer et valider par toi.
 */
function ClusterCard({ cluster }: { cluster: ScanCluster }) {
  const secteurs = cluster.sectors.map(s => SECTOR_NAME.get(s) ?? s).join(' · ');
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.tickers}>{cluster.tickers.join('  ')}</span>
        <span className={styles.cohesion}>
          score {cluster.score}/100
        </span>
        <span
          className={styles.cohesion}
          data-tooltip="Correlation residuelle moyenne entre membres, marche et secteur deja retires. Calculee sur toutes les paires, pas seulement les liens directs : une chaine n'est pas un theme."
        >
          cohésion {cluster.cohesion.toFixed(2)}
        </span>
      </div>

      <div className={styles.sectors}>
        {cluster.sectors.length > 1 && <span className={styles.crossBadge}>transverse</span>}
        {secteurs}
      </div>

      <table className={styles.members}>
        <thead>
          <tr>
            <th className={styles.thLeft}>Titre</th>
            <th data-tooltip="Pic robuste du dollar volume récent face à sa médiane des 60 séances antérieures.">vol. z</th>
            <th data-tooltip="Nombre de séances d'accélération sur les cinq dernières.">pers.</th>
            <th data-tooltip="Dollar volume median : ce qui s'echange normalement.">liquidité</th>
            <th data-tooltip="Volume moyen récent rapporté au dollar-volume médian de base.">régime</th>
            <th data-tooltip="Accélération de la pente 10j face à la pente 40j, normalisée par la volatilité 20j.">accél.</th>
            <th data-tooltip="Percentile transversal de l'accélération.">rang acc.</th>
          </tr>
        </thead>
        <tbody>
          {cluster.members.map(m => (
            <tr key={m.ticker}>
              <td className={styles.thLeft}>
                <span className={styles.ticker}>{m.ticker}</span>
                <span className={styles.memberSector}>{SECTOR_NAME.get(m.sectorId ?? '') ?? '—'}</span>
              </td>
              <td className={styles.pos}>{m.liquidityZ.toFixed(1)}</td>
              <td>{m.trueDays}/5</td>
              <td className={styles.muted}>{fmtM(m.baseline)}</td>
              <td className={styles.pos}>×{m.liquidityRatio.toFixed(1)}</td>
              <td className={styles.pos}>{m.normalizedAcceleration.toFixed(1)}</td>
              <td>{Math.round(m.accelerationPercentile)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScannerView() {
  const queryClient = useQueryClient();
  const sync = useUniverseSync();
  const { data: scan, isLoading } = useScanner();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<ImportOutcome | null>(null);

  const busy = sync.progress.phase === 'universe' || sync.progress.phase === 'fetching';
  const report = sync.progress.report;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImported(await sync.importCsv(await file.text()));
    e.target.value = '';
    queryClient.invalidateQueries({ queryKey: ['scanner'] });
  }

  async function handleSync() {
    await sync.run();
    queryClient.invalidateQueries({ queryKey: ['scanner'] });
  }

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <p className={styles.introText}>
          Repère les groupes de titres qui <strong>bougent ensemble</strong> pour une raison qui
          n'est ni le marché ni leur secteur, et entrent ensemble dans une phase
          d'accélération relative confirmée par la liquidité.
          C'est l'entrée de découverte qui manque à l'étage narrative : un thème naissant n'a ni
          ETF, ni classification, ni récit macro — il est donc invisible depuis le haut de l'entonnoir.
        </p>
        <p className={styles.introText}>
          Un cluster est un <strong>candidat à nommer</strong>, pas une recommandation. Les titres
          isolés ne sont volontairement pas affichés. Ce POC exige au moins trois membres,
          une cohésion résiduelle de 0,45 et au moins trois jours d'accélération sur cinq.
        </p>
      </div>

      <div className={styles.actions}>
        <button className={styles.primaryBtn} onClick={handleSync} disabled={busy}>
          {busy ? sync.progress.message : '↻ Synchroniser les cours'}
        </button>
        <button className={styles.secondaryBtn} onClick={() => fileRef.current?.click()} disabled={busy}>
          ⤒ Importer un univers
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className={styles.hiddenInput}
          onChange={handleFile}
        />
        {scan?.asOf && <span className={styles.asOf}>cours au {scan.asOf}</span>}
      </div>

      {busy && sync.progress.total > 0 && (
        <div className={styles.progressWrap}>
          <div
            className={styles.progressBar}
            style={{ width: `${Math.round((sync.progress.done / sync.progress.total) * 100)}%` }}
          />
        </div>
      )}

      {imported && (
        <div className={imported.ok ? styles.notice : styles.warn}>
          {imported.message}
          <button className={styles.dismiss} onClick={() => setImported(null)}>×</button>
        </div>
      )}

      {sync.progress.phase === 'error' && (
        <div className={styles.warn}>⚠ {sync.progress.message}</div>
      )}

      {report && (
        <div className={report.unresolved.length ? styles.warn : styles.notice}>
          <strong>{report.resolved}</strong> titres résolus, {report.bars.toLocaleString('fr-FR')} bougies
          {report.skipped > 0 && <>, {report.skipped} déjà à jour</>}.
          {report.unresolved.length > 0 && (
            <>
              {' '}<strong>{report.unresolved.length} non résolus</strong> —{' '}
              <span
                className={styles.mono}
                data-tooltip="Ces tickers n'ont rien renvoye. Souvent un format Yahoo different (classes d'actions), parfois un retrait de cote. Un titre manquant ampute un cluster sans qu'aucun symptome n'apparaisse, d'ou ce rapport."
              >
                {report.unresolved.slice(0, 12).join(' ')}
                {report.unresolved.length > 12 && ` +${report.unresolved.length - 12}`}
              </span>
            </>
          )}
          <button className={styles.dismiss} onClick={sync.reset}>×</button>
        </div>
      )}

      {isLoading ? (
        <div className={styles.empty}>Analyse…</div>
      ) : !scan || scan.scanned === 0 ? (
        <div className={styles.empty}>
          Aucun cours en cache.<br />
          Lance une synchronisation — la première prend quelques minutes pour ~900 titres,
          les suivantes quelques secondes.
        </div>
      ) : scan.clusters.length === 0 ? (
        <div className={styles.empty}>
          <strong>Aucun cluster détecté.</strong><br />
          {scan.candidateCount} accélérations qualifiées sur {scan.scanned} titres scannés, mais
          aucun groupe d'au moins 3 titres suffisamment cohérent une fois le marché et les secteurs retirés.
          <div className={styles.emptyNote}>
            C'est un résultat, pas une panne : la plupart du temps il ne naît pas de narrative.
            Un scanner qui trouve quelque chose tous les jours ne trouve rien.
          </div>
        </div>
      ) : (
        <>
          <div className={styles.summary}>
            <strong>{scan.clusters.length}</strong> cluster{scan.clusters.length > 1 ? 's' : ''} ·{' '}
            {scan.candidateCount} accélérations qualifiées sur {scan.scanned} titres scannés
            {scan.droppedCount > 0 && (
              <span
                className={styles.muted}
                data-tooltip="Candidats ecartes faute de benchmark exploitable dans le cache. Un titre nettoye du marche mais pas de son secteur correlerait avec ses pairs sur ce reliquat — un cluster qui n'est qu'un secteur deguise."
              >
                {' '}· {scan.droppedCount} écartés
              </span>
            )}
          </div>
          {scan.clusters.map(c => <ClusterCard key={c.tickers.join()} cluster={c} />)}
        </>
      )}
    </div>
  );
}
