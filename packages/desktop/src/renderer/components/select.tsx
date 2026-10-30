import type { Ref } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { foldSearch } from '@lore-forge/core';
import { Popover } from './popover.tsx';

export interface SelectOption {
  value: string;
  label: string;
  /** Options with the same group sit under one heading, in the order given. */
  group?: string;
  disabled?: boolean;
}

/**
 * The app's drop-down: a button that shows the chosen option and opens a themed list in its own layer, in place of
 * the native <select>, whose list Chromium on Linux draws unstyled. Keyboard like a native select: arrows, Home, End,
 * Page Up/Down, Enter or Space to choose, Escape to close, Tab to choose and move on, and typing a few letters jumps.
 */
export function Select({ id, value, options, onChange, class: cls, invalid, autoFocus, buttonRef, placeholder = 'Choose…', ...aria }: {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  class?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  placeholder?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const own = useId();
  const listId = `${id ?? own}-list`;
  const button = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });
  const current = options.findIndex((o) => o.value === value);
  const enabled = (i: number) => !!options[i] && !options[i]!.disabled;
  useEffect(() => { if (autoFocus) button.current?.focus(); }, []);
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const show = (at = current) => { setActive(at >= 0 ? at : options.findIndex((_, i) => enabled(i))); setOpen(true); };
  const choose = (i: number) => {
    setOpen(false);
    if (enabled(i) && options[i]!.value !== value) onChange(options[i]!.value);
  };
  /** The next enabled option from `from` in direction `dir`, staying put at the ends. */
  const step = (from: number, dir: number) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i;
    return from;
  };
  const typeAhead = (ch: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 500 ? ch : t.text + ch;
    t.at = now;
    const q = foldSearch(t.text);
    // Typing the same letter again cycles through the options that start with it.
    const repeat = q.length > 1 && [...q].every((c) => c === q[0]);
    const want = repeat ? q[0]! : q;
    const from = open ? active : current;
    const order = options.map((_, i) => (from + (repeat || q.length === 1 ? 1 : 0) + i) % options.length);
    const hit = order.find((i) => enabled(i) && foldSearch(options[i]!.label).startsWith(want));
    if (hit === undefined) return;
    if (open) setActive(hit);
    else if (options[hit]!.value !== value) onChange(options[hit]!.value);
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); show(); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeAhead(k); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(step(active, 1)); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(step(active, -1)); }
    else if (k === 'Home') { e.preventDefault(); setActive(step(-1, 1)); }
    else if (k === 'End') { e.preventDefault(); setActive(step(options.length, -1)); }
    else if (k === 'PageDown') { e.preventDefault(); let i = active; for (let n = 0; n < 8; n++) i = step(i, 1); setActive(i); }
    else if (k === 'PageUp') { e.preventDefault(); let i = active; for (let n = 0; n < 8; n++) i = step(i, -1); setActive(i); }
    else if (k === 'Enter' || (k === ' ' && !typed.current.text)) { e.preventDefault(); choose(active); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (k === 'Tab') choose(active);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeAhead(k); }
  };
  // Space after a few typed letters is part of the search, not "choose"; the buffer empties after a pause.
  useEffect(() => { if (!open) typed.current.text = ''; }, [open]);

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={(el) => { button.current = el; if (typeof buttonRef === 'function') buttonRef(el); else if (buttonRef) buttonRef.current = el; }}
        id={id} type="button" role="combobox" class={`select${cls ? ` ${cls}` : ''}${open ? ' is-open' : ''}`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-invalid={invalid || undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} data-value={value} {...aria}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
        <span class={`select-value${current < 0 ? ' muted' : ''}`}>{current >= 0 ? options[current]!.label : placeholder}</span>
        <span class="select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <Popover anchor={button} class="select-popover" matchWidth onClose={(why) => { setOpen(false); if (why === 'escape') button.current?.focus(); }}>
          <ul id={listId} role="listbox" class="select-list" tabIndex={-1} aria-label={aria['aria-label']} aria-labelledby={aria['aria-label'] || !id ? undefined : id}>
            {options.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : undefined;
              lastGroup = o.group;
              return (
                <>
                  {head && <li key={`g-${head}`} role="presentation" class="select-group">{head}</li>}
                  <li key={o.value} id={`${listId}-${i}`} role="option" data-value={o.value} aria-selected={i === current} aria-disabled={o.disabled || undefined}
                    class={`select-option${i === active ? ' is-active' : ''}${o.group ? ' in-group' : ''}`}
                    onPointerDown={(e) => e.preventDefault()} onPointerMove={() => i !== active && enabled(i) && setActive(i)} onClick={() => { choose(i); button.current?.focus(); }}>
                    {o.label}
                  </li>
                </>
              );
            })}
          </ul>
        </Popover>
      )}
    </>
  );
}
