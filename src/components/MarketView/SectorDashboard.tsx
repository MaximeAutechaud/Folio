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
        <span className={styles.legendSample + ' ' + styles.pos}>+12.6% vs S&P 500</span>
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
      <polyline
        points={pts}
        fill="none"
        stroke={positive ? '#3fb950' : '#f85149'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

// ── Sector card ──────────────────────────────────────────────────────────────

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

function MomentumBadge({ value }: { value: SectorPerf['momentum'] }) {
  const label =
    value === 'accelerating' ? '↑↑ accélère' : value === 'decelerating' ? '↓↓ ralentit' : '→ stable';
  const cls =
    value === 'accelerating' ? styles.momUp : value === 'decelerating' ? styles.momDown : styles.momNeutral;
  return <span className={`${styles.momBadge} ${cls}`}>{label}</span>;
}

function distFromHigh(history: { time: number; value: number }[]): number | null {
  if (history.length < 2) return null;
  const high = Math.max(...history.map(p => p.value));
  const current = history[history.length - 1].value;
  if (!high) return null;
  return ((current - high) / high) * 100;
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
  const { sector, etfPerf, relPerf, momentum, rsi, history } = data;
  const perfPos = (etfPerf ?? 0) >= 0;
  const relPos = (relPerf ?? 0) >= 0;
  const dist = distFromHigh(history);

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

        <div className={styles.cardBottom}>
          <MomentumBadge value={momentum} />
          <RsiBadge rsi={rsi} />
          <Sparkline history={history} positive={(etfPerf ?? 0) >= 0} />
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
          {isFetching ? 'Chargement…' : 'trié par perf. relative vs S&P 500'}
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
