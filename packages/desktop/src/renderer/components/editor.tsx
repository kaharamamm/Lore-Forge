import { bodyLinks, TYPE_LABELS, VISUAL_FIELDS, WorldIndex, type Action, type Character, type Entry, type LocationSpan, type LoreEvent, type Participant, type Relation, type Warning, type World } from '@lore-forge/core';
import { DateField, ListEditor, ListText, RefField, SelectField, TextField } from './fields.tsx';
import { ImageSlots } from './images.tsx';
import { WarningItem, type WarningActions } from './warnings.tsx';

const RELATION_TYPES = ['parent-of', 'child-of', 'sibling-of', 'spouse-of', 'member-of', 'leader-of', 'rules', 'serves', 'ally-of', 'enemy-of', 'owns', 'killed'];

interface Props {
  dir: string;
  world: World;
  entry: Entry;
  warnings: Warning[];
  actions: WarningActions;
  onChange: (e: Entry) => void;
  onDelete: () => void;
}

export function EntryEditor({ dir, world, entry, warnings, actions, onChange, onDelete }: Props) {
  const cal = world.manifest.calendar;
  // Each type section gets a setter typed for its own entry shape.
  const set = <E extends Entry>(e: E) => (patch: Partial<E>) => onChange({ ...e, ...patch });
  const base = set(entry);
  const ix = new WorldIndex(world);
  const links = bodyLinks(entry.body);
  return (
    <article class="editor" aria-labelledby="entry-title">
      <header class="editor-head">
        <div>
          <p class="eyebrow">{TYPE_LABELS[entry.type].replace(/s$/, '')}</p>
          <h2 id="entry-title" tabIndex={-1}>{entry.name || '(no name)'}</h2>
          <p class="muted">id <code>{entry.id}</code> · {world.files[entry.id]}</p>
        </div>
        <button type="button" class="ghost danger" onClick={onDelete}>Delete entry</button>
      </header>

      <section class="live-warnings" aria-live="polite" aria-label="Live warnings for this entry">
        {warnings.length === 0 ? (
          <p class="ok-line"><span aria-hidden="true">✓ </span>No warnings for this entry.</p>
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

      {entry.type === 'character' && <CharacterFields world={world} e={entry} set={set(entry)} />}
      {entry.type === 'place' && (
        <div class="grid-3">
          <DateField label="Founded" field="founded" value={entry.founded} calendar={cal} onChange={(founded) => set(entry)({ founded })} />
          <DateField label="Destroyed" field="destroyed" value={entry.destroyed} calendar={cal} onChange={(destroyed) => set(entry)({ destroyed })} />
          <RefField label="Part of (region)" field="partOf" value={entry.partOf} world={world} types={['place']} onChange={(partOf) => set(entry)({ partOf })} />
        </div>
      )}
      {entry.type === 'faction' && (
        <div class="grid-3">
          <DateField label="Founded" field="founded" value={entry.founded} calendar={cal} onChange={(founded) => set(entry)({ founded })} />
          <DateField label="Dissolved" field="dissolved" value={entry.dissolved} calendar={cal} onChange={(dissolved) => set(entry)({ dissolved })} />
        </div>
      )}
      {entry.type === 'item' && (
        <div class="grid-3">
          <DateField label="Made" field="created" value={entry.created} calendar={cal} onChange={(created) => set(entry)({ created })} />
          <DateField label="Destroyed" field="destroyed" value={entry.destroyed} calendar={cal} onChange={(destroyed) => set(entry)({ destroyed })} />
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
        empty={() => ({ type: 'ally-of', target: '' })}
        onChange={(relations) => base({ relations })}
        render={(r, put, f) => (
          <>
            <Pick label="Relation" field={`${f}.type`} value={r.type} options={RELATION_TYPES} onChange={(type) => put({ ...r, type: type ?? '' })} />
            <RefField label="Target" field={`${f}.target`} value={r.target} world={world} onChange={(target) => put({ ...r, target: target ?? '' })} />
            <DateField label="From" field={`${f}.from`} value={r.from} calendar={cal} onChange={(from) => put(clean({ ...r, from }))} />
            <DateField label="To" field={`${f}.to`} value={r.to} calendar={cal} onChange={(to) => put(clean({ ...r, to }))} />
          </>
        )}
      />

      <div class="field body-field" data-field="body">
        <label for="entry-body">Text</label>
        <textarea id="entry-body" class="body-text" value={entry.body} rows={14} aria-describedby="body-hint" onInput={(e) => base({ body: e.currentTarget.value })} />
        <div class="hint" id="body-hint">
          Markdown. Link entries with <code>[[id]]</code>, <code>[[Name]]</code>, <code>[[id|label]]</code> or <code>@id</code>.
          {links.length > 0 && (
            <ul class="link-chips" aria-label="Links in this text">
              {links.map((l, i) => {
                const t = ix.resolve(l.ref);
                return (
                  <li key={i} class={t ? 'chip' : 'chip chip-missing'}>
                    <span aria-hidden="true">{t ? '✓ ' : '✖ '}</span>
                    {t ? t.name : `${l.ref} (missing)`}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
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

function CharacterFields({ world, e, set }: { world: World; e: Character; set: (p: Partial<Character>) => void }) {
  const cal = world.manifest.calendar;
  return (
    <>
      <div class="grid-3">
        <DateField label="Born" field="born" value={e.born} calendar={cal} onChange={(born) => set({ born })} />
        <DateField label="Died" field="died" value={e.died} calendar={cal} onChange={(died) => set({ died })} />
        <SelectField label="Status" field="status" value={e.status} options={[['alive', 'Alive'], ['dead', 'Dead'], ['unknown', 'Unknown']] as const} onChange={(status) => set({ status })} />
      </div>
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
