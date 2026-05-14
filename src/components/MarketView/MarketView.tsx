import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNarratives, fetchAllNarrativeTickers, deleteNarrative, getSetting, setSetting } from '../../lib/db';
import { useMarketIndicators } from '../../hooks/useMarketIndicators';
import { useSentiment } from '../../hooks/useSentiment';
import { useFundamentals } from '../../hooks/useFundamentals';
import { computeNarrativeMetrics } from '../../lib/indicators';
import { computeCompositeScore, scoreToPhase, PHASES } from '../../lib/score';
import { usePortfolioStore } from '../../store/portfolio';
import type { Narrative, NarrativeTicker } from '../../types';
import { NarrativeForm } from './NarrativeForm';
import { NarrativeDrawer } from './NarrativeDrawer';
import { SectorDashboard } from './SectorDashboard';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';
import styles from './MarketView.module.css';

type MarketSubTab = 'rotation' | 'narratives';
type SortBy = 'score-desc' | 'score-asc' | 'name';

function rsiClass(rsi: number): string {
  if (rsi >= 75) return styles.rsiHot;
  if (rsi <= 30) return styles.rsiCold;
  return styles.rsiNeutral;
}

// Horizontal score gauge with 5 colored zones + marker
function PhaseGauge({ score }: { score: number }) {
  return (
    <div className={styles.gaugeWrap}>
      <div className={styles.gaugeTrack}>
        <div className={styles.gaugeMarker} style={{ left: `${score}%` }} />
      </div>
      <span className={styles.gaugeScore}>{score}<span className={styles.gaugeUnit}>/100</span></span>
    </div>
  );
}

export function MarketView() {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<MarketSubTab>('rotation');
  const [formNarrative, setFormNarrative] = useState<Narrative | null | undefined>(undefined);
  const [selectedNarrativeId, setSelectedNarrativeId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('score-desc');
  const [filterPortfolio, setFilterPortfolio] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [avKeyInput, setAvKeyInput] = useState('');
  const [avKey, setAvKey] = useState<string | null>(null);
  const [fhKeyInput, setFhKeyInput] = useState('');
  const [fhKey, setFhKey] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getSetting('alphavantage_key'), getSetting('finnhub_key')]).then(([av, fh]) => {
      setAvKey(av); if (av) setAvKeyInput(av);
      setFhKey(fh); if (fh) setFhKeyInput(fh);
    });
  }, []);

  const portfolioPositions = usePortfolioStore(s => s.positions);
  const portfolioTickers = useMemo(() => new Set(portfolioPositions.map(p => p.ticker.toUpperCase())), [portfolioPositions]);

  const { data: narratives = [] } = useQuery({ queryKey: ['narratives'], queryFn: fetchNarratives });
  const { data: allTickers = [] } = useQuery({ queryKey: ['narrative-tickers'], queryFn: fetchAllNarrativeTickers });
  const { data: indicators = {}, isFetching: loadingIndicators } = useMarketIndicators();
  const { data: sentiment = {}, isFetching: loadingSentiment } = useSentiment();
  const { data: fundamentals = {} } = useFundamentals();

  const tickersByNarrative = allTickers.reduce<Record<number, NarrativeTicker[]>>((acc, t) => {
    if (!acc[t.narrative_id]) acc[t.narrative_id] = [];
    acc[t.narrative_id].push(t);
    return acc;
  }, {});

  async function handleSaveAv() {
    const key = avKeyInput.trim();
    await setSetting('alphavantage_key', key);
    setAvKey(key || null);
    queryClient.invalidateQueries({ queryKey: ['sentiment'] });
  }

  async function handleSaveFh() {
    const key = fhKeyInput.trim();
    await setSetting('finnhub_key', key);
    setFhKey(key || null);
    queryClient.invalidateQueries({ queryKey: ['fundamentals'] });
  }

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ['narratives'] });
    queryClient.invalidateQueries({ queryKey: ['narrative-tickers'] });
    queryClient.invalidateQueries({ queryKey: ['market-indicators'] });
    setFormNarrative(undefined);
  }

  async function handleDelete(n: Narrative) {
    if (!window.confirm(`Supprimer "${n.name}" ?`)) return;
    await deleteNarrative(n.id);
    queryClient.invalidateQueries({ queryKey: ['narratives'] });
    queryClient.invalidateQueries({ queryKey: ['narrative-tickers'] });
  }

  const loading = loadingIndicators || loadingSentiment;
  const keysConfigured = [avKey, fhKey].filter(Boolean).length;

  const sortedNarratives = useMemo(() => {
    const enriched = narratives.map(n => {
      const tickers = tickersByNarrative[n.id] ?? [];
      const metrics = computeNarrativeMetrics(tickers.map(t => t.ticker), indicators, n.ref_etf);
      const sentimentScore = sentiment[n.id]?.score ?? null;
      const score = computeCompositeScore({
        momentum30d: metrics.momentum30d,
        pctAboveMA200: metrics.pctAboveMA200,
        avgRSI: metrics.avgRSI,
        sentimentScore,
        fundamentalsScore: fundamentals[n.id]?.score ?? null,
      });
      const phase = scoreToPhase(score);
      const phaseConf = PHASES[phase];
      const hasScore = metrics.momentum30d != null || metrics.pctAboveMA200 != null;
      const inPortfolio = tickers.some(t => portfolioTickers.has(t.ticker.toUpperCase()));
      const mainstream = (sentiment[n.id]?.mainstream ?? 0) === 1;
      return { n, tickers, metrics, sentimentScore, score, phase, phaseConf, hasScore, inPortfolio, mainstream };
    });

    let list = filterPortfolio ? enriched.filter(e => e.inPortfolio) : enriched;

    if (sortBy === 'score-desc') list = [...list].sort((a, b) => b.score - a.score);
    else if (sortBy === 'score-asc') list = [...list].sort((a, b) => a.score - b.score);
    else if (sortBy === 'name') list = [...list].sort((a, b) => a.n.name.localeCompare(b.n.name, 'fr'));

    return list;
  }, [narratives, tickersByNarrative, indicators, sentiment, fundamentals, portfolioTickers, sortBy, filterPortfolio]);

  return (
    <div className={styles.root}>
      <div className={styles.subNav}>
        <button
          className={`${styles.subNavBtn} ${subTab === 'rotation' ? styles.subNavActive : ''}`}
          onClick={() => setSubTab('rotation')}
        >
          Rotation sectorielle
        </button>
        <button
          className={`${styles.subNavBtn} ${subTab === 'narratives' ? styles.subNavActive : ''}`}
          onClick={() => setSubTab('narratives')}
        >
          Narratives
        </button>
      </div>

      {subTab === 'rotation' && <SectorDashboard />}

      {subTab === 'narratives' && <>
      <div className={styles.topBar}>
        <button
          className={`${styles.newsApiBtn} ${keysConfigured > 0 ? styles.newsApiOn : ''}`}
          onClick={() => setShowSettings(s => !s)}
        >
          {keysConfigured === 2 ? '●●' : keysConfigured === 1 ? '●○' : '○○'} API Keys
        </button>

        <div className={styles.filterGroup}>
          <button
            className={`${styles.filterBtn} ${!filterPortfolio ? styles.filterActive : ''}`}
            onClick={() => setFilterPortfolio(false)}
          >
            Toutes
          </button>
          <button
            className={`${styles.filterBtn} ${filterPortfolio ? styles.filterActive : ''}`}
            onClick={() => setFilterPortfolio(true)}
          >
            Portefeuille
          </button>
        </div>

        <select
          className={styles.sortSelect}
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortBy)}
        >
          <option value="score-desc">Score ↓</option>
          <option value="score-asc">Score ↑</option>
          <option value="name">Nom A→Z</option>
        </select>

        {loading && <span className={styles.loadingMsg}>Mise à jour…</span>}
        <button className={styles.addBtn} onClick={() => setFormNarrative(null)}>+ Narrative</button>
      </div>

      {showSettings && (
        <>
          <div className={styles.settingsPanel}>
            <span className={styles.settingsLabel}>Alpha Vantage</span>
            <input
              className={styles.settingsInput}
              type="password"
              value={avKeyInput}
              onChange={e => setAvKeyInput(e.target.value)}
              placeholder="Sentiment — alphavantage.co"
              onKeyDown={e => e.key === 'Enter' && handleSaveAv()}
            />
            <button className={styles.saveBtn} onClick={handleSaveAv}>Enregistrer</button>
          </div>
          <div className={styles.settingsPanel}>
            <span className={styles.settingsLabel}>Finnhub</span>
            <input
              className={styles.settingsInput}
              type="password"
              value={fhKeyInput}
              onChange={e => setFhKeyInput(e.target.value)}
              placeholder="Fondamentaux — finnhub.io"
              onKeyDown={e => e.key === 'Enter' && handleSaveFh()}
            />
            <button className={styles.saveBtn} onClick={handleSaveFh}>Enregistrer</button>
          </div>
        </>
      )}

      <div className={styles.grid}>
        {sortedNarratives.map(({ n, tickers, metrics, sentimentScore, score, phase, phaseConf, hasScore, inPortfolio, mainstream }) => {
          return (
            <div
              key={n.id}
              className={`${styles.card} ${selectedNarrativeId === n.id ? styles.cardSelected : ''}`}
              onClick={() => setSelectedNarrativeId(n.id)}
            >
              <div className={styles.colorBar} style={{ background: n.color }} />
              <div className={styles.content}>

                <div className={styles.header}>
                  <span className={styles.name}>{n.name}</span>
                  <div className={styles.cardActions} onClick={e => e.stopPropagation()}>
                    <button className={styles.iconBtn} onClick={() => setFormNarrative(n)} title="Modifier">✎</button>
                    <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleDelete(n)} title="Supprimer">×</button>
                  </div>
                </div>

                <div className={styles.metaRow}>
                  {hasScore ? (
                    <span
                      className={styles.phaseBadge}
                      style={{ color: phaseConf.color, background: `${phaseConf.color}22` }}
                    >
                      {mainstream && <span title="Sujet très médiatisé — risque de pic d'attention">⚠ </span>}
                      {phaseConf.label}
                      <InfoTooltip text={
                        phase === 'accumulation' ? 'Accumulation (0–35) : narrative peu connue du grand public. Phase potentielle d\'entrée précoce.' :
                        phase === 'awareness'    ? 'Awareness (35–60) : narrative en montée de notoriété. Momentum naissant, intérêt croissant.' :
                        phase === 'momentum'     ? 'Momentum (60–75) : narrative en forte progression. Tendance confirmée, flux entrants importants.' :
                        phase === 'overheat'     ? 'Surchauffe (75–88) : narrative très chaude. Attention au risque de consolidation ou de retournement.' :
                                                  'Blow-off (88–100) : euphorie maximale. Risque de retournement élevé — prudence.'
                      } />
                    </span>
                  ) : null}
                  {inPortfolio && <span className={styles.inPortfolioBadge}>En portefeuille</span>}
                </div>

                <p className={styles.description}>{n.description}</p>

                <div className={styles.tickers}>
                  {tickers.map(t => (
                    <span key={t.id} className={styles.ticker}>{t.ticker}</span>
                  ))}
                </div>

                <div className={styles.indicatorRow}>
                  {metrics.avgRSI != null ? (
                    <span className={`${styles.badge} ${rsiClass(metrics.avgRSI)}`}>
                      RSI {Math.round(metrics.avgRSI)}
                      <InfoTooltip text="RSI (Relative Strength Index) : mesure la force du mouvement. >70 = surachat, <30 = survente, ~50 = neutre." />
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>RSI —</span>
                  )}
                  {metrics.momentum30d != null && (
                    <span className={`${styles.badge} ${metrics.momentum30d >= 0 ? styles.badgeGreen : styles.badgeRed}`}>
                      {metrics.momentum30d >= 0 ? '+' : ''}{metrics.momentum30d.toFixed(1)}% 30j
                      <InfoTooltip text="Performance moyenne des tickers de la narrative sur les 30 derniers jours." />
                    </span>
                  )}
                  {metrics.pctAboveMA200 != null && (
                    <span className={`${styles.badge} ${metrics.pctAboveMA200 >= 50 ? styles.badgeGreen : styles.badgeRed}`}>
                      {metrics.pctAboveMA200 >= 50 ? '↑' : '↓'} MA200 {Math.round(metrics.pctAboveMA200)}%
                      <InfoTooltip text="Moyenne Mobile 200 jours : % de tickers dont le prix est au-dessus de leur tendance long terme. ↑ = tendance haussière, ↓ = tendance baissière." />
                    </span>
                  )}
                  {sentimentScore != null && (
                    <span className={`${styles.badge} ${styles.badgeSentiment}`}>
                      Sent. {Math.round(sentimentScore)}
                      <InfoTooltip text="Score de sentiment de la presse financière (Alpha Vantage). 0 = très négatif, 50 = neutre, 100 = très positif." />
                    </span>
                  )}
                </div>

                {hasScore && <PhaseGauge score={score} />}

                {n.ref_etf && <span className={styles.etf}>ETF ref : {n.ref_etf}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {formNarrative !== undefined && (
        <NarrativeForm
          narrative={formNarrative ?? undefined}
          onClose={() => setFormNarrative(undefined)}
          onSaved={handleSaved}
        />
      )}

      {selectedNarrativeId != null && (() => {
        const n = narratives.find(x => x.id === selectedNarrativeId);
        if (!n) return null;
        const tickers = tickersByNarrative[n.id] ?? [];
        return (
          <NarrativeDrawer
            narrative={n}
            tickers={tickers}
            indicators={indicators}
            sentimentRecord={sentiment[n.id] ?? null}
            fundamentalsRecord={fundamentals[n.id] ?? null}
            onClose={() => setSelectedNarrativeId(null)}
          />
        );
      })()}
      </>}
    </div>
  );
}
