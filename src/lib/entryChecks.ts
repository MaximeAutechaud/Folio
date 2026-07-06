import type { Regime } from './macroScore';

const CONCENTRATION_THRESHOLD_PCT = 25;

export interface EntryCheckInput {
  hasStop: boolean;
  riskPct: number | null;
  riskBudgetPct: number;
  positionWeightPct: number | null;
  macroRegime: Regime | null;
}

export interface EntryWarning {
  id: string;
  message: string;
}

export function evaluateEntryChecks(input: EntryCheckInput): EntryWarning[] {
  const warnings: EntryWarning[] = [];

  if (!input.hasStop) {
    warnings.push({ id: 'no-stop', message: 'Aucun stop loss défini.' });
  }

  if (input.riskPct != null && input.riskPct > input.riskBudgetPct) {
    warnings.push({
      id: 'risk-over-budget',
      message: `Risque de la ligne (${input.riskPct.toFixed(1)}%) supérieur au budget configuré (${input.riskBudgetPct}%).`,
    });
  }

  if (input.positionWeightPct != null && input.positionWeightPct > CONCENTRATION_THRESHOLD_PCT) {
    warnings.push({
      id: 'concentration',
      message: `Cette ligne représenterait ${input.positionWeightPct.toFixed(1)}% du portefeuille (seuil ${CONCENTRATION_THRESHOLD_PCT}%).`,
    });
  }

  if (input.macroRegime === 'unfavorable' || input.macroRegime === 'risk-off') {
    warnings.push({
      id: 'macro-unfavorable',
      message: `Régime macro actuel : ${input.macroRegime === 'risk-off' ? 'Risk-Off' : 'Défavorable'}.`,
    });
  }

  return warnings;
}
