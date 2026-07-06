import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNarrativeEtfPerfs, type NarrativeEtfPerf } from '../../hooks/useNarrativeEtfPerfs';
import { useMacroScore } from '../../hooks/useMacroScore';
import { scoreEtf } from '../../hooks/useAlertEngine';
import { fetchNarratives, toggleNarrativeActive } from '../../lib/db';
import { SECTORS } from '../../lib/sectors';
import type { SectorScore, SectorSignal } from '../../lib/scoring';
import { NarrativeDrawer } from './NarrativeDrawer';
import { NarrativeForm } from './NarrativeForm';
import type { Narrative } from '../../types';
import styles from './NarrativeDashboard.module.css';

type Period = '1W' | '1M' | '3M';

function fmtPerf(n: number | null): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ history, positive }: { history: { time: number; value: number }[]; positive: boolean }) {
  if (history.length < 2) return null;
  const values = history.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 72; const H = 28; const pad = 2;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - min) / range) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill="none"
        stroke={positive ? '#3fb950' : '#f85149'}
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function distFromHigh(history: { time: number; value: number }[]): number | null {
  if (history.length < 2) return null;
  const high = Math.max(...history.map(p => p.value));
  const current = history[history.length - 1].value;
  if (!high) return null;
  return ((current - high) / high) * 100;
}

// ── Badges (mêmes conventions que SectorDashboard) ────────────────────────────

function RsiBadge({ rsi }: { rsi: number | null }) {
  if (rsi == null) return null;
  const cls =
    rsi < 30 ? styles.rsiOversold :
    rsi < 45 ? styles.rsiLow :
    rsi > 70 ? styles.rsiOverbought :
    rsi > 55 ? styles.rsiHigh :
    styles.rsiNeutral;
  const tip =
    rsi < 30 ? 'Survendu — potentiel rebond' :
    rsi < 45 ? 'RSI bas — zone d\'entrée favorable' :
    rsi > 70 ? 'Suracheté — momentum à ne pas chasser' :
    rsi > 55 ? 'RSI élevé — surveiller un essoufflement' :
    'RSI neutre';
  return (
    <span className={`${styles.rsiBadge} ${cls}`} data-tooltip={tip}>
      RSI {rsi}
    </span>
  );
}

function MomentumBadge({ value }: { value: NarrativeEtfPerf['momentum'] }) {
  const label = value === 'accelerating' ? '↑↑ accélère' : value === 'decelerating' ? '↓↓ ralentit' : '→ stable';
  const cls   = value === 'accelerating' ? styles.momUp : value === 'decelerating' ? styles.momDown : styles.momNeutral;
  return <span className={`${styles.momBadge} ${cls}`}>{label}</span>;
}

const SIGNAL_LABEL: Record<NonNullable<SectorSignal>, string> = {
  reversal:     '↗ Retournement détecté',
  exhaustion:   '↘ Potentiel essoufflement',
  accelerating: '↑ Accélération en cours',
  dip:          '◎ Dip dans tendance',
};

function ScoreBadge({ score }: { score: SectorScore }) {
  const cls =
    score.label === 'hot'     ? styles.scoreBadgeHot  :
    score.label === 'warming' ? styles.scoreBadgeWarm :
    score.label === 'cooling' ? styles.scoreBadgeCool :
    styles.scoreBadgeNeutral;

  const signalLine = score.signal ? SIGNAL_LABEL[score.signal] : '';

  const ma50Line =
    score.ma50Above === true  ? 'MA50  ▲ au-dessus' :
    score.ma50Above === false ? 'MA50  ▼ en-dessous' :
    '';

  const tip = [
    signalLine,
    signalLine ? '──────────────────' : '',
    `RS Slope   ${score.rsSlope}/100  ×40%`,
    `RSI Entry  ${score.rsiEntry}/100  ×25%`,
    `Dip        ${score.drawdown}/100  ×20%`,
    `Macro      ${score.macroAlign}/100  ×15%`,
    '──────────────────',
    'Signaux narratives non calibrés',
    '(fiabilité mesurée par le tracking)',
    ma50Line ? '──────────────────' : '',
    ma50Line,
  ].filter(Boolean).join('\n');

  const prefix =
    score.label === 'hot'     ? '◆ ' :
    score.label === 'warming' ? '◈ ' :
    '';

  return (
    <span className={`${styles.scoreBadge} ${cls}`} data-tooltip={tip}>
      {prefix}{score.total}
    </span>
  );
}

// ── Narrative card ────────────────────────────────────────────────────────────

function NarrativeCard({
  data, score, parentEtf, selected, onClick,
}: {
  data: NarrativeEtfPerf;
  score: SectorScore;
  parentEtf: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const { narrative, etfPerf, relPerf, relPerfVsParent, momentum, rsi, history } = data;
  const perfPos = (etfPerf ?? 0) >= 0;
  const relPos  = (relPerf ?? 0) >= 0;
  const vsParentPos = (relPerfVsParent ?? 0) >= 0;
  const dist = distFromHigh(history);

  const glowClass =
    score.label === 'hot'     ? styles.cardHot     :
    score.label === 'warming' ? styles.cardWarming :
    '';

  return (
    <div
      className={`${styles.card} ${selected ? styles.cardSelected : ''} ${glowClass}`}
      onClick={onClick}
    >
      <div className={styles.colorBar} style={{ background: narrative.color }} />
      <div className={styles.cardContent}>

        <div className={styles.cardTop}>
          <span className={styles.name}>{narrative.name}</span>
          <span className={styles.sourceBadge}>{narrative.ref_etf}</span>
          {dist != null && (
            <span
              className={dist >= -1 ? styles.distAtHigh : styles.distFromHigh}
              data-tooltip={`${dist >= -1 ? 'Proche du' : 'Distance du'} plus haut sur la période`}
            >
              {dist >= -1 ? '▲ top' : `${dist.toFixed(1)}%`}
            </span>
          )}
        </div>

        <div className={styles.perfRow}>
          <span className={`${styles.perfAbs} ${perfPos ? styles.pos : styles.neg}`}>
            {fmtPerf(etfPerf)}
          </span>
          <span className={`${styles.perfRel} ${relPos ? styles.pos : styles.neg}`}>
            {fmtPerf(relPerf)} vs S&P 500
          </span>
        </div>

        {parentEtf && relPerfVsParent != null && (
          <div
            className={`${styles.vsParent} ${vsParentPos ? styles.pos : styles.neg}`}
            data-tooltip="Écart vs l'ETF du secteur parent — le thème tire-t-il son secteur ?"
          >
            {fmtPerf(relPerfVsParent)} vs {parentEtf}
          </div>
        )}

        <div className={styles.cardBottom}>
          <MomentumBadge value={momentum} />
          <RsiBadge rsi={rsi} />
          <ScoreBadge score={score} />
          <Sparkline history={history} positive={perfPos} />
        </div>

      </div>
    </div>
  );
}

// ── Library panel ─────────────────────────────────────────────────────────────

function LibraryPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: allNarratives = [] } = useQuery({
    queryKey: ['narratives-all'],
    queryFn: () => fetchNarratives(false),
  });

  const presets = allNarratives.filter(n => n.is_preset === 1);

  async function handleToggle(n: Narrative) {
    await toggleNarrativeActive(n.id, n.active === 0);
    queryClient.invalidateQueries({ queryKey: ['narratives-all'] });
    queryClient.invalidateQueries({ queryKey: ['narrative-etf-perfs'] });
    queryClient.invalidateQueries({ queryKey: ['narrative-pools'] });
    queryClient.invalidateQueries({ queryKey: ['narratives'] });
  }

  const bySector = SECTORS.map(s => ({
    sector: s,
    items: presets.filter(n => n.parent_sector === s.id),
  })).filter(g => g.items.length > 0);

  const unassigned = presets.filter(n => !n.parent_sector);

  return (
    <div className={styles.library}>
      <div className={styles.libraryHeader}>
        <span>Bibliothèque de narratives</span>
        <button className={styles.libCloseBtn} onClick={onClose}>✕</button>
      </div>
      <p className={styles.libraryHint}>
        Activez les narratives à afficher. Celles avec un ETF sont scorées ici ;
        celles sans ETF deviennent des pools de candidats dans le drawer de leur secteur.
      </p>
      <div className={styles.libraryList}>
        {bySector.map(({ sector, items }) => (
          <div key={sector.id} className={styles.libGroup}>
            <span className={styles.libGroupLabel} style={{ color: sector.color }}>
              {sector.name}
            </span>
            {items.map(n => (
              <label key={n.id} className={styles.libItem}>
                <span className={styles.libDot} style={{ background: n.color }} />
                <span className={styles.libName}>{n.name}</span>
                {n.ref_etf
                  ? <span className={styles.libEtf}>{n.ref_etf}</span>
                  : <span className={styles.libPool}>pool</span>}
                <input
                  type="checkbox"
                  className={styles.libCheck}
                  checked={n.active === 1}
                  onChange={() => handleToggle(n)}
                />
              </label>
            ))}
          </div>
        ))}
        {unassigned.length > 0 && (
          <div className={styles.libGroup}>
            <span className={styles.libGroupLabel}>Sans secteur</span>
            {unassigned.map(n => (
              <label key={n.id} className={styles.libItem}>
                <span className={styles.libDot} style={{ background: n.color }} />
                <span className={styles.libName}>{n.name}</span>
                <input
                  type="checkbox"
                  className={styles.libCheck}
                  checked={n.active === 1}
                  onChange={() => handleToggle(n)}
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function NarrativeDashboard() {
  const queryClient = useQueryClient();
  const [period, setPeriod]           = useState<Period>('1M');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [formNarrative, setFormNarrative] = useState<Narrative | null | undefined>(undefined);

  const { data: perfs = [], isFetching } = useNarrativeEtfPerfs(period);
  const { data: macroData } = useMacroScore();

  const scored = useMemo(() => {
    const macro = macroData ?? { score: 50, trend: 'flat' as const };
    return perfs.map(p => ({ ...p, score: scoreEtf(p, p.macroProfile, macro) }));
  }, [perfs, macroData]);

  const filtered = sectorFilter === 'all'
    ? scored
    : scored.filter(p => p.narrative.parent_sector === sectorFilter);

  // Groupes par secteur parent, ordonnés par la meilleure narrative du groupe
  // (les thèmes du secteur le plus chaud d'abord). Cartes triées par relPerf.
  const groups = useMemo(() => {
    const bySector = new Map<string, typeof filtered>();
    for (const p of filtered) {
      const key = p.narrative.parent_sector ?? 'none';
      (bySector.get(key) ?? bySector.set(key, []).get(key)!).push(p);
    }
    return [...bySector.entries()]
      .map(([key, items]) => ({
        sector: key !== 'none' ? SECTORS.find(s => s.id === key) ?? null : null,
        items, // déjà triés par relPerf (tri du hook préservé par filter)
        best: Math.max(...items.map(i => i.relPerf ?? -999)),
      }))
      .sort((a, b) => b.best - a.best);
  }, [filtered]);

  const selectedPerf = scored.find(p => p.narrative.id === selectedId);

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ['narrative-etf-perfs'] });
    queryClient.invalidateQueries({ queryKey: ['narrative-pools'] });
    queryClient.invalidateQueries({ queryKey: ['narratives'] });
    queryClient.invalidateQueries({ queryKey: ['narratives-all'] });
    setFormNarrative(undefined);
  }

  async function handleDelete(n: Narrative) {
    const { deleteNarrative } = await import('../../lib/db');
    if (!window.confirm(`Supprimer "${n.name}" ?`)) return;
    await deleteNarrative(n.id);
    queryClient.invalidateQueries({ queryKey: ['narrative-etf-perfs'] });
    queryClient.invalidateQueries({ queryKey: ['narrative-pools'] });
    queryClient.invalidateQueries({ queryKey: ['narratives-all'] });
    if (selectedId === n.id) setSelectedId(null);
  }

  // Sectors that have at least one active ETF narrative
  const activeSectorIds = new Set(perfs.map(p => p.narrative.parent_sector).filter(Boolean));

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.periods}>
          {(['1W', '1M', '3M'] as Period[]).map(p => (
            <button
              key={p}
              className={`${styles.periodBtn} ${period === p ? styles.periodActive : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>

        <select
          className={styles.sectorSelect}
          value={sectorFilter}
          onChange={e => setSectorFilter(e.target.value)}
        >
          <option value="all">Tous les secteurs</option>
          {SECTORS.filter(s => activeSectorIds.has(s.id)).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <span className={styles.hint}>
          {isFetching
            ? 'Chargement…'
            : `${filtered.length} narrative${filtered.length !== 1 ? 's' : ''}-ETF · groupées par secteur, triées par perf. relative`}
        </span>

        <div className={styles.actions}>
          <button
            className={`${styles.libBtn} ${showLibrary ? styles.libBtnActive : ''}`}
            onClick={() => setShowLibrary(s => !s)}
          >
            Bibliothèque
          </button>
          <button className={styles.addBtn} onClick={() => setFormNarrative(null)}>
            + Narrative
          </button>
        </div>
      </div>

      {showLibrary && <LibraryPanel onClose={() => setShowLibrary(false)} />}

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSample + ' ' + styles.pos}>+12.4%</span>
          <span className={styles.legendDesc}>perf. ETF sur la période</span>
        </span>
        <span className={styles.legendSep}>·</span>
        <span className={styles.legendItem}>
          <span className={styles.legendSample + ' ' + styles.pos}>+3.2% vs VGT</span>
          <span className={styles.legendDesc}>écart vs l'ETF du secteur parent</span>
        </span>
        <span className={styles.legendSep}>·</span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSample} ${styles.scoreBadgeHot}`}>74</span>
          <span className={styles.legendDesc}>score opportunité (même pipeline que les secteurs)</span>
        </span>
      </div>

      {groups.map(({ sector, items }) => (
        <div key={sector?.id ?? 'none'} className={styles.group}>
          <div className={styles.groupHeader} style={sector ? { color: sector.color } : undefined}>
            {sector?.name ?? 'Sans secteur'}
            {sector && <span className={styles.groupEtf}>{sector.etf}</span>}
          </div>
          <div className={styles.grid}>
            {items.map(p => (
              <NarrativeCard
                key={p.narrative.id}
                data={p}
                score={p.score}
                parentEtf={sector?.etf ?? null}
                selected={selectedId === p.narrative.id}
                onClick={() => setSelectedId(prev => prev === p.narrative.id ? null : p.narrative.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && !isFetching && (
        <div className={styles.empty}>
          Aucune narrative-ETF active — ouvrez la Bibliothèque pour en activer.
          Les narratives sans ETF vivent dans le drawer de leur secteur (onglet Secteurs).
        </div>
      )}

      {selectedId != null && selectedPerf && (
        <NarrativeDrawer
          narrative={selectedPerf.narrative}
          tickers={selectedPerf.tickers}
          rsTrend={[selectedPerf.relPerf3M, selectedPerf.relPerf1M, selectedPerf.relPerf1W]}
          vsParentTrend={[selectedPerf.relPerfVsParent3M, selectedPerf.relPerfVsParent1M, selectedPerf.relPerfVsParent1W]}
          parentEtf={SECTORS.find(s => s.id === selectedPerf.narrative.parent_sector)?.etf ?? null}
          score={selectedPerf.score}
          initialPeriod={period}
          onEdit={() => setFormNarrative(selectedPerf.narrative)}
          onDelete={() => handleDelete(selectedPerf.narrative)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {formNarrative !== undefined && (
        <NarrativeForm
          narrative={formNarrative ?? undefined}
          onClose={() => setFormNarrative(undefined)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
