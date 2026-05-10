import { useQuery } from '@tanstack/react-query';
import { fetchNarrativeKeywords } from '../../lib/db';
import { computeNarrativeMetrics, type TickerIndicators } from '../../lib/indicators';
import { computeScoreBreakdown, scoreToPhase, PHASES } from '../../lib/score';
import type { Narrative, NarrativeTicker } from '../../types';
import type { SentimentRecord } from '../../hooks/useSentiment';
import type { FundamentalsRecord } from '../../hooks/useFundamentals';
import styles from './NarrativeDrawer.module.css';

interface Props {
  narrative: Narrative;
  tickers: NarrativeTicker[];
  indicators: Record<string, TickerIndicators>;
  sentimentRecord: SentimentRecord | null;
  fundamentalsRecord: FundamentalsRecord | null;
  onClose: () => void;
}

function rsiClass(rsi: number, s: Record<string, string>): string {
  if (rsi >= 75) return s.rsiHot;
  if (rsi <= 30) return s.rsiCold;
  return s.rsiNeutral;
}

function BreakdownRow({
  label, weight, score, detail, na,
}: {
  label: string; weight: number; score: number | null; detail?: string; na?: boolean;
}) {
  return (
    <div className={styles.bRow}>
      <div className={styles.bHeader}>
        <span className={styles.bLabel}>
          {label} <span className={styles.bWeight}>{weight}%</span>
        </span>
        <span className={styles.bScore}>{score != null ? score : '—'}</span>
      </div>
      <div className={styles.barTrack}>
        {score != null && <div className={styles.barFill} style={{ width: `${score}%` }} />}
      </div>
      {(detail || na) && (
        <span className={styles.bDetail}>{na ? 'Non configuré' : detail}</span>
      )}
    </div>
  );
}

export function NarrativeDrawer({ narrative, tickers, indicators, sentimentRecord, fundamentalsRecord, onClose }: Props) {
  const metrics = computeNarrativeMetrics(tickers.map(t => t.ticker), indicators, narrative.ref_etf);
  const breakdown = computeScoreBreakdown({
    momentum30d:       metrics.momentum30d,
    pctAboveMA200:     metrics.pctAboveMA200,
    avgRSI:            metrics.avgRSI,
    sentimentScore:    sentimentRecord?.score ?? null,
    fundamentalsScore: fundamentalsRecord?.score ?? null,
  });
  const phase = scoreToPhase(breakdown.composite);
  const phaseConf = PHASES[phase];

  const { data: keywords = [] } = useQuery({
    queryKey: ['narrative-keywords-detail', narrative.id],
    queryFn: () => fetchNarrativeKeywords(narrative.id),
  });

  const sentimentRatio = sentimentRecord && sentimentRecord.volume_prev > 0
    ? (sentimentRecord.volume_7d / sentimentRecord.volume_prev).toFixed(1)
    : null;

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.drawer}>

        {/* ── Header ───────────────────────────────── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.colorDot} style={{ background: narrative.color }} />
            <div className={styles.headerTitles}>
              <span className={styles.name}>{narrative.name}</span>
              {narrative.ref_etf && <span className={styles.refEtf}>ETF ref : {narrative.ref_etf}</span>}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* ── Phase + gauge ────────────────────────── */}
        <div className={styles.scoreHeader}>
          <span
            className={styles.phaseBadge}
            style={{ color: phaseConf.color, background: `${phaseConf.color}22` }}
          >
            {phaseConf.label}
          </span>
          <div className={styles.gaugeWrap}>
            <div className={styles.gaugeTrack}>
              <div className={styles.gaugeMarker} style={{ left: `${breakdown.composite}%` }} />
            </div>
            <span className={styles.gaugeScore} style={{ color: phaseConf.color }}>
              {breakdown.composite}/100
            </span>
          </div>
        </div>

        {narrative.description && (
          <p className={styles.description}>{narrative.description}</p>
        )}

        <div className={styles.body}>

          {/* ── Score breakdown ───────────────────── */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Décomposition du score</span>
            <div className={styles.breakdown}>
              <BreakdownRow
                label="Momentum"
                weight={30}
                score={breakdown.momentum.score}
                detail={metrics.momentum30d != null
                  ? `Perf. moy. 30j : ${metrics.momentum30d >= 0 ? '+' : ''}${metrics.momentum30d.toFixed(1)}%`
                  : undefined}
              />
              <BreakdownRow
                label="Technique"
                weight={20}
                score={breakdown.technical.score}
                detail={[
                  `Source : ${metrics.sourceLabel}`,
                  breakdown.technical.pctAboveMA200 != null && `${Math.round(breakdown.technical.pctAboveMA200)}% > MA200`,
                  breakdown.technical.avgRSI != null && `RSI moy. ${Math.round(breakdown.technical.avgRSI)}`,
                ].filter(Boolean).join(' · ') || undefined}
              />
              <BreakdownRow
                label="Sentiment"
                weight={25}
                score={breakdown.sentiment.score}
                detail={sentimentRecord
                  ? `${sentimentRecord.volume_7d} art. cette semaine · ${sentimentRecord.volume_prev} sem. préc.${sentimentRatio ? ` · ratio ${sentimentRatio}×` : ''}`
                  : undefined}
                na={!sentimentRecord}
              />
              <BreakdownRow
                label="Fondamentaux"
                weight={25}
                score={breakdown.fundamentals.score}
                detail={fundamentalsRecord
                  ? [
                      fundamentalsRecord.recommendation_mean != null && `Moy. ${fundamentalsRecord.recommendation_mean.toFixed(1)}/5`,
                      fundamentalsRecord.buy_count  > 0 && `${fundamentalsRecord.buy_count} Buy`,
                      fundamentalsRecord.hold_count > 0 && `${fundamentalsRecord.hold_count} Hold`,
                      fundamentalsRecord.sell_count > 0 && `${fundamentalsRecord.sell_count} Sell`,
                    ].filter(Boolean).join(' · ') || undefined
                  : undefined}
                na={!fundamentalsRecord}
              />
            </div>
            {breakdown.availableWeight < 0.75 && (
              <p className={styles.noteText}>
                Score calculé sur {Math.round(breakdown.availableWeight * 100)}% des composantes
              </p>
            )}
          </div>

          {/* ── Tickers ──────────────────────────── */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Tickers ({tickers.length})</span>
            <div className={styles.tickerTable}>
              {tickers.map(t => {
                const ind = indicators[t.ticker];
                return (
                  <div key={t.id} className={styles.tickerRow}>
                    <div className={styles.tickerLeft}>
                      <span className={styles.tickerSymbol}>{t.ticker}</span>
                      <span className={styles.tickerName}>{t.name}</span>
                    </div>
                    <div className={styles.tickerRight}>
                      {ind?.rsi14 != null && (
                        <span className={`${styles.badge} ${rsiClass(ind.rsi14, styles)}`}>
                          RSI {Math.round(ind.rsi14)}
                        </span>
                      )}
                      {ind?.priceChange30d != null && (
                        <span className={`${styles.badge} ${ind.priceChange30d >= 0 ? styles.badgeGreen : styles.badgeRed}`}>
                          {ind.priceChange30d >= 0 ? '+' : ''}{ind.priceChange30d.toFixed(1)}%
                        </span>
                      )}
                      {ind?.ma200 != null && ind?.currentPrice != null && (
                        <span className={`${styles.badge} ${ind.currentPrice > ind.ma200 ? styles.badgeGreen : styles.badgeRed}`}>
                          {ind.currentPrice > ind.ma200 ? '↑' : '↓'} MA200
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Keywords ─────────────────────────── */}
          {keywords.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionTitle}>Keywords sentiment</span>
              <div className={styles.keywords}>
                {keywords.map(k => (
                  <span key={k.id} className={styles.keyword}>{k.keyword}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── Mainstream alert ─────────────────── */}
          {sentimentRecord?.mainstream === 1 && (
            <div className={styles.mainstreamAlert}>
              ⚠ Mainstream media flag — 30+ articles en 7 jours
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
