import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSetting } from '../../lib/db';
import { callAnthropic, getAnthropicModel, ANTHROPIC_API_KEY_SETTING } from '../../lib/anthropic';
import { buildBriefingSnapshot } from '../../lib/briefingSnapshot';
import { BRIEFING_SYSTEM, BRIEFING_SCHEMA, buildBriefingUserMessage, validateBriefing, type Briefing } from '../../lib/briefingPrompt';
import { loadLastBriefing, saveLastBriefing, type StoredBriefing } from '../../lib/briefingStore';
import styles from './BriefingTab.module.css';

interface Props {
  settingsOpen: boolean;
  onOpenSettings: () => void;
}

type GenState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'err'; message: string };

const ORIENTATION_BADGE: Record<Briefing['postureMacro']['orientation'], string> = {
  offensif: styles.badgeGreen,
  selectif: styles.badgeAccent,
  defensif: styles.badgeRed,
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDate(ymd: string): string {
  const d = new Date(ymd);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function BriefingTab({ settingsOpen, onOpenSettings }: Props) {
  const queryClient = useQueryClient();
  const [stored, setStored] = useState<StoredBriefing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [gen, setGen] = useState<GenState>({ kind: 'idle' });
  const wasSettingsOpen = useRef(settingsOpen);

  useEffect(() => {
    loadLastBriefing().then((b) => { setStored(b); setLoaded(true); });
    getSetting(ANTHROPIC_API_KEY_SETTING).then((v) => {
      const present = !!v;
      setHasKey(present);
      if (!present) onOpenSettings(); // pas de clé → force les réglages à l'ouverture de l'onglet
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Modale de réglages qui vient de se fermer → re-vérifie la clé (l'utilisateur
    // vient peut-être de l'enregistrer), sinon hasKey reste bloqué sur false jusqu'au
    // prochain montage de l'onglet.
    if (wasSettingsOpen.current && !settingsOpen) {
      getSetting(ANTHROPIC_API_KEY_SETTING).then((v) => setHasKey(!!v));
    }
    wasSettingsOpen.current = settingsOpen;
  }, [settingsOpen]);

  async function handleGenerate() {
    setGen({ kind: 'running' });
    try {
      const snap = buildBriefingSnapshot(queryClient);
      const userMessage = buildBriefingUserMessage(snap);

      // 2 tentatives max : la sortie contrainte peut dégénérer (JSON valide mais
      // contenu cassé — cf. validateBriefing) ; un simple re-tirage suffit en général.
      let briefing: Briefing | null = null;
      let lastReason = '';
      for (let attempt = 0; attempt < 2 && !briefing; attempt++) {
        const text = await callAnthropic(userMessage, {
          system: BRIEFING_SYSTEM,
          jsonSchema: BRIEFING_SCHEMA,
          maxTokens: 8192, // inclut le thinking adaptatif, pas seulement le JSON
        });
        const candidate = JSON.parse(text) as Briefing;
        const reason = validateBriefing(candidate);
        if (reason == null) briefing = candidate;
        else lastReason = reason;
      }
      if (!briefing) {
        throw new Error(`Sortie du modèle invalide après 2 tentatives (${lastReason}).`);
      }

      const record: StoredBriefing = {
        generatedAt: new Date().toISOString(),
        snapshotDate: snap.meta.date,
        model: await getAnthropicModel(),
        briefing,
      };
      await saveLastBriefing(record);
      setStored(record);
      setGen({ kind: 'idle' });
    } catch (e) {
      setGen({ kind: 'err', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const running = gen.kind === 'running';
  const b = stored?.briefing;

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <span className={styles.title}>Briefing IA</span>
          {stored && (
            <span className={styles.meta}>
              Généré le {fmtDateTime(stored.generatedAt)} · données du {fmtDate(stored.snapshotDate)} · {stored.model}
            </span>
          )}
        </div>
        <button
          className={styles.genBtn}
          onClick={handleGenerate}
          disabled={running || hasKey === false}
        >
          {running ? <span className={styles.spinner} /> : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>
            </svg>
          )}
          {running ? 'Génération…' : stored ? 'Regénérer' : 'Générer'}
        </button>
      </div>

      {gen.kind === 'err' && (
        <div className={styles.errBanner}>Échec de la génération : {gen.message}</div>
      )}

      {hasKey === false ? (
        <div className={styles.empty}>
          <svg className={styles.emptyIcon} width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <div className={styles.emptyText}>
            Aucune clé API Anthropic configurée. Le briefing est généré par un appel unique à l'API,
            à partir des seules données de l'app.
          </div>
          <button className={styles.linkBtn} onClick={onOpenSettings}>Configurer la clé API</button>
        </div>
      ) : loaded && !stored ? (
        <div className={styles.empty}>
          <svg className={styles.emptyIcon} width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
          </svg>
          <div className={styles.emptyText}>
            Aucun briefing pour le moment. Lance une génération pour obtenir une lecture claire
            de l'état de ton portefeuille et du contexte de marché.
          </div>
        </div>
      ) : b ? (
        <>
          <div className={styles.synthese}>{b.syntheseGlobale}</div>

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>Posture macro</span>
              <span className={`${styles.badge} ${styles.badgeNeutral}`}>{b.postureMacro.regime}</span>
              <span className={`${styles.badge} ${ORIENTATION_BADGE[b.postureMacro.orientation]}`}>
                {b.postureMacro.orientation}
              </span>
            </div>
            <div className={styles.resume}>{b.postureMacro.resume}</div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>Risque portefeuille</span>
            </div>
            <div className={styles.resume}>{b.risquePortefeuille.resume}</div>
            {b.risquePortefeuille.constats.length > 0 && (
              <ul className={styles.constats}>
                {b.risquePortefeuille.constats.map((c, i) => (
                  <li key={i} className={styles.constat}>{c}</li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>Rotation sectorielle</span>
            </div>
            <div className={styles.resume}>{b.rotationSecteurs.resume}</div>
            {b.rotationSecteurs.aSurveiller.length > 0 && (
              <div className={styles.watchGrid}>
                {b.rotationSecteurs.aSurveiller.map((s, i) => (
                  <div key={i} className={styles.watchItem}>
                    <span className={styles.watchName}>{s.secteur}</span>
                    <span className={styles.watchReason}>{s.raison}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>À regarder maintenant</span>
            </div>
            <div className={styles.points}>
              {b.pointsAregarder.map((p, i) => (
                <div key={i} className={styles.point}>
                  <span className={styles.pointNum}>{i + 1}</span>
                  <div className={styles.pointBody}>
                    <span className={styles.pointTitle}>{p.titre}</span>
                    <span className={styles.pointDetail}>{p.detail}</span>
                    <span className={styles.pointBasis}>↳ {p.fondeSur}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.disclaimer}>
            Analyse fondée uniquement sur les données de l'app (momentum relatif) : ni les résultats
            d'entreprises, ni les news, ni la valorisation n'y entrent. Considérations, pas conseils.
          </div>
        </>
      ) : null}
    </div>
  );
}
