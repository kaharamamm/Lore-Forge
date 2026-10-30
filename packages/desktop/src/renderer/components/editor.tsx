import {
  endFieldVisible, endValue, LIFECYCLE, RELATION_GROUPS, relationFits, relationKind, relationKindsFor, relationTargets, TYPE_EMOJI, TYPE_SINGULAR, VISUAL_FIELDS, WorldIndex,
  type Action, type Character, type Entry, type EntryType, type LocationSpan, type LoreEvent, type Participant, type Relation, type RelationGroup, type Warning, type World,
} from '@lore-forge/core';
import { useState } from 'preact/hooks';
import { DateField, Field, ListEditor, ListText, RefField, TextField } from './fields.tsx';
import { ImageSlots } from './images.tsx';
import { ProseField } from './prose.tsx';
import { TypeBadge } from './type.tsx';
import { WarningItem, type WarningActions } from './warnings.tsx';

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
    <article class={`editor t-${entry.type}`} aria-labelledby="entry-title">
      <header class="editor-head">
        <div>
          <p class="eyebrow"><TypeBadge type={entry.type} /></p>
          <h2 id="entry-title" tabIndex={-1}><span class="title-emoji" aria-hidden="true">{TYPE_EMOJI[entry.type]} </span>{entry.name || '(no name)'}</h2>
          <p class="muted">id <code>{entry.id}</code> · {world.files[entry.id]}</p>
        </div>
        <button type="button" class="ghost danger" onClick={onDelete}><span aria-hidden="true">🗑️ </span>Delete entry</button>
      </header>

      <section class="live-warnings" aria-live="polite" aria-label="Live warnings for this entry">
        {warnings.length === 0 ? (
          <p class="ok-line"><span aria-hidden="true">✨ </span>No warnings for this entry. Canon holds.</p>
        ) : (
          <ul class="warning-list">
            {warnings.map((w) => <WarningItem key={w.id} w={w} actions={actions} compact={w.offending.entryId === entry.id} />)}
          </ul>
        )}
      </section>

      <div class="grid-2">
        <TextField label="Name" field="name" value={entry.name} onChange={(name) => base({ name: name ?? '' })} />
        <ListText label="Aliases (comma-separated)" field="aliases" value={entry.aliases} onChange={(aliases) => base({ aliases })} resetKey={entry.id} />
        <TextField label="Summary" field="summary" value={entry.summary} onChange={(summary) => base({ summary })} />
        <ListText label="Tags (comma-separated)" field="tags" value={entry.tags} onChange={(tags) => base({ tags })} resetKey={entry.id} />
      </div>

      {LIFECYCLE[entry.type] && <LifecycleFields world={world} entry={entry} onChange={onChange} />}
      {entry.type === 'character' && <CharacterFields world={world} e={entry} set={set(entry)} />}
      {entry.type === 'place' && (
        <div class="grid-3">
          <RefField label="Part of (region)" field="partOf" value={entry.partOf} world={world} types={['place']} onChange={(partOf) => set(entry)({ partOf })} />
        </div>
      )}
      {entry.type === 'event' && <EventFields world={world} e={entry} set={set(entry)} />}
      {entry.type === 'note' && (
        <div class="grid-3">
          <DateField label="Date (optional)" field="date" value={entry.date} calendar={cal} onChange={(date) => set(entry)({ date })} />
        </div>
      )}
      {(entry.type === 'event' || entry.type === 'note') && (
        <fieldset class="list-editor">
          <legend>Story Book</legend>
          <div class="grid-2">
            <TextField label="Chapter (optional)" field="chapter" value={entry.chapter} onChange={(chapter) => base({ chapter })} hint="Leave empty to place it by date in its era or year range." />
            <TextField label="Order in chapter" field="bookOrder" value={entry.bookOrder?.toString()} onChange={(v) => base({ bookOrder: v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined })} hint="Default 0. Lower comes first; ties go by date." />
          </div>
        </fieldset>
      )}

      {VISUAL_FIELDS[entry.type].length > 0 && (
        <fieldset class="list-editor" data-field="visual">
          <legend>Visual description</legend>
          <p class="muted">Free text for artists and image or 3D tools. Used for the art briefs in the World Bible.</p>
          <div class="grid-2">
            {VISUAL_FIELDS[entry.type].map((f) => (
              <TextField key={f.key} label={f.label} field={`visual.${f.key}`} value={entry.visual?.[f.key]} placeholder={f.hint} multiline
                onChange={(v) => {
                  const visual = Object.fromEntries(Object.entries({ ...entry.visual, [f.key]: v }).filter(([, x]) => x !== undefined)) as Record<string, string>;
                  base({ visual: Object.keys(visual).length ? visual : undefined });
                }} />
            ))}
          </div>
        </fieldset>
      )}
      <ImageSlots dir={dir} entry={entry} onChange={(images) => base({ images })} />

      <ListEditor<Relation>
        title="Relationships"
        field="relations"
        items={entry.relations}
        addLabel="Add relationship"
        empty={() => ({ type: relationKindsFor(entry.type)[0]?.type ?? 'related-to', target: '' })}
        onChange={(relations) => base({ relations })}
        render={(r, put, f) => (
          <>
            <RelationTypeField world={world} entry={entry} r={r} field={`${f}.type`} onChange={(type) => put({ ...r, type })} />
            <RefField label="Target" field={`${f}.target`} value={r.target} world={world} types={relationTargets(r.type, entry.type)} exclude={entry.id} onChange={(target) => put({ ...r, target: target ?? '' })} />
            <DateField label="From" field={`${f}.from`} value={r.from} calendar={cal} onChange={(from) => put(clean({ ...r, from }))} />
            <DateField label="To" field={`${f}.to`} value={r.to} calendar={cal} onChange={(to) => put(clean({ ...r, to }))} />
          </>
        )}
      />

      <ProseField world={world} entry={entry} onInput={(body) => base({ body })} onOpen={onOpen} />
    </article>
  );
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Free text with suggestions (relation types, verbs). */
function Pick(props: { label: string; field: string; value: string; options: string[]; onChange: (v: string | undefined) => void }) {
  const id = `opts-${props.field.replace(/\W/g, '-')}`;
  return (
    <div class="field" data-field={props.field}>
      <label for={`${id}-input`}>{props.label}</label>
      <input id={`${id}-input`} type="text" list={id} value={props.value} onInput={(e) => props.onChange(e.currentTarget.value)} />
      <datalist id={id}>{props.options.map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  );
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
  const status = rec['status'];
  const [startField, startLabel] = START_FIELD[entry.type]!;
  const showEnd = endFieldVisible(entry);
  const hidden = !showEnd ? endValue(entry) : undefined;
  const ongoing = status && lc.ongoing.includes(status) ? lc.statuses.find((x) => x.value === status) : undefined;
  return (
    <fieldset class="lifecycle">
      <legend>Status and dates</legend>
      <div class="grid-3">
        <Field label="Status" field="status">
          {(id) => (
            <div class="status-pills" role="radiogroup" id={id} aria-label="Status">
              {lc.statuses.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={status === o.value} class={`pill status-${o.value}`}
                  onClick={() => put({ status: status === o.value ? undefined : o.value })}>
                  <span aria-hidden="true">{o.emoji} </span>{o.label}
                </button>
              ))}
            </div>
          )}
        </Field>
        <DateField label={startLabel} field={startField} value={rec[startField]} calendar={cal} onChange={(v) => put({ [startField]: v })} />
        {showEnd && <DateField label={lc.endLabel} field={lc.endField} value={rec[lc.endField]} calendar={cal} onChange={(v) => put({ [lc.endField]: v })} />}
      </div>
      {hidden && hidden.trim() !== '' && (
        <p class="hint hidden-note" data-field={lc.endField}>
          <span aria-hidden="true">💾 </span>{lc.endLabel} “{hidden}” is still in the file but hidden while the status is {ongoing?.label ?? status}. Pick {lc.statuses.find((x) => lc.ended.includes(x.value))!.label} to edit it, or clear it there.
        </p>
      )}
      {!showEnd && !hidden && !ongoing && <p class="hint">Pick {lc.statuses.find((x) => lc.ended.includes(x.value))!.label} to add a {lc.endLabel.toLowerCase()} date.</p>}
    </fieldset>
  );
}

const GROUP_ORDER = Object.keys(RELATION_GROUPS) as RelationGroup[];

/** Relation type limited to what fits this entry (and the chosen target), grouped; custom types still possible. */
function RelationTypeField({ world, entry, r, field, onChange }: { world: World; entry: Entry; r: Relation; field: string; onChange: (type: string) => void }) {
  const target = new WorldIndex(world).resolve(r.target);
  const kinds = relationKindsFor(entry.type, target?.type);
  const current = relationKind(r.type);
  const known = current && kinds.includes(current);
  const [custom, setCustom] = useState(!current && r.type !== '');
  const misfit = current && target && !relationFits(current, entry.type, target.type);
  const hint = misfit
    ? `“${r.type}” doesn't fit ${TYPE_SINGULAR[entry.type].toLowerCase()} → ${TYPE_SINGULAR[target.type].toLowerCase()}. Pick another.`
    : target ? `Types that fit ${TYPE_SINGULAR[entry.type].toLowerCase()} → ${TYPE_SINGULAR[target.type].toLowerCase()}` : `Types that fit a ${TYPE_SINGULAR[entry.type].toLowerCase()}`;
  return (
    <Field label="Relation" field={field} hint={hint} invalid={!!misfit}>
      {(id, hintId) => custom ? (
        <div class="row nowrap">
          <input id={id} type="text" value={r.type} aria-describedby={hintId} placeholder="custom-type" onInput={(e) => onChange(e.currentTarget.value.trim().toLowerCase().replace(/\s+/g, '-'))} />
          <button type="button" class="ghost small" onClick={() => { setCustom(false); onChange(kinds[0]?.type ?? 'related-to'); }}>List</button>
        </div>
      ) : (
        <select id={id} value={r.type} aria-describedby={hintId} aria-invalid={!!misfit}
          onChange={(e) => { const v = e.currentTarget.value; if (v === '__custom') setCustom(true); else onChange(v); }}>
          {!known && r.type && <option value={r.type}>{misfit ? '⚠ ' : ''}{r.type.replace(/-/g, ' ')}{misfit ? ' (does not fit)' : ''}</option>}
          {GROUP_ORDER.map((g) => {
            const ks = kinds.filter((k) => k.group === g);
            return ks.length ? (
              <optgroup key={g} label={`${RELATION_GROUPS[g].emoji} ${RELATION_GROUPS[g].label}`}>
                {ks.map((k) => <option key={k.type} value={k.type}>{k.label}</option>)}
              </optgroup>
            ) : null;
          })}
          <option value="__custom">✏️ Custom type…</option>
        </select>
      )}
    </Field>
  );
}

function CharacterFields({ world, e, set }: { world: World; e: Character; set: (p: Partial<Character>) => void }) {
  const cal = world.manifest.calendar;
  return (
    <>
      <ListEditor<LocationSpan>
        title="Locations over time"
        field="locations"
        items={e.locations}
        addLabel="Add location"
        empty={() => ({ place: '' })}
        onChange={(locations) => set({ locations })}
        render={(l, put, f) => (
          <>
            <RefField label="Place" field={`${f}.place`} value={l.place} world={world} types={['place']} onChange={(place) => put({ ...l, place: place ?? '' })} />
            <DateField label="From" field={`${f}.from`} value={l.from} calendar={cal} onChange={(from) => put(clean({ ...l, from }))} />
            <DateField label="To" field={`${f}.to`} value={l.to} calendar={cal} onChange={(to) => put(clean({ ...l, to }))} />
          </>
        )}
      />
    </>
  );
}

function EventFields({ world, e, set }: { world: World; e: LoreEvent; set: (p: Partial<LoreEvent>) => void }) {
  const cal = world.manifest.calendar;
  return (
    <>
      <div class="grid-3">
        <DateField label="Date" field="date" value={e.date} calendar={cal} onChange={(date) => set({ date })} />
        <DateField label="End (optional)" field="end" value={e.end} calendar={cal} onChange={(end) => set({ end })} />
        <RefField label="Place" field="place" value={e.place} world={world} types={['place']} onChange={(place) => set({ place })} />
      </div>
      <ListEditor<Participant>
        title="Participants"
        field="participants"
        items={e.participants}
        addLabel="Add participant"
        empty={() => ({ id: '' })}
        onChange={(participants) => set({ participants })}
        render={(p, put, f) => (
          <>
            <RefField label="Who" field={`${f}.id`} value={p.id} world={world} onChange={(id) => put({ ...p, id: id ?? '' })} />
            <TextField label="Role" field={`${f}.role`} value={p.role} onChange={(role) => put(clean({ ...p, role }))} />
          </>
        )}
      />
      <ListEditor<Action>
        title="What happened (actor, verb, target)"
        field="actions"
        items={e.actions}
        addLabel="Add action"
        empty={() => ({ actor: '', verb: 'killed' })}
        onChange={(actions) => set({ actions })}
        render={(a, put, f) => (
          <>
            <RefField label="Actor" field={`${f}.actor`} value={a.actor} world={world} onChange={(actor) => put({ ...a, actor: actor ?? '' })} />
            <Pick label="Verb (past tense)" field={`${f}.verb`} value={a.verb} options={['killed', 'betrayed', 'crowned', 'married', 'met', 'founded', 'destroyed', 'rescued', 'exiled', 'stole']} onChange={(verb) => put({ ...a, verb: verb ?? '' })} />
            <RefField label="Target" field={`${f}.target`} value={a.target} world={world} onChange={(target) => put(clean({ ...a, target }))} />
          </>
        )}
      />
    </>
  );
}
