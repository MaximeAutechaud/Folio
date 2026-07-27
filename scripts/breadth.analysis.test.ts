/**
 * Question préalable au backtest : la breadth de constituants dit-elle quelque
 * chose que le momentum de l'ETF sectoriel ne dit pas déjà ?
 *
 * Si la corrélation est très élevée, la breadth est une reformulation coûteuse
 * du prix qu'on a déjà, et la question est close sans dépenser d'échantillon.
 * Ce script ne mesure **aucune performance forward** : il ne consomme pas la
 * cartouche hors échantillon.
 *
 *   SCANNER_BACKTEST_SNAPSHOT=... npx vitest run scripts/breadth.analysis.test.ts
 */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { breadthDelta, breadthSeries, etfMomentum, pairedSeries } from '../src/lib/breadth';
import { correlation, beta } from '../src/lib/scanner';
import { sectorEtf } from '../src/lib/universe';
import type { Bar } from '../src/lib/scanner';

interface Columns { t: number[]; o: number[]; v: number[]; c: number[]; vol: number[] }
interface Snapshot {
  format?: 'columns';
  universe: { ticker: string; sectorId: string | null; source: string }[];
  series: Record<string, Bar[] | Columns>;
}

function toBars(snapshot: Snapshot): Record<string, Bar[]> {
  if (snapshot.format !== 'columns') return snapshot.series as Record<string, Bar[]>;
  const out: Record<string, Bar[]> = {};
  for (const [ticker, col] of Object.entries(snapshot.series as Record<string, Columns>)) {
    out[ticker] = col.t.map((time, i) => ({
      time, open: col.o[i], value: col.v[i], close: col.c[i], volume: col.vol[i],
    }));
  }
  return out;
}

function stdev(values: number[]): number {
  if (!values.length) return 0;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/** Effectifs de la passe primaire, seuls secteurs assez peuplés pour décider. */
const PRIMARY = ['xli', 'xlf', 'xlk', 'xly', 'xlv'];

const snapshotPath = process.env.SCANNER_BACKTEST_SNAPSHOT;
const MA = 50;
const LOOKBACKS = [5, 20, 60];

describe.skipIf(!snapshotPath)('breadth vs momentum ETF', () => {
  it('mesure la part de variance de la breadth non expliquée par le prix', () => {
    const snapshot: Snapshot = JSON.parse(fs.readFileSync(snapshotPath!, 'utf8'));
    const series = toBars(snapshot);

    const bySector = new Map<string, Bar[][]>();
    for (const entry of snapshot.universe) {
      if (entry.source === 'control' || !entry.sectorId) continue;
      const bars = series[entry.ticker];
      if (!bars?.length) continue;
      const list = bySector.get(entry.sectorId) ?? [];
      list.push(bars);
      bySector.set(entry.sectorId, list);
    }

    const rows: Record<string, unknown>[] = [];
    for (const [sectorId, members] of [...bySector].sort()) {
      const etfTicker = sectorEtf(sectorId);
      const etf = etfTicker ? series[etfTicker] : null;
      if (!etf?.length) continue;

      const timeline = etf.map(b => b.time);
      const breadth = breadthSeries(members, timeline, MA);
      const counts = breadth.map(p => p.count).filter(c => c > 0);

      const row: Record<string, unknown> = {
        sector: sectorId,
        etf: etfTicker,
        members: members.length,
        seances: timeline.length,
        countDebut: counts[0] ?? 0,
        countFin: counts.at(-1) ?? 0,
        primaire: PRIMARY.includes(sectorId),
      };

      for (const lookback of LOOKBACKS) {
        const { a: db, b: mom } = pairedSeries(
          breadthDelta(breadth, lookback),
          etfMomentum(etf, lookback),
        );
        const r = correlation(db, mom);
        row[`r${lookback}`] = Number(r.toFixed(3));
        row[`r2_${lookback}`] = Number((r * r).toFixed(3));
        row[`n${lookback}`] = db.length;

        // Écart-type de la breadth résiduelle : ce qui resterait à exploiter
        // une fois le momentum de l'ETF retiré, en points de pourcentage.
        const k = beta(db, mom);
        const resid = db.map((v, i) => v - k * mom[i]);
        row[`sdResid${lookback}`] = Number(stdev(resid).toFixed(2));
        row[`sdTotal${lookback}`] = Number(stdev(db).toFixed(2));
      }
      rows.push(row);
    }

    const report = {
      snapshot: snapshotPath,
      ma: MA,
      lookbacks: LOOKBACKS,
      rows,
    };
    const out = process.env.BREADTH_REPORT;
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    expect(rows.length).toBeGreaterThan(0);
  }, 600_000);
});
