import { useState } from 'react';
import { TickerSearch, type TickerResult } from '../TickerSearch/TickerSearch';
import { useFundamentals } from '../../hooks/useFundamentals';
import styles from './FundamentalsView.module.css';

/**
 * Vue d'inspection des donnees fondamentales SEC — sortie JSON brute, avant
 * tout scoring. Sert a voir ce que le resolver produit reellement sur une
 * societe donnee.
 */
export function FundamentalsView() {
  const [picked, setPicked] = useState<TickerResult | null>(null);
  const isCrypto = picked?.assetType === 'crypto';
  const { data, failure, isFetching } = useFundamentals(isCrypto ? null : picked?.ticker ?? null);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!data) return;
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={styles.root}>
      <div className={styles.searchRow}>
        <TickerSearch
          onSelect={setPicked}
          placeholder="Rechercher une société — « AAPL », « Caterpillar »…"
        />
      </div>

      <div className={styles.notice}>
        <span className={styles.noticeIcon}>ℹ</span>
        {/* Un seul enfant flex : sans ce span, <strong> deviendrait un item a part
            et le texte se briserait en colonnes. */}
        <span>
          Données SEC EDGAR — <strong>sociétés cotées aux États-Unis uniquement</strong>. Les lignes
          européennes (AIR.PA, ASML.AS…) sont hors périmètre pour l'instant : absence de données,
          pas un signal négatif. Sortie JSON brute, aucun score n'est encore calculé.
        </span>
      </div>

      {picked && (
        <div className={styles.pickedRow}>
          <span className={styles.pickedTicker}>
            {isCrypto ? picked.name : picked.ticker}
          </span>
          <span className={styles.pickedName}>{isCrypto ? picked.sublabel : picked.name}</span>
          {isFetching && <span className={styles.loading}>chargement…</span>}
          {data && (
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? 'copié ✓' : 'copier le JSON'}
            </button>
          )}
        </div>
      )}

      {isCrypto && (
        <div className={styles.errorBox}>
          <strong>{picked?.name}</strong> est une crypto — la SEC ne publie de comptes que pour
          les sociétés. Choisis une action.
        </div>
      )}

      {failure?.kind === 'no_email' && (
        <div className={styles.errorBox}>
          Aucune adresse de contact renseignée. L'annuaire des sociétés de la SEC refuse (403) les
          requêtes qui n'en portent pas — renseigne-la dans <strong>Réglages ⚙ → Données
          fondamentales</strong>.
        </div>
      )}

      {failure?.kind === 'directory_failed' && (
        <div className={styles.errorBox}>
          L'annuaire SEC n'a pas pu être chargé. Vérifie l'adresse de contact dans les réglages —
          une adresse mal formée est rejetée.
        </div>
      )}

      {failure?.kind === 'not_us_listed' && (
        <div className={styles.warnBox}>
          <strong>{failure.ticker}</strong> est introuvable dans l'annuaire SEC : la société n'est
          pas cotée aux États-Unis, ou son ticker Yahoo diffère de son symbole SEC. Aucune donnée
          fondamentale disponible — ce n'est pas un mauvais signal, c'est une absence de couverture.
        </div>
      )}

      {failure?.kind === 'fetch_failed' && (
        <div className={styles.errorBox}>
          Échec du téléchargement ({failure.step === 'profile' ? 'profil' : 'comptes'}) depuis la SEC.
        </div>
      )}

      {data && (
        <>
          <div className={styles.summary}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Société</span>
              <span className={styles.summaryValue}>{data.profile.name}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>CIK</span>
              <span className={styles.summaryValue}>{data.cik}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Secteur SIC</span>
              <span className={styles.summaryValue}>
                {data.profile.sic || '—'} · {data.profile.sicDescription || '—'}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Exercices résolus</span>
              <span className={styles.summaryValue}>{data.series.length}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Dernier rapport annuel</span>
              <span className={styles.summaryValue}>
                {data.profile.lastAnnualReport
                  ? `${data.profile.lastAnnualReport.form} · ${data.profile.lastAnnualReport.filed}`
                  : '—'}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Exercices incomplets</span>
              <span className={styles.summaryValue}>
                {Object.keys(data.missing).length} / {data.series.length}
              </span>
            </div>
          </div>

          <pre className={styles.json}>{JSON.stringify(data, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
