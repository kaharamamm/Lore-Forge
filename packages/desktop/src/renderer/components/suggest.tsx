import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { foldSearch, type IconName } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Popover } from './popover.tsx';

export interface Suggestion {
  /** What goes into the field when this is picked (an entry id, a race, a verb). */
  value: string;
  /** What the list shows; the value when not given. */
  label?: string;
  /** Muted text after the label, e.g. "character · char-mr-camel". */
  detail?: string;
  icon?: IconName;
  /** Colours the icon like the entry type (t-character, t-place, ...). */
  tone?: string;
}

/** At most this many rows are drawn; typing narrows a longer list. */
const MAX_ROWS = 120;

/** The suggestions matching `query`: label starts first, then anything containing it (label, value or detail). */
export function filterSuggestions(all: readonly Suggestion[], query: string): Suggestion[] {
  const q = foldSearch(query.trim());
  if (!q) return all.slice(0, MAX_ROWS);
  const starts: Suggestion[] = [];
  const contains: Suggestion[] = [];
  for (const s of all) {
    const label = foldSearch(s.label ?? s.value);
    if (label.startsWith(q)) starts.push(s);
    else if (label.includes(q) || foldSearch(s.value).includes(q) || (s.detail && foldSearch(s.detail).includes(q))) contains.push(s);
  }
  return [...starts, ...contains].slice(0, MAX_ROWS);
}

/** The label with the typed text marked, when it appears as typed (ignoring case). */
function marked(label: string, query: string): ComponentChildren {
  const q = query.trim();
  const at = q ? label.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return label;
  return <>{label.slice(0, at)}<mark>{label.slice(at, at + q.length)}</mark>{label.slice(at + q.length)}</>;
}

/**
 * A text box with the app's themed suggestion list, in place of a native <datalist>: Chromium on Linux draws that
 * list unstyled and leaves it floating when the page scrolls. Typing filters the list (typed text stays allowed, the
 * list only suggests); a click in the box, the chevron or Down shows every suggestion. Down and Up move, Enter or a
 * click picks, Escape or Tab closes, and scrolling the page closes it (see Popover). The caller wraps the box and
 * passes that wrapper as `anchor`, so the list lines up with the whole field.
 */
export function SuggestInput({ id, value, suggestions, onInput, onPick, onKeyDown, onBlur, anchor, placeholder, invalid, describedBy, class: cls, chevron = true, icon }: {
  id?: string;
  value: string;
  suggestions: readonly Suggestion[];
  onInput: (text: string, e: InputEvent) => void;
  onPick: (s: Suggestion) => void;
  /** Runs for keys the list does not use (Enter with nothing highlighted, Backspace, ...). */
  onKeyDown?: (e: KeyboardEvent) => void;
  onBlur?: () => void;
  anchor: RefObject<HTMLElement>;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  class?: string;
  chevron?: boolean;
  /** The current value's icon (a gender, a kind), shown at the start of the box like the list shows it. */
  icon?: IconName;
}) {
  const own = useId();
  const listId = `${id ?? own}-suggestions`;
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // What the list is filtered by: the text typed since it opened, or null to show everything.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const rows = filterSuggestions(suggestions, query ?? '');
  const shown = open && rows.length > 0;
  useEffect(() => { if (shown && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [shown, active]);

  const showAll = (at = -1) => { setQuery(null); setActive(at); setOpen(true); };
  const close = () => { setOpen(false); setActive(-1); };
  const pick = (s: Suggestion) => { close(); onPick(s); input.current?.focus(); };
  const keys = (e: KeyboardEvent) => {
    const k = e.key;
    if (!shown) {
      if (k === 'ArrowDown' && suggestions.length) { e.preventDefault(); showAll(0); return; }
      onKeyDown?.(e);
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, rows.length - 1)); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, -1)); }
    else if (k === 'PageDown') { e.preventDefault(); setActive(Math.min(active + 8, rows.length - 1)); }
    else if (k === 'PageUp') { e.preventDefault(); setActive(Math.max(active - 8, 0)); }
    else if (k === 'Enter' && active >= 0) { e.preventDefault(); pick(rows[active]!); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else { if (k === 'Tab') close(); onKeyDown?.(e); }
  };
  return (
    <>
      {icon && <Icon name={icon} class="suggest-lead" />}
      <input ref={input} id={id} type="text" class={`${cls ?? ''}${icon ? ' has-lead' : ''}`.trim() || undefined} value={value} placeholder={placeholder} autoComplete="off" spellcheck={false}
        role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={listId} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        onInput={(e) => { const t = e.currentTarget.value; setQuery(t); setActive(-1); setOpen(true); onInput(t, e as InputEvent); }}
        onClick={() => (open ? close() : showAll())}
        onKeyDown={keys}
        onBlur={() => { close(); onBlur?.(); }} />
      {chevron && suggestions.length > 0 && (
        <button type="button" class={`suggest-toggle${shown ? ' is-open' : ''}`} tabIndex={-1} aria-label="Show suggestions" title="Show suggestions"
          onPointerDown={(e) => e.preventDefault()} onClick={() => { if (shown) close(); else showAll(); input.current?.focus(); }}>
          <span class="select-chevron" aria-hidden="true" />
        </button>
      )}
      {shown && (
        <Popover anchor={anchor} class="select-popover suggest-popover" matchWidth onPointerDown={(e) => e.preventDefault()} onClose={close}>
          <ul id={listId} role="listbox" class="select-list" aria-label="Suggestions">
            {rows.map((s, i) => (
              <li key={s.value} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                class={`select-option suggest-option${i === active ? ' is-active' : ''}${s.value === value ? ' is-current' : ''}${s.tone ? ` ${s.tone}` : ''}`}
                onPointerMove={() => i !== active && setActive(i)} onClick={() => pick(s)}>
                {s.icon && <Icon name={s.icon} class="suggest-icon" />}
                <span class="suggest-label">{marked(s.label ?? s.value, query ?? '')}</span>
                {s.detail && <span class="suggest-detail">{s.detail}</span>}
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}
