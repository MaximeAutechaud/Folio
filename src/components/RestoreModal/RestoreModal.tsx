import { useEffect, useState } from 'react';
import { inspectBackup, restoreFromBackup, type BackupPreview } from '../../lib/backup';
import styles from './RestoreModal.module.css';

interface Props {
  /** Chemin retourné par le sélecteur de fichier. */
  path: string;
  onClose: () => void;
}

type State =
  | { kind: 'inspecting' }
  | { kind: 'ready'; preview: BackupPreview }
  | { kind: 'restoring' }
  | { kind: 'done'; safetyPath: string }
  | { kind: 'error'; message: string };

/**
 * Confirmation avant remplacement de la base. Pas de fermeture au clic overlay :
 * c'est une action destructive, elle se ferme explicitement (cf. la convention
 * des modals de saisie du projet).
 */
export function RestoreModal({ path, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: 'inspecting' });

  useEffect(() => {
    let cancelled = false;
    inspectBackup(path)
      .then((preview) => { if (!cancelled) setState({ kind: 'ready', preview }); })
      .catch((e) => { if (!cancelled) setState({ kind: 'error', message: String(e) }); });
    return () => { cancelled = true; };
  }, [path]);

  async function handleRestore() {
    setState({ kind: 'restoring' });
    try {
      const safetyPath = await restoreFromBackup(path);
      setState({ kind: 'done', safetyPath });
      // Le store Zustand et le cache TanStack décrivent encore l'ancienne base :
      // seul un rechargement complet garantit un état cohérent.
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setState({ kind: 'error', message: String(e) });
    }
  }

  const busy = state.kind === 'restoring' || state.kind === 'done';

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span>Importer une sauvegarde</span>
          {!busy && <button className={styles.closeBtn} onClick={onClose}>×</button>}
        </div>

        <div className={styles.body}>
          <div className={styles.fileName}>
            {state.kind === 'ready' ? state.preview.fileName : path.split(/[\\/]/).pop()}
          </div>

          {state.kind === 'inspecting' && (
            <p className={styles.loading}>Lecture de la sauvegarde…</p>
          )}

          {state.kind === 'error' && <p className={styles.error}>{state.message}</p>}

          {state.kind === 'ready' && (
            <>
              <div className={styles.counts}>
                <span className={styles.countLabel}>Positions</span>
                <span className={styles.countValue}>{state.preview.positions}</span>
                <span className={styles.countLabel}>Transactions</span>
                <span className={styles.countValue}>{state.preview.transactions}</span>
                <span className={styles.countLabel}>Snapshots</span>
                <span className={styles.countValue}>{state.preview.snapshots}</span>
                <span className={styles.countLabel}>Version de schéma</span>
                <span className={styles.countValue}>{state.preview.schemaVersion ?? '—'}</span>
              </div>
              <div className={styles.warning}>
                ⚠ Toutes les données actuelles seront remplacées par celles de ce fichier.
                Une copie de l'état actuel est écrite juste avant, et l'application se recharge
                une fois l'import terminé.
              </div>
            </>
          )}

          {state.kind === 'restoring' && <p className={styles.loading}>Remplacement en cours…</p>}

          {state.kind === 'done' && (
            <>
              <p className={styles.loading}>Import terminé — rechargement…</p>
              <p className={styles.loading}>
                État précédent conservé ici :<br />
                <span className={styles.fileName}>{state.safetyPath}</span>
              </p>
            </>
          )}
        </div>

        {!busy && (
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={onClose}>Annuler</button>
            <button
              className={styles.dangerBtn}
              onClick={handleRestore}
              disabled={state.kind !== 'ready'}
            >
              Remplacer mes données
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
