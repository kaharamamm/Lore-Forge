import { createContext } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { calendarProblems, ENTRY_TYPES, eraUsage, fieldKey, TYPE_ICON, TYPE_LABELS, type Calendar, type CustomField, type CustomFieldKind, type EntryType, type World, type WorldManifest } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Select } from './select.tsx';
import { ColorField } from './color.tsx';
import { t, tj, tm } from '../i18n.tsx';
import { picturePresets, writingPresets, type Preset } from '../presets.ts';

/** Opens World settings, at the calendar or at the custom fields; null outside a world. Used by the "Known eras" hints and the editor's fields. */
export const ErasLink = createContext<((at?: 'fields') => void) | null>(null);

/** A small "Edit eras" link for a message about unknown eras, or nothing. */
export function EditErasLink({ message }: { message: string }) {
  const open = useContext(ErasLink);
  if (!open || !message.includes('Known eras')) return null;
  return <button type="button" class="link eras-link" onClick={() => open()}><Icon name="calendar" /> {t('Edit eras')}</button>;
}

const ERA_COLOURS = ['#c9a45c', '#6f8fc9', '#8fb87a', '#c97a6f', '#a68fc9', '#6fb8b0'];

interface EraRow { key: number; orig?: string; id: string; name: string; start: string; end: string; color: string }
interface MonthRow { key: number; name: string; days: string }
/** A field of the book's own in the dialog: `orig` is the saved field (its key stays), absent for a new one. */
interface FieldRow { key: number; orig?: CustomField; name: string; kind: CustomFieldKind; choices: string }
/** The book's own fields as World settings saves them. */
export type BookFields = NonNullable<WorldManifest['fields']>;

/** The choices typed for a choice field: comma-separated, each once. */
const choicesOf = (text: string): string[] => [...new Set(text.split(',').map((c) => c.trim()).filter(Boolean))];

/** The keys of one type's fields: the saved ones keep theirs; a new one gets one made from its name. */
function fieldKeys(rows: readonly FieldRow[]): string[] {
  const taken = rows.flatMap((r) => (r.orig ? [r.orig.key] : []));
  return rows.map((r) => {
    if (r.orig) return r.orig.key;
    const key = fieldKey(r.name, taken);
    taken.push(key);
    return key;
  });
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));


/** The ready styles under a field: a click puts one in the field (the one it holds shows as chosen). */
function Presets({ presets, value, label, onPick }: { presets: Preset[]; value: string; label: string; onPick: (text: string) => void }) {
  return (
    <div class="ws-presets" role="group" aria-label={label}>
      <span class="muted small">{t('Start from:')}</span>
      {presets.map((p) => (
        <button key={p.name} type="button" class="ws-preset" aria-pressed={value.trim() === p.text} title={p.text} onClick={() => onPick(p.text)}>{p.name}</button>
      ))}
    </div>
  );
}

/** How the book is written and how its pictures look: what Ask AI and AI apps follow (world.json). */
export interface BookStyle {
  writingStyle: string;
  artStyle: string;
}

/**
 * World settings: how the book is written and drawn (for AI), then its calendar from world.json: its eras (what
 * "312 OK" means) and months. Eras still used by dates keep their abbreviation; other problems (overlaps, missing
 * names) block Save until fixed.
 */
export function WorldSettings({ world, at, onSave, onClose }: { world: World; at?: 'fields'; onSave: (cal: Calendar, style: BookStyle, fields: BookFields) => Promise<boolean>; onClose: () => void }) {
  const cal = world.manifest.calendar;
  const [style, setStyle] = useState<BookStyle>({ writingStyle: world.manifest.writingStyle ?? '', artStyle: world.manifest.artStyle ?? '' });
  const seq = useRef(0);
  const [eras, setEras] = useState<EraRow[]>(() => cal.eras.map((e) => ({ key: seq.current++, orig: e.id, id: e.id, name: e.name, start: String(e.start), end: e.end === undefined ? '' : String(e.end), color: e.color ?? '' })));
  const [months, setMonths] = useState<MonthRow[]>(() => (cal.months ?? []).map((m) => ({ key: seq.current++, name: m.name, days: String(m.days) })));
  const [defaultEra, setDefaultEra] = useState(cal.defaultEra);
  const [fieldRows, setFieldRows] = useState<Record<EntryType, FieldRow[]>>(() => Object.fromEntries(ENTRY_TYPES.map((type) => [type, (world.manifest.fields?.[type] ?? []).map((f): FieldRow => ({ key: seq.current++, orig: f, name: f.name, kind: f.kind, choices: (f.choices ?? []).join(', ') }))])) as Record<EntryType, FieldRow[]>);
  const [fieldType, setFieldType] = useState<EntryType>(() => ENTRY_TYPES.find((type) => world.manifest.fields?.[type]?.length) ?? 'character');
  const fieldsHead = useRef<HTMLHeadingElement>(null);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLTextAreaElement>(null);
  const back = useRef<Element | null>(document.activeElement);
  const usage = useMemo(() => eraUsage(world), [world]);

  useEffect(() => {
    if (at === 'fields') {
      fieldsHead.current?.scrollIntoView({ block: 'start' });
      fieldsHead.current?.focus();
    } else first.current?.focus();
    const focused = back.current;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); (focused as HTMLElement | null)?.focus?.(); };
  }, [onClose]);

  const draft: Calendar = {
    ...cal,
    eras: eras.map((r) => ({ id: r.id.trim(), name: r.name.trim(), start: num(r.start), ...(r.end.trim() ? { end: num(r.end) } : {}), ...(r.color ? { color: r.color } : {}) })),
    defaultEra,
    months: months.map((m) => ({ name: m.name.trim(), days: num(m.days) })),
  };
  // A used era must keep its abbreviation, or its dates would stop parsing.
  const kept = new Set(eras.filter((r) => r.orig && r.orig === r.id.trim()).map((r) => r.orig));
  const lost = cal.eras.filter((e) => (usage.get(e.id) ?? 0) > 0 && !kept.has(e.id))
    .map((e) => usage.get(e.id) === 1
      ? t('{n} date is written in {era} ({code}). Keep its abbreviation {code}, or change those dates first.', { n: usage.get(e.id), era: e.name, code: e.id })
      : t('{n} dates are written in {era} ({code}). Keep its abbreviation {code}, or change those dates first.', { n: usage.get(e.id), era: e.name, code: e.id }));
  // The book's own fields, each needing a name (once per type), and a choice its choices.
  const fieldProblems = ENTRY_TYPES.flatMap((type) => {
    const label = tm(TYPE_LABELS[type]);
    const rows = fieldRows[type];
    const names = rows.map((r) => r.name.trim().toLocaleLowerCase());
    return [
      ...(rows.some((r) => !r.name.trim()) ? [t('{type}: a field has no name.', { type: label })] : []),
      ...rows.filter((r) => r.name.trim() && r.kind === 'choice' && !choicesOf(r.choices).length).map((r) => t('{type}: the choice field “{name}” needs its choices, separated by commas.', { type: label, name: r.name.trim() })),
      ...[...new Set(names.filter((n, i) => n && names.indexOf(n) !== i))].map((n) => t('{type}: two fields are called “{name}”.', { type: label, name: rows.find((r) => r.name.trim().toLocaleLowerCase() === n)!.name.trim() })),
    ];
  });
  const problems = [...lost, ...calendarProblems(draft), ...fieldProblems];
  const draftFields = (): BookFields => Object.fromEntries(ENTRY_TYPES.flatMap((type) => {
    const rows = fieldRows[type];
    const keys = fieldKeys(rows);
    const list = rows.map((r, i): CustomField => {
      const { key: _k, name: _n, kind: _kind, choices: _c, ...rest } = r.orig ?? ({} as Partial<CustomField>);
      return { ...rest, key: keys[i]!, name: r.name.trim(), kind: r.kind, ...(r.kind === 'choice' ? { choices: choicesOf(r.choices) } : {}) };
    });
    return list.length ? [[type, list]] : [];
  }));
  const setField = (key: number, patch: Partial<FieldRow>) => setFieldRows((all) => ({ ...all, [fieldType]: all[fieldType].map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const kinds: { value: CustomFieldKind; label: string }[] = [
    { value: 'text', label: t('Text') },
    { value: 'number', label: t('Number') },
    { value: 'yes-no', label: t('Yes or no') },
    { value: 'choice', label: t('Choice') },
  ];

  const setEra = (key: number, patch: Partial<EraRow>) => setEras((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = <T,>(list: T[], i: number, d: number) => { const out = [...list]; const [x] = out.splice(i, 1); out.splice(i + d, 0, x!); return out; };
  const addEra = () => {
    const last = draft.eras.reduce((m, e) => (Number.isFinite(e.start) ? Math.max(m, e.end ?? e.start) : m), 0);
    setEras((rs) => [...rs, { key: seq.current++, id: '', name: '', start: String(last + 1), end: '', color: ERA_COLOURS[rs.length % ERA_COLOURS.length]! }]);
  };
  const save = async () => {
    if (problems.length || saving) return;
    setSaving(true);
    const ok = await onSave({ ...draft, months: draft.months?.length ? draft.months : undefined } as Calendar, style, draftFields());
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section class="world-settings" role="dialog" aria-modal="true" aria-labelledby="ws-title">
        <header class="about-head dialog-head">
          <Icon name="calendar" class="about-mark" />
          <div>
            <h2 id="ws-title">{t('World settings')}</h2>
          </div>
        </header>

        <div class="dialog-body">
        <h3 id="ws-style">{t('Writing and pictures')}</h3>
        <p class="muted small ws-explain">{t('Ask AI, and AI apps connected to Lore-Forge, write and draw this book this way. Leave a field empty to let them follow what the book already has.')}</p>
        <div class="ws-style" role="group" aria-labelledby="ws-style">
          <label class="field">
            <span class="field-label">{t('Writing style')}</span>
            <textarea ref={first} class="ws-writing" rows={3} value={style.writingStyle} placeholder={t('Third person, past tense. Warm and wry, short sentences, for readers of ten and up. No modern slang.')}
              onInput={(e) => { const v = e.currentTarget.value; setStyle((s) => ({ ...s, writingStyle: v })); }} />
            <span class="hint">{t('Point of view, tense, tone, audience, what to avoid. A short paragraph in your own voice helps too.')}</span>
          </label>
          <Presets presets={writingPresets()} value={style.writingStyle} label={t('Ready writing styles')} onPick={(text) => setStyle((s) => ({ ...s, writingStyle: text }))} />
          <label class="field">
            <span class="field-label">{t('Picture style')}</span>
            <input class="ws-art" type="text" value={style.artStyle} placeholder={t('Painterly fantasy concept art, warm desert light')}
              onInput={(e) => { const v = e.currentTarget.value; setStyle((s) => ({ ...s, artStyle: v })); }} />
            <span class="hint">{t('Added to every picture an AI makes for this book, so they look alike.')}</span>
          </label>
          <Presets presets={picturePresets()} value={style.artStyle} label={t('Ready picture styles')} onPick={(text) => setStyle((s) => ({ ...s, artStyle: text }))} />
        </div>

        <h3 id="ws-calendar">{t('Calendar')}</h3>
        <div class="ws-default-row">
          <label class="ws-default">
            <span class="field-label">{t('Default era')}</span>
            <Select id="ws-default" value={defaultEra} onChange={setDefaultEra} placeholder={t('Pick an era…')}
              options={draft.eras.filter((e) => e.id).map((e) => ({ value: e.id, label: `${e.name || e.id} (${e.id})`, ...(e.color ? { swatch: e.color } : {}) }))} />
          </label>
          <p class="muted small">{t('Dates written without an era abbreviation, like “312”, count in this era.')}</p>
        </div>

        <h3 id="ws-eras">{t('Eras')}</h3>
        <p class="muted small ws-explain">
          {tj("A date like “312 OK” is year 312 of the era with the abbreviation OK. {startsAt} is the world year that the era's year 1 falls on, so every era sits on one timeline. An era without an end lasts until the next one starts. Dates with no abbreviation use the default era.", { startsAt: <strong>{t('Starts at')}</strong> })}
        </p>
        <div class="ws-eras" role="group" aria-labelledby="ws-eras">
          <div class="ws-era ws-head" aria-hidden="true"><span /><span>{t('Name')}</span><span>{t('Abbreviation')}</span><span>{t('Starts at')}</span><span>{t('Ends at')}</span><span>{t('Colour')}</span><span>{t('Dates')}</span><span /></div>
          {eras.map((r, i) => {
            const label = r.name.trim() || t('era {n}', { n: i + 1 });
            const used = r.orig ? usage.get(r.orig) ?? 0 : 0;
            return (
              <div key={r.key} class="ws-era" role="group" aria-label={label}>
                <span class="ws-order">
                  <button type="button" class="ghost small ws-up" aria-label={t('Move {era} up', { era: label })} disabled={i === 0} onClick={() => setEras((rs) => move(rs, i, -1))}><span class="chev chev-up" /></button>
                  <button type="button" class="ghost small ws-down" aria-label={t('Move {era} down', { era: label })} disabled={i === eras.length - 1} onClick={() => setEras((rs) => move(rs, i, 1))}><span class="chev chev-down" /></button>
                </span>
                <input class="ws-name" type="text" value={r.name} aria-label={t('Name of {era}', { era: label })} placeholder={t('After the Sundering')} onInput={(e) => setEra(r.key, { name: e.currentTarget.value })} />
                <input class="ws-code" type="text" value={r.id} aria-label={t('Abbreviation of {era}', { era: label })} placeholder={t('AS')} onInput={(e) => setEra(r.key, { id: e.currentTarget.value })} />
                <input class="ws-start" type="number" step={1} value={r.start} aria-label={t('World year {era} starts at', { era: label })} onInput={(e) => setEra(r.key, { start: e.currentTarget.value })} />
                <input class="ws-end" type="number" step={1} value={r.end} aria-label={t('World year {era} ends at (optional)', { era: label })} placeholder={t('open')} onInput={(e) => setEra(r.key, { end: e.currentTarget.value })} />
                <span class="ws-color">
                  {r.color
                    ? <><ColorField label={t('Colour of {era}', { era: label })} value={r.color} alpha={false} swatches={ERA_COLOURS} class="inline" onChange={(c) => setEra(r.key, { color: c })} />
                      <button type="button" class="ghost small" aria-label={t('No colour for {era}', { era: label })} onClick={() => setEra(r.key, { color: '' })}><Icon name="cancel" /></button></>
                    : <button type="button" class="ghost small" onClick={() => setEra(r.key, { color: ERA_COLOURS[i % ERA_COLOURS.length]! })}>{t('Add colour')}</button>}
                </span>
                <span class="ws-used muted" title={t('{n} dates use this era', { n: used })}>{used}</span>
                <button type="button" class="ghost small ws-delete" aria-label={t('Delete {era}', { era: label })} onClick={() => setEras((rs) => rs.filter((x) => x.key !== r.key))}><Icon name="trash-can" /></button>
              </div>
            );
          })}
        </div>
        <div class="ws-row">
          <button type="button" class="ghost small ws-add-era" onClick={addEra}>{t('+ Add era')}</button>
        </div>

        <h3 id="ws-months">{t('Months')}</h3>
        <p class="muted small ws-explain">{months.length ? t('{months} months, {days} days a year.', { months: months.length, days: draft.months!.reduce((n, m) => n + (Number.isFinite(m.days) ? m.days : 0), 0) }) : t('No months set: the year has 12 months of 30 days.')}</p>
        <ol class="ws-months" aria-labelledby="ws-months">
          {months.map((m, i) => (
            <li key={m.key} class="ws-month">
              <span class="muted ws-month-no">{i + 1}</span>
              <input class="ws-month-name" type="text" value={m.name} aria-label={t('Name of month {n}', { n: i + 1 })} onInput={(e) => { const v = e.currentTarget.value; setMonths((ms) => ms.map((x) => (x.key === m.key ? { ...x, name: v } : x))); }} />
              <input class="ws-month-days" type="number" min={1} step={1} value={m.days} aria-label={t('Days in month {n}', { n: i + 1 })} onInput={(e) => { const v = e.currentTarget.value; setMonths((ms) => ms.map((x) => (x.key === m.key ? { ...x, days: v } : x))); }} />
              <span class="muted small">{t('days')}</span>
              <button type="button" class="ghost small" aria-label={t('Delete month {n}', { n: i + 1 })} onClick={() => setMonths((ms) => ms.filter((x) => x.key !== m.key))}><Icon name="trash-can" /></button>
            </li>
          ))}
        </ol>
        <button type="button" class="ghost small ws-add-month" onClick={() => setMonths((ms) => [...ms, { key: seq.current++, name: '', days: '30' }])}>{t('+ Add month')}</button>

        <h3 id="ws-fields" ref={fieldsHead} tabIndex={-1}>{t('Custom fields')}</h3>
        <p class="muted small ws-explain">{t('Fields of your own for each type of entry, such as HP and Strength for characters or Damage and Rarity for items. They show in the editor and the World Codex, and go into game data with their values.')}</p>
        <div class="ws-field-types" role="group" aria-label={t('Type of entry')}>
          {ENTRY_TYPES.map((type) => (
            <button key={type} type="button" class={`ws-field-type t-${type}`} aria-pressed={fieldType === type} onClick={() => setFieldType(type)}>
              <Icon name={TYPE_ICON[type]} /> {tm(TYPE_LABELS[type])}{fieldRows[type].length > 0 && <span class="count">{fieldRows[type].length}</span>}
            </button>
          ))}
        </div>
        <div class="ws-fields" role="group" aria-labelledby="ws-fields">
          {fieldRows[fieldType].length === 0 && <p class="muted small ws-fields-empty">{t('No fields for {type} yet.', { type: tm(TYPE_LABELS[fieldType]) })}</p>}
          {fieldRows[fieldType].map((r, i, rows) => {
            const label = r.name.trim() || t('field {n}', { n: i + 1 });
            const key = fieldKeys(rows)[i]!;
            return (
              <div key={r.key} class="ws-field" role="group" aria-label={label}>
                <span class="ws-order">
                  <button type="button" class="ghost small" aria-label={t('Move {field} up', { field: label })} disabled={i === 0} onClick={() => setFieldRows((all) => ({ ...all, [fieldType]: move(all[fieldType], i, -1) }))}><span class="chev chev-up" /></button>
                  <button type="button" class="ghost small" aria-label={t('Move {field} down', { field: label })} disabled={i === rows.length - 1} onClick={() => setFieldRows((all) => ({ ...all, [fieldType]: move(all[fieldType], i, 1) }))}><span class="chev chev-down" /></button>
                </span>
                <input class="ws-field-name" type="text" value={r.name} aria-label={t('Name of {field}', { field: label })} placeholder={t('e.g. Strength')} onInput={(e) => setField(r.key, { name: e.currentTarget.value })} />
                <Select class="ws-field-kind" value={r.kind} options={kinds} aria-label={t('What {field} holds', { field: label })} onChange={(v) => setField(r.key, { kind: v as CustomFieldKind })} />
                {r.kind === 'choice'
                  ? <input class="ws-field-choices" type="text" value={r.choices} aria-label={t('Choices of {field}, separated by commas', { field: label })} placeholder={t('common, rare, legendary')} onInput={(e) => setField(r.key, { choices: e.currentTarget.value })} />
                  : <span class="ws-field-choices" aria-hidden="true" />}
                <code class="ws-field-key muted" title={t('Its name in the entry files and in game data')}>{r.name.trim() ? key : ''}</code>
                <button type="button" class="ghost small ws-delete" aria-label={t('Delete {field}', { field: label })} onClick={() => setFieldRows((all) => ({ ...all, [fieldType]: all[fieldType].filter((x) => x.key !== r.key) }))}><Icon name="trash-can" /></button>
              </div>
            );
          })}
        </div>
        <div class="ws-row">
          <button type="button" class="ghost small ws-add-field" onClick={() => setFieldRows((all) => ({ ...all, [fieldType]: [...all[fieldType], { key: seq.current++, name: '', kind: 'text', choices: '' }] }))}>{t('+ Add field')}</button>
        </div>
        <p class="muted small ws-explain">{t('The name in grey is what the files and game data call the value. It stays when you rename the field, and deleting a field keeps the values already written.')}</p>

        <div class="ws-problems" aria-live="polite">
          {problems.length > 0 && (
            <ul>{problems.map((p) => <li key={p}><Icon name="hazard-sign" /> {tm(p)}</li>)}</ul>
          )}
        </div>
        </div>
        <div class="dialog-actions">
          <span class="muted small spacer">{t('Changing a start year moves every date in that era on the timeline.')}</span>
          <button type="button" class="ghost ws-cancel" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" class="primary ws-save" disabled={problems.length > 0 || saving} onClick={() => void save()}><Icon name="check-mark" /> {t('Save')}</button>
        </div>
      </section>
    </div>
  );
}
