import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { searchYahoo } from '../../lib/api/yahoo';
import { searchCoinGecko } from '../../lib/api/coingecko';
import styles from './TickerSearch.module.css';

export interface TickerResult {
  ticker: string;
  name: string;
  assetType: 'stock' | 'crypto';
  sublabel: string;
}

interface Props {
  onSelect: (result: TickerResult) => void;
  placeholder?: string;
}

export function TickerSearch({ onSelect, placeholder = 'Rechercher un ticker — "NVDA", "bitcoin"…' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TickerResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function updateDropPos() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const [stocks, cryptos] = await Promise.all([
        searchYahoo(value).catch(() => []),
        searchCoinGecko(value).catch(() => []),
      ]);

      const stockResults: TickerResult[] = stocks.slice(0, 5).map(s => ({
        ticker: s.symbol,
        name: s.shortname || s.symbol,
        assetType: 'stock',
        sublabel: s.exchDisp || '',
      }));

      const cryptoResults: TickerResult[] = cryptos.slice(0, 4).map(c => ({
        ticker: c.id,
        name: c.name,
        assetType: 'crypto',
        sublabel: `#${c.market_cap_rank ?? '—'} · ${c.symbol.toUpperCase()}`,
      }));

      setResults([...stockResults, ...cryptoResults]);
      setLoading(false);
      updateDropPos();
      setOpen(stockResults.length + cryptoResults.length > 0);
    }, 280);
  }

  function handleFocus() {
    updateDropPos();
    if (results.length > 0) setOpen(true);
  }

  function handlePick(r: TickerResult) {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect(r);
  }

  return (
    <>
      <div className={styles.wrap}>
        <span className={styles.icon}>⌕</span>
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && <span className={styles.spinner} />}
      </div>

      {open && dropPos && createPortal(
        <div className={styles.dropdown} style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}>
          {results.map((r, i) => {
            const prevType = i > 0 ? results[i - 1].assetType : null;
            const showSep = prevType && prevType !== r.assetType;
            return (
              <div key={`${r.assetType}-${r.ticker}`}>
                {showSep && <div className={styles.sep} />}
                <div className={styles.option} onMouseDown={() => handlePick(r)}>
                  <span className={`${styles.typeBadge} ${r.assetType === 'crypto' ? styles.crypto : styles.stock}`}>
                    {r.assetType === 'crypto' ? 'CRYPTO' : 'STOCK'}
                  </span>
                  <span className={styles.ticker}>{r.assetType === 'crypto' ? r.name : r.ticker}</span>
                  <span className={styles.name}>{r.assetType === 'crypto' ? r.sublabel : r.name}</span>
                  {r.assetType === 'stock' && r.sublabel && (
                    <span className={styles.exch}>{r.sublabel}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
