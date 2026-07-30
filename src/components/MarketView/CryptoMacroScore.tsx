import { useCryptoMacroScore } from '../../hooks/useCryptoMacroScore';
import { MacroScorePanel } from './MacroScorePanel';

export function CryptoMacroScore() {
  const { data, isFetching } = useCryptoMacroScore();

  return (
    <MacroScorePanel
      data={data}
      isFetching={isFetching}
      title="Contexte Macro Crypto"
      loadingLabel="Chargement du contexte crypto…"
      contextLabel="Contexte marché — hors score"
      footnote={
        'Score de 0 (Risk-Off total) à 100 (Risk-On total) — CoinGecko, alternative.me et Yahoo, ' +
        'rafraîchi toutes les 15 min. Descriptif : il résume le régime en cours, il ne prédit pas les rendements.'
      }
    />
  );
}
