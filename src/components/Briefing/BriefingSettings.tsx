import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSetting, setSetting } from '../../lib/db';
import { callAnthropic, ANTHROPIC_API_KEY_SETTING, ANTHROPIC_MODEL } from '../../lib/anthropic';
import { buildBriefingSnapshot } from '../../lib/briefingSnapshot';
import { BRIEFING_SYSTEM, BRIEFING_SCHEMA, buildBriefingUserMessage } from '../../lib/briefingPrompt';
import styles from './BriefingSettings.module.css';

interface Props {
  onClose: () => void;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; text: string }
  | { kind: 'err'; message: string };

export function BriefingSettings({ onClose }: Props) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [gen, setGen] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    getSetting(ANTHROPIC_API_KEY_SETTING).then((v) => {
      setKey(v ?? '');
      setLoaded(true);
    });
  }, []);

  async function handleSave() {
    await setSetting(ANTHROPIC_API_KEY_SETTING, key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function handleTest() {
    setTest({ kind: 'running' });
    try {
      await setSetting(ANTHROPIC_API_KEY_SETTING, key.trim()); // teste la clé courante
      const text = await callAnthropic('Réponds uniquement par le mot: OK', { maxTokens: 20 });
      setTest({ kind: 'ok', text: text.trim() || '(vide)' });
    } catch (e) {
      setTest({ kind: 'err', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleGenerate() {
    setGen({ kind: 'running' });
    try {
      const snap = buildBriefingSnapshot(queryClient);
      const text = await callAnthropic(buildBriefingUserMessage(snap), {
        system: BRIEFING_SYSTEM,
        jsonSchema: BRIEFING_SCHEMA,
        maxTokens: 2048,
      });
      setGen({ kind: 'ok', text: JSON.stringify(JSON.parse(text), null, 2) });
    } catch (e) {
      setGen({ kind: 'err', message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Briefing IA — Réglages</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <label className={styles.label}>
            Clé API Anthropic
            <input
              className={styles.input}
              type="password"
              placeholder="sk-ant-..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoFocus={loaded}
            />
          </label>
          <p className={styles.hint}>
            Stockée en local (SQLite), jamais envoyée ailleurs qu'à l'API Anthropic.
            Modèle : <strong>{ANTHROPIC_MODEL}</strong>.
          </p>

          <div className={styles.row}>
            <button className={styles.btn} onClick={handleSave} disabled={!key.trim()}>
              {saved ? 'Enregistré ✓' : 'Enregistrer'}
            </button>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleTest}
              disabled={!key.trim() || test.kind === 'running'}
            >
              {test.kind === 'running' ? 'Test…' : 'Tester la connexion'}
            </button>
          </div>

          {test.kind === 'ok' && (
            <div className={`${styles.status} ${styles.statusOk}`}>
              Connexion OK — réponse : {test.text}
            </div>
          )}
          {test.kind === 'err' && (
            <div className={`${styles.status} ${styles.statusErr}`}>
              Échec : {test.message}
            </div>
          )}

          <div className={styles.divider} />

          <button
            className={styles.btn}
            onClick={() => setSnapshot(JSON.stringify(buildBriefingSnapshot(queryClient), null, 2))}
          >
            Aperçu du snapshot (données envoyées)
          </button>
          {snapshot && <pre className={styles.snapshot}>{snapshot}</pre>}

          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleGenerate}
            disabled={!key.trim() || gen.kind === 'running'}
          >
            {gen.kind === 'running' ? 'Génération…' : 'Générer un briefing (test)'}
          </button>
          {gen.kind === 'err' && (
            <div className={`${styles.status} ${styles.statusErr}`}>Échec : {gen.message}</div>
          )}
          {gen.kind === 'ok' && <pre className={styles.snapshot}>{gen.text}</pre>}
        </div>
      </div>
    </div>
  );
}
