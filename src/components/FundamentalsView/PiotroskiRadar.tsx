import type { PiotroskiScore, PiotroskiTestId } from '../../lib/piotroski';
import styles from './PiotroskiRadar.module.css';

/**
 * Profil de reussite du F-Score, en radar.
 *
 * Deux series, en **emphase** et non en categoriel : l'exercice courant est le
 * sujet (accent, trait pointille), l'historique n'est que son contexte (gris,
 * aplat). Une palette categorielle a deux teintes suggererait deux entites de
 * meme rang, ce que ces series ne sont pas.
 *
 * Le rayon d'un axe est le **taux de reussite historique** du test, pas sa
 * valeur de l'annee. Tracer directement les 9 tests binaires donnerait une
 * etoile en dents de scie, chaque axe valant 0 ou 100 — illisible, et sans
 * information sur la regularite. Le taux, lui, ne demande aucune borne a
 * calibrer : c'est un comptage, pas une normalisation arbitraire.
 */

const SHORT_LABEL: Record<PiotroskiTestId, string> = {
  roa: 'ROA',
  cfo: 'Cash-flow',
  deltaRoa: 'Δ ROA',
  accruals: 'Accruals',
  deltaLeverage: 'Levier',
  deltaLiquidity: 'Liquidité',
  dilution: 'Dilution',
  deltaMargin: 'Marge',
  deltaTurnover: 'Rotation',
};

/**
 * Cadre plus large que haut, et rayon de donnees volontairement petit devant
 * lui. La serie de l'exercice courant etant binaire, elle touche l'anneau
 * exterieur sur CHAQUE test reussi — contrairement a un radar de valeurs
 * continues, qui reste generalement en deca. Les etiquettes ont donc besoin
 * d'un degagement franc, sans quoi le trace leur passe dessus.
 */
const VIEW_W = 360;
const VIEW_H = 330;
const CX = VIEW_W / 2;
const CY = 158;
const MAX_R = 76;
/** Rayon des etiquettes, en pixels du cadre — pas en pourcentage : cf. `project`. */
const LABEL_R = 108;
const RINGS = [25, 50, 75, 100];

interface AxisDatum {
  id: PiotroskiTestId;
  label: string;
  /** Libelle complet, conserve en infobulle : « Accruals » n'apprend rien seul. */
  fullLabel: string;
  /** Taux de reussite historique, 0-100. `null` si le test n'a jamais ete calculable. */
  rate: number | null;
  /** Resultat de l'exercice le plus recent. */
  current: boolean | null;
  passed: number;
  available: number;
}

/**
 * Projection pure, rayon en pixels. Separee du bornage a dessein : passer un
 * rayon d'etiquette par `polar` le faisait ecreter a 100 %, et les etiquettes
 * se retrouvaient dessinees exactement sur l'anneau exterieur, donc sur le
 * trace.
 */
function project(radius: number, index: number, count: number): [number, number] {
  // On demarre a midi et on tourne dans le sens horaire.
  const angle = (-90 + (360 / count) * index) * (Math.PI / 180);
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

/** Projection d'une valeur 0-100, bornee a l'anneau exterieur. */
function polar(value: number, index: number, count: number): [number, number] {
  return project((Math.max(0, Math.min(100, value)) / 100) * MAX_R, index, count);
}

function ringPath(value: number, count: number): string {
  return Array.from({ length: count }, (_, i) => polar(value, i, count).join(','))
    .join(' ');
}

/** Agrege l'historique par test : combien de fois reussi sur combien de fois calculable. */
export function buildAxes(history: PiotroskiScore[]): AxisDatum[] {
  const last = history[history.length - 1];
  if (!last) return [];

  return last.tests.map((t) => {
    let passed = 0;
    let available = 0;
    for (const year of history) {
      const test = year.tests.find((x) => x.id === t.id);
      if (test?.passed == null) continue;
      available++;
      if (test.passed) passed++;
    }
    return {
      id: t.id,
      label: SHORT_LABEL[t.id],
      fullLabel: t.label,
      rate: available === 0 ? null : (passed / available) * 100,
      current: t.passed,
      passed,
      available,
    };
  });
}

export function PiotroskiRadar({ history }: { history: PiotroskiScore[] }) {
  const axes = buildAxes(history);
  if (axes.length === 0) return null;

  const n = axes.length;
  const years = history.length;
  const currentYear = history[history.length - 1].periodEnd.slice(0, 4);

  const historyPoints = axes.map((a, i) => polar(a.rate ?? 0, i, n).join(',')).join(' ');
  const currentPoints = axes
    .map((a, i) => polar(a.current === true ? 100 : 0, i, n).join(','))
    .join(' ');

  return (
    <div className={styles.wrap}>
      <p className={styles.caption}>
        Chaque test vaut <strong>0 ou 1</strong> sur l'exercice — c'est ce que compte le score.
        Le radar montre autre chose : à quelle <strong>fréquence</strong> chaque test a été réussi
        sur les {years} exercices disponibles.
      </p>

      <div className={styles.chartCol}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className={styles.svg}
          role="img"
          aria-label={`Profil de réussite des neuf tests sur ${years} exercices`}
        >
          {/* Trame : traits pleins et sourds, jamais pointilles — le pointille
              est reserve a la serie de donnees. */}
          {RINGS.map((r) => (
            <polygon key={r} points={ringPath(r, n)} className={styles.ring} />
          ))}
          {axes.map((a, i) => {
            const [x, y] = polar(100, i, n);
            return <line key={a.id} x1={CX} y1={CY} x2={x} y2={y} className={styles.spoke} />;
          })}

          <polygon points={historyPoints} className={styles.histShape} />
          <polyline
            points={`${currentPoints} ${currentPoints.split(' ')[0]}`}
            className={styles.currentShape}
          />

          {axes.map((a, i) => {
            const [x, y] = polar(a.current === true ? 100 : 0, i, n);
            return (
              <circle key={a.id} cx={x} cy={y} r={3} className={styles.currentDot}>
                <title>
                  {a.label} — {a.current === true ? 'réussi' : a.current === false ? 'échoué' : 'non calculable'}
                  {a.rate != null ? ` · ${Math.round(a.rate)} % sur ${a.available} exercices` : ''}
                </title>
              </circle>
            );
          })}

          {axes.map((a, i) => {
            const [x, y] = project(LABEL_R, i, n);
            return (
              <text
                key={a.id}
                x={x}
                y={y}
                className={a.rate == null ? styles.axisLabelNa : styles.axisLabel}
                textAnchor={x < CX - 4 ? 'end' : x > CX + 4 ? 'start' : 'middle'}
                dominantBaseline="middle"
              >
                {a.label}
              </text>
            );
          })}
        </svg>

        {/* Legende obligatoire des qu'il y a deux series. */}
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.swatchHist} /> régularité sur {years} exercice{years > 1 ? 's' : ''}
          </span>
          <span className={styles.legendItem}>
            <span className={styles.swatchCurrent} /> résultat {currentYear} (0 ou 1 par test)
          </span>
        </div>
      </div>

      {/* Equivalent tabulaire : chaque valeur du graphique est lisible ici sans
          survol, le survol n'etant qu'un confort.

          L'en-tete n'est pas decoratif. Deux echelles de temps cohabitent dans
          une meme ligne — le resultat binaire de l'exercice et la frequence de
          reussite sur l'historique — et sans les nommer, une ligne comme
          « x Accruals 94 % » se lit comme une contradiction. */}
      <ul className={styles.table}>
        <li className={styles.head}>
          <span className={styles.headYear}>{currentYear}</span>
          <span
            className={styles.headHint}
            data-tooltip="Chaque test vaut 0 ou 1 sur l'exercice : c'est la coche ou la croix. Le pourcentage est autre chose — la part des exercices où le test a été réussi."
          >
            test
          </span>
          <span className={styles.headRate}>régularité</span>
          <span className={styles.headCount}>réussis</span>
        </li>
        {axes.map((a) => (
          <li key={a.id} className={styles.row} data-tooltip={a.fullLabel}>
            <span
              className={
                a.current == null ? styles.badgeNa : a.current ? styles.badgeOk : styles.badgeKo
              }
            >
              {a.current == null ? '?' : a.current ? '✓' : '×'}
            </span>
            <span className={a.current == null ? styles.nameNa : styles.name}>{a.label}</span>
            <span className={styles.rate}>
              {a.rate == null ? 'n/d' : `${Math.round(a.rate)} %`}
            </span>
            <span className={styles.count}>
              {a.available === 0 ? '—' : `${a.passed}/${a.available}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
