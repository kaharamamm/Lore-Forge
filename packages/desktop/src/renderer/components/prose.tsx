import { Fragment, type ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { bodyLinks, LIFECYCLE, MentionMatcher, statusOf, TYPE_SINGULAR, WorldIndex, type Entry, type Mention, type World } from '@lore-forge/core';
import { EntryLabel, TypeBadge } from './type.tsx';
import { Portrait } from './cover.tsx';
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
    <div class="card-body has-portrait">
      <Portrait entry={entry} raceName={race} size="md" />
      <div class="card-text">
      <div class="card-title"><EntryLabel entry={entry} /></div>
      <div class="card-meta"><TypeBadge type={entry.type} />{race && <span class="card-race"> {race}</span>} <span>{dates}</span>{status && <span> · <Icon name={status.icon} /> {status.label}</span>}</div>
      {entry.summary && <p class="card-summary">{entry.summary}</p>}
      </div>
    </div>
  );
}

/** An extra highlight over the text, e.g. a story warning: underlined, with a hover card. */
export interface SpanMark {
  start: number;
  end: number;
  /** CSS class, e.g. "warn-line kind-error". */
  cls: string;
  /** Shown in the hover card. */
  title: string;
  detail?: string;
}

interface Popup {
  mention?: Mention;
  mark?: SpanMark;
  x: number;
  y: number;
  /** The top of the name it points at: the card goes above it when there is no room below. */
  above: number;
  /** A picker (after Ctrl+click on a shared name) stays open until closed. */
  pick: boolean;
}

/** A bit of text picked in the editor: by selecting it, right-clicking it or pressing Ctrl+Shift+A. */
export interface TextPick {
  start: number;
  end: number;
  text: string;
  /** Where to show the chip or menu, in window coordinates. */
  x: number;
  y: number;
  /** How it was picked: a plain selection, the context menu, or the add shortcut. */
  how: 'select' | 'menu' | 'quick';
}

export interface ProseEditorProps {
  id: string;
  world: World;
  value: string;
  /** Entry whose own names are not linked in its text. */
  exclude?: string;
  onInput: (text: string) => void;
  onOpen: (id: string) => void;
  /** Fill the box and scroll inside (the story); otherwise grow with the text (entry bodies). */
  fill?: boolean;
  marks?: readonly SpanMark[];
  /** Select and scroll to this range; change `n` to do it again. */
  reveal?: { start: number; end: number; n: number };
  label?: string;
  describedBy?: string;
  /** Called with the picked text, or null when the selection goes away. */
  onPick?: (pick: TextPick | null) => void;
}

/**
 * Text with plain-name mentions highlighted in their type colour.
 * A mirror layer behind a transparent-background textarea draws the highlights,
 * so typing stays a normal textarea. Hover shows a card; Ctrl/⌘+click opens the entry
 * (or a picker when the name is shared). Keyboard: Ctrl/⌘+Enter on a name.
 */
export function ProseEditor({ id, world, value, exclude, onInput, onOpen, fill, marks = [], reveal, label, describedBy, onPick }: ProseEditorProps) {
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const matcher = useMatcher(world);
  const mentions = useMemo(() => matcher.find(value, exclude ? { exclude } : {}), [matcher, value, exclude]);
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const card = useRef<HTMLDivElement>(null);
  // Keep the card on screen: above the name when there is no room below, and shifted left at the window's edge.
  useLayoutEffect(() => {
    const el = card.current;
    const w = wrap.current;
    if (!el || !w || !popup) return;
    el.style.top = `${popup.y}px`;
    el.style.left = `${popup.x}px`;
    const r = el.getBoundingClientRect();
    const box = w.getBoundingClientRect();
    if (r.bottom > innerHeight - 8 && popup.above - r.height + box.top >= 8) el.style.top = `${popup.above - r.height}px`;
    else if (r.bottom > innerHeight - 8) el.style.top = `${Math.max(8 - box.top, innerHeight - 8 - box.top - r.height)}px`;
    if (r.right > innerWidth - 8) el.style.left = `${Math.max(8 - box.left, innerWidth - 8 - box.left - r.width)}px`;
  }, [popup]);
  const [linkCursor, setLinkCursor] = useState(false);
  const [flash, setFlash] = useState<{ start: number; end: number } | null>(null);

  // Grow with the text so the mirror never has to scroll (entry bodies only).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || fill) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 224)}px`;
  }, [value, fill]);

  // Jump to a sentence: select it, scroll it to the upper third, flash it.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !reveal) return;
    const end = Math.min(reveal.end, value.length);
    el.focus({ preventScroll: true });
    el.setSelectionRange(reveal.start, end);
    setFlash({ start: reveal.start, end });
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [reveal?.n]);
  useLayoutEffect(() => {
    const probe = mirror.current?.querySelector<HTMLElement>('.reveal');
    const el = area.current;
    if (!probe || !el) return;
    if (fill) {
      el.scrollTop = Math.max(0, probe.offsetTop - el.clientHeight / 3);
      mirror.current!.scrollTop = el.scrollTop;
    } else probe.scrollIntoView({ block: 'center' });
  }, [flash]);

  const at = (x: number, y: number): { m?: Mention; mark?: SpanMark; rect: DOMRect } | undefined => {
    const inside = (el: Element) => [...el.getClientRects()].find((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    for (const mk of mirror.current?.querySelectorAll<HTMLElement>('mark[data-i]') ?? []) {
      const r = inside(mk);
      if (r) return { m: mentions[Number(mk.dataset['i'])]!, rect: r };
    }
    for (const mk of mirror.current?.querySelectorAll<HTMLElement>('[data-w]') ?? []) {
      const r = inside(mk);
      if (r) return { mark: marks[Number(mk.dataset['w'])]!, rect: r };
    }
    return undefined;
  };
  const place = (rect: DOMRect) => {
    const box = wrap.current!.getBoundingClientRect();
    return { x: Math.min(rect.left - box.left, Math.max(0, box.width - 240)), y: rect.bottom - box.top + 6, above: rect.top - box.top - 6 };
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
    setLinkCursor(!!hit?.m && (e.ctrlKey || e.metaKey));
    if (popup?.pick) return;
    if (!hit) return popup && setPopup(null);
    if (hit.m && popup?.mention?.start !== hit.m.start) setPopup({ mention: hit.m, ...place(hit.rect), pick: false });
    if (hit.mark && popup?.mark !== hit.mark) setPopup({ mark: hit.mark, ...place(hit.rect), pick: false });
  };
  const onDown = (e: MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const hit = at(e.clientX, e.clientY);
    if (!hit?.m) return;
    e.preventDefault();
    open(hit.m, hit.rect);
  };
  /** The screen box of text offset `i` in the mirror (the mirror lays the text out exactly like the textarea). */
  const rectAt = (i: number): DOMRect | undefined => {
    const root = mirror.current;
    if (!root) return undefined;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let left = i;
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      if (left <= n.length) {
        const r = document.createRange();
        const from = Math.max(0, left - 1);
        r.setStart(n, from);
        r.setEnd(n, Math.min(n.length, from + 1));
        const rects = r.getClientRects();
        return rects[rects.length - 1] ?? r.getBoundingClientRect();
      }
      left -= n.length;
    }
    return undefined;
  };
  /** Report the current selection (trimmed to one line of at most 80 characters) to `onPick`. */
  const pick = (how: TextPick['how'], at?: { x: number; y: number }): boolean => {
    const el = area.current;
    if (!onPick || !el) return false;
    let start = el.selectionStart;
    let end = el.selectionEnd;
    // Right-click on a word with nothing selected picks the word (and the capitalised words next to it).
    if (start === end && how === 'menu') {
      const word = /[\p{L}\p{M}\p{N}'’-]/u;
      while (start > 0 && word.test(value[start - 1]!)) start--;
      while (end < value.length && word.test(value[end]!)) end++;
      if (/^\p{Lu}/u.test(value.slice(start, end))) {
        const more = /^[ \t]+(?:of[ \t]+(?:the[ \t]+)?)?\p{Lu}[\p{L}\p{M}'’-]*/u;
        for (let m = more.exec(value.slice(end)); m; m = more.exec(value.slice(end))) end += m[0].length;
      }
      if (end > start) el.setSelectionRange(start, end);
    }
    const raw = value.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (!text || text.length > 80 || /\n/.test(text)) {
      onPick(null);
      return false;
    }
    const r = rectAt(start + lead + text.length);
    const box = el.getBoundingClientRect();
    const x = at?.x ?? Math.min(Math.max(r?.right ?? box.left, box.left), box.right);
    const y = at?.y ?? Math.min(Math.max(r?.bottom ?? box.top, box.top), box.bottom);
    onPick({ start: start + lead, end: start + lead + text.length, text, x, y, how });
    return true;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && popup) return setPopup(null);
    if (onPick && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      pick('quick');
      return;
    }
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    const pos = area.current!.selectionStart;
    const m = mentions.find((x) => pos >= x.start && pos <= x.end);
    if (!m) return;
    e.preventDefault();
    const i = mentions.indexOf(m);
    const mk = mirror.current?.querySelector<HTMLElement>(`mark[data-i="${i}"]`);
    open(m, mk?.getClientRects()[0]);
  };

  // Mirror content: the text cut at every mention, mark and flash boundary; a trailing space keeps a final newline's height.
  const cuts = new Set([0, value.length]);
  for (const r of [...mentions, ...marks, ...(flash ? [flash] : [])]) {
    cuts.add(Math.max(0, Math.min(r.start, value.length)));
    cuts.add(Math.max(0, Math.min(r.end, value.length)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const parts: ComponentChildren[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k]!;
    const b = points[k + 1]!;
    let node: ComponentChildren = value.slice(a, b);
    const mi = mentions.findIndex((m) => m.start <= a && m.end >= b);
    if (mi >= 0) {
      const m = mentions[mi]!;
      const first = ix.byIdOf(m.ids[0]!);
      node = <mark data-i={mi} class={`mention t-${first?.type ?? 'note'}${m.ids.length > 1 ? ' mention-ambiguous' : ''}`}>{node}</mark>;
    }
    const wi = marks.findIndex((r) => r.start <= a && r.end >= b);
    if (wi >= 0) node = <span data-w={wi} class={marks[wi]!.cls}>{node}</span>;
    if (flash && flash.start <= a && flash.end >= b) node = <span class={a === flash.start ? 'reveal flash-span' : 'flash-span'}>{node}</span>;
    parts.push(<Fragment key={a}>{node}</Fragment>);
  }
  parts.push(' ');

  return (
    <div class={`prose${fill ? ' prose-fill' : ''}${linkCursor ? ' prose-link-cursor' : ''}`} ref={wrap} onMouseLeave={() => { setLinkCursor(false); if (!popup?.pick) setPopup(null); }}>
      <div class="prose-mirror body-text" ref={mirror} aria-hidden="true">{parts}</div>
      <textarea id={id} ref={area} class="prose-input body-text" value={value} spellcheck aria-label={label} aria-describedby={describedBy}
        onInput={(e) => { onPick?.(null); onInput(e.currentTarget.value); }} onMouseMove={onMove} onMouseDown={onDown} onKeyDown={onKey}
        onMouseUp={onPick ? (e) => { if (e.button === 0) setTimeout(() => pick('select', { x: e.clientX, y: e.clientY + 14 }), 0); } : undefined}
        onKeyUp={onPick ? (e) => { if (e.shiftKey && /^(Arrow|Home|End|Page)/.test(e.key)) pick('select'); else if (/^(Arrow|Home|End|Page)/.test(e.key)) onPick(null); } : undefined}
        onContextMenu={onPick ? (e) => { if (pick('menu', { x: e.clientX, y: e.clientY })) e.preventDefault(); } : undefined}
        onScroll={(e) => { onPick?.(null); if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }} />
      {popup && (
        <div ref={card} class={`mention-card${popup.pick ? ' is-picker' : ''}`} role={popup.pick ? 'dialog' : 'tooltip'} aria-label={popup.pick && popup.mention ? `Which “${popup.mention.text}”?` : undefined}>
          {popup.mark && (
            <>
              <p class="card-title">{popup.mark.title}</p>
              {popup.mark.detail && <p class="card-summary">{popup.mark.detail}</p>}
            </>
          )}
          {popup.mention && popup.pick && <p class="card-pick-title">“{popup.mention.text}” is shared. Open which one?</p>}
          {popup.mention?.ids.map((eid) => {
            const t = ix.byIdOf(eid);
            if (!t) return null;
            return popup.pick ? (
              <button key={eid} type="button" class="card-pick" onClick={() => { setPopup(null); onOpen(eid); }} autoFocus={eid === popup.mention!.ids[0]}>
                <EntryCard ix={ix} entry={t} />
              </button>
            ) : <EntryCard key={eid} ix={ix} entry={t} />;
          })}
          {popup.mention && (popup.pick ? (
            <button type="button" class="ghost small" onClick={() => { setPopup(null); area.current?.focus(); }}>Cancel</button>
          ) : (
            <p class="card-hint">{popup.mention.ids.length > 1 ? `Shared name: ${MOD}+click to choose` : `${MOD}+click to open`}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** An entry's body text: the prose editor, a hint and chips for the names it mentions. */
export function ProseField({ world, entry, onInput, onOpen }: { world: World; entry: Entry; onInput: (body: string) => void; onOpen: (id: string) => void }) {
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const matcher = useMatcher(world);
  const value = entry.body;
  const mentions = useMemo(() => matcher.find(value, { exclude: entry.id }), [matcher, value, entry.id]);
  const unique = [...new Map(mentions.map((m) => [m.ids.join('+'), m])).values()];
  const links = bodyLinks(value);
  return (
    <div class="field body-field" data-field="body">
      <label for="entry-body">Text</label>
      <ProseEditor id="entry-body" world={world} value={value} exclude={entry.id} onInput={onInput} onOpen={onOpen} describedBy="body-hint" />
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
