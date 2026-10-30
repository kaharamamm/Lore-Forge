import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { normalizeName, type IconName } from '@lore-forge/core';
import { Icon } from './icon.tsx';

export interface PaletteItem {
  id: string;
  label: string;
  /** Shown muted after the label, and searched too (type, race, aliases). */
  hint?: string;
  icon: IconName;
  group: 'Go to' | 'Create' | 'Publish' | 'World' | 'Entries';
  /** Extra class on the row, e.g. the entry's type colour. */
  tone?: string;
  run: (query: string) => void;
}

/** Ctrl+K: jump to any entry or run any command by typing a few letters. */
export function CommandPalette({ items, extra, onClose }: { items: PaletteItem[]; extra?: (query: string) => PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    input.current?.focus();
    const focused = back.current;
    return () => (focused as HTMLElement | null)?.focus?.();
  }, []);
  const q = normalizeName(query);
  const shown = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    const hits = items.filter((it) => { const hay = normalizeName(`${it.label} ${it.hint ?? ''} ${it.group}`); return words.every((w) => hay.includes(w)); });
    // Label starts first, then the rest in their given order; without a query, entries come after commands.
    const ranked = q ? [...hits.filter((it) => normalizeName(it.label).startsWith(q)), ...hits.filter((it) => !normalizeName(it.label).startsWith(q))] : hits;
    return [...ranked, ...(extra && query.trim() ? extra(query.trim()) : [])];
  }, [items, extra, q]);
  const pick = Math.min(active, Math.max(shown.length - 1, 0));
  useEffect(() => { document.getElementById(`pal-${pick}`)?.scrollIntoView({ block: 'nearest' }); }, [pick]);
  const run = (it: PaletteItem | undefined) => { if (!it) return; onClose(); it.run(query.trim()); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = shown.length;
      if (n) setActive((pick + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') { e.preventDefault(); run(shown[pick]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let lastGroup = '';
  return (
    <div class="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="palette-input">
          <Icon name="magnifying-glass" />
          <input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown.length ? `pal-${pick}` : undefined}
            aria-label="Type a command or an entry name" placeholder="Type a command or an entry name…" value={query}
            onInput={(e) => { setQuery(e.currentTarget.value); setActive(0); }} onKeyDown={onKey} />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" class="palette-list" aria-label="Results">
          {shown.length === 0 && <li class="palette-empty muted">Nothing matches “{query}”.</li>}
          {shown.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <>
                {head && <li key={`g-${head}`} role="presentation" class="palette-group">{head}</li>}
                <li key={it.id} id={`pal-${i}`} role="option" aria-selected={i === pick} class={`palette-item${it.tone ? ` ${it.tone}` : ''}`}
                  onMouseMove={() => i !== pick && setActive(i)} onClick={() => run(it)}>
                  <Icon name={it.icon} class="palette-icon" />
                  <span class="palette-label">{it.label}</span>
                  {it.hint && <span class="palette-hint muted">{it.hint}</span>}
                </li>
              </>
            );
          })}
        </ul>
        <p class="palette-foot muted"><kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to run</p>
      </div>
    </div>
  );
}
