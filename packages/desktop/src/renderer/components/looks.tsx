import { useEffect, useRef, useState } from 'preact/hooks';
import { lookWhen, newLookId, VISUAL_FIELDS, WorldIndex, type Entry, type Look, type World } from '@lore-forge/core';
import { t, tm } from '../i18n.tsx';
import { worldIndex } from '../hooks.ts';
import { ConfirmDialog } from './confirm.tsx';
import { DateField, RefField, TextField } from './fields.tsx';
import { Icon } from './icon.tsx';
import { EntryMedia } from './images.tsx';
import { Select } from './select.tsx';

/** Sent by Go to before it looks for a field of a look or a picture of one: the look to show (its id, or null for Default). */
export const SHOW_LOOK = 'lore:show-look';

type Mode = 'always' | 'after' | 'before' | 'dates' | 'era';
const MODES: [Mode, () => string][] = [
  ['always', () => t('Always')],
  ['after', () => t('After an event')],
  ['before', () => t('Before an event')],
  ['dates', () => t('Between dates')],
  ['era', () => t('In an era')],
];

/** Which "When" a look is set to: the first of after, before, dates and era it has (a file can mix them; the summary line shows all). */
const modeOf = (l: Look): Mode => (l.after?.trim() ? 'after' : l.before?.trim() ? 'before' : l.from?.trim() || l.to?.trim() ? 'dates' : l.era?.trim() ? 'era' : 'always');

/** A look without the parts that are empty, so the file stays tidy. */
const tidy = (l: Look): Look => Object.fromEntries(Object.entries(l).filter(([k, v]) => k === 'id' || k === 'name' || (v !== undefined && v !== '' && !(typeof v === 'object' && !Object.keys(v as object).length)))) as unknown as Look;

/**
 * An entry's looks in the Appearance section: the Default look (the entry itself) and the looks it has for a while
 * (after a war, in coronation robes, in old age), as a row of pills. The chosen look shows its card (name, why, when),
 * its visual description (only what changes, the Default's text showing through), and its own pictures and 3D models.
 */
export function LooksPanel({ dir, world, entry, onChange }: { dir: string; world: World; entry: Entry; onChange: (e: Entry) => void }) {
  const looks = entry.looks ?? [];
  const [current, setCurrent] = useState<string | null>(null);
  const look = current ? looks.find((l) => l.id === current) : undefined;
  const [adding, setAdding] = useState(false);
  const [doomed, setDoomed] = useState<Look | null>(null);
  // A look that went away (an undo, a change made outside the app): back to the Default look. Only one that was
  // there before: a look just added may not have come back from the editor yet.
  const before = useRef(looks);
  useEffect(() => {
    const had = before.current.some((l) => l.id === current);
    before.current = looks;
    if (current && had && !looks.some((l) => l.id === current)) setCurrent(null);
  }, [looks]);
  // Go to a warning about a look, or a picture of one, shows that look first.
  useEffect(() => {
    const show = (e: Event) => setCurrent((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(SHOW_LOOK, show);
    return () => window.removeEventListener(SHOW_LOOK, show);
  }, []);
  const ix = worldIndex(world);
  const setLooks = (next: Look[]): void => {
    const { looks: _old, ...rest } = entry;
    onChange((next.length ? { ...rest, looks: next } : rest) as Entry);
  };
  const putLook = (id: string, patch: Partial<Look>): void => setLooks(looks.map((l) => (l.id === id ? tidy({ ...l, ...patch }) : l)));
  const add = (name: string): void => {
    const id = newLookId(entry, name);
    setLooks([...looks, { id, name }]);
    setCurrent(id);
    setAdding(false);
  };
  // A deleted look's pictures go back to the Default look (their files stay), and so do its 3D models.
  const remove = (l: Look): void => {
    const { looks: _old, images: _imgs, ...rest } = entry;
    const next = looks.filter((x) => x.id !== l.id);
    const images = entry.images?.map((i) => (i.look === l.id ? (({ look: _l, ...img }) => img)(i) : i));
    onChange({ ...rest, ...(next.length ? { looks: next } : {}), ...(images?.length ? { images } : {}) } as Entry);
    setCurrent(null);
    void window.lore.moveLookModels(dir, entry.id, l.id).catch(() => undefined);
  };
  const fields = VISUAL_FIELDS[entry.type];
  const setVisual = (key: string, v: string | undefined): void => {
    const from = look ? look.visual : entry.visual;
    const visual = Object.fromEntries(Object.entries({ ...from, [key]: v }).filter(([, x]) => x !== undefined && x !== '')) as Record<string, string>;
    if (look) putLook(look.id, { visual: Object.keys(visual).length ? visual : undefined });
    else {
      const { visual: _old, ...rest } = entry;
      onChange((Object.keys(visual).length ? { ...rest, visual } : rest) as Entry);
    }
  };
  return (
    <div class="looks" data-field="looks">
      <div class="looks-bar" role="tablist" aria-label={t('Looks')}>
        <span class="looks-label" aria-hidden="true"><Icon name="sparkles" /> {t('Looks')}</span>
        <button type="button" role="tab" class="pill look-pill" aria-selected={!look} onClick={() => setCurrent(null)}>{t('Default')}</button>
        {looks.map((l, i) => (
          <span key={l.id} data-field={`looks[${i}]`} class="look-pill-wrap">
            <button type="button" role="tab" class="pill look-pill" aria-selected={look?.id === l.id} title={lookWhen(l, ix) ? tm(lookWhen(l, ix)) : undefined} onClick={() => setCurrent(l.id)}>
              {l.name.trim() || t('(no name)')}
            </button>
          </span>
        ))}
        {adding
          ? <NewLook onAdd={add} onCancel={() => setAdding(false)} />
          : <button type="button" class="ghost small look-add" onClick={() => setAdding(true)}>+ {t('New look')}</button>}
      </div>
      {look
        ? <LookCard key={look.id} world={world} ix={ix} look={look} index={looks.indexOf(look)} onPut={(patch) => putLook(look.id, patch)} onDelete={() => setDoomed(look)} />
        : <p class="muted looks-help">{t('How {name} looks most of the time. When that changes for a while (after a war, in coronation robes, in old age), add a look: it gets its own description, pictures and 3D models.', { name: entry.name || t('(no name)') })}</p>}
      {fields.length > 0 && (
        <div data-field={look ? `looks.${look.id}.visual` : 'visual'}>
          <p class="muted">{look ? t('Only what changes: empty fields stay as in the Default look.') : t('Free text for artists and image or 3D tools. Used for the art briefs in the World Codex.')}</p>
          <div class="grid-2">
            {fields.map((f) => {
              const inherited = look ? entry.visual?.[f.key]?.trim() : undefined;
              return (
                <TextField key={`${look?.id ?? ''}:${f.key}`} label={tm(f.label)} field={look ? `looks.${look.id}.visual.${f.key}` : `visual.${f.key}`} multiline
                  value={(look ? look.visual : entry.visual)?.[f.key]} placeholder={inherited ? t('Default: {text}', { text: inherited }) : tm(f.hint)}
                  onChange={(v) => setVisual(f.key, v)} />
              );
            })}
          </div>
        </div>
      )}
      <EntryMedia dir={dir} entry={entry} look={look} onChange={(images) => { const { images: _old, ...rest } = entry; onChange((images ? { ...rest, images } : rest) as Entry); }} />
      {doomed && (
        <ConfirmDialog title={t('Delete the look “{name}”?', { name: doomed.name.trim() || doomed.id })} confirmLabel={t('Delete look')} onClose={() => setDoomed(null)}
          onConfirm={async () => { remove(doomed); setDoomed(null); }}>
          <p>{t('Its pictures and 3D models move to the Default look. Their files stay in the world folder.')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** The name box for a new look: Enter adds it, Escape (or an empty name) gives up. */
function NewLook({ onAdd, onCancel }: { onAdd: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  return (
    <form class="look-new" onSubmit={(e) => { e.preventDefault(); const text = (box.current?.value ?? name).trim(); if (text) onAdd(text); else onCancel(); }}>
      <input ref={box} type="text" value={name} placeholder={t('Name of the new look')} aria-label={t('Name of the new look')}
        onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }} />
      <button type="submit" class="primary small">{t('Add')}</button>
      <button type="button" class="ghost small" onClick={onCancel}>{t('Cancel')}</button>
    </form>
  );
}

/** A look's name, why it looks different and when it applies, with a line that says it in words. */
function LookCard({ world, ix, look, index, onPut, onDelete }: { world: World; ix: WorldIndex; look: Look; index: number; onPut: (patch: Partial<Look>) => void; onDelete: () => void }) {
  const cal = world.manifest.calendar;
  const [mode, setMode] = useState<Mode>(() => modeOf(look));
  // Changed some other way (an undo, an AI assistant): follow it, unless it is simply not filled in yet.
  useEffect(() => { const m = modeOf(look); if (m !== 'always') setMode(m); }, [look.after, look.before, look.from, look.to, look.era]);
  const pick = (m: Mode): void => {
    setMode(m);
    onPut({
      after: m === 'after' ? look.after : undefined,
      before: m === 'before' ? look.before : undefined,
      from: m === 'dates' ? look.from : undefined,
      to: m === 'dates' ? look.to : undefined,
      era: m === 'era' ? (look.era ?? cal.eras[0]?.id) : undefined,
    });
  };
  const when = lookWhen(look, ix);
  const f = (name: string) => `looks[${index}].${name}`;
  return (
    <fieldset class="look-card" data-field={`looks[${index}]`}>
      <legend><Icon name="sparkles" /> {look.name.trim() || t('(no name)')}</legend>
      <div class="grid-2">
        <TextField label={t('Name')} field={f('name')} value={look.name} onChange={(name) => onPut({ name: name ?? '' })} />
        <TextField label={t('Why it looks different')} field={f('reason')} value={look.reason} placeholder={t('e.g. lost an eye in the war, crowned queen, new clothes')} multiline onChange={(reason) => onPut({ reason })} />
      </div>
      <div class="look-when" data-field={f('when')}>
        <span class="look-when-label" id={`look-when-${look.id}`}>{t('When')}</span>
        <div class="status-pills look-modes" role="radiogroup" aria-labelledby={`look-when-${look.id}`}>
          {MODES.map(([m, label]) => (
            <button key={m} type="button" role="radio" class="pill" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} onClick={() => mode !== m && pick(m)}>{label()}</button>
          ))}
        </div>
      </div>
      {mode === 'after' && <div class="grid-2"><RefField label={t('Event')} field={f('after')} value={look.after} world={world} types={['event']} onChange={(after) => onPut({ after })} /></div>}
      {mode === 'before' && <div class="grid-2"><RefField label={t('Event')} field={f('before')} value={look.before} world={world} types={['event']} onChange={(before) => onPut({ before })} /></div>}
      {mode === 'dates' && (
        <div class="grid-2">
          <DateField label={t('From')} field={f('from')} value={look.from} calendar={cal} onChange={(from) => onPut({ from })} />
          <DateField label={t('To')} field={f('to')} value={look.to} calendar={cal} onChange={(to) => onPut({ to })} />
        </div>
      )}
      {mode === 'era' && (
        <div class="grid-2">
          <div class="field" data-field={f('era')}>
            <label for={`look-era-${look.id}`}>{t('Era')}</label>
            <Select id={`look-era-${look.id}`} value={look.era ?? ''} onChange={(era) => onPut({ era: era || undefined })}
              options={cal.eras.map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }))} />
          </div>
        </div>
      )}
      <div class="look-foot">
        <p class="muted look-summary"><Icon name="hourglass" /> {when ? t('Applies {when}.', { when: tm(when) }) : t('Applies at any time.')}</p>
        <button type="button" class="ghost small danger look-delete" onClick={onDelete}><Icon name="trash-can" /> {t('Delete look')}</button>
      </div>
    </fieldset>
  );
}
