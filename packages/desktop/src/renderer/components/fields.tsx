import { useEffect, useId, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { DATE_FORMATS_HINT, describeDate, parseDate, TYPE_SINGULAR, WorldIndex, type Calendar, type IconName, type World } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Select } from './select.tsx';
import { EditErasLink } from './world-settings.tsx';

/** Empty input -> undefined, so empty fields disappear from the file. */
export const opt = (s: string): string | undefined => (s.trim() === '' ? undefined : s);

interface FieldProps {
  label: string;
  field: string;
  hint?: ComponentChildren;
  invalid?: boolean;
  children: (id: string, hintId: string) => ComponentChildren;
}

export function Field({ label, field, hint, invalid, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div class={`field${invalid ? ' field-invalid' : ''}`} data-field={field}>
      <label for={id}>{label}</label>
      {children(id, hintId)}
      {hint !== undefined && <div class="hint" id={hintId}>{invalid && <><Icon name="cancel" /> </>}{hint}</div>}
    </div>
  );
}

export function TextField(props: { label: string; field: string; value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string; hint?: string; multiline?: boolean }) {
  return (
    <Field label={props.label} field={props.field} hint={props.hint}>
      {(id, hintId) => props.multiline ? (
        <textarea id={id} rows={2} value={props.value ?? ''} placeholder={props.placeholder} aria-describedby={props.hint ? hintId : undefined} onInput={(e) => props.onChange(opt(e.currentTarget.value))} />
      ) : (
        <input id={id} type="text" value={props.value ?? ''} placeholder={props.placeholder} aria-describedby={props.hint ? hintId : undefined} onInput={(e) => props.onChange(opt(e.currentTarget.value))} />
      )}
    </Field>
  );
}

/** A list edited as text (comma- or line-separated). Keeps the raw text while typing. */
export function ListText(props: { label: string; field: string; value: string[] | undefined; onChange: (v: string[] | undefined) => void; resetKey: string; multiline?: boolean; hint?: string }) {
  const sep = props.multiline ? '\n' : ', ';
  const [text, setText] = useState((props.value ?? []).join(sep));
  useEffect(() => setText((props.value ?? []).join(sep)), [props.resetKey]);
  const update = (t: string): void => {
    setText(t);
    const list = t.split(props.multiline ? /\n/ : /,/).map((s) => s.trim()).filter(Boolean);
    props.onChange(list.length ? list : undefined);
  };
  return (
    <Field label={props.label} field={props.field} hint={props.hint}>
      {(id, hintId) =>
        props.multiline ? (
          <textarea id={id} rows={2} value={text} aria-describedby={hintId} onInput={(e) => update(e.currentTarget.value)} />
        ) : (
          <input id={id} type="text" value={text} aria-describedby={props.hint ? hintId : undefined} onInput={(e) => update(e.currentTarget.value)} />
        )
      }
    </Field>
  );
}

export function DateField(props: { label: string; field: string; value: string | undefined; calendar: Calendar; onChange: (v: string | undefined) => void }) {
  const r = parseDate(props.value, props.calendar);
  const invalid = r.kind === 'invalid';
  const hint = props.value === undefined || props.value.trim() === '' ? `Empty. Type ${DATE_FORMATS_HINT}, e.g. 1920, 03.1920, 12.03.1920, 12.03` : describeDate(props.value, props.calendar);
  return (
    <Field label={props.label} field={props.field} hint={hint} invalid={invalid}>
      {(id, hintId) => (
        <>
          <input id={id} type="text" class="date-input" value={props.value ?? ''} aria-invalid={invalid} aria-describedby={hintId} onInput={(e) => props.onChange(opt(e.currentTarget.value))} />
          {r.kind === 'invalid' && <EditErasLink message={r.reason} />}
        </>
      )}
    </Field>
  );
}

/** Reference to another entry: an id (or name), with suggestions limited to `types` (all types when empty). */
export function RefField(props: { label: string; field: string; value: string | undefined; world: World; onChange: (v: string | undefined) => void; types?: readonly string[]; exclude?: string }) {
  const ix = new WorldIndex(props.world);
  const target = props.value ? ix.resolve(props.value) : undefined;
  const listId = useId();
  const allowed = props.types && props.types.length ? props.types : undefined;
  const wrongType = !!target && !!allowed && !allowed.includes(target.type);
  const invalid = (!!props.value && !target) || wrongType;
  const want = allowed ? allowed.map((t) => TYPE_SINGULAR[t as keyof typeof TYPE_SINGULAR].toLowerCase()).join(', ') : undefined;
  const hint = !props.value
    ? `Type an id or name${want ? ` (${want})` : ''}`
    : !target ? 'No entry has this id or name'
    : `${target.name} · ${TYPE_SINGULAR[target.type]}${wrongType ? ` (expected ${want})` : ''}`;
  const options = props.world.entries.filter((e) => e.id !== props.exclude && (!allowed || allowed.includes(e.type))).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Field label={props.label} field={props.field} hint={hint} invalid={invalid}>
      {(id, hintId) => (
        <>
          <input id={id} type="text" list={listId} value={props.value ?? ''} aria-invalid={invalid} aria-describedby={hintId} onInput={(e) => props.onChange(opt(e.currentTarget.value))} />
          <datalist id={listId}>
            {options.map((e) => (
              <option key={e.id} value={e.id}>{`${e.name} · ${TYPE_SINGULAR[e.type].toLowerCase()}`}</option>
            ))}
          </datalist>
        </>
      )}
    </Field>
  );
}

export function SelectField<T extends string>(props: { label: string; field: string; value: T | undefined; options: readonly (readonly [T, string])[]; onChange: (v: T | undefined) => void; emptyLabel?: string }) {
  return (
    <Field label={props.label} field={props.field}>
      {(id) => (
        <Select id={id} value={props.value ?? ''} onChange={(v) => props.onChange((v || undefined) as T | undefined)}
          options={[{ value: '', label: props.emptyLabel ?? '(not set)' }, ...props.options.map(([v, l]) => ({ value: v, label: l }))]} />
      )}
    </Field>
  );
}

/** Editable list of rows (relations, participants, ...). */
export function ListEditor<T>(props: {
  title: string;
  field: string;
  items: T[] | undefined;
  empty: () => T;
  onChange: (items: T[] | undefined) => void;
  addLabel: string;
  render: (item: T, set: (item: T) => void, field: string) => ComponentChildren;
}) {
  const items = props.items ?? [];
  const setAt = (i: number, item: T): void => props.onChange(items.map((x, j) => (j === i ? item : x)));
  const removeAt = (i: number): void => {
    const next = items.filter((_, j) => j !== i);
    props.onChange(next.length ? next : undefined);
  };
  return (
    <fieldset class="list-editor">
      <legend>{props.title}</legend>
      {items.length === 0 && <p class="muted empty-hint"><Icon name="sprout" /> None yet. Add the first one below.</p>}
      {items.map((item, i) => (
        <div class="list-row" key={i} data-field={`${props.field}[${i}]`}>
          <div class="list-row-fields">{props.render(item, (x) => setAt(i, x), `${props.field}[${i}]`)}</div>
          <button type="button" class="ghost danger" onClick={() => removeAt(i)} aria-label={`Remove ${props.title.toLowerCase()} row ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" class="ghost add-row" onClick={() => props.onChange([...items, props.empty()])}>
        + {props.addLabel}
      </button>
    </fieldset>
  );
}

export interface ChipOption { value: string; label: string }

/**
 * Several short values as chips with an icon and a remove button; a text box with suggestions adds more
 * (Enter, comma, picking a suggestion, or leaving the box). Used for race or kind and for links to entries.
 */
export function ChipInput(props: {
  label: string; field: string; values: string[]; options: ChipOption[]; onChange: (v: string[]) => void;
  icon: (v: string) => IconName; display?: (v: string) => string; hint?: ComponentChildren; placeholder?: string; invalid?: (v: string) => boolean;
  onOpen?: (v: string) => void;
}) {
  const [text, setText] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => props.options.find((o) => o.label.toLowerCase() === s.toLowerCase())?.value ?? s);
    const next = [...props.values];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    setText('');
    if (next.length !== props.values.length) props.onChange(next);
  };
  const remove = (v: string) => props.onChange(props.values.filter((x) => x !== v));
  const shown = (v: string) => props.display?.(v) ?? v;
  return (
    <Field label={props.label} field={props.field} hint={props.hint} invalid={props.values.some((v) => props.invalid?.(v))}>
      {(id, hintId) => (
        <div class="chip-input">
          {props.values.map((v) => (
            <span key={v} class={`chip${props.invalid?.(v) ? ' is-invalid' : ''}`} data-chip={v}>
              <Icon name={props.icon(v)} />
              {props.onOpen ? <button type="button" class="link chip-label" onClick={() => props.onOpen!(v)}>{shown(v)}</button> : <span class="chip-label">{shown(v)}</span>}
              <button type="button" class="chip-remove" aria-label={`Remove ${shown(v)}`} onClick={() => remove(v)}>×</button>
            </span>
          ))}
          <input id={id} type="text" list={listId} value={text} placeholder={props.values.length ? 'Add another…' : props.placeholder} aria-describedby={hintId}
            onInput={(e) => {
              const t = e.currentTarget.value;
              if ((e as InputEvent).inputType === 'insertReplacementText' || t.endsWith(',')) add(t);
              else setText(t);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) { e.preventDefault(); add(text); }
              else if (e.key === 'Backspace' && !text && props.values.length) remove(props.values[props.values.length - 1]!);
            }}
            onBlur={() => text.trim() && add(text)} />
          <datalist id={listId}>
            {props.options.filter((o) => !props.values.includes(o.value)).map((o) => <option key={o.value} value={o.label} />)}
          </datalist>
        </div>
      )}
    </Field>
  );
}
