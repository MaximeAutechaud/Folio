import { useState, useRef } from 'react';
import { useWatchlist } from '../../hooks/useWatchlist';
import { TickerChart } from '../TickerChart/TickerChart';
import { TickerSearch } from '../TickerSearch/TickerSearch';
import { AlertForm } from '../AlertPanel/AlertForm';
import type { WatchlistRow } from '../../hooks/useWatchlist';
import type { WatchlistCategory } from '../../types';
import type { TickerResult } from '../TickerSearch/TickerSearch';
import styles from './WatchlistView.module.css';

// ── Constants ──────────────────────────────────────────────────────────────────

const CAT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#6e7681'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function rsiColor(rsi: number): string {
  if (rsi >= 70) return 'var(--red)';
  if (rsi >= 55) return '#d29922';
  if (rsi >= 45) return 'var(--fg-muted, #6e7681)';
  if (rsi >= 30) return '#3fb950';
  return 'var(--green)';
}

function fmtPrice(price: number | null): string {
  if (price == null) return '—';
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1)    return price.toFixed(2);
  return price.toFixed(4);
}

function fmtPct(n: number | null): string {
  if (n == null) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ── Category header ────────────────────────────────────────────────────────────

interface GroupHeaderProps {
  category: WatchlistCategory | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onActivate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function GroupHeader({ category, count, collapsed, onToggle, onActivate, onRename, onDelete }: GroupHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(category?.name ?? '');
  const inputRef              = useRef<HTMLInputElement>(null);

  function startEdit() {
    if (!category) return;
    setDraft(category.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== category?.name) onRename(trimmed);
    setEditing(false);
  }

  const color = category?.color ?? '#6e7681';

  return (
    <div className={styles.groupHeader} onClick={onActivate}>
      <button className={styles.collapseBtn} onClick={e => { e.stopPropagation(); onToggle(); }}>
        <span className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`}>›</span>
      </button>
      <span className={styles.groupDot} style={{ background: color }} />
      {editing ? (
        <input
          ref={inputRef}
          className={styles.groupNameInput}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
        />
      ) : (
        <span
          className={styles.groupName}
          onDoubleClick={startEdit}
          title={category ? 'Double-clic pour renommer' : undefined}
        >
          {category ? category.name : 'Sans catégorie'}
        </span>
      )}
      <span className={styles.groupCount}>{count}</span>
      {category && (
        <button
          className={`${styles.groupDeleteBtn}`}
          onClick={onDelete}
          data-tooltip="Supprimer la catégorie"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Panel row ──────────────────────────────────────────────────────────────────

interface RowProps {
  row: WatchlistRow;
  selected: boolean;
  categories: WatchlistCategory[];
  isDragging: boolean;
  onClick: () => void;
  onAlert: () => void;
  onRemove: () => void;
  onAssign: (categoryId: number | null) => void;
  onPointerDown: (e: React.PointerEvent) => void;
}

function PanelRow({ row, selected, categories, isDragging, onClick, onAlert, onRemove, onAssign, onPointerDown }: RowProps) {
  const changePos = row.change1d != null && row.change1d >= 0;
  const vsMA50Pos = row.vsMA50 != null && row.vsMA50 >= 0;
  const atTop     = row.drawdown != null && row.drawdown > -1;
  const catColor  = categories.find(c => c.id === row.category_id)?.color ?? 'transparent';

  return (
    <div
      className={`${styles.row} ${selected ? styles.rowSelected : ''} ${isDragging ? styles.rowDragging : ''}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {/* Line 1: category dot + ticker + actions */}
      <div className={styles.rowTop}>
        <div className={styles.rowTopLeft}>
          <div className={styles.catDotWrap} title="Changer de catégorie">
            <span className={styles.catDot} style={{ background: row.category_id ? catColor : 'var(--border)' }} />
            <select
              className={styles.catSelect}
              value={row.category_id ?? ''}
              onChange={e => onAssign(e.target.value ? parseInt(e.target.value) : null)}
              onClick={e => e.stopPropagation()}
            >
              <option value="">Sans catégorie</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <span className={styles.rowTicker}>{row.ticker}</span>
        </div>
        <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
          <button className={styles.actionBtn} onClick={onAlert} data-tooltip="Créer une alerte">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>
          <button className={`${styles.actionBtn} ${styles.danger}`} onClick={onRemove} data-tooltip="Retirer">
            ✕
          </button>
        </div>
      </div>

      {/* Line 2: name + price + change */}
      <div className={styles.rowMiddle}>
        <span className={styles.rowName}>{row.name}</span>
        <div className={styles.rowPriceGroup}>
          <span className={styles.rowPrice}>
            {row.loading ? <span className={styles.loading}>…</span> : fmtPrice(row.price)}
          </span>
          <span className={`${styles.rowChange} ${changePos ? styles.green : row.change1d != null ? styles.red : styles.muted}`}>
            {fmtPct(row.change1d)}
          </span>
        </div>
      </div>

      {/* Line 3: indicators */}
      <div className={styles.rowMeta}>
        {row.rsi != null && (
          <span className={styles.metaChip} style={{ color: rsiColor(row.rsi) }}>
            RSI {row.rsi}
          </span>
        )}
        {row.vsMA50 != null && (
          <span className={`${styles.metaChip} ${vsMA50Pos ? styles.green : styles.red}`}>
            MA50 {fmtPct(row.vsMA50)}
          </span>
        )}
        {row.drawdown != null && (
          <span className={`${styles.metaChip} ${atTop ? styles.green : styles.muted}`}>
            {atTop ? '▲ top' : fmtPct(row.drawdown)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Add category form ──────────────────────────────────────────────────────────

interface AddCategoryFormProps {
  onAdd: (name: string, color: string) => void;
}

function AddCategoryForm({ onAdd }: AddCategoryFormProps) {
  const [open, setOpen]   = useState(false);
  const [name, setName]   = useState('');
  const [color, setColor] = useState(CAT_COLORS[0]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, color);
    setName('');
    setColor(CAT_COLORS[0]);
    setOpen(false);
  }

  if (!open) {
    return (
      <button className={styles.addCatBtn} onClick={() => setOpen(true)}>
        + Nouvelle catégorie
      </button>
    );
  }

  return (
    <form className={styles.addCatForm} onSubmit={handleSubmit}>
      <input
        className={styles.addCatInput}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Nom de la catégorie"
        autoFocus
      />
      <div className={styles.colorPicker}>
        {CAT_COLORS.map(c => (
          <button
            key={c}
            type="button"
            className={`${styles.colorSwatch} ${color === c ? styles.colorSwatchActive : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className={styles.addCatActions}>
        <button type="button" className={styles.cancelBtn} onClick={() => setOpen(false)}>Annuler</button>
        <button type="submit" className={styles.confirmBtn} disabled={!name.trim()}>Créer</button>
      </div>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function WatchlistView() {
  const { rows, groups, categories, addItem, removeItem, assignToCategory, addCategory, renameCategory, removeCategory } = useWatchlist();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [alertTicker, setAlertTicker]       = useState<string | null>(null);
  const [collapsed, setCollapsed]           = useState<Set<string>>(new Set());
  const [activeCatId, setActiveCatId]       = useState<number | null>(null);
  const [draggingId, setDraggingId]         = useState<number | null>(null);
  const [dragOverKey, setDragOverKey]       = useState<string | null>(null);
  const activeDrag = useRef<{
    id: number; catId: number | null; clone: HTMLElement;
    offsetX: number; offsetY: number; moved: boolean;
  } | null>(null);
  const lastDragWasMove = useRef(false);

  const selectedRow = rows.find(r => r.ticker === selectedTicker) ?? rows[0] ?? null;

  function toggleCollapse(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleAdd(result: TickerResult) {
    addItem(result.ticker, result.name, result.assetType, activeCatId);
    if (!selectedTicker) setSelectedTicker(result.ticker);
  }

  function handleGroupHeaderClick(catId: number | null) {
    setActiveCatId(catId);
  }

  function handleRowPointerDown(e: React.PointerEvent, row: WatchlistRow) {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    if (e.button !== 0) return;

    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    const clone = el.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, opacity: '0', pointerEvents: 'none',
      zIndex: '9999', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      borderRadius: '6px', background: 'var(--bg-secondary)',
    });
    document.body.appendChild(clone);

    activeDrag.current = {
      id: row.id, catId: row.category_id, clone,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, moved: false,
    };

    function onMove(ev: PointerEvent) {
      const drag = activeDrag.current;
      if (!drag) return;
      if (!drag.moved) {
        if (Math.abs(ev.clientX - startX) < 6 && Math.abs(ev.clientY - startY) < 6) return;
        drag.moved = true;
        drag.clone.style.opacity = '0.85';
        setDraggingId(drag.id);
      }
      drag.clone.style.left = `${ev.clientX - drag.offsetX}px`;
      drag.clone.style.top  = `${ev.clientY - drag.offsetY}px`;
      drag.clone.style.display = 'none';
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      drag.clone.style.display = '';
      setDragOverKey((under?.closest('[data-cat-key]') as HTMLElement | null)?.dataset.catKey ?? null);
    }

    function onUp(ev: PointerEvent) {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      const drag = activeDrag.current;
      if (!drag) return;
      drag.clone.remove();
      activeDrag.current = null;
      setDraggingId(null);
      setDragOverKey(null);
      if (!drag.moved) return;
      lastDragWasMove.current = true;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const groupEl = under?.closest('[data-cat-key]') as HTMLElement | null;
      if (!groupEl) return;
      const targetCatId = groupEl.dataset.catId === 'null' ? null : parseInt(groupEl.dataset.catId!);
      if (targetCatId !== drag.catId && (targetCatId === null || !isNaN(targetCatId))) {
        assignToCategory(drag.id, targetCatId);
      }
    }

    function onCancel() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      const drag = activeDrag.current;
      if (!drag) return;
      drag.clone.remove();
      activeDrag.current = null;
      setDraggingId(null);
      setDragOverKey(null);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }

  return (
    <div className={styles.root}>
      {/* LEFT: Chart 2/3 */}
      <div className={styles.chartArea}>
        {selectedRow ? (
          <TickerChart
            key={selectedRow.ticker}
            ticker={selectedRow.ticker}
            assetType={selectedRow.asset_type}
            name={`${selectedRow.ticker} · ${selectedRow.name}`}
          />
        ) : (
          <div className={styles.emptyChart}>
            Ajoutez un ticker dans la watchlist →
          </div>
        )}
      </div>

      {/* RIGHT: Panel 1/3 */}
      <div className={styles.panel}>
        <div className={styles.panelSearch}>
          <TickerSearch onSelect={handleAdd} placeholder='Ajouter — "NVDA", "AIR.PA"…' />
          {activeCatId != null && (
            <div className={styles.activeCatHint}>
              <span
                className={styles.activeCatDot}
                style={{ background: categories.find(c => c.id === activeCatId)?.color }}
              />
              <span className={styles.activeCatName}>
                {categories.find(c => c.id === activeCatId)?.name}
              </span>
              <button className={styles.activeCatClear} onClick={() => setActiveCatId(null)}>✕</button>
            </div>
          )}
        </div>

        <div className={styles.panelList}>
          {groups.map(group => {
            const key       = group.category ? `cat-${group.category.id}` : 'uncat';
            const isCollapsed = collapsed.has(key);

            // Hide "Sans catégorie" group if empty
            if (!group.category && group.rows.length === 0) return null;

            return (
              <div
                key={key}
                className={`${styles.group} ${dragOverKey === key && draggingId !== null ? styles.groupDragOver : ''}`}
                data-cat-key={key}
                data-cat-id={String(group.category?.id ?? null)}
              >
                <GroupHeader
                  category={group.category}
                  count={group.rows.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggleCollapse(key)}
                  onActivate={() => handleGroupHeaderClick(group.category?.id ?? null)}
                  onRename={name => renameCategory(group.category!.id, name)}
                  onDelete={() => removeCategory(group.category!.id)}
                />

                {!isCollapsed && group.rows.map(row => (
                  <PanelRow
                    key={row.id}
                    row={row}
                    selected={row.ticker === selectedRow?.ticker}
                    categories={categories}
                    isDragging={row.id === draggingId}
                    onClick={() => {
                      if (lastDragWasMove.current) { lastDragWasMove.current = false; return; }
                      setSelectedTicker(row.ticker);
                    }}
                    onAlert={() => setAlertTicker(row.ticker)}
                    onRemove={() => removeItem(row.id)}
                    onAssign={catId => assignToCategory(row.id, catId)}
                    onPointerDown={e => handleRowPointerDown(e, row)}
                  />
                ))}

                {!isCollapsed && group.rows.length === 0 && (
                  <div className={styles.groupEmpty}>Aucun ticker</div>
                )}
              </div>
            );
          })}

          {rows.length === 0 && (
            <div className={styles.panelEmpty}>Recherchez un ticker pour commencer</div>
          )}
        </div>

        <div className={styles.panelFooter}>
          <AddCategoryForm onAdd={addCategory} />
        </div>
      </div>

      {alertTicker != null && (
        <AlertForm prefillTicker={alertTicker} onClose={() => setAlertTicker(null)} />
      )}
    </div>
  );
}
