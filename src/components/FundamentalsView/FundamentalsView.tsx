import { useState } from 'react';
import { TickerSearch, type TickerResult } from '../TickerSearch/TickerSearch';
import { useFundamentals, type FundamentalsData } from '../../hooks/useFundamentals';
import { MIN_AVAILABLE_TESTS, type PiotroskiScore } from '../../lib/piotroski';
import { PiotroskiRadar } from './PiotroskiRadar';
import styles from './FundamentalsView.module.css';

const VERDICT_LABEL: Record<string, string> = {
  solide: 'Solide', correct: 'Correct', fragile: 'Fragile', difficulte: 'En difficulté',
};

function pct(n: number | null, digits = 1): string {
  return n == null ? '—' : (n * 100).toFixed(digits) + ' %';
}

function num(n: number | null, digits = 1): string {
  return n == null ? '—' : n.toFixed(digits);
}

function usd(n: number | null): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  // Tout en milliards au-dela du seuil : « B$ » pour billion se lirait comme
  // l'anglais « billion » (10^9) alors qu'il vaut 10^12 en francais.
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e12 ? 0 : 1)} Md$`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(0)} M$`;
  return `${n.toFixed(0)} $`;
}

function Verdict({ score }: { score: PiotroskiScore }) {
  const cls =
    score.verdict === 'solide' ? styles.vSolide :
    score.verdict === 'correct' ? styles.vCorrect :
    score.verdict === 'fragile' ? styles.vFragile :
    score.verdict === 'difficulte' ? styles.vDifficulte :
    styles.vInconnu;

  return (
    <div className={`${styles.verdictCard} ${cls}`}>
      <div className={styles.verdictScore}>
        {score.score}<span className={styles.verdictOutOf}>/{score.available}</span>
      </div>
      <div className={styles.verdictBody}>
        <div className={styles.verdictLabel}>
          {score.verdict ? VERDICT_LABEL[score.verdict] : 'Pas de verdict'}
        </div>
        <div className={styles.verdictNote}>
          {score.verdict
            ? `F-Score de Piotroski · exercice ${score.periodEnd}`
            : `Seulement ${score.available} tests calculables sur 9 — en dessous de ${MIN_AVAILABLE_TESTS}, aucune synthèse ne serait honnête.`}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.metric} {...(hint ? { 'data-tooltip': hint } : {})}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  );
}

function Report({ data }: { data: FundamentalsData }) {
  const last = data.piotroski[data.piotroski.length - 1] ?? null;
  const { altman, context } = data;

  return (
    <>
      <div className={styles.identity}>
        <span className={styles.company}>{data.profile.name}</span>
        <span className={styles.sub}>
          {data.ticker} · {data.profile.sicDescription || 'secteur inconnu'} ·
          {' '}{data.series.length} exercices · capitalisation {usd(data.marketCap)}
          {' · '}
          <span
            className={styles.source}
            data-tooltip={
              data.fromCache
                ? `Comptes en base, relus sans téléchargement. Dernière vérification le ${new Date(data.fetchedAt).toLocaleString('fr-FR')}. Le cours, lui, est toujours récupéré à chaque consultation.`
                : `Comptes téléchargés à l'instant depuis la SEC (~4 Mo) et mis en base.`
            }
          >
            {data.fromCache ? 'cache' : 'téléchargé'}
          </span>
        </span>
      </div>

      {data.isFinancial && (
        <div className={styles.warnBox}>
          <strong>Société financière — non notée.</strong> Le bilan d'une banque ou d'un assureur
          ne se lit pas comme les autres : ni marge brute, ni résultat opérationnel, ni distinction
          entre actif courant et non courant. Un score calculé dessus serait faux plutôt
          qu'imprécis.
        </div>
      )}

      {last && (
        <>
          <Verdict score={last} />
          <PiotroskiRadar history={data.piotroski} />

          {last.nonOperatingShare != null && last.nonOperatingShare > 0.25 && (
            <div className={styles.flagBox}>
              <strong>{pct(last.nonOperatingShare, 0)} du résultat net ne vient pas de
              l'exploitation.</strong> Typiquement une cession d'activité ou un effet fiscal. Les
              tests de rentabilité ci-dessus reposent volontairement sur le résultat opérationnel
              et ne s'en trouvent pas faussés — mais le bénéfice publié, lui, n'est pas
              reconductible.
            </div>
          )}

          {data.piotroski.length > 1 && (
            <div className={styles.history}>
              <span className={styles.historyLabel}>Historique</span>
              {data.piotroski.slice(-8).map((s) => (
                <span
                  key={s.periodEnd}
                  className={styles.historyItem}
                  data-tooltip={`${s.periodEnd} — ${s.score}/${s.available}${s.verdict ? ' · ' + VERDICT_LABEL[s.verdict] : ' · pas de verdict'}`}
                >
                  <span className={styles.historyYear}>{s.periodEnd.slice(0, 4)}</span>
                  <span className={styles.historyScore}>{s.score}/{s.available}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {altman?.distressSignal === true && (
        <div className={styles.errorBox}>
          <strong>Signal de détresse financière (Altman Z″ = {num(altman.headline, 2)}).</strong>{' '}
          Sous le seuil de 1,1, le modèle associe historiquement ce profil à un risque de
          défaillance élevé à un ou deux ans.
        </div>
      )}

      {context && (
        <>
          <div className={styles.sectionTitle}>
            Contexte — hors score
            <span className={styles.sectionNote}>
              volontairement séparé : mélanger « bonne entreprise » et « pas chère » rend la note
              ininterprétable
            </span>
          </div>
          <div className={styles.metrics}>
            <Metric label="FCF" value={usd(context.freeCashFlow)}
              hint="Cash-flow d'exploitation moins investissements corporels" />
            <Metric label="Marge de FCF" value={pct(context.freeCashFlowMargin)} />
            <Metric label="Rendement FCF" value={pct(context.freeCashFlowYield)}
              hint="FCF rapporté à la capitalisation" />
            <Metric label="PER" value={num(context.priceEarnings)}
              hint="Non affiché sur un résultat négatif : un PER négatif se lirait « bon marché »" />
            <Metric label="EV / résultat opé." value={num(context.enterpriseValueToEbit)}
              hint="À la place d'EV/EBITDA : les dotations aux amortissements n'ont pas de tag XBRL exploitable" />
            <Metric label="Dette nette" value={usd(context.netDebt)}
              hint="Dette long terme moins trésorerie. Négatif = trésorerie nette" />
            <Metric label="Dette nette / CFO" value={num(context.netDebtToOperatingCashFlow, 2)}
              hint="Années de cash-flow d'exploitation nécessaires au remboursement" />
            <Metric label="Couverture intérêts" value={num(context.interestCoverage)}
              hint="Souvent indisponible : la charge d'intérêts n'est pas taguée par tous les émetteurs" />
            <Metric label="DSO" value={context.daysSalesOutstanding == null ? '—' : `${Math.round(context.daysSalesOutstanding)} j`}
              hint="Délai de règlement client. À lire en tendance sur une même société, jamais entre sociétés" />
            <Metric label="Jours de stock" value={context.inventoryDays == null ? '—' : `${Math.round(context.inventoryDays)} j`}
              hint="Rapportés au coût des ventes. À lire en tendance, jamais entre sociétés" />
          </div>
        </>
      )}

      {altman && (
        <div className={styles.marketRead}>
          <span className={styles.marketReadLabel}>Lecture marché</span>
          Z″ comptable <strong>{num(altman.headline, 2)}</strong> — le verdict n'utilise aucun
          cours. À titre indicatif, le Z d'origine avec capitalisation vaut{' '}
          <strong>{num(altman.zMarket, 2)}</strong> contre <strong>{num(altman.zBook, 2)}</strong>{' '}
          avec les capitaux propres comptables : l'écart de {num(altman.marketEffect, 2)} ne
          contient que l'opinion du marché.
        </div>
      )}

      <details className={styles.rawWrap}>
        <summary className={styles.rawSummary}>Données brutes (JSON)</summary>
        <pre className={styles.json}>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </>
  );
}

/**
 * Ne garde que ce que la SEC sait couvrir : des actions cotees aux Etats-Unis.
 *
 * Chez Yahoo, une cotation etrangere porte toujours un suffixe d'place separe
 * par un point (`ASML.AS`, `AAPL34.SA` — le certificat bresilien d'Apple) ;
 * les lignes americaines n'en ont jamais, les actions a categories multiples
 * utilisant un tiret (`BRK-B`). Le point est donc un discriminant fiable, et
 * il laisse passer les ADR sans suffixe, qui deposent bien aupres de la SEC.
 */
/**
 * Contrats d'options, que Yahoo melange aux societes : format OCC, soit le
 * sous-jacent puis AAMMJJ, C ou P, et le prix d'exercice sur 8 chiffres
 * (`ASMG260821P00019000`). Motif assez specifique pour n'ecarter aucun ticker
 * reel.
 */
const OPTION_SYMBOL = /^.{1,6}\d{6}[CP]\d{8}$/;

function isUsListedStock(r: TickerResult): boolean {
  return r.assetType === 'stock'
    && !r.ticker.includes('.')
    && !OPTION_SYMBOL.test(r.ticker);
}

/** Vue d'analyse fondamentale — donnees SEC EDGAR, societes americaines. */
export function FundamentalsView() {
  const [picked, setPicked] = useState<TickerResult | null>(null);
  const { data, failure, isFetching } = useFundamentals(picked?.ticker ?? null);

  return (
    <div className={styles.root}>
      <div className={styles.searchRow}>
        <TickerSearch
          onSelect={setPicked}
          filter={isUsListedStock}
          placeholder="Rechercher une société — « AAPL », « Caterpillar »…"
        />
        {isFetching && <span className={styles.loading}>chargement…</span>}
      </div>

      {!picked && (
        <div className={styles.notice}>
          <span className={styles.noticeIcon}>ℹ</span>
          <span>
            Solidité fondamentale à partir des comptes déposés à la SEC —{' '}
            <strong>sociétés cotées aux États-Unis uniquement</strong>. Le verdict repose sur le
            F-Score de Piotroski, neuf tests comptables sans pondération ni seuil à calibrer.
            Score <strong>descriptif</strong>, jamais validé en forward sur ton univers.
          </span>
        </div>
      )}

      {failure?.kind === 'unsupported_currency' && (
        <div className={styles.warnBox}>
          {failure.currency && failure.currency !== 'USD' ? (
            <>
              <strong>{failure.name}</strong> dépose bien auprès de la SEC, mais publie ses comptes
              en <strong>{failure.currency}</strong>. Cet outil ne lit que les comptes libellés en
              dollars — le cas des émetteurs étrangers cotés aux États-Unis.
            </>
          ) : (
            <>
              <strong>{failure.name}</strong> ne publie aucun état financier exploitable. C'est
              attendu pour un ETF, un fonds ou une fiducie : ces véhicules déposent d'autres
              formulaires que les sociétés d'exploitation, et n'ont ni chiffre d'affaires ni
              résultat opérationnel à analyser.
            </>
          )}{' '}
          <strong>Ce n'est pas un mauvais signal</strong>, c'est une absence de couverture.
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
          L'annuaire SEC n'a pas pu être chargé. Vérifie l'adresse de contact dans les réglages.
        </div>
      )}

      {failure?.kind === 'not_us_listed' && (
        <div className={styles.warnBox}>
          <strong>{failure.ticker}</strong> est introuvable dans l'annuaire SEC : la société n'est
          pas cotée aux États-Unis. Aucune donnée fondamentale disponible —{' '}
          <strong>ce n'est pas un mauvais signal</strong>, c'est une absence de couverture.
        </div>
      )}

      {failure?.kind === 'fetch_failed' && (
        <div className={styles.errorBox}>
          Échec du téléchargement ({failure.step === 'profile' ? 'profil' : 'comptes'}) depuis la SEC.
        </div>
      )}

      {data && <Report data={data} />}
    </div>
  );
}
