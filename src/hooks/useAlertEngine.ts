import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { useSectorPerfs } from './useSectorData';
import { useNarrativePerfs } from './useNarrativePerfs';
import { useMacroScore } from './useMacroScore';
import { fetchYahooPrices } from '../lib/api/yahoo';
import {
  fetchAlertRules,
  fetchUnacknowledgedCount,
  getLastAlertEvent,
  insertAlertEvent,
  insertBaselineAlertEvent,
} from '../lib/db';
import type { AlertRule } from '../types';
import type { SectorPerf } from './useSectorData';
import type { NarrativePerf } from './useNarrativePerfs';
import type { MacroScoreData } from './useMacroScore';

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

// ── Evaluation ────────────────────────────────────────────────────────────────

async function evaluateRules(
  rules: AlertRule[],
  sectorPerfs: SectorPerf[],
  narrativePerfs: NarrativePerf[],
  macroScore: MacroScoreData | undefined,
  tickerPrices: Record<string, number | undefined>,
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

        // Skip if we already fired a real alert today
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

        conditionMet = rule.type === 'price_target' ? price >= threshold : price <= threshold;
        currentValue = price.toFixed(2);

        if (conditionMet) {
          consecutiveDays = (lastEvent && lastEvent.triggered_at >= yesterdayStart)
            ? lastEvent.consecutive_days + 1 : 1;
          const op = rule.type === 'price_target' ? '≥' : '≤';
          const lbl = rule.type === 'price_target' ? 'Prix cible' : 'Stop atteint';
          message = `${rule.label} · ${lbl} — ${price.toFixed(2)} ${op} ${threshold}${consecutiveSuffix(consecutiveDays)}`;
        }
      }
    } catch {
      continue;
    }

    if (!conditionMet) continue;

    await insertAlertEvent(rule.id, consecutiveDays, currentValue, message);
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
        .filter(r => r.scope === 'ticker' && r.is_active)
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

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['alert-unack-count'] });
    queryClient.invalidateQueries({ queryKey: ['alert-events'] });
  }, [queryClient]);

  useEffect(() => {
    if (rules.length === 0) return;
    const dataReady = sectorPerfs.length > 0 || narrativePerfs.length > 0 || macroScore != null;
    if (!dataReady) return;

    const now = Date.now();
    if (now - lastRunRef.current < 4 * 60 * 1000) return;
    if (runningRef.current) return;

    runningRef.current = true;
    lastRunRef.current = now;

    evaluateRules(rules, sectorPerfs, narrativePerfs, macroScore, tickerPrices, invalidate)
      .finally(() => { runningRef.current = false; });
  }, [rules, sectorPerfs, narrativePerfs, macroScore, tickerPrices, invalidate]);
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
