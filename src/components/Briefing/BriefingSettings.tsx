import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '../../lib/db';
import { callAnthropic, ANTHROPIC_API_KEY_SETTING, ANTHROPIC_MODEL, ANTHROPIC_MODEL_SETTING, ANTHROPIC_MODELS } from '../../lib/anthropic';
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
  const [key, setKey] = useState('');
  const [model, setModel] = useState<string>(ANTHROPIC_MODEL);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    getSetting(ANTHROPIC_API_KEY_SETTING).then((v) => {
      setKey(v ?? '');
      setLoaded(true);
    });
    getSetting(ANTHROPIC_MODEL_SETTING).then((v) => {
      if (v) setModel(v);
    });
  }, []);

  async function handleModelChange(id: string) {
    setModel(id);
    await setSetting(ANTHROPIC_MODEL_SETTING, id);
  }

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
          </p>

          <label className={styles.label}>
            Modèle
            <select
              className={styles.input}
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

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
        </div>
      </div>
    </div>
  );
}
