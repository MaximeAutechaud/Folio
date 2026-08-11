import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '../../lib/db';
import { callAnthropic, ANTHROPIC_API_KEY_SETTING, ANTHROPIC_MODEL, ANTHROPIC_MODEL_SETTING, ANTHROPIC_MODELS } from '../../lib/anthropic';
import { SEC_CONTACT_EMAIL_SETTING } from '../../lib/api/sec';
import styles from './AppSettings.module.css';

interface Props {
  onClose: () => void;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; text: string }
  | { kind: 'err'; message: string };

export function AppSettings({ onClose }: Props) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState<string>(ANTHROPIC_MODEL);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const [secEmail, setSecEmail] = useState('');
  const [secSaved, setSecSaved] = useState(false);

  useEffect(() => {
    getSetting(ANTHROPIC_API_KEY_SETTING).then((v) => {
      setKey(v ?? '');
      setLoaded(true);
    });
    getSetting(ANTHROPIC_MODEL_SETTING).then((v) => {
      if (v) setModel(v);
    });
    getSetting(SEC_CONTACT_EMAIL_SETTING).then((v) => setSecEmail(v ?? ''));
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

  async function handleSecSave() {
    await setSetting(SEC_CONTACT_EMAIL_SETTING, secEmail.trim());
    setSecSaved(true);
    setTimeout(() => setSecSaved(false), 1500);
  }

  const secEmailValid = secEmail.trim().includes('@');

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Réglages</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.sectionTitle}>Briefing IA</div>

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

          <div className={styles.divider} />
          <div className={styles.sectionTitle}>Données fondamentales (SEC)</div>

          <label className={styles.label}>
            Adresse e-mail de contact
            <input
              className={styles.input}
              type="email"
              placeholder="prenom.nom@exemple.com"
              value={secEmail}
              onChange={(e) => setSecEmail(e.target.value)}
            />
          </label>
          <p className={styles.hint}>
            La SEC exige une adresse de contact dans les requêtes vers son annuaire des sociétés,
            et refuse (403) celles qui n'en portent pas. Elle reste en local et n'est envoyée
            qu'à sec.gov — c'est pour cette raison qu'elle n'est pas inscrite dans le code,
            le dépôt étant public.
          </p>

          <div className={styles.row}>
            <button className={styles.btn} onClick={handleSecSave} disabled={!secEmailValid}>
              {secSaved ? 'Enregistré ✓' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
