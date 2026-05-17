import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNarrativePerfs, type NarrativePerf } from '../../hooks/useNarrativePerfs';
import { fetchNarratives, toggleNarrativeActive } from '../../lib/db';
import { SECTORS } from '../../lib/sectors';
import { NarrativeDrawer } from './NarrativeDrawer';
import { NarrativeForm } from './NarrativeForm';
import type { Narrative } from '../../types';
import styles from './NarrativeDashboard.module.css';

type Period = '1W' | '1M' | '3M';

function fmtPerf(n: number | null): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ── RS Trend ─────────────────────────────────────────────────────────────────

function RsTrend({ trend }: { trend: NarrativePerf['rsTrend'] }) {
  const labels = ['3M', '1M', '1W'];
  return (
    <div className={styles.rsTrend}>
      <span className={styles.rsLabel}>RS</span>
      {trend.map((v, i) => (
        <span
          key={i}
          className={`${styles.rsDot} ${v == null ? styles.rsDotNull : v >= 0 ? styles.rsDotPos : styles.rsDotNeg}`}
          title={`${labels[i]}: ${fmtPerf(v)} vs S&P 500`}
        >
          {v == null ? '·' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'}
          <span className={styles.rsSpan}>{labels[i]}</span>
        </span>
      ))}
    </div>
  );
}

// ── Momentum badge ────────────────────────────────────────────────────────────

function MomentumBadge({ value }: { value: NarrativePerf['momentum'] }) {
  const label = value === 'accelerating' ? '↑↑ accélère' : value === 'decelerating' ? '↓↓ ralentit' : '→ stable';
  const cls   = value === 'accelerating' ? styles.momUp : value === 'decelerating' ? styles.momDown : styles.momNeutral;
  return <span className={`${styles.momBadge} ${cls}`}>{label}</span>;
}

// ── Narrative card ────────────────────────────────────────────────────────────

function NarrativeCard({
  data, rank, selected, onClick,
}: {
  data: NarrativePerf;
  rank: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { narrative, basketPerf, relPerf, momentum, rsTrend, source, lowConfidence } = data;
  const perfPos = (basketPerf ?? 0) >= 0;
  const relPos  = (relPerf ?? 0) >= 0;

  return (
    <div
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      onClick={onClick}
    >
      <div className={styles.colorBar} style={{ background: narrative.color }} />
      <div className={styles.cardContent}>

        <div className={styles.cardTop}>
          <span className={styles.rank}>#{rank}</span>
          <span className={styles.name}>{narrative.name}</span>
          {source.type === 'etf'
            ? <span className={styles.sourceBadge}>{source.label}</span>
            : <span className={`${styles.sourceBadge} ${styles.sourceBadgeBasket}`}>Panier {source.count}T</span>
          }
          {lowConfidence && (
            <span className={styles.lowConf} title="Moins de 5 tickers — signal momentum peu fiable">⚠</span>
          )}
        </div>

        <div className={styles.perfRow}>
          <span className={`${styles.perfAbs} ${perfPos ? styles.pos : styles.neg}`}>
            {fmtPerf(basketPerf)}
          </span>
          <span className={`${styles.perfRel} ${relPos ? styles.pos : styles.neg}`}>
            {fmtPerf(relPerf)} vs S&P 500
          </span>
        </div>

        <RsTrend trend={rsTrend} />

        <div className={styles.cardBottom}>
          <MomentumBadge value={momentum} />
          {narrative.parent_sector && (
            <span className={styles.sectorTag}>
              {SECTORS.find(s => s.id === narrative.parent_sector)?.name ?? narrative.parent_sector}
            </span>
          )}
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
    queryClient.invalidateQueries({ queryKey: ['narrative-perfs'] });
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
        Activez les narratives à afficher dans le dashboard. Les narratives custom sont toujours visibles.
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
                {n.ref_etf && <span className={styles.libEtf}>{n.ref_etf}</span>}
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

  const { data: perfs = [], isFetching } = useNarrativePerfs(period);

  const filtered = sectorFilter === 'all'
    ? perfs
    : perfs.filter(p => p.narrative.parent_sector === sectorFilter);

  const selectedPerf = filtered.find(p => p.narrative.id === selectedId);

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ['narrative-perfs'] });
    queryClient.invalidateQueries({ queryKey: ['narratives'] });
    queryClient.invalidateQueries({ queryKey: ['narratives-all'] });
    setFormNarrative(undefined);
  }

  async function handleDelete(n: Narrative) {
    const { deleteNarrative } = await import('../../lib/db');
    if (!window.confirm(`Supprimer "${n.name}" ?`)) return;
    await deleteNarrative(n.id);
    queryClient.invalidateQueries({ queryKey: ['narrative-perfs'] });
    queryClient.invalidateQueries({ queryKey: ['narratives-all'] });
    if (selectedId === n.id) setSelectedId(null);
  }

  // Sectors that have at least one active narrative
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
          {isFetching ? 'Chargement…' : `${filtered.length} narrative${filtered.length !== 1 ? 's' : ''} · trié par perf. relative vs S&P 500`}
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
          <span className={styles.legendDesc}>perf. sur la période</span>
        </span>
        <span className={styles.legendSep}>·</span>
        <span className={styles.legendItem}>
          <span className={styles.legendSample + ' ' + styles.pos}>+8.1% vs S&P 500</span>
          <span className={styles.legendDesc}>perf. relative</span>
        </span>
        <span className={styles.legendSep}>·</span>
        <span className={styles.legendItem}>
          <span className={styles.legendSample}>RS 3M · 1M · 1W</span>
          <span className={styles.legendDesc}>tendance de la surperf. relative</span>
        </span>
      </div>

      <div className={styles.grid}>
        {filtered.map((p, i) => (
          <NarrativeCard
            key={p.narrative.id}
            data={p}
            rank={i + 1}
            selected={selectedId === p.narrative.id}
            onClick={() => setSelectedId(prev => prev === p.narrative.id ? null : p.narrative.id)}
          />
        ))}
        {filtered.length === 0 && !isFetching && (
          <div className={styles.empty}>
            Aucune narrative active — ouvrez la Bibliothèque pour en activer.
          </div>
        )}
      </div>

      {selectedId != null && selectedPerf && (
        <NarrativeDrawer
          narrative={selectedPerf.narrative}
          tickers={selectedPerf.tickers}
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
