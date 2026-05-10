import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNarratives, fetchAllNarrativeTickers, deleteNarrative, getSetting, setSetting } from '../../lib/db';
import { useMarketIndicators } from '../../hooks/useMarketIndicators';
import { useSentiment } from '../../hooks/useSentiment';
import { useFundamentals } from '../../hooks/useFundamentals';
import { computeNarrativeMetrics } from '../../lib/indicators';
import { computeCompositeScore, scoreToPhase, PHASES } from '../../lib/score';
import type { Narrative, NarrativeTicker } from '../../types';
import { NarrativeForm } from './NarrativeForm';
import { NarrativeDrawer } from './NarrativeDrawer';
import styles from './MarketView.module.css';

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
      <span className={styles.gaugeScore}>{score}</span>
    </div>
  );
}

export function MarketView() {
  const queryClient = useQueryClient();
  const [formNarrative, setFormNarrative] = useState<Narrative | null | undefined>(undefined);
  const [selectedNarrativeId, setSelectedNarrativeId] = useState<number | null>(null);
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

  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <button
          className={`${styles.newsApiBtn} ${keysConfigured > 0 ? styles.newsApiOn : ''}`}
          onClick={() => setShowSettings(s => !s)}
        >
          {keysConfigured === 2 ? '●●' : keysConfigured === 1 ? '●○' : '○○'} API Keys
        </button>
        {loading && <span className={styles.loadingMsg}>Mise à jour des indicateurs…</span>}
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
        {narratives.map(n => {
          const tickers = tickersByNarrative[n.id] ?? [];
          const metrics = computeNarrativeMetrics(tickers.map(t => t.ticker), indicators, n.ref_etf);
          const sentimentScore = sentiment[n.id]?.score ?? null;
          const mainstream = (sentiment[n.id]?.mainstream ?? 0) === 1;
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
                    {hasScore ? (
                      <span
                        className={styles.phaseBadge}
                        style={{ color: phaseConf.color, background: `${phaseConf.color}22` }}
                      >
                        {mainstream && <span title="Mainstream media flag">⚠ </span>}
                        {phaseConf.label}
                      </span>
                    ) : (
                      <span className={styles.phaseMuted}>—</span>
                    )}
                    <button className={styles.iconBtn} onClick={() => setFormNarrative(n)} title="Modifier">✎</button>
                    <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleDelete(n)} title="Supprimer">×</button>
                  </div>
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
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>RSI —</span>
                  )}
                  {metrics.momentum30d != null && (
                    <span className={`${styles.badge} ${metrics.momentum30d >= 0 ? styles.badgeGreen : styles.badgeRed}`}>
                      {metrics.momentum30d >= 0 ? '+' : ''}{metrics.momentum30d.toFixed(1)}% 30j
                    </span>
                  )}
                  {metrics.pctAboveMA200 != null && (
                    <span className={`${styles.badge} ${metrics.pctAboveMA200 >= 50 ? styles.badgeGreen : styles.badgeRed}`}>
                      {metrics.pctAboveMA200 >= 50 ? '↑' : '↓'} MA200 {Math.round(metrics.pctAboveMA200)}%
                    </span>
                  )}
                  {sentimentScore != null && (
                    <span className={`${styles.badge} ${styles.badgeSentiment}`}>
                      Sent. {Math.round(sentimentScore)}
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
    </div>
  );
}
