import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_TRIM, docSheets, inlineRuns, storyBook, TRIMS, TYPE_ICON, TYPE_LABELS, worldCodex, type Block, type BookSettings, type ChapterGrouping, type Doc, type EntryType, type TrimSize, type World } from '@lore-forge/core';
import type { PdfKind, PublishOptions } from '../../shared/api.ts';
import { Icon } from './icon.tsx';
import { Aura } from './aura.tsx';
import { Select } from './select.tsx';
import { titleFont, useImage, WorldCover } from './cover.tsx';

const ALL_TYPES: EntryType[] = ['character', 'place', 'faction', 'item', 'event', 'note'];
const TITLE: Record<PdfKind, string> = { codex: 'World Codex', book: 'Story Book' };
const TITLE_ICON = { codex: 'book-cover', book: 'open-book' } as const;

/** Build the Doc exactly as the PDF export does (same core function, same options). */
export function previewDoc(world: World, kind: PdfKind, options: PublishOptions): Doc {
  return kind === 'codex' ? worldCodex(world, options) : storyBook(world, options);
}

export const sheetsOf = docSheets;

function Inline({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {inlineRuns(line).map((r, j) => (r.bold ? <strong key={j}>{r.text}</strong> : r.italic ? <em key={j}>{r.text}</em> : r.text))}
        </Fragment>
      ))}
    </>
  );
}

function DocImage({ dir, file, caption }: { dir: string; file: string; caption: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void window.lore.readImage(dir, file).then((s) => live && setSrc(s));
    return () => void (live = false);
  }, [dir, file]);
  if (src === undefined) return <div class="doc-img-missing">Loading image…</div>;
  if (src === null) return <div class="doc-img-missing"><Icon name="photo-camera" /> Image file missing: {file}</div>;
  return <img src={src} alt={caption} />;
}

const TRIM_LABEL: Record<TrimSize, string> = { '6x9': '6 × 9 in (trade paperback)', '5.5x8.5': '5.5 × 8.5 in (digest)', a5: 'A5 (148 × 210 mm)' };
type DetailKey = 'title' | 'author' | 'publisher' | 'dedication' | 'epigraph' | 'epigraphSource' | 'copyright';
const DETAILS: [DetailKey, string, string, boolean][] = [
  ['title', 'Book title', 'The world name', false],
  ['author', 'Author', 'Unknown', false],
  ['publisher', 'Publisher', 'None', false],
  ['dedication', 'Dedication', 'None (no dedication page)', true],
  ['epigraph', 'Epigraph', 'None (no epigraph page)', true],
  ['epigraphSource', 'Epigraph by', 'Unknown', false],
  ['copyright', 'Copyright page', 'Copyright © year author. All rights reserved.', true],
];

const anchorId = (b: Extract<Block, { kind: 'heading' }>, i: number) => `pv-${b.anchor ?? `h-${i}`}`;
const TITLE_PARTS = ['title', 'sub', 'author', 'publisher'];

/** The first page: the world's cover art with the title, as the PDF draws it. */
function CoverSheet({ doc, dir }: { doc: Doc; dir: string }) {
  const c = doc.cover;
  const image = useImage(dir, c.art?.image);
  const trim = doc.print ? ` is-print trim-${doc.print.trim.replace('.', '-')}` : '';
  if (!c.art) {
    return (
      <section class="sheet sheet-cover">
        <p class="sheet-title">{c.title}</p>
        <p class="sheet-sub">{c.subtitle}</p>
        {c.lines.map((l, i) => <p key={i} class="doc-small">{l}</p>)}
      </section>
    );
  }
  return (
    <section class={`sheet sheet-cover has-art${trim}`} aria-label="Cover">
      <span class="world-cover"><WorldCover art={c.art} image={image} /></span>
      <div class="sheet-cover-text">
        {c.art.showTitle && <p class={`sheet-title title-${c.art.titleStyle}${c.art.font ? ' has-font' : ''}`} style={{ color: c.art.titleColor, ...titleFont(c.art) }}>{c.title}</p>}
        <p class="sheet-sub">{c.subtitle}</p>
        {c.lines.map((l, i) => <p key={i} class="sheet-cover-line">{l.replace(/\*\*/g, '')}</p>)}
      </div>
    </section>
  );
}

function BlockView({ b, dir, doc, i }: { b: Block; dir: string; doc: Doc; i: number }) {
  switch (b.kind) {
    case 'heading': {
      const H = (`h${b.level + 1}`) as 'h2' | 'h3' | 'h4';
      if (b.opener) {
        const m = /^(Chapter \d+)\.\s+(.*)$/.exec(b.text);
        return <H id={anchorId(b, i)} class="doc-h doc-h1 doc-opener">{m && <span class="doc-opener-label">{m[1]}</span>}{m ? m[2] : b.text}</H>;
      }
      return <H id={anchorId(b, i)} class={`doc-h doc-h${b.level}`}>{b.icon && <><Icon name={b.icon} /> </>}{b.text}{b.mark && <> <Icon class="doc-mark" name={b.mark} /></>}</H>;
    }
    case 'para': return <p class={`doc-p${b.style ? ` doc-${b.style}` : ''}${b.dropCap ? ' doc-dropcap' : ''}`}><Inline text={b.text} /></p>;
    case 'front':
      // Title page lines are title, subtitle, author, publisher (empty when unset); each part has its place on the page.
      return (
        <div class={`doc-front doc-front-${b.role}`}>
          {b.lines.map((l, j) => l !== '' && <p key={j} class={b.role === 'title' ? `ft-${TITLE_PARTS[j] ?? 'line'}` : undefined}>{l}</p>)}
        </div>
      );
    case 'facts':
      return (
        <dl class="doc-facts">
          {b.rows.map(([k, v], j) => <div key={j}><dt>{k}</dt><dd><Inline text={v} /></dd></div>)}
        </dl>
      );
    case 'list': return <ul class="doc-list">{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ul>;
    case 'image':
      return (
        <figure class="doc-figure">
          <DocImage dir={dir} file={b.file} caption={b.caption} />
          <figcaption><strong>{b.caption}</strong>{b.details.map((d, j) => <span key={j} class="doc-small"><br />{d}</span>)}</figcaption>
        </figure>
      );
    case 'prompt':
      return (
        <div class="doc-prompt">
          <p class="doc-prompt-label">{b.label}</p>
          <pre>{b.text}</pre>
        </div>
      );
    case 'box':
      return (
        <aside class="doc-box">
          <p class="doc-box-title">{b.title}</p>
          {b.blocks.map((x, j) => <BlockView key={j} b={x} dir={dir} doc={doc} i={-1 - j} />)}
        </aside>
      );
    case 'toc': {
      const heads = doc.blocks.map((h, j) => [h, j] as const).filter(([h]) => h.kind === 'heading' && h.toc) as [Extract<Block, { kind: 'heading' }>, number][];
      return (
        <nav class="doc-toc" aria-label="Contents">
          <p class="doc-h doc-h1">Contents</p>
          <ol>
            {heads.map(([h, j]) => (
              <li key={j} class={`toc-l${h.level}`}>
                <a href={`#${anchorId(h, j)}`} onClick={(e) => { e.preventDefault(); document.getElementById(anchorId(h, j))?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>{h.text}</a>
              </li>
            ))}
          </ol>
          <p class="doc-small">Page numbers are added in the PDF{doc.print ? ' and in Word' : ''}.</p>
        </nav>
      );
    }
  }
}

interface Props {
  dir: string;
  world: World;
  kind: PdfKind;
  onClose: () => void;
  onSave: (kind: PdfKind, options: PublishOptions) => Promise<void>;
  onSaveDocx?: (options: PublishOptions) => Promise<void>;
  /** Save the book details into world.json. */
  onSaveBook?: (book: BookSettings) => Promise<void>;
}

/** In-app preview of the World Codex / Story Book, from the same Doc the PDF uses; "Save PDF" only after looking. */
export function PreviewDialog({ dir, world, kind, onClose, onSave, onSaveDocx, onSaveBook }: Props) {
  const [types, setTypes] = useState<EntryType[]>(ALL_TYPES);
  const [warnings, setWarnings] = useState(true);
  const [artBriefs, setArtBriefs] = useState(true);
  const manifestYears = world.manifest.book?.chapterYears;
  const [grouping, setGrouping] = useState<ChapterGrouping>(manifestYears && manifestYears >= 1 ? 'years' : 'era');
  const [chapterYears, setChapterYears] = useState(manifestYears ?? 100);
  const [appendix, setAppendix] = useState(true);
  const [trim, setTrim] = useState<TrimSize>(world.manifest.book?.trim ?? DEFAULT_TRIM);
  const [rightHand, setRightHand] = useState(world.manifest.book?.rightHandChapters ?? false);
  const [book, setBook] = useState<BookSettings>(world.manifest.book ?? {});
  const bookWorld = useMemo(() => (kind === 'book' ? { ...world, manifest: { ...world.manifest, book: { ...world.manifest.book, ...book } } } : world), [world, kind, book]);
  const editBook = (k: DetailKey, v: string) => setBook((b) => ({ ...b, [k]: v }));
  const persist = (patch: BookSettings) => {
    const saved = world.manifest.book ?? {};
    if (Object.entries(patch).some(([k, v]) => (saved[k as keyof BookSettings] ?? '') !== v)) void onSaveBook?.(patch);
  };
  const hasStory = (world.story?.length ?? 0) > 0;
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  const options: PublishOptions = kind === 'codex'
    ? { types: ALL_TYPES.filter((t) => types.includes(t)), warnings, artBriefs }
    : { grouping, ...(grouping === 'years' ? { chapterYears } : {}), ...(hasStory && !appendix ? { appendix: false } : {}), trim, rightHandChapters: rightHand };
  const key = JSON.stringify(options);
  const doc = useMemo(() => previewDoc(bookWorld, kind, options), [bookWorld, kind, key]);
  const sheets = useMemo(() => sheetsOf(doc.blocks), [doc]);
  const hasCover = !doc.print || !!doc.cover.art;
  const sheetCount = sheets.length + (hasCover ? 1 : 0);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('h2')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !dialog.current) return;
      // Keep focus inside the dialog.
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href], [tabindex="0"]')];
      const first = items[0], last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!dialog.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, []);

  const toggleType = (t: EntryType) => setTypes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  const save = async () => { setBusy(true); try { await onSave(kind, options); } finally { setBusy(false); } };
  const saveDocx = async () => { setBusy(true); try { await onSaveDocx?.(options); } finally { setBusy(false); } };
  const count = world.entries.filter((e) => types.includes(e.type)).length;

  return (
    <div class="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="preview" role="dialog" aria-modal="true" aria-labelledby="preview-title" ref={dialog}>
        <header class="preview-head">
          <h2 id="preview-title" tabIndex={-1}><Icon name={TITLE_ICON[kind]} /> {TITLE[kind]} <span class="muted">preview</span></h2>
          <p class="muted">{doc.print
            ? `${TRIM_LABEL[doc.print.trim]}, print layout. ${sheetCount} sheets here; the PDF paginates further${doc.print.rightHand ? ', adds running heads and page numbers, and starts each chapter on a right-hand page.' : ' and adds running heads and page numbers.'}`
            : `${sheetCount} sheets here; the PDF paginates further. This is the same content the PDF gets.`}</p>
          <div class="preview-actions">
            <button type="button" class="primary" disabled={busy || (kind === 'codex' && types.length === 0)} onClick={() => void save()}>
              <Icon name="save" /> {busy ? 'Saving…' : 'Save PDF…'}
            </button>
            {kind === 'book' && onSaveDocx && (
              <button type="button" class="save-docx" disabled={busy} onClick={() => void saveDocx()}>
                <Icon name="quill-ink" /> Save Word (.docx)…
              </button>
            )}
            <button type="button" class="ghost" onClick={onClose}>Close <kbd>Esc</kbd></button>
          </div>
        </header>
        <div class="preview-body">
          <Aura calm local />
          <aside class="preview-options" aria-label="Options">
            {kind === 'codex' ? (
              <>
                <fieldset>
                  <legend>Entry types</legend>
                  {ALL_TYPES.map((t) => (
                    <label key={t} class={`check t-${t}`}>
                      <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />
                      <Icon name={TYPE_ICON[t]} /> {TYPE_LABELS[t]}
                    </label>
                  ))}
                  <p class="hint">{count} entries included{types.length === 0 ? ' — pick at least one type' : ''}.</p>
                </fieldset>
                <fieldset>
                  <legend>Extras</legend>
                  <label class="check"><input type="checkbox" checked={artBriefs} onChange={() => setArtBriefs(!artBriefs)} /> <Icon name="palette" /> Art briefs and image prompts</label>
                  <label class="check"><input type="checkbox" checked={warnings} onChange={() => setWarnings(!warnings)} /> <Icon name="hazard-sign" /> Warnings appendix</label>
                </fieldset>
              </>
            ) : (
              <>
              <fieldset>
                <legend>Print</legend>
                <label class="field">
                  <span>Trim size</span>
                  <Select class="trim-select" value={trim} onChange={(v) => { const t = v as TrimSize; setTrim(t); persist({ trim: t }); }} options={(Object.keys(TRIMS) as TrimSize[]).map((t) => ({ value: t, label: TRIM_LABEL[t] }))} />
                </label>
                <p class="hint">Margins are mirrored with a wider inside edge for the binding.</p>
                <label class="check right-hand">
                  <input type="checkbox" name="right-hand-chapters" checked={rightHand} onChange={() => { const v = !rightHand; setRightHand(v); persist({ rightHandChapters: v || undefined }); }} />
                  <Icon name="open-book" /> Start chapters on right-hand pages
                </label>
                <p class="hint">{rightHand ? 'For a printed book: blank pages are added so each chapter opens on the right.' : 'Off: every chapter starts on the next page, with no blank pages.'}</p>
              </fieldset>
              <fieldset class="book-details">
                <legend>Book details</legend>
                {DETAILS.map(([k, label, empty, long]) => (
                  <label key={k} class="field">
                    <span>{label}</span>
                    {long ? (
                      <textarea name={`book-${k}`} rows={k === 'copyright' ? 3 : 2} placeholder={empty} value={book[k] ?? ''} onInput={(e) => editBook(k, e.currentTarget.value)} onBlur={(e) => persist({ [k]: e.currentTarget.value.trim() })} />
                    ) : (
                      <input name={`book-${k}`} placeholder={empty} value={book[k] ?? ''} onInput={(e) => editBook(k, e.currentTarget.value)} onBlur={(e) => persist({ [k]: e.currentTarget.value.trim() })} />
                    )}
                  </label>
                ))}
                <p class="hint">All optional. Saved in world.json.</p>
              </fieldset>
              {hasStory && (
                <fieldset>
                  <legend>Story</legend>
                  <p class="hint">Your written chapters are the book. The chronicle of events and notes follows them.</p>
                  <label class="check"><input type="checkbox" checked={appendix} onChange={() => setAppendix(!appendix)} /> <Icon name="hourglass" /> Chronicle appendix</label>
                </fieldset>
              )}
              {(!hasStory || appendix) && (
              <fieldset>
                <legend>{hasStory ? 'Chronicle chapters' : 'Chapters'}</legend>
                {([['era', 'One per era'], ['years', 'By year ranges'], ['single', 'One chapter']] as const).map(([g, label]) => (
                  <label key={g} class="check">
                    <input type="radio" name="grouping" checked={grouping === g} onChange={() => setGrouping(g)} /> {label}
                  </label>
                ))}
                {grouping === 'years' && (
                  <label class="field inline-field">
                    <span>Years per chapter</span>
                    <input type="number" min={1} step={1} value={chapterYears} onInput={(e) => { const n = Number(e.currentTarget.value); if (n >= 1) setChapterYears(Math.floor(n)); }} />
                  </label>
                )}
                <p class="hint">A page's own “chapter:” always wins.</p>
              </fieldset>
              )}
              </>
            )}
          </aside>
          <div class="preview-pages" tabIndex={0} aria-label="Preview pages">
            {hasCover && <CoverSheet doc={doc} dir={dir} />}
            {sheets.map((s, i) => (
              <section class={doc.print ? `sheet is-print trim-${doc.print.trim.replace('.', '-')}${s[0]?.kind === 'front' ? ' is-front' : ''}` : 'sheet'} key={i}>
                {s.map((b, j) => <BlockView key={j} b={b} dir={dir} doc={doc} i={doc.blocks.indexOf(b)} />)}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
