import { monthsOf, TYPE_LABELS, WorldIndex, type Calendar, type Entry, type ParsedDate, type Warning, type World } from '@lore-forge/core';
import { CountBadge } from './severity.tsx';
import { involves } from './warnings.tsx';

interface Row {
  entry: Entry;
  start?: ParsedDate;
  end?: ParsedDate;
  label: string;
}

/** Absolute day -> "1800" or "410 OK", using the era that contains it. */
function yearLabel(day: number, cal: Calendar): string {
  const perYear = monthsOf(cal).reduce((s, m) => s + m.days, 0);
  const abs = Math.floor(day / perYear);
  const eras = [...cal.eras].sort((a, b) => a.start - b.start);
  const era = [...eras].reverse().find((e) => e.start <= abs) ?? eras[0]!;
  const y = abs - era.start + 1;
  return era.id === cal.defaultEra ? String(y) : `${y} ${era.id}`;
}

export function TimelineView({ world, warnings, selectedId, onOpen }: { world: World; warnings: Warning[]; selectedId: string | null; onOpen: (id: string) => void }) {
  const ix = new WorldIndex(world);
  const cal = world.manifest.calendar;
  const rows: Row[] = [];
  const events: Row[] = [];
  for (const e of world.entries) {
    if (e.type === 'note') continue;
    const life = ix.life(e);
    if (!life.start && !life.end) continue;
    const label = `${life.start ? ix.fmt(life.start.date) : '?'} – ${life.end ? ix.fmt(life.end.date) : e.type === 'event' ? '' : '?'}`.replace(/ – $/, '');
    (e.type === 'event' ? events : rows).push({ entry: e, start: life.start?.date, end: life.end?.date, label });
  }
  const all = [...rows, ...events].flatMap((r) => [r.start, r.end]).filter((d): d is ParsedDate => !!d);
  if (all.length === 0) return <section class="timeline"><h2>Timeline</h2><p class="muted">No dated entries yet. Add birth, founding or event dates to see them here.</p></section>;
  let min = Math.min(...all.map((d) => d.lo));
  let max = Math.max(...all.map((d) => d.hi));
  const pad = Math.max((max - min) * 0.03, 1);
  min -= pad;
  max += pad;
  const pct = (day: number): number => ((day - min) / (max - min)) * 100;
  const ticks = Array.from({ length: 6 }, (_, i) => min + ((max - min) * i) / 5);
  const byStart = (a: Row, b: Row) => (a.start?.lo ?? a.end?.lo ?? 0) - (b.start?.lo ?? b.end?.lo ?? 0);
  const groups = (['character', 'faction', 'place', 'item'] as const).map((t) => [t, rows.filter((r) => r.entry.type === t).sort(byStart)] as const).filter(([, rs]) => rs.length > 0);
  events.sort(byStart);

  const renderRow = (r: Row) => {
    const isEvent = r.entry.type === 'event';
    const from = r.start ? r.start.lo : min;
    const to = r.end ? r.end.hi : isEvent ? (r.start?.hi ?? max) : max;
    const left = pct(from);
    const width = Math.max(pct(to) - left, 0.6);
    const open = `${r.start ? '' : ' open-start'}${r.end || isEvent ? '' : ' open-end'}`;
    const ws = warnings.filter((w) => involves(w, r.entry.id));
    return (
      <li class={`tl-row${selectedId === r.entry.id ? ' selected' : ''}`} key={r.entry.id}>
        <button type="button" class="tl-label" onClick={() => onOpen(r.entry.id)}>
          <span class="tl-name">{r.entry.name}</span>
          <span class="tl-dates">{r.label}</span>
          <CountBadge warnings={ws} />
        </button>
        <div class="tl-track" aria-hidden="true">
          {isEvent && !r.end ? (
            <span class="tl-marker" style={{ left: `${pct(((r.start?.lo ?? 0) + (r.start?.hi ?? 0)) / 2)}%` }} />
          ) : (
            <span class={`tl-bar tl-${r.entry.type}${open}`} style={{ left: `${left}%`, width: `${width}%` }} />
          )}
        </div>
      </li>
    );
  };

  return (
    <section class="timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title" tabIndex={-1}>Timeline</h2>
      <p class="muted">Lifespans and events on one axis. A faded end means the date is unknown. Select a name to open it.</p>
      <div class="tl-scroll">
        <div class="tl-inner">
          <div class="tl-axis" aria-hidden="true">
            <span class="tl-axis-spacer" />
            <div class="tl-track">
              {ticks.map((t, i) => (
                <span key={i} class="tl-tick" style={{ left: `${pct(t)}%` }}>{yearLabel(t, cal)}</span>
              ))}
            </div>
          </div>
          {groups.map(([t, rs]) => (
            <section key={t} class="tl-group" aria-label={TYPE_LABELS[t]}>
              <h3>{TYPE_LABELS[t]}</h3>
              <ul>{rs.map(renderRow)}</ul>
            </section>
          ))}
          {events.length > 0 && (
            <section class="tl-group" aria-label="Events">
              <h3>Events</h3>
              <ul>{events.map(renderRow)}</ul>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
