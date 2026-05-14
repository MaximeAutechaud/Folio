import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './Select.module.css';

export interface SelectOption {
  value: number | string;
  label: string;
  sublabel?: string;
}

interface Props {
  options: SelectOption[];
  value: number | string | null;
  onChange: (value: number | string) => void;
  placeholder?: string;
}

export function Select({ options, value, onChange, placeholder = 'Sélectionner…' }: Props) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find(o => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDropPos(null);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function handleToggle() {
    if (open) { setOpen(false); setDropPos(null); return; }
    const rect = triggerRef.current!.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  }

  function handleSelect(opt: SelectOption) {
    onChange(opt.value);
    setOpen(false);
    setDropPos(null);
  }

  return (
    <>
      <button ref={triggerRef} className={styles.trigger} onClick={handleToggle}>
        <span className={styles.triggerContent}>
          {selected ? (
            <>
              <span className={styles.triggerLabel}>{selected.label}</span>
              {selected.sublabel && <span className={styles.triggerSub}>{selected.sublabel}</span>}
            </>
          ) : (
            <span className={styles.triggerPlaceholder}>{placeholder}</span>
          )}
        </span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>▾</span>
      </button>

      {open && dropPos && createPortal(
        <div
          className={styles.dropdown}
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}
        >
          {options.map(opt => (
            <div
              key={opt.value}
              className={`${styles.option} ${opt.value === value ? styles.optionSelected : ''}`}
              onMouseDown={() => handleSelect(opt)}
            >
              <span className={styles.optionLabel}>{opt.label}</span>
              {opt.sublabel && <span className={styles.optionSub}>{opt.sublabel}</span>}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
