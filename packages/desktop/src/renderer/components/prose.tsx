import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { bodyLinks, LIFECYCLE, MentionMatcher, statusOf, TYPE_SINGULAR, WorldIndex, type Entry, type Mention, type World } from '@lore-forge/core';
import { EntryLabel, TypeBadge } from './type.tsx';
import { Icon } from './icon.tsx';

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const MOD = IS_MAC ? '⌘' : 'Ctrl';

/** Re-build the matcher only when names or aliases change, not on every keystroke. */
function useMatcher(world: World): MentionMatcher {
  const key = world.entries.map((e) => `${e.id}\u0000${e.name}\u0000${(e.aliases ?? []).join('\u0001')}`).join('\u0002');
  return useMemo(() => new MentionMatcher(world.entries), [key]);
}

/** Small card: type, dates, status. */
function EntryCard({ ix, entry }: { ix: WorldIndex; entry: Entry }) {
  const life = ix.life(entry);
  const dates = life.start || life.end ? `${life.start ? ix.fmt(life.start.date) : '?'} – ${life.end ? ix.fmt(life.end.date) : ''}` : 'No dates';
  const status = LIFECYCLE[entry.type]?.statuses.find((x) => x.value === statusOf(entry));
  const race = entry.type === 'character' && entry.race ? ix.nameOf(entry.race) : undefined;
  return (
    <div class="card-body">
      <div class="card-title"><EntryLabel entry={entry} /></div>
      <div class="card-meta"><TypeBadge type={entry.type} />{race && <span class="card-race"> {race}</span>} <span>{dates}</span>{status && <span> · <Icon name={status.icon} /> {status.label}</span>}</div>
      {entry.summary && <p class="card-summary">{entry.summary}</p>}
    </div>
  );
}

interface Popup {
  mention: Mention;
  x: number;
  y: number;
  /** A picker (after Ctrl+click on a shared name) stays open until closed. */
  pick: boolean;
}

/**
 * Body text with plain-name mentions highlighted in their type colour.
 * A mirror layer behind a transparent-background textarea draws the highlights,
 * so typing stays a normal textarea. Hover shows a card; Ctrl/⌘+click opens the entry
 * (or a picker when the name is shared). Keyboard: Ctrl/⌘+Enter on a name, or the chips below.
 */
export function ProseField({ world, entry, onInput, onOpen }: { world: World; entry: Entry; onInput: (body: string) => void; onOpen: (id: string) => void }) {
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const matcher = useMatcher(world);
  const value = entry.body;
  const mentions = useMemo(() => matcher.find(value, { exclude: entry.id }), [matcher, value, entry.id]);
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [linkCursor, setLinkCursor] = useState(false);

  // Grow with the text so the mirror never has to scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 224)}px`;
  }, [value]);

  const at = (x: number, y: number): { m: Mention; rect: DOMRect } | undefined => {
    const marks = mirror.current?.querySelectorAll<HTMLElement>('mark[data-i]') ?? [];
    for (const mk of marks) {
      for (const r of mk.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { m: mentions[Number(mk.dataset['i'])]!, rect: r };
      }
    }
    return undefined;
  };
  const place = (rect: DOMRect) => {
    const box = wrap.current!.getBoundingClientRect();
    return { x: rect.left - box.left, y: rect.bottom - box.top + 6 };
  };
  const open = (m: Mention, rect?: DOMRect) => {
    if (m.ids.length === 1) {
      setPopup(null);
      onOpen(m.ids[0]!);
    } else if (rect) setPopup({ mention: m, ...place(rect), pick: true });
  };

  const onMove = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.mention-card')) return;
    const hit = at(e.clientX, e.clientY);
    setLinkCursor(!!hit && (e.ctrlKey || e.metaKey));
    if (popup?.pick) return;
    if (!hit) return popup && setPopup(null);
    if (popup?.mention.start !== hit.m.start) setPopup({ mention: hit.m, ...place(hit.rect), pick: false });
  };
  const onDown = (e: MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const hit = at(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    open(hit.m, hit.rect);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && popup) return setPopup(null);
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    const pos = area.current!.selectionStart;
    const m = mentions.find((x) => pos >= x.start && pos <= x.end);
    if (!m) return;
    e.preventDefault();
    const i = mentions.indexOf(m);
    const mk = mirror.current?.querySelector<HTMLElement>(`mark[data-i="${i}"]`);
    open(m, mk?.getClientRects()[0]);
  };

  // Mirror content: plain text with <mark>s; a trailing space keeps a final newline's height.
  const parts: ComponentChildren[] = [];
  let pos = 0;
  mentions.forEach((m, i) => {
    if (m.start > pos) parts.push(value.slice(pos, m.start));
    const first = ix.byIdOf(m.ids[0]!);
    parts.push(<mark key={i} data-i={i} class={`mention t-${first?.type ?? 'note'}${m.ids.length > 1 ? ' mention-ambiguous' : ''}`}>{m.text}</mark>);
    pos = m.end;
  });
  parts.push(`${value.slice(pos)} `);

  const unique = [...new Map(mentions.map((m) => [m.ids.join('+'), m])).values()];
  const links = bodyLinks(value);
  return (
    <div class="field body-field" data-field="body">
      <label for="entry-body">Text</label>
      <div class={`prose${linkCursor ? ' prose-link-cursor' : ''}`} ref={wrap} onMouseLeave={() => { setLinkCursor(false); if (!popup?.pick) setPopup(null); }}>
        <div class="prose-mirror body-text" ref={mirror} aria-hidden="true">{parts}</div>
        <textarea id="entry-body" ref={area} class="prose-input body-text" value={value} spellcheck aria-describedby="body-hint"
          onInput={(e) => onInput(e.currentTarget.value)} onMouseMove={onMove} onMouseDown={onDown} onKeyDown={onKey} onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }} />
        {popup && (
          <div class={`mention-card${popup.pick ? ' is-picker' : ''}`} style={{ left: `${popup.x}px`, top: `${popup.y}px` }} role={popup.pick ? 'dialog' : 'tooltip'} aria-label={popup.pick ? `Which “${popup.mention.text}”?` : undefined}>
            {popup.pick && <p class="card-pick-title">“{popup.mention.text}” is shared. Open which one?</p>}
            {popup.mention.ids.map((id) => {
              const t = ix.byIdOf(id);
              if (!t) return null;
              return popup.pick ? (
                <button key={id} type="button" class="card-pick" onClick={() => { setPopup(null); onOpen(id); }} autoFocus={id === popup.mention.ids[0]}>
                  <EntryCard ix={ix} entry={t} />
                </button>
              ) : <EntryCard key={id} ix={ix} entry={t} />;
            })}
            {popup.pick ? (
              <button type="button" class="ghost small" onClick={() => { setPopup(null); area.current?.focus(); }}>Cancel</button>
            ) : (
              <p class="card-hint">{popup.mention.ids.length > 1 ? `Shared name: ${MOD}+click to choose` : `${MOD}+click to open`}</p>
            )}
          </div>
        )}
      </div>
      <div class="hint" id="body-hint">
        Markdown. Names and aliases you type are linked automatically. Hover one for details; {MOD}+click (or {MOD}+Enter) opens it. Explicit links: <code>[[id]]</code>, <code>[[Name]]</code>, <code>[[id|label]]</code>, <code>@id</code>.
      </div>
      {(unique.length > 0 || links.length > 0) && (
        <div class="mention-chips">
          <span class="chips-label">Mentioned here</span>
          <ul class="link-chips" aria-label="Entries mentioned in this text">
            {unique.map((m) => {
              const es = m.ids.map((id) => ix.byIdOf(id)).filter((x): x is Entry => !!x);
              return es.length === 1 ? (
                <li key={m.ids[0]}><button type="button" class="entry-chip" onClick={() => onOpen(es[0]!.id)}><EntryLabel entry={es[0]!} /><span class="sr-only">, {TYPE_SINGULAR[es[0]!.type].toLowerCase()}</span></button></li>
              ) : (
                <li key={m.ids.join('+')} class="chip-ambiguous">
                  <span class="chip-shared"><Icon name="uncertainty" /> “{m.text}” is shared:</span>
                  {es.map((x) => <button key={x.id} type="button" class="entry-chip" onClick={() => onOpen(x.id)}><EntryLabel entry={x} /><span class="sr-only">, {TYPE_SINGULAR[x.type].toLowerCase()}</span></button>)}
                </li>
              );
            })}
            {links.map((l, i) => {
              const t = ix.resolve(l.ref);
              return t ? (
                <li key={`l${i}`}><button type="button" class="entry-chip chip-explicit" onClick={() => onOpen(t.id)} title="Explicit link"><Icon name="linked-rings" /> <EntryLabel entry={t} /></button></li>
              ) : (
                <li key={`l${i}`} class="chip chip-missing"><Icon name="cancel" /> {l.ref} (missing)</li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
