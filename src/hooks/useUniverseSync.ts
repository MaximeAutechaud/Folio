import { useCallback, useState } from 'react';
import { fetchScannerBars } from '../lib/api/yahoo';
import { seedUniverse, controlInstruments, parseHoldingsCsv } from '../lib/universe';
import {
  fetchScannerUniverse,
  replaceScannerUniverse,
  markUniverseFetch,
  upsertPriceBars,
  fetchBarDateBounds,
  prunePriceBars,
} from '../lib/db';
import {
  rangeFor,
  toRows,
  buildReport,
  pruneBefore,
  toDateString,
  type SyncOutcome,
  type SyncReport,
} from '../lib/priceCache';

export interface SyncProgress {
  phase: 'idle' | 'universe' | 'fetching' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
  report?: SyncReport;
}

const IDLE: SyncProgress = { phase: 'idle', done: 0, total: 0, message: '' };

/**
 * Synchronise le cache de prix de l'univers du scanner.
 *
 * ## Séquentiel, et ce n'est pas négociable
 *
 * ~900 requêtes en parallèle est le meilleur moyen de se faire limiter par
 * Yahoo, et un rate-limit ne se manifeste pas par une erreur franche : il
 * renvoie des réponses vides. On croirait alors à des tickers introuvables et on
 * les purgerait de l'univers. La contrepartie est une à trois minutes d'attente
 * à la première passe, d'où la progression ticker par ticker.
 *
 * Chaque `await` rend déjà la main au navigateur, donc la barre de progression
 * s'anime sans qu'il faille intercaler un `setTimeout`.
 *
 * ## Le rapport de résolution
 *
 * Un ticker qui ne renvoie rien est **consigné**, jamais ignoré. C'est le seul
 * filet contre les tickers mal formés que la table d'exceptions de
 * `toYahooTicker` ne couvre pas encore : sur 900 titres, trois disparitions
 * silencieuses amputeraient des clusters sans produire le moindre symptôme.
 *
 * Un échec ne retire pas le ticker de l'univers — il incrémente `fail_count`.
 * Yahoo a des indisponibilités passagères, et purger sur un seul échec ferait
 * fondre l'univers au fil des semaines.
 */
export function useUniverseSync() {
  const [progress, setProgress] = useState<SyncProgress>(IDLE);

  const run = useCallback(async () => {
    try {
      setProgress({ phase: 'universe', done: 0, total: 0, message: 'Préparation de l\'univers…' });

      // Premier lancement : la graine peuple la table. Ensuite c'est la table
      // qui fait foi — un import CSV l'a peut-être remplacée.
      let universe = await fetchScannerUniverse();
      if (universe.length === 0) {
        await replaceScannerUniverse(
          [...seedUniverse(), ...controlInstruments()]
            .map(e => ({ ticker: e.ticker, sectorId: e.sectorId, source: e.source })),
        );
        universe = await fetchScannerUniverse();
      }

      const today = toDateString(Date.now() / 1000);
      const bounds = await fetchBarDateBounds();

      const plan = universe
        .map(u => ({
          ticker: u.ticker,
          range: rangeFor(bounds[u.ticker]?.latest, today, bounds[u.ticker]?.earliest),
        }))
        .filter((p): p is { ticker: string; range: string } => p.range != null);
      const skipped = universe.length - plan.length;

      setProgress({
        phase: 'fetching', done: 0, total: plan.length,
        message: `${plan.length} tickers à mettre à jour (${skipped} déjà à jour)…`,
      });

      const outcomes: SyncOutcome[] = [];
      for (let i = 0; i < plan.length; i++) {
        const { ticker, range } = plan[i];
        let bars: Awaited<ReturnType<typeof fetchScannerBars>> = [];
        try {
          bars = await fetchScannerBars(ticker, range);
        } catch {
          bars = [];
        }

        if (bars.length > 0) {
          await upsertPriceBars(ticker, toRows(bars));
        }
        await markUniverseFetch(ticker, bars.length > 0, today);
        outcomes.push({ ticker, ok: bars.length > 0, bars: bars.length });

        setProgress({
          phase: 'fetching', done: i + 1, total: plan.length,
          message: `${i + 1}/${plan.length} — ${ticker}`,
        });
      }

      await prunePriceBars(pruneBefore(today));

      const report = buildReport(outcomes, skipped);
      setProgress({
        phase: 'done', done: plan.length, total: plan.length,
        message: `${report.resolved}/${report.requested - skipped} résolus, ${report.bars} bougies.`,
        report,
      });
    } catch (e) {
      setProgress({ phase: 'error', done: 0, total: 0, message: String(e) });
    }
  }, []);

  /**
   * Remplace l'univers depuis un CSV de holdings d'émetteur.
   *
   * Le texte arrive du composant via un `<input type="file">` standard, lu par
   * `File.text()`. Volontairement pas le dialog natif : il ne donne qu'un
   * chemin, et lire ce chemin exigerait `tauri-plugin-fs` ou une quatrième
   * command Rust — alors que les commands sont tenues au strict nécessaire et
   * qu'un input de fichier fait exactement le même travail dans WebView2.
   *
   * Les instruments de contrôle sont toujours réinjectés : un import qui les
   * emporterait priverait la résidualisation de ses benchmarks, et le scanner
   * se remettrait à trouver des clusters qui ne sont que des secteurs.
   */
  const importCsv = useCallback(async (csv: string): Promise<ImportOutcome> => {
    const rows = parseHoldingsCsv(csv);
    if (rows.length === 0) {
      return { ok: false, imported: 0, withSector: 0, message: 'Aucune ligne exploitable — le fichier doit être l\'onglet Holdings exporté en CSV.' };
    }

    await replaceScannerUniverse([
      ...rows.map(r => ({ ticker: r.ticker, sectorId: r.sectorId, source: 'import' })),
      ...controlInstruments().map(e => ({ ticker: e.ticker, sectorId: e.sectorId, source: e.source })),
    ]);

    const withSector = rows.filter(r => r.sectorId != null).length;
    return {
      ok: true,
      imported: rows.length,
      withSector,
      message: `${rows.length} titres importés, ${withSector} avec secteur.`,
    };
  }, []);

  return { progress, run, importCsv, reset: () => setProgress(IDLE) };
}

export interface ImportOutcome {
  ok: boolean;
  imported: number;
  withSector: number;
  message: string;
}
