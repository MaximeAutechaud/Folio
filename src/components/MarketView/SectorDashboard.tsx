import { useState } from 'react';
import { useSectorPerfs, type SectorPerf } from '../../hooks/useSectorData';
import { MacroScore } from './MacroScore';
import { SectorDrawer } from './SectorDrawer';
import styles from './SectorDashboard.module.css';

type Period = '1W' | '1M' | '3M';

function fmtPerf(n: number | null): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className={styles.legend}>
      <span className={styles.legendItem}>
        <span className={styles.legendSample + ' ' + styles.pos}>+19.5%</span>
        <span className={styles.legendDesc}>perf. ETF sur la période</span>
      </span>
      <span className={styles.legendSep}>·</span>
      <span className={styles.legendItem}>
        <span className={styles.legendSample + ' ' + styles.pos}>+12.6% vs SPY</span>
        <span className={styles.legendDesc}>écart vs S&P 500 — positif = surperformance</span>
      </span>
      <span className={styles.legendSep}>·</span>
      <span className={styles.legendItem}>
        <span className={styles.legendSample}>↑↑ / → / ↓↓</span>
        <span className={styles.legendDesc}>momentum : rythme relatif cette semaine vs période</span>
      </span>
    </div>
  );
}

// ── Sector card ──────────────────────────────────────────────────────────────

function MomentumBadge({ value }: { value: SectorPerf['momentum'] }) {
  const label =
    value === 'accelerating' ? '↑↑ accélère' : value === 'decelerating' ? '↓↓ ralentit' : '→ stable';
  const cls =
    value === 'accelerating' ? styles.momUp : value === 'decelerating' ? styles.momDown : styles.momNeutral;
  return <span className={`${styles.momBadge} ${cls}`}>{label}</span>;
}

function SectorCard({
  data,
  rank,
  selected,
  onClick,
}: {
  data: SectorPerf;
  rank: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { sector, etfPerf, relPerf, momentum } = data;
  const perfPos = (etfPerf ?? 0) >= 0;
  const relPos = (relPerf ?? 0) >= 0;

  return (
    <div
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      onClick={onClick}
    >
      <div className={styles.colorBar} style={{ background: sector.color }} />
      <div className={styles.cardContent}>
        <div className={styles.cardTop}>
          <span className={styles.rank}>#{rank}</span>
          <span className={styles.sectorName}>{sector.name}</span>
          <span className={styles.etfBadge}>{sector.etf}</span>
        </div>

        <div className={styles.perfRow}>
          <span className={`${styles.perfAbs} ${perfPos ? styles.pos : styles.neg}`}>
            {fmtPerf(etfPerf)}
          </span>
          <span className={`${styles.perfRel} ${relPos ? styles.pos : styles.neg}`}>
            {fmtPerf(relPerf)} vs SPY
          </span>
        </div>

        <div className={styles.cardBottom}>
          <MomentumBadge value={momentum} />
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function SectorDashboard() {
  const [period, setPeriod] = useState<Period>('1M');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: sectors = [], isFetching } = useSectorPerfs(period);

  function handleCardClick(id: string) {
    setSelectedId(prev => (prev === id ? null : id));
  }

  return (
    <div className={styles.root}>
      <MacroScore />

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
        <span className={styles.hint}>
          {isFetching ? 'Chargement…' : 'trié par perf. relative vs SPY'}
        </span>
      </div>

      <Legend />

      <div className={styles.grid}>
        {sectors.map((s, i) => (
          <SectorCard
            key={s.sector.id}
            data={s}
            rank={i + 1}
            selected={selectedId === s.sector.id}
            onClick={() => handleCardClick(s.sector.id)}
          />
        ))}
      </div>

      {selectedId && (
        <SectorDrawer
          sectorId={selectedId}
          initialPeriod={period}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
