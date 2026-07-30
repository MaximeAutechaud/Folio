import { useMacroScore } from '../../hooks/useMacroScore';
import { MacroScoreChart } from './MacroScoreChart';
import { MacroScorePanel } from './MacroScorePanel';

export function MacroScore() {
  const { data, isFetching } = useMacroScore();

  return (
    <MacroScorePanel
      data={data}
      isFetching={isFetching}
      title="Contexte Macro"
      loadingLabel="Chargement du contexte macro…"
      contextLabel="Contexte taux obligataires — hors score"
      footnote="Score de 0 (Risk-Off total) à 100 (Risk-On total) — données Yahoo Finance, rafraîchies toutes les 5 min."
    >
      <MacroScoreChart />
    </MacroScorePanel>
  );
}
