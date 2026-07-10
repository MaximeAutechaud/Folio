import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import type { MarketSubTab } from '../MarketView/MarketView';
import styles from './OnboardingTour.module.css';

export type TourTab = 'portfolio' | 'charts' | 'market' | 'watchlist' | 'trades' | 'ia';

interface TourStep {
  /** valeur de l'attribut data-tour de l'élément à surligner ; absent = étape centrée */
  target?: string;
  /** onglet à activer avant d'afficher l'étape */
  tab?: TourTab;
  /** sous-onglet Market à forcer (implique tab: 'market') */
  marketSubTab?: MarketSubTab;
  title: string;
  body: string;
  tip?: string;
}

const STEPS: TourStep[] = [
  {
    title: 'Bienvenue dans Folio',
    body: "Suivi de portefeuille 100 % local : positions, marchés, alertes et briefing IA. Cette visite fait le tour des 6 onglets en deux minutes.",
    tip: "Tu pourras la relancer à tout moment via le bouton ? en haut à droite.",
  },
  {
    target: 'tab-portfolio',
    tab: 'portfolio',
    title: 'Portfolio — ta base',
    body: "Valeur totale, P&L, dividendes, exposition sectorielle et la liste de tes positions. Un clic sur une ligne ouvre le détail avec l'historique complet des transactions (achats, ventes, splits, dividendes).",
    tip: "Renseigne stop et objectifs (TP1/TP2) dès l'achat : c'est ce qui alimente les alertes et l'onglet Trades.",
  },
  {
    target: 'sync',
    tab: 'portfolio',
    title: 'Sync corporate',
    body: "Ce bouton interroge Yahoo pour détecter splits, actions gratuites et dividendes sur tes positions. Un badge apparaît quand des événements attendent ta validation.",
    tip: "Un événement ignoré ne sera plus re-proposé — valide-les au fil de l'eau pour garder un PRU juste.",
  },
  {
    target: 'tab-charts',
    tab: 'charts',
    title: 'Charts — analyse technique',
    body: "Recherche n'importe quel ticker (format Yahoo : AIR.PA, ASML.AS…) ou une crypto, et visualise son historique avec indicateurs.",
    tip: "Pas besoin de détenir le titre : sers-t'en pour valider un point d'entrée avant d'acheter.",
  },
  {
    target: 'tab-market',
    tab: 'market',
    marketSubTab: 'macro',
    title: 'Market — le contexte',
    body: "Le cœur analytique de l'app, en quatre sous-onglets. Ici, Macro : un score de régime de marché (VIX, courbe des taux, momentum…) avec l'historique et le détail par indicateur.",
    tip: "Commence toujours par là : sous 40, régime risk-off — les signaux d'entrée qui suivent sont moins fiables.",
  },
  {
    target: 'market-sub-secteurs',
    tab: 'market',
    marketSubTab: 'secteurs',
    title: 'Secteurs — la rotation',
    body: "Chaque secteur est scoré (pente de force relative, RSI d'entrée, drawdown, alignement macro) pour repérer où l'argent tourne et lesquels offrent un point d'entrée.",
    tip: "Clique sur un secteur pour ouvrir son drawer : tu y trouveras les tickers candidats des narratives rattachées, évalués contre l'ETF du secteur.",
  },
  {
    target: 'market-sub-narratives',
    tab: 'market',
    marketSubTab: 'narratives',
    title: 'Narratives — les thèmes',
    body: "Les thèmes de marché que tu suis (IA, défense, uranium…), chacun mesuré via son ETF de référence et scoré comme un secteur, croisé avec le régime macro.",
    tip: "Un thème sans ETF de référence n'apparaît pas ici : ses tickers alimentent le pool de candidats dans le drawer de son secteur parent.",
  },
  {
    target: 'market-sub-signaux',
    tab: 'market',
    marketSubTab: 'signaux',
    title: 'Signaux — la fiabilité',
    body: "Chaque signal émis (dip, reversal, accelerating, exhaustion…) est loggé quotidiennement, puis sa performance relative à J+5/J+10/J+20 est mesurée. Tu vois donc quels signaux ont réellement marché.",
    tip: "Vérifie le win rate d'un signal avant de le suivre — et rappelle-toi qu'exhaustion est un signal d'évitement, pas d'entrée.",
  },
  {
    target: 'tab-watchlist',
    tab: 'watchlist',
    title: 'Watchlist',
    body: "Tes tickers sous surveillance, organisés par catégories, avec prix et variations en direct.",
    tip: "Alimente-la depuis Market : repère les candidats dans Secteurs/Narratives, suis-les ici, achète au bon signal.",
  },
  {
    target: 'tab-trades',
    tab: 'trades',
    title: 'Trades — ta discipline',
    body: "Une position devient un trade dès qu'un stop loss est défini. Suivi du risque et de la distance au stop, puis à la clôture : win rate et P&L moyen par setup.",
    tip: "Renseigne le champ setup à chaque achat — c'est lui qui révèle quels setups te font vraiment gagner.",
  },
  {
    target: 'tab-ia',
    tab: 'ia',
    title: 'IA — le briefing',
    body: "Un briefing généré par Claude : posture macro, risque portefeuille, rotation sectorielle et « à regarder maintenant », croisés avec tes positions réelles.",
    tip: "Configure ta clé API via la roue crantée en haut à droite. Lis-le avant d'agir, pas après.",
  },
  {
    target: 'alerts',
    title: 'Alertes',
    body: "Règles de prix (objectif, stop) et de score secteur. Les alertes prix sont one-shot : déclenchées une fois puis désactivées, ré-armables depuis ce panneau.",
    tip: "Pose une alerte sur chaque stop et chaque TP1 : l'app surveille pour toi, inutile de garder l'écran ouvert.",
  },
];

const TOOLTIP_WIDTH = 360;
const SPOT_PADDING = 6;

interface Props {
  onClose: () => void;
  onTabChange: (tab: TourTab) => void;
  onMarketSubTab: (sub: MarketSubTab | null) => void;
}

export function OnboardingTour({ onClose, onTabChange, onMarketSubTab }: Props) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const measure = useCallback(() => {
    if (!step.target) { setRect(null); return; }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step.target]);

  useEffect(() => {
    if (step.tab) onTabChange(step.tab);
    onMarketSubTab(step.marketSubTab ?? null);
    // laisse le temps à l'onglet de se rendre avant de mesurer la cible
    const t = setTimeout(measure, 80);
    return () => clearTimeout(t);
  }, [index, step.tab, step.marketSubTab, measure, onTabChange, onMarketSubTab]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const next = useCallback(() => {
    if (index === STEPS.length - 1) onClose();
    else setIndex((i) => i + 1);
  }, [index, onClose]);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') prev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  const spot = rect
    ? {
        top: rect.top - SPOT_PADDING,
        left: rect.left - SPOT_PADDING,
        width: rect.width + SPOT_PADDING * 2,
        height: rect.height + SPOT_PADDING * 2,
      }
    : null;

  // tooltip sous la cible, clampé horizontalement ; centré si pas de cible
  const tooltipStyle: CSSProperties = spot
    ? {
        top: spot.top + spot.height + 14,
        left: Math.min(
          Math.max(12, spot.left + spot.width / 2 - TOOLTIP_WIDTH / 2),
          window.innerWidth - TOOLTIP_WIDTH - 12,
        ),
      }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  const arrowLeft = spot
    ? spot.left + spot.width / 2 - (typeof tooltipStyle.left === 'number' ? tooltipStyle.left : 0)
    : 0;

  return (
    <div className={`${styles.overlay} ${spot ? '' : styles.dimmed}`}>
      {spot && <div className={styles.spotlight} style={spot} />}
      <div className={styles.tooltip} style={tooltipStyle} key={index}>
        {spot && <div className={styles.arrow} style={{ left: Math.max(14, Math.min(arrowLeft, TOOLTIP_WIDTH - 14)) }} />}
        <div className={styles.header}>
          <span className={styles.title}>{step.title}</span>
          <span className={styles.counter}>{index + 1}/{STEPS.length}</span>
        </div>
        <p className={styles.body}>{step.body}</p>
        {step.tip && <p className={styles.tip}><span className={styles.tipMark}>▸</span>{step.tip}</p>}
        <div className={styles.footer}>
          <button className={styles.skipBtn} onClick={onClose}>Passer la visite</button>
          <div className={styles.navBtns}>
            {index > 0 && <button className={styles.prevBtn} onClick={prev}>Précédent</button>}
            <button className={styles.nextBtn} onClick={next}>{isLast ? 'Terminer' : 'Suivant'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
