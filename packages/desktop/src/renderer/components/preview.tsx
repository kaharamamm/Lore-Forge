import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { docSheets, inlineRuns, storyBook, TYPE_EMOJI, TYPE_LABELS, worldBible, type Block, type ChapterGrouping, type Doc, type EntryType, type World } from '@lore-forge/core';
import type { PdfKind, PublishOptions } from '../../shared/api.ts';

const ALL_TYPES: EntryType[] = ['character', 'place', 'faction', 'item', 'event', 'note'];
const TITLE: Record<PdfKind, string> = { bible: '📖 World Bible', book: '📚 Story Book' };

/** Build the Doc exactly as the PDF export does (same core function, same options). */
export function previewDoc(world: World, kind: PdfKind, options: PublishOptions): Doc {
  return kind === 'bible' ? worldBible(world, options) : storyBook(world, options);
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
  if (src === null) return <div class="doc-img-missing"><span aria-hidden="true">🖼️ </span>Image file missing: {file}</div>;
  return <img src={src} alt={caption} />;
}

const anchorId = (b: Extract<Block, { kind: 'heading' }>, i: number) => `pv-${b.anchor ?? `h-${i}`}`;

function BlockView({ b, dir, doc, i }: { b: Block; dir: string; doc: Doc; i: number }) {
  switch (b.kind) {
    case 'heading': {
      const H = (`h${b.level + 1}`) as 'h2' | 'h3' | 'h4';
      return <H id={anchorId(b, i)} class={`doc-h doc-h${b.level}`}>{b.text}</H>;
    }
    case 'para': return <p class={`doc-p${b.style ? ` doc-${b.style}` : ''}`}><Inline text={b.text} /></p>;
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
          <p class="doc-small">Page numbers are added in the PDF.</p>
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
}

/** In-app preview of the World Bible / Story Book, from the same Doc the PDF uses; "Save PDF" only after looking. */
export function PreviewDialog({ dir, world, kind, onClose, onSave }: Props) {
  const [types, setTypes] = useState<EntryType[]>(ALL_TYPES);
  const [warnings, setWarnings] = useState(true);
  const [artBriefs, setArtBriefs] = useState(true);
  const manifestYears = world.manifest.book?.chapterYears;
  const [grouping, setGrouping] = useState<ChapterGrouping>(manifestYears && manifestYears >= 1 ? 'years' : 'era');
  const [chapterYears, setChapterYears] = useState(manifestYears ?? 100);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  const options: PublishOptions = kind === 'bible'
    ? { types: ALL_TYPES.filter((t) => types.includes(t)), warnings, artBriefs }
    : { grouping, ...(grouping === 'years' ? { chapterYears } : {}) };
  const key = JSON.stringify(options);
  const doc = useMemo(() => previewDoc(world, kind, options), [world, kind, key]);
  const sheets = useMemo(() => sheetsOf(doc.blocks), [doc]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('h2')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !dialog.current) return;
      // Keep focus inside the dialog.
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href], [tabindex="0"]')];
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
  const count = world.entries.filter((e) => types.includes(e.type)).length;

  return (
    <div class="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="preview" role="dialog" aria-modal="true" aria-labelledby="preview-title" ref={dialog}>
        <header class="preview-head">
          <h2 id="preview-title" tabIndex={-1}>{TITLE[kind]} <span class="muted">preview</span></h2>
          <p class="muted">{sheets.length + 1} sheets here; the PDF paginates further. This is the same content the PDF gets.</p>
          <div class="preview-actions">
            <button type="button" class="primary" disabled={busy || (kind === 'bible' && types.length === 0)} onClick={() => void save()}>
              <span aria-hidden="true">💾 </span>{busy ? 'Saving…' : 'Save PDF…'}
            </button>
            <button type="button" class="ghost" onClick={onClose}>Close <kbd>Esc</kbd></button>
          </div>
        </header>
        <div class="preview-body">
          <aside class="preview-options" aria-label="Options">
            {kind === 'bible' ? (
              <>
                <fieldset>
                  <legend>Entry types</legend>
                  {ALL_TYPES.map((t) => (
                    <label key={t} class={`check t-${t}`}>
                      <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />
                      <span aria-hidden="true">{TYPE_EMOJI[t]}</span> {TYPE_LABELS[t]}
                    </label>
                  ))}
                  <p class="hint">{count} entries included{types.length === 0 ? ' — pick at least one type' : ''}.</p>
                </fieldset>
                <fieldset>
                  <legend>Extras</legend>
                  <label class="check"><input type="checkbox" checked={artBriefs} onChange={() => setArtBriefs(!artBriefs)} /> 🎨 Art briefs and image prompts</label>
                  <label class="check"><input type="checkbox" checked={warnings} onChange={() => setWarnings(!warnings)} /> ⚠️ Warnings appendix</label>
                </fieldset>
              </>
            ) : (
              <fieldset>
                <legend>Chapters</legend>
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
          </aside>
          <div class="preview-pages" tabIndex={0} aria-label="Preview pages">
            <section class="sheet sheet-cover">
              <p class="cover-title">{doc.cover.title}</p>
              <p class="cover-sub">{doc.cover.subtitle}</p>
              {doc.cover.lines.map((l, i) => <p key={i} class="doc-small">{l}</p>)}
            </section>
            {sheets.map((s, i) => (
              <section class="sheet" key={i}>
                {s.map((b, j) => <BlockView key={j} b={b} dir={dir} doc={doc} i={doc.blocks.indexOf(b)} />)}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
