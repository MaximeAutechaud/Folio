import { useCryptoScreener, type ScreenerEntryWithStreak } from '../../hooks/useCryptoScreener';
import styles from './CryptoScreener.module.css';

const CONFIRMED_STREAK = 3;

function fmtPct(n: number | null): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function fmtUsd(n: number): string {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(1)} Md`
       : n >= 1e6 ? `$${(n / 1e6).toFixed(0)} M`
       :            `$${n.toFixed(0)}`;
}

function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(3)}`;
}

function RsiBadge({ rsi }: { rsi: number | null }) {
  if (rsi == null) return <span className={styles.rsiBadge} data-tooltip="Historique insuffisant">RSI —</span>;
  const cls =
    rsi < 30 ? styles.rsiOversold :
    rsi < 45 ? styles.rsiLow :
    rsi > 70 ? styles.rsiOverbought :
    rsi > 55 ? styles.rsiHigh :
    styles.rsiNeutral;
  return <span className={`${styles.rsiBadge} ${cls}`} data-tooltip="RSI(14) horaire, 7 derniers jours">RSI {rsi}</span>;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 72; const H = 26; const pad = 2;
  const positive = values[values.length - 1] >= values[0];

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

function HeatBadge({ heat }: { heat: number }) {
  const cls =
    heat >= 70 ? styles.heatHot :
    heat >= 55 ? styles.heatWarm :
    heat <= 30 ? styles.heatCool :
    styles.heatNeutral;
  return <span className={`${styles.heatBadge} ${cls}`}>{heat}</span>;
}

function StreakBadge({ streak }: { streak: number }) {
  const cls =
    streak >= CONFIRMED_STREAK ? styles.streakConfirmed :
    streak === 2               ? styles.streakBuilding :
    styles.streakNeutral;
  const tip =
    streak >= CONFIRMED_STREAK
      ? `Présente ${streak} jours consécutifs dans le top ${15} — tendance plus crédible qu'une lecture isolée`
      : `${streak || 0} jour${streak > 1 ? 's' : ''} consécutif${streak > 1 ? 's' : ''} dans le top 15 — sous le seuil de confirmation (${CONFIRMED_STREAK} jours)`;
  return (
    <span className={`${styles.streakBadge} ${cls}`} data-tooltip={tip}>
      {streak >= CONFIRMED_STREAK ? '🔥 ' : ''}{streak}j
    </span>
  );
}

function Row({ entry, rank }: { entry: ScreenerEntryWithStreak; rank: number }) {
  const { coin, heat, rsi, volRank, streak } = entry;
  return (
    <div className={styles.row}>
      <span className={styles.rank}>#{rank}</span>
      <div className={styles.identity}>
        <span className={styles.symbol}>{coin.symbol}</span>
        <span className={styles.name}>{coin.name}</span>
      </div>
      <span className={styles.price}>{fmtPrice(coin.price)}</span>
      <span className={`${styles.perf} ${(coin.perf24h ?? 0) >= 0 ? styles.pos : styles.neg}`}>
        {fmtPct(coin.perf24h)}
      </span>
      <span className={`${styles.perf} ${styles.perfMuted} ${(coin.perf7d ?? 0) >= 0 ? styles.pos : styles.neg}`}>
        {fmtPct(coin.perf7d)}
      </span>
      <RsiBadge rsi={rsi} />
      <span className={styles.volRank} data-tooltip="Rang percentile du ratio volume 24h / capitalisation, au sein du lot">
        vol {volRank}
      </span>
      <span className={styles.mcap}>{fmtUsd(coin.marketCap)}</span>
      <Sparkline values={coin.sparkline7d} />
      <HeatBadge heat={heat} />
      <StreakBadge streak={streak} />
    </div>
  );
}

export function CryptoScreener() {
  const { data, isFetching, isError, error } = useCryptoScreener();
  // Streak d'abord : une piece qui persiste plusieurs jours dans le top passe
  // avant un pic isole du jour, meme mieux score aujourd'hui.
  const ranked = [...(data ?? [])].sort((a, b) => b.streak - a.streak || b.heat - a.heat);
  const top = ranked.slice(0, 25);
  const confirmedCount = top.filter((e) => e.streak >= CONFIRMED_STREAK).length;

  return (
    <div className={styles.root}>
      <div className={styles.disclaimer}>
        <span className={styles.disclaimerIcon}>⚠</span>
        Expérimental — score "chaud" non calibré, jamais validé en forward. Un score isolé est du
        bruit : le badge streak (🔥 dès {CONFIRMED_STREAK} jours) compte les jours consécutifs
        passés dans le top 15 quotidien — il ne peut se construire qu'au fil des ouvertures de
        l'app, donc les premiers jours il restera à 1j pour tout le monde.
      </div>

      <div className={styles.toolbar}>
        <span className={styles.hint}>
          {isFetching
            ? 'Chargement…'
            : `top 100 par capitalisation — ${top.length} affichées, triées par streak puis score` +
              (confirmedCount > 0 ? ` · ${confirmedCount} tendance(s) confirmée(s)` : '')}
        </span>
      </div>

      {isError && (
        <div className={styles.errorBox}>
          {error instanceof Error ? error.message : 'Erreur inconnue'}
        </div>
      )}

      {top.length > 0 && (
        <div className={styles.list}>
          <div className={styles.headerRow}>
            <span className={styles.rank}>#</span>
            <span className={styles.identity}>Actif</span>
            <span className={styles.price}>Prix</span>
            <span className={styles.perf}>24h</span>
            <span className={`${styles.perf} ${styles.perfMuted}`}>7j</span>
            <span>RSI</span>
            <span className={styles.volRank}>Volume</span>
            <span className={styles.mcap}>MCap</span>
            <span>7j</span>
            <span>Score</span>
            <span>Streak</span>
          </div>
          {top.map((entry, i) => (
            <Row key={entry.coin.id} entry={entry} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
