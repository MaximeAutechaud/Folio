import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { useSectorPerfs } from './useSectorData';
import { useNarrativePerfs } from './useNarrativePerfs';
import { useMacroScore } from './useMacroScore';
import { fetchYahooPrices, fetchYahooHistory } from '../lib/api/yahoo';
import { calcEma, calcMa } from '../lib/indicators';
import { calcSectorScore } from '../lib/scoring';
import type { SectorScore } from '../lib/scoring';
import {
  fetchAlertRules,
  fetchUnacknowledgedCount,
  getLastAlertEvent,
  insertAlertEvent,
  insertBaselineAlertEvent,
  insertSignalLog,
  toggleAlertRule,
} from '../lib/db';
import type { AlertRule } from '../types';
import type { SectorPerf, EtfMetrics } from './useSectorData';
import type { NarrativePerf } from './useNarrativePerfs';
import type { MacroScoreData } from './useMacroScore';
import type { MacroProfile } from '../lib/sectors';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRegime(regime: string): string {
  const map: Record<string, string> = {
    'risk-on': 'Risk-On',
    'favorable': 'Favorable',
    'neutral': 'Neutre',
    'unfavorable': 'Défavorable',
    'risk-off': 'Risk-Off',
  };
  return map[regime] ?? regime;
}

function consecutiveSuffix(n: number): string {
  if (n <= 1) return '';
  return ` — ${n}j consécutifs`;
}

// Mapping EtfMetrics → ScoreInput, centralisé (partagé entre l'alerte
// sector_score_threshold, le logging de signaux, le briefing IA et l'UI) —
// même entrées EW pour les secteurs et les narratives-ETF. Le paramètre macro
// n'exige que score/trend pour permettre un fallback neutre quand le
// MacroScore n'est pas encore chargé.
export function scoreEtf(
  perf: EtfMetrics,
  macroProfile: MacroProfile,
  macro: Pick<MacroScoreData, 'score' | 'trend'>,
): SectorScore {
  return calcSectorScore({
    relPerf1W: perf.relPerf1W_ew,
    relPerf1M: perf.relPerf1M_ew,
    relPerf3M: perf.relPerf3M_ew,
    rsi: perf.rsi,
    drawdown3M: perf.drawdown3M,
    drawdown6M: perf.drawdown6M,
    ma50Above: perf.ma50Above,
    macroProfile,
    macroScore: macro.score,
    macroTrend: macro.trend,
  });
}

// Applique le score d'opportunité à un secteur.
export function scoreSector(sp: SectorPerf, macro: Pick<MacroScoreData, 'score' | 'trend'>): SectorScore {
  return scoreEtf(sp, sp.sector.macroProfile, macro);
}

function localDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Phase 3 : enregistre 1 ligne/secteur/jour dès qu'un secteur émet un signal
// (dip/reversal/accelerating/exhaustion). Upsert idempotent — les rejeux dans la
// journée réécrivent juste la classification (voir insertSignalLog).
async function logSectorSignals(
  sectorPerfs: SectorPerf[],
  macro: MacroScoreData | undefined,
): Promise<void> {
  if (!macro || sectorPerfs.length === 0) return;
  const today = localDateString();
  for (const sp of sectorPerfs) {
    const s = scoreSector(sp, macro);
    if (!s.signal) continue;
    try {
      await insertSignalLog(today, 'sector', sp.sector.id, s.signal, s.total);
    } catch {
      // best-effort — ne bloque jamais le moteur d'alertes
    }
  }
}

// ── Evaluation ────────────────────────────────────────────────────────────────

async function evaluateRules(
  rules: AlertRule[],
  sectorPerfs: SectorPerf[],
  narrativePerfs: NarrativePerf[],
  macroScore: MacroScoreData | undefined,
  tickerPrices: Record<string, number | undefined>,
  maHistories: Record<string, number[]>,
  onNewEvent: () => void,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const yesterdayStart = todayStart - 86400;

  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (rule.snoozed_until && rule.snoozed_until > now) continue;

    let conditionMet = false;
    let currentValue = '';
    let message = '';
    let consecutiveDays = 1;

    try {
      const lastEvent = await getLastAlertEvent(rule.id);

      if (rule.type === 'rsi_overbought' || rule.type === 'rsi_oversold') {
        if (lastEvent && lastEvent.triggered_at >= todayStart) continue;

        const threshold = parseFloat(rule.threshold ?? (rule.type === 'rsi_overbought' ? '70' : '30'));
        let rsi: number | null = null;

        if (rule.scope === 'sector') {
          rsi = sectorPerfs.find(s => s.sector.id === rule.scope_id)?.rsi ?? null;
        } else if (rule.scope === 'narrative') {
          rsi = narrativePerfs.find(n => n.narrative.id === parseInt(rule.scope_id))?.rsi ?? null;
        }

        if (rsi == null) continue;
        conditionMet = rule.type === 'rsi_overbought' ? rsi >= threshold : rsi <= threshold;
        currentValue = String(rsi);

        if (conditionMet) {
          consecutiveDays = (lastEvent && lastEvent.triggered_at >= yesterdayStart)
            ? lastEvent.consecutive_days + 1 : 1;
          const direction = rule.type === 'rsi_overbought' ? 'overbought' : 'oversold';
          message = `${rule.label} · RSI ${rsi} — ${direction}${consecutiveSuffix(consecutiveDays)}`;
        }

      } else if (rule.type === 'macro_regime_change') {
        if (!macroScore) continue;
        const currentRegime = macroScore.regime;
        currentValue = currentRegime;

        if (!lastEvent) {
          await insertBaselineAlertEvent(rule.id, currentRegime);
          continue;
        }

        if (lastEvent.triggered_at >= todayStart && lastEvent.consecutive_days > 0) continue;

        conditionMet = lastEvent.value_at_trigger !== currentRegime;
        if (conditionMet) {
          message = `MacroScore · Régime: ${formatRegime(lastEvent.value_at_trigger)} → ${formatRegime(currentRegime)}`;
        }

      } else if (rule.type === 'price_target' || rule.type === 'stop_loss') {
        if (lastEvent && lastEvent.triggered_at >= todayStart) continue;

        const price = tickerPrices[rule.scope_id];
        if (price == null) continue;
        const threshold = parseFloat(rule.threshold ?? '0');
        if (!threshold) continue;

        // stop_loss = toujours « en-dessous » ; price_target suit rule.direction ('above' par défaut)
        const below = rule.type === 'stop_loss' || rule.direction === 'below';
        conditionMet = below ? price <= threshold : price >= threshold;
        currentValue = price.toFixed(2);

        if (conditionMet) {
          const op = below ? '≤' : '≥';
          const lbl = rule.type === 'stop_loss' ? 'Stop atteint' : 'Prix cible';
          message = `${rule.label} · ${lbl} — ${price.toFixed(2)} ${op} ${threshold}`;
        }

      } else if (rule.type === 'price_below_ma200') {
        if (lastEvent && lastEvent.triggered_at >= todayStart) continue;

        const prices = maHistories[rule.scope_id];
        if (!prices || prices.length < 200) continue;

        const ma200 = calcMa(prices, 200)!;
        const currentPrice = prices[prices.length - 1];
        conditionMet = currentPrice < ma200;
        currentValue = currentPrice.toFixed(2);

        if (conditionMet) {
          consecutiveDays = (lastEvent && lastEvent.triggered_at >= yesterdayStart)
            ? lastEvent.consecutive_days + 1 : 1;
          message = `${rule.label} · Prix sous MA200 — ${currentPrice.toFixed(2)} < ${ma200.toFixed(2)}${consecutiveSuffix(consecutiveDays)}`;
        }

      } else if (rule.type === 'ema_cross') {
        const prices = maHistories[rule.scope_id];
        if (!prices || prices.length < 200) continue;

        const ema50 = calcEma(prices, 50)!;
        const ema200 = calcEma(prices, 200)!;
        const currentState = ema50 > ema200 ? 'above' : 'below';
        currentValue = currentState;

        if (!lastEvent) {
          await insertBaselineAlertEvent(rule.id, currentState);
          continue;
        }

        if (lastEvent.triggered_at >= todayStart && lastEvent.consecutive_days > 0) continue;

        const prevState = lastEvent.value_at_trigger;
        const crossedGolden = prevState === 'below' && currentState === 'above';
        const crossedDeath = prevState === 'above' && currentState === 'below';
        const wantedDir = rule.threshold ?? 'both';

        if (crossedGolden && (wantedDir === 'golden' || wantedDir === 'both')) {
          conditionMet = true;
          message = `${rule.label} · Golden Cross — EMA50 croise au-dessus de EMA200`;
        } else if (crossedDeath && (wantedDir === 'death' || wantedDir === 'both')) {
          conditionMet = true;
          message = `${rule.label} · Death Cross — EMA50 croise en-dessous de EMA200`;
        }

        // Always update baseline to current state so next crossover is detected
        if (!conditionMet && prevState !== currentState) {
          await insertBaselineAlertEvent(rule.id, currentState);
          continue;
        }

      } else if (rule.type === 'sector_score_threshold') {
        if (lastEvent && lastEvent.triggered_at >= todayStart) continue;
        if (!macroScore) continue;

        const sp = sectorPerfs.find(s => s.sector.id === rule.scope_id);
        if (!sp) continue;

        const score = scoreSector(sp, macroScore);

        const threshold = parseFloat(rule.threshold ?? '70');
        conditionMet = score.total >= threshold;
        currentValue = String(score.total);

        if (conditionMet) {
          consecutiveDays = (lastEvent && lastEvent.triggered_at >= yesterdayStart)
            ? lastEvent.consecutive_days + 1 : 1;
          message = `${rule.label} · Score ≥ ${threshold} — ${score.total}/100 (${score.label})${consecutiveSuffix(consecutiveDays)}`;
        }
      }
    } catch {
      continue;
    }

    if (!conditionMet) continue;

    await insertAlertEvent(rule.id, consecutiveDays, currentValue, message);

    // One-shot : les franchissements de niveau prix ne se déclenchent qu'une fois.
    // La règle passe inactive (visible dans le panneau, ré-armable via le toggle).
    if (rule.type === 'price_target' || rule.type === 'stop_loss') {
      await toggleAlertRule(rule.id, false);
    }

    onNewEvent();

    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === 'granted';
      }
      if (granted) await sendNotification({ title: 'Folio', body: message });
    } catch {
      // Notifications non supportées ou refusées — silencieux
    }
  }

  // Phase 3 : piggyback — logging des signaux secteurs sur le même cycle debounce.
  await logSectorSignals(sectorPerfs, macroScore);
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAlertEngine() {
  const queryClient = useQueryClient();
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);

  const { data: rules = [] } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: fetchAlertRules,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: sectorPerfs = [] } = useSectorPerfs('3M');
  const { data: narrativePerfs = [] } = useNarrativePerfs('3M');
  const { data: macroScore } = useMacroScore();

  const tickerSymbols = [
    ...new Set(
      rules
        .filter(r => r.scope === 'ticker' && r.is_active && (r.type === 'price_target' || r.type === 'stop_loss'))
        .map(r => r.scope_id)
        .filter(Boolean)
    ),
  ].sort();

  const { data: rawTickerPrices } = useQuery({
    queryKey: ['alert-ticker-prices', tickerSymbols.join(',')],
    queryFn: () => fetchYahooPrices(tickerSymbols),
    enabled: tickerSymbols.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const tickerPrices = rawTickerPrices ?? {};

  // 1Y daily history for MA200 / EMA cross alerts
  const maTickers = [
    ...new Set(
      rules
        .filter(r => (r.type === 'price_below_ma200' || r.type === 'ema_cross') && r.is_active)
        .map(r => r.scope_id)
        .filter(Boolean)
    ),
  ].sort();

  const { data: maHistoriesRaw } = useQuery({
    queryKey: ['alert-ma-histories', maTickers.join(',')],
    // 2Y daily (~500 points) so the EMA200 is properly warmed up: with only
    // ~252 points the EMA200 stays anchored to its SMA seed and diverges from
    // what charting platforms show, mistiming golden/death cross detection.
    queryFn: () => Promise.all(
      maTickers.map(async t => ({
        ticker: t,
        prices: (await fetchYahooHistory(t, '2Y_daily')).map(p => p.value),
      }))
    ),
    enabled: maTickers.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const maHistories: Record<string, number[]> = {};
  for (const item of (maHistoriesRaw ?? [])) {
    maHistories[item.ticker] = item.prices;
  }

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['alert-unack-count'] });
    queryClient.invalidateQueries({ queryKey: ['alert-events'] });
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
  }, [queryClient]);

  useEffect(() => {
    // Pas de garde `rules.length === 0` : le logging de signaux (Phase 3) doit
    // tourner même sans règle d'alerte configurée. evaluateRules gère une liste
    // vide (boucle no-op) puis loggue les signaux secteurs.
    const dataReady = sectorPerfs.length > 0 || narrativePerfs.length > 0 || macroScore != null;
    if (!dataReady) return;

    const now = Date.now();
    if (now - lastRunRef.current < 4 * 60 * 1000) return;
    if (runningRef.current) return;

    runningRef.current = true;
    lastRunRef.current = now;

    evaluateRules(rules, sectorPerfs, narrativePerfs, macroScore, tickerPrices, maHistories, invalidate)
      .finally(() => { runningRef.current = false; });
  }, [rules, sectorPerfs, narrativePerfs, macroScore, tickerPrices, maHistories, invalidate]);
}

export function useUnacknowledgedCount() {
  return useQuery({
    queryKey: ['alert-unack-count'],
    queryFn: fetchUnacknowledgedCount,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useAlertRules() {
  return useQuery({
    queryKey: ['alert-rules'],
    queryFn: fetchAlertRules,
    staleTime: 60_000,
  });
}
