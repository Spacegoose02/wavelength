import { type ReactNode, useEffect, useRef, useState } from 'react';
import { IconPencil, IconX } from './Icons';

/**
 * The shell of the Edit song / Edit album / Edit artist dialogs (views/SongEditor.tsx, AlbumEditor.tsx,
 * ArtistEditor.tsx), laid out like Plex's: a pencil and the title on top, sections down the left (a row of tabs on a
 * phone), the section's fields on the right, and Cancel / Save along the bottom. Esc or a click outside closes it,
 * except while it's saving.
 */
export function EditDialog<T extends string>({ title, tabs, tab, onTab, busy, onClose, footer, children, className }: {
  title: string;
  /** extra classes on the dialog ("narrow" for a dialog with one section) */
  className?: string;
  tabs: readonly (readonly [T, string])[];
  tab: T;
  onTab: (t: T) => void;
  busy?: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return (
    <div className="pin-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className={`edit-dialog ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="edit-dialog-head">
          <IconPencil aria-hidden />
          <h3>{title}</h3>
          <button className="icon-btn" title="Close" onClick={onClose} disabled={busy}><IconX /></button>
        </header>
        <div className="edit-dialog-body">
          {tabs.length > 1 && (
            <nav className="edit-dialog-tabs" role="tablist" aria-label="Sections">
              {tabs.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>{label}</button>
              ))}
            </nav>
          )}
          <div className="edit-dialog-pane">{children}</div>
        </div>
        <footer className="edit-dialog-foot">{footer}</footer>
      </div>
    </div>
  );
}

/**
 * A list of names as chips, Plex style: type and press Enter (or pick a suggestion) to add one, × or Backspace in
 * the empty box to take one off. Pasting "A, B & C" adds each (`split`).
 */
export function ChipInput({ values, onChange, list, placeholder, split, label }: {
  values: string[];
  onChange: (v: string[]) => void;
  list?: string;
  placeholder?: string;
  split: (s: string) => string[];
  label: string;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const names = split(raw).filter((n) => !values.some((v) => v.toLowerCase() === n.toLowerCase()));
    if (names.length) onChange([...values, ...names]);
    setText('');
  };
  return (
    <div className="chip-input" onClick={() => ref.current?.focus()}>
      {values.map((v, i) => (
        <span key={`${v}:${i}`} className="chip on">
          {v}
          <button type="button" aria-label={`Remove ${label} ${v}`} onClick={(e) => { e.stopPropagation(); onChange(values.filter((_, j) => j !== i)); }}><IconX /></button>
        </span>
      ))}
      <input ref={ref} list={list} value={text} placeholder={placeholder} aria-label={`Add a ${label}`}
        onChange={(e) => {
          const v = e.target.value;
          // a suggestion picked from the list comes in whole: add it straight away
          const native = e.nativeEvent as InputEvent;
          if (!native.inputType || native.inputType === 'insertReplacementText') return add(v);
          setText(v);
        }}
        onPaste={(e) => {
          const v = e.clipboardData.getData('text');
          if (split(v).length > 1) {
            e.preventDefault();
            add(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)} />
    </div>
  );
}
