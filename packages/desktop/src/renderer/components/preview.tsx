import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BOOK_FONTS, bookLook, DEFAULT_TRIM, docSheets, inlineRuns, storyBook, TITLE_FONTS, TRIMS, type BookLook, type DropCapStyle, TYPE_ICON, TYPE_LABELS, worldCodex, type Block, type BookSettings, type ChapterGrouping, type Doc, type EntryType, type TrimSize, type World } from '@lore-forge/core';
import type { PdfKind, PublishOptions } from '../../shared/api.ts';
import { Icon } from './icon.tsx';
import { Aura } from './aura.tsx';
import { Select } from './select.tsx';
import { titleFont, titlePlace, useImage, WorldCover } from './cover.tsx';
import { t, tm, tmDoc, tx } from '../i18n.tsx';

const ALL_TYPES: EntryType[] = ['character', 'place', 'faction', 'item', 'event', 'note'];
const TITLE: Record<PdfKind, string> = { codex: 'World Codex', book: 'Story Book' };
const TITLE_ICON = { codex: 'book-cover', book: 'open-book' } as const;

/** Build the Doc exactly as the PDF export does (same core function, same options, the same language). */
export function previewDoc(world: World, kind: PdfKind, options: PublishOptions): Doc {
  return tmDoc(kind === 'codex' ? worldCodex(world, options) : storyBook(world, options));
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
  if (src === undefined) return <div class="doc-img-missing">{t('Loading image…')}</div>;
  if (src === null) return <div class="doc-img-missing"><Icon name="photo-camera" /> {t('Image file missing: {file}', { file })}</div>;
  return <img src={src} alt={caption} />;
}

const TRIM_LABEL: Record<TrimSize, string> = { '6x9': '6 × 9 in (trade paperback)', '5.5x8.5': '5.5 × 8.5 in (digest)', a5: 'A5 (148 × 210 mm)', a4: 'A4 (210 × 297 mm)', letter: 'US Letter (8.5 × 11 in)' };
const trimClass = (t: TrimSize) => `trim-${t.replace('.', '-')}`;
type DetailKey = 'title' | 'author' | 'publisher' | 'dedication' | 'epigraph' | 'epigraphSource' | 'copyright';
const DETAILS: [DetailKey, string, string, boolean][] = [
  ['title', 'Book title', 'The world name', false],
  ['author', 'Author', 'Unknown', false],
  ['publisher', 'Publisher', 'None', false],
  ['dedication', 'Dedication', 'None (no dedication page)', true],
  ['epigraph', 'Epigraph', 'None (no epigraph page)', true],
  ['epigraphSource', 'Epigraph by', 'Unknown', false],
  ['copyright', 'Copyright page', 'Empty: a plain notice with the author and year', true],
];

const anchorId = (b: Extract<Block, { kind: 'heading' }>, i: number) => `pv-${b.anchor ?? `h-${i}`}`;
const TITLE_PARTS = ['title', 'sub', 'author', 'publisher'];

/** The first page: the world's cover art with the title, as the PDF draws it. */
export function CoverSheet({ doc, dir }: { doc: Doc; dir: string }) {
  const c = doc.cover;
  const image = useImage(dir, c.art?.image);
  const trim = doc.print ? ` is-print ${trimClass(doc.print.trim)}` : '';
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
    <section class={`sheet sheet-cover has-art${trim}`} aria-label={t('Cover')}>
      <span class="world-cover"><WorldCover art={c.art} image={image} /></span>
      {/* A title with a chosen place sits there, as in the PDF; the subtitle and lines stay where they are. */}
      {c.art.showTitle && c.art.titlePos && <p class={`sheet-title is-placed title-${c.art.titleStyle}${c.art.font ? ' has-font' : ''}`} style={{ color: c.art.titleColor, ...titleFont(c.art), ...titlePlace(c.art) }}>{c.title}</p>}
      <div class="sheet-cover-text">
        {c.art.showTitle && !c.art.titlePos && <p class={`sheet-title title-${c.art.titleStyle}${c.art.font ? ' has-font' : ''}`} style={{ color: c.art.titleColor, ...titleFont(c.art) }}>{c.title}</p>}
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
        const m = /^((?:Chapter|Bölüm) \d+)\.\s+(.*)$/.exec(b.text);
        // The chapter's date sits at the top right of its first page, as in the PDF and Word.
        return (
          <>
            {b.stamp && <p class="doc-stamp">{b.stamp}</p>}
            <H id={anchorId(b, i)} class="doc-h doc-h1 doc-opener">{m && <span class="doc-opener-label">{m[1]}</span>}{m ? m[2] : b.text}</H>
          </>
        );
      }
      return <H id={anchorId(b, i)} class={`doc-h doc-h${b.level}`}>{b.icon && <><Icon name={b.icon} /> </>}{b.text}{b.mark && <> <Icon class="doc-mark" name={b.mark} /></>}</H>;
    }
    case 'para': {
      if (!b.dropCap || !doc.print) return <p class={`doc-p${b.style ? ` doc-${b.style}` : ''}`}><Inline text={b.text} /></p>;
      // The initial is its own span (not ::first-letter), so "raised" and "dropped" are drawn the way the PDF draws them.
      // Emphasis markers stay on the rest of the text; an opening quote goes with the initial.
      const m = /^([*_]*)([“"‘']*\p{L})/u.exec(b.text);
      const cap = m?.[2] ?? '';
      const rest = m ? m[1] + b.text.slice(m[0].length) : b.text;
      return <p class={`doc-p doc-dropcap cap-${doc.print.look?.dropCap ?? 'raised'}`}><span class="doc-cap">{cap}</span><Inline text={rest} /></p>;
    }
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
      // A map: its places numbered on the picture, and listed by number under it.
      if (b.pins) return (
        <figure class="doc-figure doc-map">
          <div class="doc-map-frame">
            <DocImage dir={dir} file={b.file} caption={b.caption} />
            {b.pins.map((p) => <span key={p.n} class="doc-pin" style={{ left: `${p.x}%`, top: `${p.y}%` }} title={p.name}>{p.n}</span>)}
          </div>
          {b.pins.length > 0 && <ol class="doc-map-legend">{b.pins.map((p) => <li key={p.n}><span class="doc-pin">{p.n}</span> {p.name}</li>)}</ol>}
        </figure>
      );
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
        <nav class="doc-toc" aria-label={tm('Contents')}>
          <p class="doc-h doc-h1">{tm('Contents')}</p>
          <ol>
            {heads.map(([h, j]) => (
              <li key={j} class={`toc-l${h.level}`}>
                <a href={`#${anchorId(h, j)}`} onClick={(e) => { e.preventDefault(); document.getElementById(anchorId(h, j))?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>{h.text}</a>
              </li>
            ))}
          </ol>
          <p class="doc-small">{doc.print ? t('Page numbers are added in the PDF and in Word.') : t('Page numbers are added in the PDF.')}</p>
        </nav>
      );
    }
  }
}

/** The look fields of world.json "book" the style bar edits. */
type LookKey = 'bodyFont' | 'bodySize' | 'bodyColor' | 'chapterFont' | 'chapterSize' | 'chapterColor' | 'lineSpacing' | 'margins' | 'dropCap' | 'dateStamps' | 'coverTitleColor' | 'coverTitleSize' | 'authorSize';
const LOOK_KEYS: LookKey[] = ['bodyFont', 'bodySize', 'bodyColor', 'chapterFont', 'chapterSize', 'chapterColor', 'lineSpacing', 'margins', 'dropCap', 'dateStamps', 'coverTitleColor', 'coverTitleSize', 'authorSize'];
const SPACINGS = [1, 1.15, 1.3, 1.45, 1.6, 1.8, 2];
const fontOptions = (list: readonly string[], group?: string) => list.map((f) => ({ value: f, label: f, ...(group ? { group } : {}) }));

/** A labelled number box that commits whole steps and keeps the last good value while typing. */
function NumberField({ label, name, value, min, max, step, unit, onCommit }: { label: string; name: string; value: number; min: number; max: number; step: number; unit: string; onCommit: (n: number) => void }) {
  return (
    <label class="bt-field bt-number">
      <span class="bt-label">{label}</span>
      <span class="bt-num">
        <input type="number" name={name} min={min} max={max} step={step} value={value} aria-label={`${label} (${unit})`}
          onInput={(e) => { const n = Number(e.currentTarget.value); if (e.currentTarget.value !== '' && n >= min && n <= max) onCommit(n); }} />
        <span class="bt-unit" aria-hidden="true">{unit}</span>
      </span>
    </label>
  );
}

function ColorField({ label, name, value, onCommit }: { label: string; name: string; value: string; onCommit: (c: string) => void }) {
  return (
    <label class="bt-field bt-color" title={`${label}: ${value}`}>
      <span class="bt-label">{label}</span>
      <input type="color" name={name} value={value} aria-label={label} onInput={(e) => onCommit(e.currentTarget.value)} />
    </label>
  );
}

/**
 * The Story Book style bar: page, text, chapter titles, spacing, initial, dates and cover, like a word processor's
 * ribbon. Every change shows at once in the pages below and is saved in world.json "book"; the PDF and Word use it.
 */
function BookToolbar({ look, trim, coverColor, onTrim, onLook, onReset, custom }: {
  look: BookLook;
  trim: TrimSize;
  coverColor: string;
  onTrim: (t: TrimSize) => void;
  onLook: (patch: BookSettings) => void;
  onReset: () => void;
  custom: boolean;
}) {
  return (
    <div class="book-toolbar" role="region" aria-label={t('Book style')}>
      <div class="bt-group" role="group" aria-label={t('Page')}>
        <span class="bt-title"><Icon name="book-cover" /> {t('Page')}</span>
        <label class="bt-field">
          <span class="bt-label">{t('Size')}</span>
          <Select class="trim-select" aria-label={t('Page size')} value={trim} onChange={(v) => onTrim(v as TrimSize)} options={(Object.keys(TRIMS) as TrimSize[]).map((size) => ({ value: size, label: t(TRIM_LABEL[size]) }))} />
        </label>
        <label class="bt-field">
          <span class="bt-label">{t('Margins')}</span>
          <Select class="margins-select" aria-label={t('Margins')} value={look.margins} onChange={(v) => onLook({ margins: v === 'normal' ? undefined : (v as BookLook['margins']) })} options={[{ value: 'narrow', label: t('Narrow') }, { value: 'normal', label: t('Normal') }, { value: 'wide', label: t('Wide') }]} />
        </label>
      </div>
      <div class="bt-group" role="group" aria-label={t('Text')}>
        <span class="bt-title"><Icon name="quill-ink" /> {t('Text')}</span>
        <label class="bt-field bt-font">
          <span class="bt-label">{t('Font')}</span>
          <Select class="body-font-select" aria-label={t('Text font')} value={look.bodyFont} onChange={(v) => onLook({ bodyFont: v })} options={fontOptions(BOOK_FONTS)} />
        </label>
        <NumberField label={t('Size')} name="book-body-size" value={look.bodySize} min={8} max={16} step={0.5} unit="pt" onCommit={(n) => onLook({ bodySize: n })} />
        <ColorField label={t('Colour')} name="book-body-color" value={look.bodyColor} onCommit={(c) => onLook({ bodyColor: c })} />
        <label class="bt-field">
          <span class="bt-label">{t('Spacing')}</span>
          <Select class="spacing-select" aria-label={t('Line spacing')} value={String(SPACINGS.reduce((a, b) => (Math.abs(b - look.lineSpacing) < Math.abs(a - look.lineSpacing) ? b : a)))} onChange={(v) => onLook({ lineSpacing: Number(v) })} options={SPACINGS.map((n) => ({ value: String(n), label: n.toFixed(2).replace(/0$/, '') }))} />
        </label>
      </div>
      <div class="bt-group" role="group" aria-label={t('Chapter titles')}>
        <span class="bt-title"><Icon name="scroll-unfurled" /> {t('Chapter titles')}</span>
        <label class="bt-field bt-font">
          <span class="bt-label">{t('Font')}</span>
          <Select class="chapter-font-select" aria-label={t('Chapter title font')} value={look.chapterFont} onChange={(v) => onLook({ chapterFont: v })} options={[...fontOptions(BOOK_FONTS, t('Book fonts')), ...fontOptions(TITLE_FONTS, t('Display fonts'))]} />
        </label>
        <NumberField label={t('Size')} name="book-chapter-size" value={look.chapterSize} min={12} max={40} step={1} unit="pt" onCommit={(n) => onLook({ chapterSize: n })} />
        <ColorField label={t('Colour')} name="book-chapter-color" value={look.chapterColor} onCommit={(c) => onLook({ chapterColor: c })} />
      </div>
      <div class="bt-group" role="group" aria-label={t('Chapter openings')}>
        <span class="bt-title"><Icon name="spell-book" /> {t('Openings')}</span>
        <div class="bt-field">
          <span class="bt-label" id="bt-cap-label">{t('First letter')}</span>
          <div class="bt-seg" role="group" aria-labelledby="bt-cap-label">
            {([['none', 'None'], ['raised', 'Raised'], ['dropped', 'Dropped']] as [DropCapStyle, string][]).map(([v, label]) => (
              <button key={v} type="button" class={`bt-cap-${v}`} aria-pressed={look.dropCap === v} onClick={() => onLook({ dropCap: v === 'raised' ? undefined : v })}>{t(label)}</button>
            ))}
          </div>
        </div>
        <div class="bt-field">
          <span class="bt-label">{t('Dates')}</span>
          <button type="button" class="bt-toggle bt-dates" aria-pressed={look.dateStamps} onClick={() => onLook({ dateStamps: look.dateStamps ? false : undefined })}>
            <Icon name="calendar" /> {look.dateStamps ? t('Shown') : t('Hidden')}
          </button>
        </div>
      </div>
      <div class="bt-group" role="group" aria-label={t('Cover')}>
        <span class="bt-title"><Icon name="palette" /> {t('Cover')}</span>
        <ColorField label={t('Title colour')} name="book-cover-color" value={coverColor} onCommit={(c) => onLook({ coverTitleColor: c })} />
        <NumberField label={t('Title size')} name="book-cover-size" value={Math.round(look.coverTitleScale * 100)} min={50} max={200} step={5} unit="%" onCommit={(n) => onLook({ coverTitleSize: n === 100 ? undefined : n })} />
        <NumberField label={t('Author size')} name="book-author-size" value={Math.round(look.authorScale * 100)} min={50} max={200} step={5} unit="%" onCommit={(n) => onLook({ authorSize: n === 100 ? undefined : n })} />
      </div>
      <button type="button" class="ghost bt-reset" disabled={!custom} onClick={onReset} title={t('Back to the default book look')}><Icon name="clockwise-rotation" /> {t('Reset style')}</button>
    </div>
  );
}

/** The look as CSS variables on the preview pages, in units of the default (10.5 pt text, 19 pt titles). */
export function lookVars(look: BookLook, k: number): Record<string, string> {
  const fam = (f: string) => `'${f}', ${/Sans|Carlito/.test(f) ? "'DejaVu Sans', system-ui, sans-serif" : "'DejaVu Serif', Georgia, serif"}`;
  return {
    '--bk-font': fam(look.bodyFont),
    '--bk-head-font': fam(look.chapterFont),
    '--bk-scale': String(look.bodySize / 10.5),
    '--bk-head-scale': String(look.chapterSize / 19),
    '--bk-ink': look.bodyColor,
    '--bk-accent': look.chapterColor,
    '--bk-lh': String(look.lineSpacing + 0.05),
    '--bk-margin': String(k),
    '--bk-cover-scale': String(look.coverTitleScale),
    '--bk-author-scale': String(look.authorScale),
  };
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
  // Saves go one after another (each one patches world.json), so quick changes never overwrite each other.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const persist = (patch: BookSettings) => {
    const saved = world.manifest.book ?? {};
    if (Object.entries(patch).some(([k, v]) => (saved[k as keyof BookSettings] ?? '') !== v)) queue.current = queue.current.then(() => onSaveBook?.(patch)).catch(() => {});
  };
  // Style changes show at once; their save waits until the colour picker or number box has been still for a moment.
  const pendingLook = useRef<BookSettings>({});
  const lookTimer = useRef<ReturnType<typeof setTimeout>>();
  const flushLook = () => {
    clearTimeout(lookTimer.current);
    const patch = pendingLook.current;
    pendingLook.current = {};
    if (Object.keys(patch).length) persist(patch);
    return queue.current;
  };
  const changeLook = (patch: BookSettings) => {
    setBook((b) => ({ ...b, ...patch }));
    pendingLook.current = { ...pendingLook.current, ...patch };
    clearTimeout(lookTimer.current);
    lookTimer.current = setTimeout(() => void flushLook(), 350);
  };
  useEffect(() => () => void flushLook(), []);
  const look = useMemo(() => bookLook(book), [book]);
  const customLook = LOOK_KEYS.some((k) => book[k] !== undefined);
  const resetLook = () => changeLook(Object.fromEntries(LOOK_KEYS.map((k) => [k, undefined])) as BookSettings);
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
  const save = async () => { setBusy(true); try { await flushLook(); await onSave(kind, options); } finally { setBusy(false); } };
  const saveDocx = async () => { setBusy(true); try { await flushLook(); await onSaveDocx?.(options); } finally { setBusy(false); } };
  const count = world.entries.filter((e) => types.includes(e.type)).length;

  return (
    <div class="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="preview" role="dialog" aria-modal="true" aria-labelledby="preview-title" ref={dialog}>
        <header class="preview-head">
          <h2 id="preview-title" tabIndex={-1}><Icon name={TITLE_ICON[kind]} /> {t(TITLE[kind])} <span class="muted">{tx('title', 'preview')}</span></h2>
          <p class="muted">{doc.print
            ? doc.print.rightHand
              ? t('{trim}, print layout. {n} sheets here; the PDF paginates further, adds running heads and page numbers, and starts each chapter on a right-hand page.', { trim: t(TRIM_LABEL[doc.print.trim]), n: sheetCount })
              : t('{trim}, print layout. {n} sheets here; the PDF paginates further and adds running heads and page numbers.', { trim: t(TRIM_LABEL[doc.print.trim]), n: sheetCount })
            : t('{n} sheets here; the PDF paginates further. This is the same content the PDF gets.', { n: sheetCount })}</p>
          <div class="preview-actions">
            <button type="button" class="primary" disabled={busy || (kind === 'codex' && types.length === 0)} onClick={() => void save()}>
              <Icon name="save" /> {busy ? t('Saving…') : t('Save PDF…')}
            </button>
            {kind === 'book' && onSaveDocx && (
              <button type="button" class="save-docx" disabled={busy} onClick={() => void saveDocx()}>
                <Icon name="quill-ink" /> {t('Save Word (.docx)…')}
              </button>
            )}
            <button type="button" class="ghost" onClick={onClose}>{t('Close')} <kbd>Esc</kbd></button>
          </div>
        </header>
        <div class="preview-body">
          <Aura calm local />
          <aside class="preview-options" aria-label={t('Options')}>
            {kind === 'codex' ? (
              <>
                <fieldset>
                  <legend>{t('Entry types')}</legend>
                  {ALL_TYPES.map((t) => (
                    <label key={t} class={`check t-${t}`}>
                      <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />
                      <Icon name={TYPE_ICON[t]} /> {tm(TYPE_LABELS[t])}
                    </label>
                  ))}
                  <p class="hint">{types.length === 0 ? t('{n} entries included. Pick at least one type.', { n: count }) : t('{n} entries included.', { n: count })}</p>
                </fieldset>
                <fieldset>
                  <legend>{t('Extras')}</legend>
                  <label class="check"><input type="checkbox" checked={artBriefs} onChange={() => setArtBriefs(!artBriefs)} /> <Icon name="palette" /> {t('Art briefs and image prompts')}</label>
                  <label class="check"><input type="checkbox" checked={warnings} onChange={() => setWarnings(!warnings)} /> <Icon name="hazard-sign" /> {t('Warnings appendix')}</label>
                </fieldset>
              </>
            ) : (
              <>
              <fieldset>
                <legend>{t('Print')}</legend>
                <p class="hint">{t('Page size, margins, fonts and colours are in the style bar above the pages. Margins are mirrored with a wider inside edge for the binding.')}</p>
                <label class="check right-hand">
                  <input type="checkbox" name="right-hand-chapters" checked={rightHand} onChange={() => { const v = !rightHand; setRightHand(v); persist({ rightHandChapters: v || undefined }); }} />
                  <Icon name="open-book" /> {t('Start chapters on right-hand pages')}
                </label>
                <p class="hint">{rightHand ? t('For a printed book: blank pages are added so each chapter opens on the right.') : t('Off: every chapter starts on the next page, with no blank pages.')}</p>
              </fieldset>
              <fieldset class="book-details">
                <legend>{t('Book details')}</legend>
                {DETAILS.map(([k, label, empty, long]) => (
                  <label key={k} class="field">
                    <span>{t(label)}</span>
                    {long ? (
                      <textarea name={`book-${k}`} rows={k === 'copyright' ? 3 : 2} placeholder={t(empty)} value={book[k] ?? ''} onInput={(e) => editBook(k, e.currentTarget.value)} onBlur={(e) => persist({ [k]: e.currentTarget.value.trim() })} />
                    ) : (
                      <input name={`book-${k}`} placeholder={t(empty)} value={book[k] ?? ''} onInput={(e) => editBook(k, e.currentTarget.value)} onBlur={(e) => persist({ [k]: e.currentTarget.value.trim() })} />
                    )}
                  </label>
                ))}
                <p class="hint">{t('All optional. Saved in world.json.')}</p>
              </fieldset>
              {hasStory && (
                <fieldset>
                  <legend>{t('Story')}</legend>
                  <p class="hint">{t('Your written chapters are the book. The chronicle of events and notes follows them.')}</p>
                  <label class="check"><input type="checkbox" checked={appendix} onChange={() => setAppendix(!appendix)} /> <Icon name="hourglass" /> {t('Chronicle appendix')}</label>
                </fieldset>
              )}
              {(!hasStory || appendix) && (
              <fieldset>
                <legend>{hasStory ? t('Chronicle chapters') : t('Chapters')}</legend>
                {([['era', 'One per era'], ['years', 'By year ranges'], ['single', 'One chapter']] as const).map(([g, label]) => (
                  <label key={g} class="check">
                    <input type="radio" name="grouping" checked={grouping === g} onChange={() => setGrouping(g)} /> {t(label)}
                  </label>
                ))}
                {grouping === 'years' && (
                  <label class="field inline-field">
                    <span>{t('Years per chapter')}</span>
                    <input type="number" min={1} step={1} value={chapterYears} onInput={(e) => { const n = Number(e.currentTarget.value); if (n >= 1) setChapterYears(Math.floor(n)); }} />
                  </label>
                )}
                <p class="hint">{t("A page's own “chapter:” always wins.")}</p>
              </fieldset>
              )}
              </>
            )}
          </aside>
          <div class="preview-main">
            {kind === 'book' && (
              <BookToolbar look={look} trim={trim} coverColor={look.coverTitleColor ?? doc.cover.art?.titleColor ?? '#fbf3df'} custom={customLook}
                onTrim={(t) => { setTrim(t); persist({ trim: t }); }} onLook={changeLook} onReset={resetLook} />
            )}
            <div class={`preview-pages${doc.print ? ` is-book cap-${look.dropCap}` : ''}`} tabIndex={0} aria-label={t('Preview pages')} style={doc.print ? lookVars(look, look.margins === 'narrow' ? 0.75 : look.margins === 'wide' ? 1.3 : 1) : undefined}>
              {hasCover && <CoverSheet doc={doc} dir={dir} />}
              {sheets.map((s, i) => (
                <section class={doc.print ? `sheet is-print ${trimClass(doc.print.trim)}${s[0]?.kind === 'front' ? ' is-front' : ''}` : 'sheet'} key={i}>
                  {s.map((b, j) => <BlockView key={j} b={b} dir={dir} doc={doc} i={doc.blocks.indexOf(b)} />)}
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
