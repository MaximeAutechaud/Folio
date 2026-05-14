import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './InfoTooltip.module.css';

interface Props {
  text: string;
}

export function InfoTooltip({ text }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    function onMouseDown(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setPos(null);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [pos]);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const rect = btnRef.current!.getBoundingClientRect();
    setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
  }

  return (
    <>
      <button
        ref={btnRef}
        className={styles.trigger}
        onClick={handleClick}
        aria-label="Plus d'infos"
      >
        ⓘ
      </button>
      {pos && createPortal(
        <div className={styles.popover} style={{ top: pos.top, left: pos.left }}>
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
