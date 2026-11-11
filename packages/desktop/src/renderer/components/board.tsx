/**
 * The Story view's planning board: every chapter as a card (its title, date, point of view, what happens in it and
 * how far it is), moved by dragging, and under the cards who is in which chapter.
 */
import { useContext, useMemo, useState } from 'preact/hooks';
import { BookLang } from './cover.tsx';
import {
  CHAPTER_STATUS_LABELS, CHAPTER_STATUSES, bodyLinks, chapterCast, chapterDate, chapterNames, chapterStatus, entryIcon, WorldIndex,
  type CastRow, type ChapterStatus, type StoryChapter, type Warning, type World,
} from '@lore-forge/core';
import { num, t, tm } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { Select, type SelectOption } from './select.tsx';
import { wordsOf } from './story.tsx';

/** Rows the cast grid shows before Show all: the characters in the most chapters. */
const CAST_ROWS = 24;
/** Each status's colour, as on the cards (styles.css .st-*). */
const STATUS_COLOUR: Record<ChapterStatus, string> = { idea: 'var(--muted)', draft: 'var(--info)', revised: 'var(--warning)', done: 'var(--ok)' };

/** Where a chapter first names an entry, to open it there. */
function firstNamed(c: StoryChapter, id: string, ix: WorldIndex): [number, number] | undefined {
  const m = ix.mentions.find(c.body).find((x) => x.ids.length === 1 && x.ids[0] === id);
  const l = bodyLinks(c.body).find((x) => ix.resolve(x.ref)?.id === id);
  if (m && (!l || m.start < l.index)) return [m.start, m.end];
  if (!l) return undefined;
  const end = c.body.startsWith('[[', l.index) ? c.body.indexOf(']]', l.index) + 2 : l.index + 1 + l.ref.length;
  return [l.index, Math.max(end, l.index + 1)];
}

export function StoryBoard({ world, chapters, warnings, onWrite, onChange, onMoveTo, onPlan, onDelete, onEntry }: {
  world: World;
  /** In reading order. */
  chapters: readonly StoryChapter[];
  warnings: readonly Warning[];
  /** Write a chapter: it opens in the Story view, at `span` when given. */
  onWrite: (file: string, span?: [number, number]) => void;
  onChange: (ch: StoryChapter) => void;
  /** Put a chapter at this place in the reading order (0 is first). */
  onMoveTo: (file: string, index: number) => void;
  /** A new card, for a chapter not written yet. */
  onPlan: () => void;
  onDelete: (file: string) => void;
  /** Open an entry in the editor. */
  onEntry: (id: string) => void;
}) {
  const bookLang = useContext(BookLang);
  // The index and the names in each chapter's text stay while the entries do: typing on a card searches nothing again.
  const ix = useMemo(() => new WorldIndex(world), [world.entries, world.manifest]);
  const names = useMemo(() => new Map<string, ReadonlySet<string>>(), [ix]);
  const namesOf = (c: StoryChapter): ReadonlySet<string> => {
    let n = names.get(c.body);
    if (!n) names.set(c.body, (n = chapterNames(c, ix)));
    return n;
  };
  const cast = chapterCast(world, chapters, { ix, namesOf });
  const people = useMemo((): SelectOption[] => [
    { value: '', label: t('No point of view') },
    ...world.entries.filter((e) => e.type === 'character').sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ value: e.id, label: e.name || e.id, icon: entryIcon(e), tone: 't-character' })),
  ], [world.entries]);
  const statuses = CHAPTER_STATUSES.map((s): SelectOption => ({ value: s, label: tm(CHAPTER_STATUS_LABELS[s]), swatch: STATUS_COLOUR[s] }));
  const total = chapters.reduce((n, c) => n + wordsOf(c), 0);
  const tally = CHAPTER_STATUSES.map((s) => [s, chapters.filter((c) => chapterStatus(c) === s).length] as const).filter(([, n]) => n > 0);

  // Moving a card: the grip makes it draggable; it lands before or after the card it is dropped on.
  const [grab, setGrab] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ file: string; after: boolean } | null>(null);
  const [said, setSaid] = useState('');
  const endDrag = (): void => {
    setGrab(null);
    setDrag(null);
    setDrop(null);
  };
  const move = (file: string, to: number): void => {
    const c = chapters.find((x) => x.file === file);
    if (!c || to < 0 || to >= chapters.length || chapters[to]?.file === file) return;
    onMoveTo(file, to);
    setSaid(t('“{title}” is now chapter {n}.', { title: c.title || t('Untitled'), n: to + 1 }));
  };
  const place = (target: string, after: boolean): void => {
    if (!drag) return;
    const from = chapters.findIndex((x) => x.file === drag);
    let to = chapters.findIndex((x) => x.file === target) + (after ? 1 : 0);
    if (from < to) to--;
    if (from >= 0) move(drag, to);
    endDrag();
  };
  const regrip = (file: string): void => {
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.board-card[data-file="${CSS.escape(file)}"] .board-grip`)?.focus());
  };

  return (
    <div class="board">
      <div class="board-head">
        <h2><Icon name="files" /> {t('Planning board')}</h2>
        <p class="muted small">{chapters.length === 1 ? t('{n} chapter · {words} words', { n: chapters.length, words: num(total) }) : t('{n} chapters · {words} words', { n: chapters.length, words: num(total) })}</p>
        {tally.length > 0 && (
          <ul class="board-tally" aria-label={t('Chapters by status')}>
            {tally.map(([s, n]) => <li key={s} class={`st-${s}`}><span class="board-dot" aria-hidden="true" />{tm(CHAPTER_STATUS_LABELS[s])} <strong>{n}</strong></li>)}
          </ul>
        )}
      </div>
      {!chapters.length && <p class="muted board-empty">{t('Plan the story as cards, one for each chapter, with what happens in it. Write them when you are ready.')}</p>}
      <ol class="board-cards">
        {chapters.map((c, i) => {
          const status = chapterStatus(c);
          const words = wordsOf(c);
          const n = warnings.filter((w) => !w.intended && w.offending.chapter === c.file).length;
          const pov = c.pov ? ix.resolve(c.pov) : undefined;
          const povOptions = pov || !c.pov ? people : [...people, { value: c.pov, label: t('{name} (not in the book)', { name: c.pov }) }];
          const title = c.title || t('Untitled');
          const cls = ['board-card', `st-${status}`, drag === c.file ? 'is-dragged' : '', drop?.file === c.file && drag !== c.file ? (drop.after ? 'drop-after' : 'drop-before') : ''].filter(Boolean).join(' ');
          return (
            <li key={c.file} class={cls} data-file={c.file} draggable={grab === c.file}
              onDragStart={(e) => {
                if (grab !== c.file || !e.dataTransfer) return e.preventDefault();
                // Its own kind of data: dropped on a text box, it does not type the title into it.
                e.dataTransfer.setData('application/x-lore-forge-chapter', c.file);
                e.dataTransfer.effectAllowed = 'move';
                setDrag(c.file);
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientX > r.left + r.width / 2;
                if (drop?.file !== c.file || drop.after !== after) setDrop({ file: c.file, after });
              }}
              onDrop={(e) => {
                if (!drag) return;
                e.preventDefault();
                place(c.file, drop?.file === c.file ? drop.after : false);
              }}>
              <div class="board-card-head">
                <button type="button" class="board-grip" aria-label={t('Move “{title}”: drag it, or use the arrow keys', { title })} title={t('Drag to move it, or use the arrow keys')}
                  onPointerDown={() => setGrab(c.file)} onPointerUp={() => { if (!drag) setGrab(null); }}
                  onKeyDown={(e) => {
                    const to = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? chapters.length - 1 : null;
                    if (to === null) return;
                    e.preventDefault();
                    move(c.file, to);
                    regrip(c.file);
                  }}>
                  <span class="grip-dots" aria-hidden="true" />
                  <span class="board-n">{i + 1}</span>
                </button>
                {/* A box that wraps, so a long title shows whole; Enter leaves it, since a title is one line. */}
                <textarea class="board-title" lang={bookLang} rows={1} value={c.title} placeholder={t('Chapter title')} aria-label={t('Chapter title')}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                  onInput={(e) => onChange({ ...c, title: e.currentTarget.value.replace(/\s*\n\s*/g, ' ') })} />
                {n > 0 && <span class="count count-warning" title={n === 1 ? t('{n} warning', { n }) : t('{n} warnings', { n })}><Icon name="hazard-sign" /> {n}</span>}
              </div>
              <div class="board-meta">
                <input class="board-date" value={c.date ?? ''} placeholder={chapterDate(c) ?? t('Date')} aria-label={t('Date')}
                  onInput={(e) => { const v = e.currentTarget.value; const { date: _d, ...rest } = c; onChange(v.trim() ? { ...rest, date: v } : rest); }} />
                <Select class="board-pov" value={pov?.id ?? c.pov ?? ''} options={povOptions} aria-label={t('Point of view')}
                  onChange={(v) => { const { pov: _p, ...rest } = c; onChange(v ? { ...rest, pov: v } : rest); }} />
              </div>
              <textarea class="board-summary" value={c.summary ?? ''} placeholder={t('What happens in this chapter?')} aria-label={t('What happens')} rows={3}
                onInput={(e) => { const v = e.currentTarget.value; const { summary: _s, ...rest } = c; onChange(v.trim() ? { ...rest, summary: v } : rest); }} />
              <div class="board-foot">
                <Select class={`board-status st-${status}`} value={status} options={statuses} aria-label={t('Status')}
                  onChange={(v) => { if (v !== status) onChange({ ...c, status: v as ChapterStatus }); }} />
                <span class="muted small board-words">{words === 1 ? t('{n} word', { n: num(words) }) : t('{n} words', { n: num(words) })}</span>
                <button type="button" class="ghost small board-write" onClick={() => onWrite(c.file)} title={t('Write this chapter')}><Icon name="feather" /> {t('Write')}</button>
                <button type="button" class="ghost small icon-only danger board-delete" onClick={() => onDelete(c.file)} aria-label={t('Delete “{title}”', { title })} title={t('Delete chapter')}><Icon name="trash-can" /></button>
              </div>
            </li>
          );
        })}
        <li class="board-plan">
          <button type="button" class="board-plan-button" onClick={onPlan}><Icon name="quill" /> {t('Plan a chapter')}</button>
        </li>
      </ol>
      <p class="sr-only" aria-live="polite">{said}</p>
      {chapters.length > 0 && <CastGrid chapters={chapters} rows={cast} ix={ix} onWrite={onWrite} onEntry={onEntry} />}
    </div>
  );
}

/** Who is in which chapter: a row for each character, a mark for each chapter that names them, and long absences. */
function CastGrid({ chapters, rows, ix, onWrite, onEntry }: {
  chapters: readonly StoryChapter[];
  rows: CastRow[];
  ix: WorldIndex;
  onWrite: (file: string, span?: [number, number]) => void;
  onEntry: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const written = chapters.map((c) => c.body.trim() !== '');
  const shown = all ? rows : rows.slice(0, CAST_ROWS);
  return (
    <section class="cast" aria-labelledby="cast-title">
      <h3 id="cast-title"><Icon name="meeple-group" /> {t('Who is in which chapter')}</h3>
      {!rows.length ? (
        <p class="muted small">{t('The characters a chapter names, or tells it from their point of view, show here.')}</p>
      ) : (
        <>
          <p class="muted small">{t('A mark is a chapter that names them or is told from their point of view. Click it to read where they are named.')}</p>
          <div class="cast-scroll">
            <table class="cast-grid">
              <thead>
                <tr>
                  <th scope="col" class="cast-who"><span class="sr-only">{t('Character')}</span></th>
                  {chapters.map((c, i) => <th key={c.file} scope="col" class={written[i] ? '' : 'unwritten'} title={c.title || t('Untitled')}>{i + 1}</th>)}
                  <th scope="col" class="cast-note"><span class="sr-only">{t('Notes')}</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const e = ix.byIdOf(r.id);
                  const name = e?.name || r.id;
                  return (
                    <tr key={r.id} class={r.gap ? 'has-gap' : undefined}>
                      <th scope="row" class="cast-who">
                        <button type="button" class="cast-name" onClick={() => onEntry(r.id)} title={t('Open {name}', { name })}>{e && <Icon name={entryIcon(e)} class="t-character" />} {name}</button>
                      </th>
                      {r.in.map((here, i) => {
                        const c = chapters[i]!;
                        const gap = r.gap && i >= r.gap.from && i <= r.gap.to && written[i];
                        const what = t('{name} in chapter {n}: {title}', { name, n: i + 1, title: c.title || t('Untitled') });
                        return (
                          <td key={c.file} class={[here ? 'in' : '', gap ? 'gap' : '', written[i] ? '' : 'unwritten'].filter(Boolean).join(' ') || undefined}>
                            {here && <button type="button" class="cast-mark" aria-label={what} title={what} onClick={() => onWrite(c.file, firstNamed(c, r.id, ix))} />}
                          </td>
                        );
                      })}
                      <td class="cast-note">
                        {r.gap && (r.gap.last ? t('Not seen after chapter {n}', { n: r.gap.from }) : t('Missing from chapter {from} to {to}', { from: r.gap.from + 1, to: r.gap.to + 1 }))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > CAST_ROWS && <button type="button" class="ghost small cast-more" onClick={() => setAll(!all)}>{all ? t('Show fewer') : t('Show all {n}', { n: rows.length })}</button>}
        </>
      )}
    </section>
  );
}
