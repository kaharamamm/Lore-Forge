import { useEffect, useState } from 'preact/hooks';
import { IMAGE_VIEWS, viewLabel, type Entry, type Provenance, type RefImage } from '@lore-forge/core';
import { ListText, TextField } from './fields.tsx';
import { Icon } from './icon.tsx';

function Thumb({ dir, file, alt }: { dir: string; file: string; alt: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void window.lore.readImage(dir, file).then((s) => live && setSrc(s));
    return () => void (live = false);
  }, [dir, file]);
  if (src === undefined) return <div class="thumb thumb-empty">Loading…</div>;
  if (src === null) return <div class="thumb thumb-empty"><Icon name="hazard-sign" /> File missing<br /><span class="file-path">{file}</span></div>;
  return <img class="thumb" src={src} alt={alt} />;
}

const HELP: Partial<Record<Entry['type'], string>> = {
  character: 'For turnaround sheets and 3D tools (Tripo3D, Meshy).',
  item: 'For prop sheets and 3D tools.',
  place: 'Establishing shots, maps and mood boards.',
  event: 'Scenes and battle maps; used as illustrations in the Story Book.',
};

/**
 * Reference images as a gallery: one tile per usual view for the entry's type, plus any other view already in the
 * file. An empty tile is itself the button that adds an image; a filled tile shows the picture with its view, and
 * small buttons to replace or remove it and to open its details. The details (where the image came from) open in
 * one panel under the gallery, so the tiles stay the same size. Images are copied into the world folder.
 */
export function ImageSlots({ dir, entry, onChange }: { dir: string; entry: Entry; onChange: (images: RefImage[] | undefined) => void }) {
  const images = entry.images ?? [];
  const usual = IMAGE_VIEWS[entry.type];
  const views = [...usual, ...images.map((i) => i.view).filter((v, i, all) => !usual.includes(v) && all.indexOf(v) === i)];
  const [open, setOpen] = useState<string | null>(null);
  const put = (view: string, img: RefImage | undefined): void => {
    const rest = images.filter((i) => i.view !== view);
    const next = img ? [...rest, img].sort((a, b) => views.indexOf(a.view) - views.indexOf(b.view)) : rest;
    onChange(next.length ? next : undefined);
  };
  const attach = async (view: string): Promise<void> => {
    const file = await window.lore.importImage(dir, entry.id, view);
    if (file) put(view, { file, view, provenance: { ...images.find((i) => i.view === view)?.provenance, date: new Date().toISOString().slice(0, 10) } });
  };
  const filled = images.length;
  const detail = open ? images.find((i) => i.view === open) : undefined;
  const detailIndex = detail ? images.indexOf(detail) : -1;
  const setProv = (p: Partial<Provenance>): void => {
    if (!detail) return;
    const provenance = Object.fromEntries(Object.entries({ ...detail.provenance, ...p }).filter(([, v]) => v !== undefined)) as Provenance;
    put(detail.view, { ...detail, provenance });
  };
  return (
    <fieldset class="list-editor ref-images" data-field="images">
      <legend>Reference images</legend>
      <p class="muted ref-images-help">
        {HELP[entry.type] ?? ''} <span class="ref-images-count">{filled} of {views.length} views</span>
        <span class="ref-images-where"> · copied into <code>images/{entry.id}/</code></span>
      </p>
      <div class="image-grid">
        {views.map((view) => {
          const index = images.findIndex((i) => i.view === view);
          const img = images[index];
          const label = viewLabel(view);
          const unusual = !usual.includes(view);
          if (!img) {
            return (
              <button type="button" key={view} class="image-slot image-slot-empty" onClick={() => void attach(view)} aria-label={`Add a ${label.toLowerCase()} image`}>
                <span class="image-slot-frame"><Icon name="photo-camera" class="image-slot-add" /><span class="image-slot-hint">Add image</span></span>
                <span class="image-slot-label">{label}{unusual && <span class="image-slot-unusual"> · unusual</span>}</span>
              </button>
            );
          }
          return (
            <section key={view} class={`image-slot${open === view ? ' is-open' : ''}`} aria-label={`${label} view`} data-field={`images[${index}]`}>
              <span class="image-slot-frame"><Thumb dir={dir} file={img.file} alt={`${entry.name}, ${label}`} /></span>
              <span class="image-slot-label">{label}{unusual && <span class="image-slot-unusual"> · unusual</span>}</span>
              <span class="image-slot-actions">
                <button type="button" class="ghost icon-only" title="Details: where it came from" aria-label={`Details of the ${label.toLowerCase()} image`} aria-expanded={open === view} onClick={() => setOpen(open === view ? null : view)}><Icon name="info" /></button>
                <button type="button" class="ghost icon-only" title="Replace with another image" aria-label={`Replace the ${label.toLowerCase()} image`} onClick={() => void attach(view)}><Icon name="cycle" /></button>
                <button type="button" class="ghost icon-only danger" title="Remove (the file stays in the world folder)" aria-label={`Remove the ${label.toLowerCase()} image`} onClick={() => { if (open === view) setOpen(null); put(view, undefined); }}><Icon name="trash-can" /></button>
              </span>
            </section>
          );
        })}
      </div>
      {detail && (
        <section class="image-details" aria-label={`${viewLabel(detail.view)} image details`} data-field={`images[${detailIndex}]`}>
          <header class="image-details-head">
            <h4><Icon name="info" /> {viewLabel(detail.view)}: where it came from</h4>
            <span class="muted file-path">{detail.file}</span>
            <button type="button" class="ghost small" onClick={() => setOpen(null)}>Close</button>
          </header>
          <div class="image-details-grid">
            <TextField label="Tool" field={`images.${detail.view}.tool`} value={detail.provenance?.tool} onChange={(tool) => setProv({ tool })} placeholder="e.g. Grok Bot, Meshy, hand drawn" />
            <TextField label="Date made" field={`images.${detail.view}.date`} value={detail.provenance?.date} onChange={(date) => setProv({ date })} placeholder="YYYY-MM-DD" />
            <TextField label="Rights note" field={`images.${detail.view}.rights`} value={detail.provenance?.rights} onChange={(rights) => setProv({ rights })} />
            <TextField label="Prompt" field={`images.${detail.view}.prompt`} value={detail.provenance?.prompt} onChange={(prompt) => setProv({ prompt })} multiline />
            <ListText label="Sources (one per line)" field={`images.${detail.view}.sources`} value={detail.provenance?.sources} onChange={(sources) => setProv({ sources })} resetKey={`${entry.id}:${detail.file}`} multiline />
          </div>
        </section>
      )}
    </fieldset>
  );
}
