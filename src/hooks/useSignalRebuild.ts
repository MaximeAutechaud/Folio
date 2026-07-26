import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { SECTORS } from '../lib/sectors';
import { narrativeMacroProfile } from '../lib/scoring';
import { SECTOR_TICKERS, type Point } from './useSectorData';
import { fetchNarratives, replaceSignalLogScope } from '../lib/db';
import { rebuildRange, tradingSessions } from '../lib/rebuildSignals';
import type { ScorableEtf } from '../lib/settledSignals';

const MACRO_TICKERS = ['^VIX', 'DX-Y.NYB', '^TNX', '^TYX', '^IRX', 'HYG', 'GLD', 'HG=F', 'SPY', 'IWM'];

export interface RebuildProgress {
  phase: 'idle' | 'fetching' | 'computing' | 'writing' | 'done' | 'error';
  /** 0..1 sur la phase de calcul. */
  ratio: number;
  message: string;
  /** Bilan une fois terminé. */
  result?: { sessions: number; sectorRows: number; narrativeRows: number; from: string; to: string };
}

/**
 * Reconstruit `signal_log` depuis 2010 à partir des historiques Yahoo.
 *
 * Remplace intégralement les deux scopes : c'est le but. Les lignes existantes
 * mélangent des mesures intraday, des dates de week-end et des trous ; les
 * conserver interdirait toute statistique homogène.
 *
 * Pourquoi 2010 et plus 2 ans : sur une seule fenêtre de 18 mois, un backtest
 * ne mesure pas un signal, il mesure un régime. Le premier tour sur 2025-2026 a
 * donné quatre signaux tous perdants — mais cette période était anti-momentum
 * de bout en bout (le momentum sectoriel 3M y perd 1,2 pt), ce qui suffit à
 * expliquer le résultat sans rien dire de la validité des signaux.
 *
 * Les ETF récents (XLC et BLOK, 2018) n'ont simplement pas de lignes avant leur
 * création : `computeSettledFor` écarte toute série de moins de 60 bougies.
 */
export function useSignalRebuild() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RebuildProgress>({ phase: 'idle', ratio: 0, message: '' });

  const run = useCallback(async () => {
    try {
      setProgress({ phase: 'fetching', ratio: 0, message: 'Téléchargement des historiques…' });

      const narratives = (await fetchNarratives(true)).filter(n => n.ref_etf);
      const narrativeEntries: ScorableEtf[] = narratives.map(n => {
        const parent = SECTORS.find(s => s.id === n.parent_sector);
        return {
          id: n.ref_etf!,  // scope_id d'une narrative = ticker de l'ETF, pas l'id DB
          label: n.name,
          etf: n.ref_etf!,
          macroProfile: narrativeMacroProfile(n.ref_etf!, parent?.macroProfile ?? 'neutral'),
        };
      });

      // Dédoublonne : deux narratives peuvent partager le même ETF de référence.
      const uniqueNarratives = [...new Map(narrativeEntries.map(e => [e.id, e])).values()];

      const tickers = [...new Set([
        ...SECTOR_TICKERS, ...MACRO_TICKERS, ...uniqueNarratives.map(e => e.etf),
      ])];

      // Séquentiel volontairement : ~50 requêtes de 16 ans en parallèle est le
      // meilleur moyen de se faire limiter par Yahoo. La contrepartie est une
      // à deux minutes d'attente, d'où la progression ticker par ticker.
      const histories: Record<string, Point[]> = {};
      for (let i = 0; i < tickers.length; i++) {
        const t = tickers[i];
        setProgress({
          phase: 'fetching', ratio: 0,
          message: `Téléchargement ${i + 1}/${tickers.length} — ${t}`,
        });
        try {
          histories[t] = await fetchYahooHistory(t, 'MAX_daily');
        } catch {
          histories[t] = [];
        }
      }

      const macroHistories: Record<string, Point[]> = {};
      for (const t of MACRO_TICKERS) macroHistories[t] = histories[t] ?? [];

      // minBars : il faut ~6 mois de profondeur avant la première séance
      // reconstruite, sinon RSI, MA50 et drawdown 6M sont calculés sur trop peu
      // de bougies et le score est faux.
      const sessions = tradingSessions(histories['SPY'] ?? [], 130);
      if (sessions.length === 0) {
        setProgress({ phase: 'error', ratio: 0, message: 'Historique insuffisant — aucune séance exploitable.' });
        return;
      }

      setProgress({ phase: 'computing', ratio: 0, message: `Calcul sur ${sessions.length} séances…` });

      const sectorEntries: ScorableEtf[] = SECTORS.map(s => ({
        id: s.id, label: s.name, etf: s.etf, macroProfile: s.macroProfile,
      }));

      // rebuildRange rend la main au navigateur toutes les 25 séances : les
      // setProgress ci-dessous sont donc réellement rendus pendant le calcul.
      const sectorRows = await rebuildRange(
        sectorEntries, 'sector', histories, macroHistories, sessions,
        (done, total) => {
          if (done % 25 === 0) {
            setProgress({ phase: 'computing', ratio: (done / total) * 0.5, message: `Secteurs — séance ${done}/${total}` });
          }
        },
      );

      const narrativeRows = uniqueNarratives.length > 0
        ? await rebuildRange(
            uniqueNarratives, 'narrative', histories, macroHistories, sessions,
            (done, total) => {
              if (done % 25 === 0) {
                setProgress({ phase: 'computing', ratio: 0.5 + (done / total) * 0.5, message: `Narratives — séance ${done}/${total}` });
              }
            },
          )
        : [];

      setProgress({ phase: 'writing', ratio: 1, message: 'Écriture…' });
      await replaceSignalLogScope('sector', sectorRows);
      await replaceSignalLogScope('narrative', narrativeRows);

      queryClient.invalidateQueries({ queryKey: ['signal-logs'] });

      setProgress({
        phase: 'done', ratio: 1, message: 'Terminé.',
        result: {
          sessions: sessions.length,
          sectorRows: sectorRows.length,
          narrativeRows: narrativeRows.length,
          from: sessions[0].date,
          to: sessions[sessions.length - 1].date,
        },
      });
    } catch (e) {
      setProgress({ phase: 'error', ratio: 0, message: String(e) });
    }
  }, [queryClient]);

  return { progress, run, reset: () => setProgress({ phase: 'idle', ratio: 0, message: '' }) };
}
