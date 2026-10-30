import { createContext } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { calendarProblems, eraUsage, type Calendar, type World } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Select } from './select.tsx';
import { ColorField } from './color.tsx';

/** Opens World settings at the calendar; null outside a world. Used by the "Known eras" hints. */
export const ErasLink = createContext<(() => void) | null>(null);

/** A small "Edit eras" link for a message about unknown eras, or nothing. */
export function EditErasLink({ message }: { message: string }) {
  const open = useContext(ErasLink);
  if (!open || !message.includes('Known eras')) return null;
  return <button type="button" class="link eras-link" onClick={open}><Icon name="calendar" /> Edit eras</button>;
}

const ERA_COLOURS = ['#c9a45c', '#6f8fc9', '#8fb87a', '#c97a6f', '#a68fc9', '#6fb8b0'];

interface EraRow { key: number; orig?: string; id: string; name: string; start: string; end: string; color: string }
interface MonthRow { key: number; name: string; days: string }

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/**
 * The world's calendar, from world.json: its eras (what "312 OK" means) and months. Eras still used by dates
 * keep their abbreviation; other problems (overlaps, missing names) block Save until fixed.
 */
export function WorldSettings({ world, onSave, onClose, onAbout }: { world: World; onSave: (cal: Calendar) => Promise<boolean>; onClose: () => void; onAbout?: () => void }) {
  const cal = world.manifest.calendar;
  const seq = useRef(0);
  const [eras, setEras] = useState<EraRow[]>(() => cal.eras.map((e) => ({ key: seq.current++, orig: e.id, id: e.id, name: e.name, start: String(e.start), end: e.end === undefined ? '' : String(e.end), color: e.color ?? '' })));
  const [months, setMonths] = useState<MonthRow[]>(() => (cal.months ?? []).map((m) => ({ key: seq.current++, name: m.name, days: String(m.days) })));
  const [defaultEra, setDefaultEra] = useState(cal.defaultEra);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const back = useRef<Element | null>(document.activeElement);
  const usage = useMemo(() => eraUsage(world), [world]);

  useEffect(() => {
    first.current?.focus();
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
    .map((e) => `${usage.get(e.id)} date${usage.get(e.id) === 1 ? ' is' : 's are'} written in ${e.name} (${e.id}). Keep its abbreviation ${e.id}, or change those dates first.`);
  const problems = [...lost, ...calendarProblems(draft)];

  const setEra = (key: number, patch: Partial<EraRow>) => setEras((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = <T,>(list: T[], i: number, d: number) => { const out = [...list]; const [x] = out.splice(i, 1); out.splice(i + d, 0, x!); return out; };
  const addEra = () => {
    const last = draft.eras.reduce((m, e) => (Number.isFinite(e.start) ? Math.max(m, e.end ?? e.start) : m), 0);
    setEras((rs) => [...rs, { key: seq.current++, id: '', name: '', start: String(last + 1), end: '', color: ERA_COLOURS[rs.length % ERA_COLOURS.length]! }]);
  };
  const save = async () => {
    if (problems.length || saving) return;
    setSaving(true);
    const ok = await onSave({ ...draft, months: draft.months?.length ? draft.months : undefined } as Calendar);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section class="world-settings" role="dialog" aria-modal="true" aria-labelledby="ws-title">
        <header class="about-head">
          <Icon name="calendar" class="about-mark" />
          <div>
            <h2 id="ws-title">World settings</h2>
            <p class="muted">The calendar of {world.manifest.name}, saved in world.json.</p>
          </div>
        </header>

        <h3 id="ws-eras">Eras</h3>
        <p class="muted small ws-explain">
          A date like “312 OK” is year 312 of the era with the abbreviation OK. <strong>Starts at</strong> is the world year that the era's year 1 falls on, so every era sits on one timeline.
          An era without an end lasts until the next one starts. Dates with no abbreviation use the default era.
        </p>
        <div class="ws-eras" role="group" aria-labelledby="ws-eras">
          <div class="ws-era ws-head" aria-hidden="true"><span /><span>Name</span><span>Abbreviation</span><span>Starts at</span><span>Ends at</span><span>Colour</span><span>Dates</span><span /></div>
          {eras.map((r, i) => {
            const label = r.name.trim() || `era ${i + 1}`;
            const used = r.orig ? usage.get(r.orig) ?? 0 : 0;
            return (
              <div key={r.key} class="ws-era" role="group" aria-label={label}>
                <span class="ws-order">
                  <button type="button" class="ghost small ws-up" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => setEras((rs) => move(rs, i, -1))}><span class="chev chev-up" /></button>
                  <button type="button" class="ghost small ws-down" aria-label={`Move ${label} down`} disabled={i === eras.length - 1} onClick={() => setEras((rs) => move(rs, i, 1))}><span class="chev chev-down" /></button>
                </span>
                <input ref={i === 0 ? first : undefined} class="ws-name" type="text" value={r.name} aria-label={`Name of ${label}`} placeholder="After the Sundering" onInput={(e) => setEra(r.key, { name: e.currentTarget.value })} />
                <input class="ws-code" type="text" value={r.id} aria-label={`Abbreviation of ${label}`} placeholder="AS" onInput={(e) => setEra(r.key, { id: e.currentTarget.value })} />
                <input class="ws-start" type="number" step={1} value={r.start} aria-label={`World year ${label} starts at`} onInput={(e) => setEra(r.key, { start: e.currentTarget.value })} />
                <input class="ws-end" type="number" step={1} value={r.end} aria-label={`World year ${label} ends at (optional)`} placeholder="open" onInput={(e) => setEra(r.key, { end: e.currentTarget.value })} />
                <span class="ws-color">
                  {r.color
                    ? <><ColorField label={`Colour of ${label}`} value={r.color} alpha={false} swatches={ERA_COLOURS} class="inline" onChange={(c) => setEra(r.key, { color: c })} />
                      <button type="button" class="ghost small" aria-label={`No colour for ${label}`} onClick={() => setEra(r.key, { color: '' })}><Icon name="cancel" /></button></>
                    : <button type="button" class="ghost small" onClick={() => setEra(r.key, { color: ERA_COLOURS[i % ERA_COLOURS.length]! })}>Add colour</button>}
                </span>
                <span class="ws-used muted" title={`${used} dates use this era`}>{used}</span>
                <button type="button" class="ghost small ws-delete" aria-label={`Delete ${label}`} onClick={() => setEras((rs) => rs.filter((x) => x.key !== r.key))}><Icon name="trash-can" /></button>
              </div>
            );
          })}
        </div>
        <div class="ws-row">
          <button type="button" class="ghost small ws-add-era" onClick={addEra}>+ Add era</button>
          <label class="ws-default">
            <span class="field-label">Default era</span>
            <Select id="ws-default" value={defaultEra} onChange={setDefaultEra} placeholder="Pick an era…"
              options={draft.eras.filter((e) => e.id).map((e) => ({ value: e.id, label: `${e.name || e.id} (${e.id})` }))} />
          </label>
        </div>

        <h3 id="ws-months">Months</h3>
        <p class="muted small ws-explain">{months.length ? `${months.length} months, ${draft.months!.reduce((n, m) => n + (Number.isFinite(m.days) ? m.days : 0), 0)} days a year.` : 'No months set: the year has 12 months of 30 days.'}</p>
        <ol class="ws-months" aria-labelledby="ws-months">
          {months.map((m, i) => (
            <li key={m.key} class="ws-month">
              <span class="muted ws-month-no">{i + 1}</span>
              <input class="ws-month-name" type="text" value={m.name} aria-label={`Name of month ${i + 1}`} onInput={(e) => { const v = e.currentTarget.value; setMonths((ms) => ms.map((x) => (x.key === m.key ? { ...x, name: v } : x))); }} />
              <input class="ws-month-days" type="number" min={1} step={1} value={m.days} aria-label={`Days in month ${i + 1}`} onInput={(e) => { const v = e.currentTarget.value; setMonths((ms) => ms.map((x) => (x.key === m.key ? { ...x, days: v } : x))); }} />
              <span class="muted small">days</span>
              <button type="button" class="ghost small" aria-label={`Delete month ${i + 1}`} onClick={() => setMonths((ms) => ms.filter((x) => x.key !== m.key))}><Icon name="trash-can" /></button>
            </li>
          ))}
        </ol>
        <button type="button" class="ghost small ws-add-month" onClick={() => setMonths((ms) => [...ms, { key: seq.current++, name: '', days: '30' }])}>+ Add month</button>

        <div class="ws-problems" aria-live="polite">
          {problems.length > 0 && (
            <ul>{problems.map((p) => <li key={p}><Icon name="hazard-sign" /> {p}</li>)}</ul>
          )}
        </div>
        <div class="dialog-actions">
          {onAbout && <button type="button" class="ghost small ws-about" onClick={onAbout} title="About Lore-Forge, credits and licences"><Icon name="laurels" /> About</button>}
          <span class="muted small spacer">Changing a start year moves every date in that era on the timeline.</span>
          <button type="button" class="ghost ws-cancel" onClick={onClose}>Cancel</button>
          <button type="button" class="primary ws-save" disabled={problems.length > 0 || saving} onClick={() => void save()}><Icon name="check-mark" /> Save calendar</button>
        </div>
      </section>
    </div>
  );
}
