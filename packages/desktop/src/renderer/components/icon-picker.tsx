import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { searchIcons, type IconName } from '@lore-forge/core';
import { Icon } from './icon.tsx';

const labelOf = (name: IconName) => name.replace(/-/g, ' ');

/**
 * A grid of game-icons with a search box on top. The search matches icon names and keywords (see searchIcons in
 * core), waits for a short pause in typing, and says how many icons it found. Keyboard: Down from the box goes into
 * the grid, Enter in the box picks the first match, arrows/Home/End move in the grid (one Tab stop), Up from the
 * first row goes back to the box, Escape in a non-empty box clears it. `none` adds a "No emblem" choice first.
 */
export function IconPicker({ label, choices, value, onPick, none, class: cls }: {
  label: string;
  choices: readonly IconName[];
  value: IconName | null | undefined;
  onPick: (name: IconName | null) => void;
  none?: string;
  class?: string;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 150);
    return () => clearTimeout(t);
  }, [text]);
  const found = useMemo(() => searchIcons(choices, query), [choices, query]);
  const items: (IconName | null)[] = none && !query ? [null, ...found] : found;
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);
  const grid = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const focusAt = (i: number) => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    setActive(n);
    grid.current?.querySelectorAll<HTMLButtonElement>('.icon-choice')[n]?.focus();
  };
  const columns = () => {
    const g = grid.current;
    return g ? Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length) : 1;
  };
  const onGridKey = (e: KeyboardEvent) => {
    const cols = columns();
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    if (e.key === 'ArrowUp' && active < cols) { e.preventDefault(); input.current?.focus(); return; }
    if (e.key in moves) { e.preventDefault(); focusAt(active + moves[e.key]!); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(items.length - 1); }
  };
  const onInputKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); focusAt(0); }
    else if (e.key === 'Enter') { e.preventDefault(); const first = searchIcons(choices, text.trim())[0]; if (first) onPick(first); }
    else if (e.key === 'Escape' && text) { e.preventDefault(); e.stopPropagation(); setText(''); setQuery(''); }
  };
  const total = choices.length + (none ? 1 : 0);
  const id = `icon-grid-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div class={`icon-picker${cls ? ` ${cls}` : ''}`}>
      <div class="icon-search">
        <Icon name="magnifying-glass" />
        <input ref={input} type="search" value={text} placeholder="Search icons..." aria-label={`Search ${label.toLowerCase()} icons`} aria-controls={id} spellcheck={false}
          onInput={(e) => setText(e.currentTarget.value)} onKeyDown={onInputKey} />
        <span class="icon-count muted" aria-live="polite">{query ? `${found.length} of ${total}` : `${total} icons`}</span>
      </div>
      {items.length === 0 ? (
        <p class="icon-empty muted">No icon matches “{query}”. Try another word, like sword, tower or kale.</p>
      ) : (
        <div ref={grid} id={id} class="icon-choices" role="group" aria-label={label} onKeyDown={onGridKey}>
          {items.map((name, i) => {
            const title = name ? labelOf(name) : none!;
            return (
              <button key={name ?? '\u0000none'} type="button" class="icon-choice" tabIndex={i === Math.min(active, items.length - 1) ? 0 : -1}
                aria-pressed={name ? name === value : !value} title={title} aria-label={title} data-icon={name ?? ''}
                onFocus={() => setActive(i)} onClick={() => onPick(name)}><Icon name={name ?? 'cancel'} /></button>
            );
          })}
        </div>
      )}
    </div>
  );
}
