import { useEffect, useRef, useState } from 'preact/hooks';
import { IMAGE_VIEWS, imageLook, viewLabel, type Entry, type Look, type Provenance, type RefImage } from '@lore-forge/core';
import { lower, t, tj, tm } from '../i18n.tsx';
import { ListText, TextField } from './fields.tsx';
import { Icon } from './icon.tsx';
import { ModelPanel } from './models.tsx';

function Thumb({ dir, file, alt }: { dir: string; file: string; alt: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void window.lore.readImage(dir, file).then((s) => live && setSrc(s));
    return () => void (live = false);
  }, [dir, file]);
  if (src === undefined) return <div class="thumb thumb-empty">{t('Loading…')}</div>;
  if (src === null) return <div class="thumb thumb-empty"><Icon name="hazard-sign" /> {t('File missing')}<br /><span class="file-path">{file}</span></div>;
  return <img class="thumb" src={src} alt={alt} />;
}

const HELP: Partial<Record<Entry['type'], string>> = {
  character: 'For turnaround sheets and 3D tools (Tripo3D, Meshy).',
  item: 'For prop sheets and 3D tools.',
  place: 'Establishing shots, maps and mood boards.',
  event: 'Scenes and battle maps; used as illustrations in the Story Book.',
};

/**
 * Reference images of one look (none: the Default look) as a gallery: one tile per usual view for the entry's type,
 * plus any other view already in the file. An empty tile is itself the button that adds an image; a filled tile shows
 * the picture with its view, and small buttons to replace or remove it and to open its details. The details (where the
 * image came from) open in one panel under the gallery, so the tiles stay the same size. Images are copied into the
 * world folder (a look's into its own folder). Pictures of other looks are kept as they are, in their places.
 */
export function ImageSlots({ dir, entry, look, onChange }: { dir: string; entry: Entry; look?: Look; onChange: (images: RefImage[] | undefined) => void }) {
  const all = entry.images ?? [];
  const mine = (e: Entry, i: RefImage) => imageLook(e, i) === (look ? e.looks?.find((l) => l.id === look.id) : undefined);
  const images = all.filter((i) => mine(entry, i));
  const usual = IMAGE_VIEWS[entry.type];
  const views = [...usual, ...images.map((i) => i.view).filter((v, i, all) => !usual.includes(v) && all.indexOf(v) === i)];
  const [open, setOpen] = useState<string | null>(null);
  /** Where the last copy went (the download button on a picture), with a way to show it. */
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const download = (file: string): void => {
    setProblem(null);
    void window.lore.saveCopy(dir, file).then((to) => to && setSaved(to), (e: unknown) => setProblem(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '\w+': (Error: )?/, '')));
  };
  /** This look's picture for a view replaced (or removed, or added at the end); every other picture stays in place. */
  const placed = (e: Entry, view: string, img: RefImage | undefined): RefImage[] => {
    const list = [...(e.images ?? [])];
    const at = list.findIndex((i) => mine(e, i) && i.view === view);
    if (at >= 0) {
      if (img) list[at] = img;
      else list.splice(at, 1);
    } else if (img) list.push(img);
    return list;
  };
  const put = (view: string, img: RefImage | undefined): void => {
    const next = placed(entry, view, img);
    onChange(next.length ? next : undefined);
  };
  // The entry may change while the file dialog is open (an AI assistant writing, a reload): the picture goes into
  // the entry as it is when the dialog closes, through the latest onChange.
  const latest = useRef({ entry, onChange });
  latest.current = { entry, onChange };
  const attach = async (view: string): Promise<void> => {
    const file = await window.lore.importImage(dir, entry.id, view, look?.id);
    if (!file) return;
    const now = latest.current.entry;
    const before = (now.images ?? []).find((i) => mine(now, i) && i.view === view);
    const img: RefImage = { file, view, ...(look ? { look: look.id } : {}), provenance: { ...before?.provenance, date: new Date().toISOString().slice(0, 10) } };
    latest.current.onChange(placed(now, view, img));
  };
  const filled = images.length;
  const detail = open ? images.find((i) => i.view === open) : undefined;
  const detailIndex = detail ? all.indexOf(detail) : -1;
  const setProv = (p: Partial<Provenance>): void => {
    if (!detail) return;
    const provenance = Object.fromEntries(Object.entries({ ...detail.provenance, ...p }).filter(([, v]) => v !== undefined)) as Provenance;
    put(detail.view, { ...detail, provenance });
  };
  return (
    <fieldset class="list-editor ref-images" data-field="images">
      <legend>{t('Reference images')}</legend>
      <p class="muted ref-images-help">
        {t(HELP[entry.type] ?? '')} <span class="ref-images-count">{t('{filled} of {total} views', { filled, total: views.length })}</span>
        <span class="ref-images-where"> · {tj('copied into {path}', { path: <code>images/{entry.id}/{look ? `${look.id}/` : ''}</code> })}</span>
      </p>
      <div class="image-grid">
        {views.map((view) => {
          const img = images.find((i) => i.view === view);
          const index = img ? all.indexOf(img) : -1;
          const label = tm(viewLabel(view));
          const unusual = !usual.includes(view);
          if (!img) {
            return (
              <button type="button" key={view} class="image-slot image-slot-empty" onClick={() => void attach(view)} aria-label={t('Add a {view} image', { view: lower(label) })}>
                <span class="image-slot-frame"><Icon name="photo-camera" class="image-slot-add" /><span class="image-slot-hint">{t('Add image')}</span></span>
                <span class="image-slot-label">{label}{unusual && <span class="image-slot-unusual"> · {t('unusual')}</span>}</span>
              </button>
            );
          }
          return (
            <section key={view} class={`image-slot${open === view ? ' is-open' : ''}`} aria-label={t('{view} view', { view: label })} data-field={`images[${index}]`}>
              <span class="image-slot-frame">
                <Thumb dir={dir} file={img.file} alt={`${entry.name}, ${label}`} />
                {/* A toolbar along the picture's bottom edge, as wide as the picture: it never spills out of the tile. */}
                <span class="image-slot-actions">
                  <button type="button" class="ghost icon-only" title={t('Details: where it came from')} aria-label={t('Details of the {view} image', { view: lower(label) })} aria-expanded={open === view} onClick={() => setOpen(open === view ? null : view)}><Icon name="info" /></button>
                  <button type="button" class="ghost icon-only" title={t('Replace with another image')} aria-label={t('Replace the {view} image', { view: lower(label) })} onClick={() => void attach(view)}><Icon name="cycle" /></button>
                  <button type="button" class="ghost icon-only image-download" title={t('Save a copy of this picture anywhere')} aria-label={t('Save a copy of the {view} image', { view: lower(label) })} onClick={() => download(img.file)}><Icon name="cloud-download" /></button>
                  <button type="button" class="ghost icon-only danger" title={t('Remove (the file stays in the world folder)')} aria-label={t('Remove the {view} image', { view: lower(label) })} onClick={() => { if (open === view) setOpen(null); put(view, undefined); }}><Icon name="trash-can" /></button>
                </span>
              </span>
              <span class="image-slot-label">{label}{unusual && <span class="image-slot-unusual"> · {t('unusual')}</span>}</span>
            </section>
          );
        })}
      </div>
      {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
      {saved && <p class="muted saved-copy" role="status"><Icon name="check-mark" /> {t('Saved a copy: {path}', { path: saved })} <button type="button" class="link-button" onClick={() => void window.lore.showInFolder(saved)}>{t('Show in folder')}</button></p>}
      {detail && (
        <section class="image-details" aria-label={t('{view} image details', { view: tm(viewLabel(detail.view)) })} data-field={`images[${detailIndex}]`}>
          <header class="image-details-head">
            <h4><Icon name="info" /> {t('{view}: where it came from', { view: tm(viewLabel(detail.view)) })}</h4>
            <span class="muted file-path">{detail.file}</span>
            <button type="button" class="ghost small" onClick={() => setOpen(null)}>{t('Close')}</button>
          </header>
          <div class="image-details-grid">
            <TextField label={t('Tool')} field={`images.${detail.view}.tool`} value={detail.provenance?.tool} onChange={(tool) => setProv({ tool })} placeholder={t('e.g. Grok Bot, Meshy, hand drawn')} />
            <TextField label={t('Date made')} field={`images.${detail.view}.date`} value={detail.provenance?.date} onChange={(date) => setProv({ date })} placeholder={t('YYYY-MM-DD')} />
            <TextField label={t('Rights note')} field={`images.${detail.view}.rights`} value={detail.provenance?.rights} onChange={(rights) => setProv({ rights })} />
            <TextField label={t('Prompt')} field={`images.${detail.view}.prompt`} value={detail.provenance?.prompt} onChange={(prompt) => setProv({ prompt })} multiline />
            <ListText label={t('Sources (one per line)')} field={`images.${detail.view}.sources`} value={detail.provenance?.sources} onChange={(sources) => setProv({ sources })} resetKey={`${entry.id}:${detail.file}`} multiline />
          </div>
        </section>
      )}
    </fieldset>
  );
}

/** Sent by Go to before it looks for an image field. */
export const SHOW_IMAGES = 'lore:show-images';

/** Reference images and 3D models of an entry, as two tabs: Images | 3D model. */
export function EntryMedia({ dir, entry, look, onChange }: { dir: string; entry: Entry; look?: Look; onChange: (images: RefImage[] | undefined) => void }) {
  const [tab, setTab] = useState<'images' | 'models'>('images');
  // Go to a warning about an image shows the Images tab, also when the 3D model tab was open.
  useEffect(() => {
    const show = () => setTab('images');
    window.addEventListener(SHOW_IMAGES, show);
    return () => window.removeEventListener(SHOW_IMAGES, show);
  }, []);
  const tabs: ['images' | 'models', 'photo-camera' | 'cube', string][] = [['images', 'photo-camera', t('Images')], ['models', 'cube', t('3D model')]];
  return (
    <div class="entry-media">
      <div class="media-tabs" role="tablist" aria-label={t('Pictures and models')}>
        {tabs.map(([t, icon, label]) => (
          <button key={t} type="button" role="tab" id={`media-tab-${t}`} aria-selected={tab === t} aria-controls={`media-${t}`} class={`media-tab${tab === t ? ' is-on' : ''}`} onClick={() => setTab(t)}><Icon name={icon} /> {label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`media-${tab}`} aria-labelledby={`media-tab-${tab}`}>
        {tab === 'images' ? <ImageSlots dir={dir} entry={entry} look={look} onChange={onChange} /> : <ModelPanel dir={dir} entry={entry} look={look?.id} />}
      </div>
    </div>
  );
}
