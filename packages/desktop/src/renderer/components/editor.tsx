import {
  ageAtDeathText, DETAIL_FIELDS, detailList, detailOf, raceIcon, raceLabel, racesOf, suggestionIcon, type DetailField, type DetailSection, type IconName,
  DEFAULT_STATUS, endFieldVisible, endValue, LIFECYCLE, raceSuggestions, statusOf, RELATION_GROUPS, relationFits, relationKind, relationKindsFor, relationTargets, TYPE_ICON, TYPE_SINGULAR, VISUAL_FIELDS,
  type Action, type Character, type Entry, type EntryType, type LocationSpan, type LoreEvent, type Participant, type Relation, type RelationGroup, type Warning, type World,
} from '@lore-forge/core';
import { worldIndex } from '../hooks.ts';
import { capital, lower, t, tm } from '../i18n.tsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChipInput, DateField, entrySuggestion, Field, ListEditor, ListText, OpenEntry, RefField, TextField } from './fields.tsx';
import { LooksPanel } from './looks.tsx';
import { ProseField } from './prose.tsx';
import { TypeBadge } from './type.tsx';
import { WarningItem, type WarningActions } from './warnings.tsx';
import { Icon } from './icon.tsx';
import { Portrait, portraitFile } from './cover.tsx';
import { Select } from './select.tsx';
import { SuggestInput } from './suggest.tsx';

interface Props {
  dir: string;
  world: World;
  entry: Entry;
  warnings: Warning[];
  actions: WarningActions;
  onChange: (e: Entry) => void;
  onDelete: () => void;
  onOpen: (id: string) => void;
}

export function EntryEditor({ dir, world, entry, warnings, actions, onChange, onDelete, onOpen }: Props) {
  const cal = world.manifest.calendar;
  // Each type section gets a setter typed for its own entry shape.
  const set = <E extends Entry>(e: E) => (patch: Partial<E>) => onChange({ ...e, ...patch });
  const base = set(entry);
  return (
    <OpenEntry.Provider value={onOpen}>
    <article class={`editor t-${entry.type}`} aria-labelledby="entry-title">
      <header class="editor-head">
        <div>
          <p class="eyebrow"><TypeBadge type={entry.type} /></p>
          <h2 id="entry-title" tabIndex={-1}>{portraitFile(entry) ? <Portrait entry={entry} size="md" /> : <Icon class="title-icon" name={TYPE_ICON[entry.type]} />} {entry.name || t('(no name)')}</h2>
          <p class="editor-meta">
            <span class="meta-chip" title={t("The entry's id, used in links and files")}><Icon name="key" /><span class="meta-chip-label">{t('id')}</span><code>{entry.id}</code></span>
            {world.files[entry.id] && <span class="meta-chip" title={t('Its file in the world folder')}><Icon name="open-folder" /><span class="meta-chip-path">{world.files[entry.id]}</span></span>}
          </p>
        </div>
        <button type="button" class="ghost danger" onClick={onDelete}><Icon name="trash-can" /> {t('Delete entry')}</button>
      </header>

      <section class="live-warnings" aria-live="polite" aria-label={t('Live warnings for this entry')}>
        {warnings.length === 0 ? (
          <p class="ok-line"><Icon name="sparkles" /> {t('No warnings for this entry. Canon holds.')}</p>
        ) : (
          <ul class="warning-list">
            {warnings.map((w) => <WarningItem key={w.id} w={w} actions={actions} compact={w.offending.entryId === entry.id} />)}
          </ul>
        )}
      </section>

      <Section id="basics" title={t('Basics')} icon="scroll-unfurled">
        <div class="grid-2">
          <TextField label={t('Name')} field="name" value={entry.name} onChange={(name) => base({ name: name ?? '' })} />
          <ListText label={t('Aliases (comma-separated)')} field="aliases" value={entry.aliases} onChange={(aliases) => base({ aliases })} resetKey={entry.id} />
        </div>
        <TextField label={t('Summary')} field="summary" value={entry.summary} onChange={(summary) => base({ summary })} multiline hint={t('One or two lines: shown on cards, in hover cards and in the Codex.')} />
        {entry.type === 'character' && <RaceField world={world} e={entry} set={set(entry)} onOpen={onOpen} />}
        {LIFECYCLE[entry.type] && <LifecycleFields world={world} entry={entry} onChange={onChange} />}
        {ageAtDeathText(entry, cal) && <p class="hint age-at-death" data-field="age"><Icon name="hourglass" /> {t('Age at death: {age}', { age: tm(ageAtDeathText(entry, cal)!) })}</p>}
        {entry.type === 'place' && (
          <div class="grid-3">
            <RefField label={t('Part of (region)')} field="partOf" value={entry.partOf} world={world} types={['place']} onChange={(partOf) => set(entry)({ partOf })} />
          </div>
        )}
        {entry.type === 'event' && <EventWhen world={world} e={entry} set={set(entry)} />}
        {entry.type === 'note' && (
          <div class="grid-3">
            <DateField label={t('Date (optional)')} field="date" value={entry.date} calendar={cal} onChange={(date) => set(entry)({ date })} />
          </div>
        )}
        <DetailFields world={world} entry={entry} section="basics" onChange={onChange} onOpen={onOpen} />
      </Section>

      {(
        <Section id="appearance" title={t('Appearance')} icon="photo-camera">
          {/* The Default look and the entry's other looks over time, each with its description, pictures and 3D models. */}
          <LooksPanel dir={dir} world={world} entry={entry} onChange={onChange} />
        </Section>
      )}

      {(DETAIL_FIELDS[entry.type].some((f) => f.section === 'story') || entry.type === 'event' || entry.type === 'note') && (
        <Section id="story" title={t('Story')} icon="feather">
          <DetailFields world={world} entry={entry} section="story" onChange={onChange} onOpen={onOpen} />
          {(entry.type === 'event' || entry.type === 'note') && (
            <fieldset class="list-editor">
              <legend>{t('Story Book')}</legend>
              <div class="grid-2">
                <TextField label={t('Chapter (optional)')} field="chapter" value={entry.chapter} onChange={(chapter) => base({ chapter })} hint={t('Leave empty to place it by date in its era or year range.')} />
                <NumberText label={t('Order in chapter')} field="bookOrder" value={entry.bookOrder} onChange={(bookOrder) => base({ bookOrder })} hint={t('Default 0. Lower comes first; ties go by date.')} />
              </div>
            </fieldset>
          )}
        </Section>
      )}

      <Section id="connections" title={t('Connections')} icon="spider-web">
        <DetailFields world={world} entry={entry} section="connections" onChange={onChange} onOpen={onOpen} />
        {entry.type === 'character' && <CharacterFields world={world} e={entry} set={set(entry)} />}
        {entry.type === 'event' && <EventFields world={world} e={entry} set={set(entry)} />}
        <ListEditor<Relation>
          title={t('Relationships')}
          field="relations"
          items={entry.relations}
          addLabel={t('Add relationship')}
          empty={() => ({ type: relationKindsFor(entry.type)[0]?.type ?? 'related-to', target: '' })}
          onChange={(relations) => base({ relations })}
          render={(r, put, f) => (
            <>
              <RelationTypeField world={world} entry={entry} r={r} field={`${f}.type`} onChange={(type) => put({ ...r, type })} />
              <RefField label={t('Target')} field={`${f}.target`} value={r.target} world={world} types={relationTargets(r.type, entry.type)} exclude={entry.id} onChange={(target) => put({ ...r, target: target ?? '' })} />
              <DateField label={t('From')} field={`${f}.from`} value={r.from} calendar={cal} onChange={(from) => put(clean({ ...r, from }))} />
              <DateField label={t('To')} field={`${f}.to`} value={r.to} calendar={cal} onChange={(to) => put(clean({ ...r, to }))} />
            </>
          )}
        />
      </Section>

      <ProseField world={world} entry={entry} onInput={(body) => base({ body })} onOpen={onOpen} />
    </article>
    </OpenEntry.Provider>
  );
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Free text with suggestions (gender, kind, verbs). Suggested words are offered (in the app's language) and saved with a capital first
 * letter, and a value that is one of them (in any case) shows that way; `lower` keeps them as written (verbs, which
 * sit inside sentences, and stay English for the rules). The value's icon shows at the start of the box, as in the list.
 */
function Pick(props: { label: string; field: string; value: string; options: string[]; onChange: (v: string | undefined) => void; icon?: (v: string) => IconName | undefined; lower?: boolean }) {
  const id = `opts-${props.field.replace(/\W/g, '-')}`;
  const box = useRef<HTMLDivElement>(null);
  const options = props.lower ? props.options : props.options.map((o) => capital(tm(o)));
  // The list's spelling for a typed word ("port" -> "Port"), only once it is the whole word: "port " can go on to "Port town".
  const canonical = (t: string) => options.find((o) => o.toLowerCase() === t.toLowerCase()) ?? t;
  const shown = canonical(props.value);
  const lead = shown.trim() ? props.icon?.(shown) : undefined;
  return (
    <div class="field" data-field={props.field}>
      <label for={`${id}-input`}>{props.label}</label>
      <div class="suggest" ref={box}>
        <SuggestInput id={`${id}-input`} anchor={box} value={shown} {...(lead ? { icon: lead } : {})}
          suggestions={options.map((o) => { const icon = props.icon?.(o); return icon ? { value: o, icon } : { value: o }; })}
          onInput={(t) => props.onChange(canonical(t))} onPick={(o) => props.onChange(o.value)}
          onBlur={() => { const tidy = canonical(props.value.trim()); if (tidy !== props.value) props.onChange(tidy); }} />
      </div>
    </div>
  );
}

/** Arrow keys move the single selected status, like a radio group; there is always exactly one. */
function statusKeys(ev: KeyboardEvent, values: string[], current: string, pick: (v: string) => void): void {
  const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
  if (!step || ev.altKey) return;
  ev.preventDefault();
  const next = values[(values.indexOf(current) + step + values.length) % values.length]!;
  pick(next);
  requestAnimationFrame(() => (ev.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
}

const START_FIELD: Partial<Record<EntryType, [string, string]>> = { character: ['born', 'Born'], place: ['founded', 'Founded'], faction: ['founded', 'Founded'], item: ['created', 'Made'] };

/**
 * Status first. An ongoing status (alive, standing, active, intact, lost) hides the end date;
 * an ended one shows it. A hidden end date stays in the file and still counts for the checker.
 */
function LifecycleFields({ world, entry, onChange }: { world: World; entry: Entry; onChange: (e: Entry) => void }) {
  const lc = LIFECYCLE[entry.type]!;
  const cal = world.manifest.calendar;
  const rec = entry as unknown as Record<string, string | undefined>;
  const put = (patch: Record<string, string | undefined>) => onChange(clean({ ...entry, ...patch }) as Entry);
  const status = statusOf(entry) ?? DEFAULT_STATUS;
  const [startField, startLabel] = START_FIELD[entry.type]!;
  const showEnd = endFieldVisible(entry);
  const hidden = !showEnd ? endValue(entry) : undefined;
  const ongoing = status && lc.ongoing.includes(status) ? lc.statuses.find((x) => x.value === status) : undefined;
  return (
    <fieldset class="lifecycle">
      <legend><Icon name="hourglass" /> {t('Status and dates')}</legend>
      <div class="grid-3">
        <Field label={t('Status')} field="status">
          {(id) => (
            <div class="status-pills" role="radiogroup" id={id} aria-label={t('Status')} onKeyDown={(ev) => statusKeys(ev, lc.statuses.map((x) => x.value), status, (v) => put({ status: v }))}>
              {lc.statuses.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={status === o.value} tabIndex={status === o.value ? 0 : -1} class={`pill status-${o.value}`}
                  onClick={() => status !== o.value && put({ status: o.value })}>
                  <Icon name={o.icon} /> {tm(o.label)}
                </button>
              ))}
            </div>
          )}
        </Field>
        <DateField label={t(startLabel)} field={startField} value={rec[startField]} calendar={cal} onChange={(v) => put({ [startField]: v })} />
        {showEnd && <DateField label={tm(lc.endLabel)} field={lc.endField} value={rec[lc.endField]} calendar={cal} onChange={(v) => put({ [lc.endField]: v })} />}
      </div>
      {hidden && hidden.trim() !== '' && (
        <p class="hint hidden-note" data-field={lc.endField}>
          <Icon name="save" /> {t('{field} “{value}” is still in the file but hidden while the status is {status}. Pick {ended} to edit it, or clear it there.', { field: tm(lc.endLabel), value: hidden, status: tm(ongoing?.label ?? status), ended: tm(lc.statuses.find((x) => lc.ended.includes(x.value))!.label) })}
        </p>
      )}
      {!showEnd && !hidden && !ongoing && <p class="hint">{t('Pick {status} to add a {field} date.', { status: tm(lc.statuses.find((x) => lc.ended.includes(x.value))!.label), field: lower(tm(lc.endLabel)) })}</p>}
    </fieldset>
  );
}

const GROUP_ORDER = Object.keys(RELATION_GROUPS) as RelationGroup[];

/** Relation type limited to what fits this entry (and the chosen target), grouped; custom types still possible. */
function RelationTypeField({ world, entry, r, field, onChange }: { world: World; entry: Entry; r: Relation; field: string; onChange: (type: string) => void }) {
  const target = worldIndex(world).resolve(r.target);
  const kinds = relationKindsFor(entry.type, target?.type);
  const current = relationKind(r.type);
  const known = current && kinds.includes(current);
  const [custom, setCustom] = useState(!current && r.type !== '');
  const misfit = current && target && !relationFits(current, entry.type, target.type);
  const hint = misfit
    ? t("“{type}” doesn't fit {from} → {to}. Pick another.", { type: r.type, from: lower(tm(TYPE_SINGULAR[entry.type])), to: lower(tm(TYPE_SINGULAR[target.type])) })
    : target ? t('Types that fit {from} → {to}', { from: lower(tm(TYPE_SINGULAR[entry.type])), to: lower(tm(TYPE_SINGULAR[target.type])) }) : t('Types that fit a {type}', { type: lower(tm(TYPE_SINGULAR[entry.type])) });
  return (
    <Field label={t('Relation')} field={field} hint={hint} invalid={!!misfit}>
      {(id, hintId) => custom ? (
        <div class="row nowrap">
          <CustomType id={id} hintId={hintId} value={r.type} onChange={onChange} />
          <button type="button" class="ghost small" onClick={() => { setCustom(false); onChange(kinds[0]?.type ?? 'related-to'); }}>{t('List')}</button>
        </div>
      ) : (
        <Select id={id} value={r.type} aria-describedby={hintId} invalid={!!misfit}
          onChange={(v) => { if (v === '__custom') setCustom(true); else onChange(v); }}
          options={[
            ...(!known && r.type ? [{ value: r.type, label: misfit ? t('! {type} (does not fit)', { type: r.type.replace(/-/g, ' ') }) : r.type.replace(/-/g, ' ') }] : []),
            ...GROUP_ORDER.flatMap((g) => kinds.filter((k) => k.group === g).map((k) => ({ value: k.type, label: capital(tm(k.label)), group: tm(RELATION_GROUPS[g].label), icon: RELATION_GROUPS[g].icon }))),
            { value: '__custom', label: t('Custom type…') },
          ]} />
      )}
    </Field>
  );
}

/** Race or kind as chips with an icon each; suggestions are the races already used in this world, then common ones. More than one is fine. */
function RaceField({ world, e, set, onOpen }: { world: World; e: Character; set: (p: Partial<Character>) => void; onOpen: (id: string) => void }) {
  const ix = worldIndex(world);
  const races = racesOf(e);
  const linked = (r: string) => ix.resolve(r);
  return (
    <ChipInput label={t('Race or kind')} field="race" values={races} placeholder={t('e.g. human, camel-folk, ghoul')}
      options={() => raceSuggestions(world.entries).map((r) => ({ value: r, label: r, icon: raceIcon(r) }))} normalize={capital}
      icon={(r) => raceIcon(linked(r)?.name ?? r)} display={(r) => raceLabel(r, (x) => linked(x)?.name)}
      {...(races.some((r) => linked(r)) ? { onOpen: (r: string) => { const t = linked(r); if (t) onOpen(t.id); } } : {})}
      hint={t('Type and press Enter, or pick a suggestion. × removes one.')}
      onChange={(list) => set({ race: list.length ? list.join(', ') : undefined })} />
  );
}

const SECTIONS_KEY = 'lore-forge.editorSections';
const closedSections = (): string[] => {
  try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '[]') as string[]; } catch { return []; }
};

/** A collapsible editor section; which ones are closed is remembered. A jump to a field inside opens it. */
function Section({ id, title, icon, children }: { id: string; title: string; icon: IconName; children: preact.ComponentChildren }) {
  const [open] = useState(() => !closedSections().includes(id));
  return (
    <details class="editor-section" data-section={id} open={open}
      onToggle={(ev) => {
        const isOpen = (ev.currentTarget as HTMLDetailsElement).open;
        const rest = closedSections().filter((x) => x !== id);
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(isOpen ? rest : [...rest, id]));
      }}>
      <summary><Icon name="play-button" class="chevron" /> <Icon name={icon} /> {title}</summary>
      <div class="section-body">{children}</div>
    </details>
  );
}

/** The optional detail fields of one section. Empty means unknown: nothing is written and exports leave it out. */
function DetailFields({ world, entry, section, onChange, onOpen }: { world: World; entry: Entry; section: DetailSection; onChange: (e: Entry) => void; onOpen: (id: string) => void }) {
  const fields = DETAIL_FIELDS[entry.type].filter((f) => f.section === section);
  if (!fields.length) return null;
  const put = (f: DetailField, v: string | string[] | undefined) => {
    const details = { ...entry.details };
    if (v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === '')) delete details[f.key];
    else details[f.key] = v;
    const { details: _d, ...rest } = entry;
    onChange((Object.keys(details).length ? { ...rest, details } : rest) as Entry);
  };
  const ix = worldIndex(world);
  const short = fields.filter((f) => f.kind !== 'long');
  const long = fields.filter((f) => f.kind === 'long');
  const one = (f: DetailField) => {
    const field = f.key;
    switch (f.kind) {
      case 'ref':
        return <RefField key={field} label={tm(f.label)} field={field} value={detailOf(entry, field) as string | undefined} world={world} types={f.to ?? []} exclude={entry.id} onChange={(v) => put(f, v)} />;
      case 'refs': {
        // Every entry of the world: only made when the list opens or a typed name is looked up.
        const options = () => world.entries.filter((x) => x.id !== entry.id && (!f.to || f.to.includes(x.type))).sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ ...entrySuggestion(x), label: x.name }));
        return (
          <ChipInput key={field} label={tm(f.label)} field={field} values={detailList(entry, field)} placeholder={t('Add {types}…', { types: (f.to ?? []).map((type) => lower(tm(TYPE_SINGULAR[type]))).join(` ${t('or')} `) })}
            options={options} icon={(v) => TYPE_ICON[ix.resolve(v)?.type ?? (f.to?.[0] ?? 'note')]}
            display={(v) => ix.resolve(v)?.name ?? v} invalid={(v) => !ix.resolve(v)} onOpen={(v) => { const t = ix.resolve(v); if (t) onOpen(t.id); }}
            hint={f.relation ? t('Also shown as “{relation}” in the relationship web.', { relation: tm(f.relation.replace(/-/g, ' ')) }) : undefined}
            onChange={(v) => put(f, v)} />
        );
      }
      case 'list':
        return <ListText key={field} label={tm(f.label)} field={field} value={detailList(entry, field)} resetKey={entry.id} hint={f.hint && tm(f.hint)} onChange={(v) => put(f, v)} />;
      case 'long':
        return <TextField key={field} label={tm(f.label)} field={field} value={detailOf(entry, field) as string | undefined} multiline onChange={(v) => put(f, v)} />;
      default:
        return f.suggest ? (
          <Pick key={field} label={tm(f.label)} field={field} value={(detailOf(entry, field) as string | undefined) ?? ''} options={[...f.suggest]} icon={(v) => suggestionIcon(entry.type, f.key, v)} onChange={(v) => put(f, v)} />
        ) : (
          <TextField key={field} label={tm(f.label)} field={field} value={detailOf(entry, field) as string | undefined} placeholder={f.hint && tm(f.hint)} onChange={(v) => put(f, v)} />
        );
    }
  };
  return (
    <div class="detail-fields" data-details={section}>
      {short.length > 0 && <div class="grid-2">{short.map(one)}</div>}
      {long.map(one)}
      {section === 'basics' && <p class="hint">{t('Every field is optional. Leave it empty when it is unknown; empty fields are not saved and do not show in exports.')}</p>}
    </div>
  );
}

function CharacterFields({ world, e, set }: { world: World; e: Character; set: (p: Partial<Character>) => void }) {
  const cal = world.manifest.calendar;
  return (
    <>
      <ListEditor<LocationSpan>
        title={t('Locations over time')}
        field="locations"
        items={e.locations}
        addLabel={t('Add location')}
        empty={() => ({ place: '' })}
        onChange={(locations) => set({ locations })}
        render={(l, put, f) => (
          <>
            <RefField label={t('Place')} field={`${f}.place`} value={l.place} world={world} types={['place']} onChange={(place) => put({ ...l, place: place ?? '' })} />
            <DateField label={t('From')} field={`${f}.from`} value={l.from} calendar={cal} onChange={(from) => put(clean({ ...l, from }))} />
            <DateField label={t('To')} field={`${f}.to`} value={l.to} calendar={cal} onChange={(to) => put(clean({ ...l, to }))} />
          </>
        )}
      />
    </>
  );
}

function EventWhen({ world, e, set }: { world: World; e: LoreEvent; set: (p: Partial<LoreEvent>) => void }) {
  const cal = world.manifest.calendar;
  return (
    <div class="grid-3">
      <DateField label={t('Date')} field="date" value={e.date} calendar={cal} onChange={(date) => set({ date })} />
      <DateField label={t('End (optional)')} field="end" value={e.end} calendar={cal} onChange={(end) => set({ end })} />
      <RefField label={t('Place')} field="place" value={e.place} world={world} types={['place']} onChange={(place) => set({ place })} />
    </div>
  );
}

function EventFields({ world, e, set }: { world: World; e: LoreEvent; set: (p: Partial<LoreEvent>) => void }) {
  return (
    <>
      <ListEditor<Participant>
        title={t('Participants')}
        field="participants"
        items={e.participants}
        addLabel={t('Add participant')}
        empty={() => ({ id: '' })}
        onChange={(participants) => set({ participants })}
        render={(p, put, f) => (
          <>
            <RefField label={t('Who')} field={`${f}.id`} value={p.id} world={world} onChange={(id) => put({ ...p, id: id ?? '' })} />
            <TextField label={t('Role')} field={`${f}.role`} value={p.role} onChange={(role) => put(clean({ ...p, role }))} />
          </>
        )}
      />
      <ListEditor<Action>
        title={t('What happened (actor, verb, target)')}
        field="actions"
        items={e.actions}
        addLabel={t('Add action')}
        empty={() => ({ actor: '', verb: 'killed' })}
        onChange={(actions) => set({ actions })}
        render={(a, put, f) => (
          <>
            <RefField label={t('Actor')} field={`${f}.actor`} value={a.actor} world={world} onChange={(actor) => put({ ...a, actor: actor ?? '' })} />
            <Pick label={t('Verb (past tense)')} field={`${f}.verb`} lower value={a.verb} options={['killed', 'betrayed', 'crowned', 'married', 'met', 'founded', 'destroyed', 'rescued', 'exiled', 'stole']} icon={(v) => suggestionIcon('event', 'verb', v)} onChange={(verb) => put({ ...a, verb: verb ?? '' })} />
            <RefField label={t('Target')} field={`${f}.target`} value={a.target} world={world} onChange={(target) => put(clean({ ...a, target }))} />
          </>
        )}
      />
    </>
  );
}

/** "sworn brother" -> "sworn-brother": a relation type as stored. */
const typeSlug = (t: string) => t.toLowerCase().replace(/\s+/g, '-');

/** A custom relation type. The raw text stays while typing (spaces become hyphens in the stored type), tidied on leaving. */
function CustomType({ id, hintId, value, onChange }: { id: string; hintId: string; value: string; onChange: (type: string) => void }) {
  const [text, setText] = useState(value);
  const box = useRef<HTMLInputElement>(null);
  // While typing the raw text stays, unless the type changed some other way (an undo, an outside change).
  useEffect(() => { if (document.activeElement !== box.current || typeSlug(text.trimStart()) !== value) setText(value); }, [value]);
  return (
    <input ref={box} id={id} type="text" value={text} aria-describedby={hintId} placeholder={t('custom-type')}
      onInput={(e) => { const t = e.currentTarget.value; setText(t); onChange(typeSlug(t.trimStart())); }}
      onBlur={() => { const tidy = typeSlug(text.trim()).replace(/^-+|-+$/g, ''); setText(tidy); if (tidy !== value) onChange(tidy); }} />
  );
}

/** A number field that keeps what is typed ("-", "1.") until it is a number; empty means unset. */
function NumberText(props: { label: string; field: string; value: number | undefined; hint?: string; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(props.value?.toString() ?? '');
  const box = useRef<HTMLDivElement>(null);
  // While typing, "-" and "1." stay as typed; a value changed some other way (an undo) shows.
  const typed = (t: string): number | undefined => (t.trim() && Number.isFinite(Number(t)) ? Number(t) : undefined);
  useEffect(() => { if (!box.current?.contains(document.activeElement) || (typed(text) !== props.value && text.trim() !== '-')) setText(props.value?.toString() ?? ''); }, [props.value]);
  return (
    <div ref={box} onFocusOut={() => setText(props.value?.toString() ?? '')}>
      <TextField label={props.label} field={props.field} value={text} hint={props.hint} onChange={(v) => {
        const t = v ?? '';
        setText(t);
        const n = Number(t);
        if (!t.trim()) props.onChange(undefined);
        else if (t.trim() !== '-' && Number.isFinite(n)) props.onChange(n);
      }} />
    </div>
  );
}
