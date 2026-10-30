import { useEffect, useState } from 'preact/hooks';
import { IMAGE_VIEWS, type Character, type ImageView, type Provenance, type RefImage } from '@lore-forge/core';
import { ListText, TextField } from './fields.tsx';

const VIEW_LABELS: Record<ImageView, string> = {
  'a-pose': 'A-pose', front: 'Front', back: 'Back', left: 'Left', right: 'Right', 'three-quarter': 'Three-quarter', concept: 'Concept',
};

function Thumb({ dir, file, alt }: { dir: string; file: string; alt: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void window.lore.readImage(dir, file).then((s) => live && setSrc(s));
    return () => void (live = false);
  }, [dir, file]);
  if (src === undefined) return <div class="thumb thumb-empty">Loading…</div>;
  if (src === null) return <div class="thumb thumb-empty">File missing: {file}</div>;
  return <img class="thumb" src={src} alt={alt} />;
}

/** One slot per view. Images are copied into the world folder; provenance is stored in the entry. */
export function ImageSlots({ dir, entry, onChange }: { dir: string; entry: Character; onChange: (images: RefImage[] | undefined) => void }) {
  const images = entry.images ?? [];
  const put = (view: ImageView, img: RefImage | undefined): void => {
    const rest = images.filter((i) => i.view !== view);
    const next = img ? [...rest, img].sort((a, b) => IMAGE_VIEWS.indexOf(a.view) - IMAGE_VIEWS.indexOf(b.view)) : rest;
    onChange(next.length ? next : undefined);
  };
  const attach = async (view: ImageView): Promise<void> => {
    const file = await window.lore.importImage(dir, entry.id, view);
    if (file) put(view, { file, view, provenance: { ...images.find((i) => i.view === view)?.provenance, date: new Date().toISOString().slice(0, 10) } });
  };
  return (
    <fieldset class="list-editor" data-field="images">
      <legend>Reference images</legend>
      <p class="muted">For turnaround sheets and 3D tools (Tripo3D, Meshy). Files are copied into <code>images/{entry.id}/</code> inside the world.</p>
      <div class="image-grid">
        {IMAGE_VIEWS.map((view) => {
          const img = images.find((i) => i.view === view);
          const setProv = (p: Partial<Provenance>): void => {
            if (!img) return;
            const provenance = Object.fromEntries(Object.entries({ ...img.provenance, ...p }).filter(([, v]) => v !== undefined)) as Provenance;
            put(view, { ...img, provenance });
          };
          return (
            <section class={`image-slot${img ? '' : ' image-slot-empty'}`} key={view} aria-label={`${VIEW_LABELS[view]} view`}>
              <h4>{VIEW_LABELS[view]}</h4>
              {img ? <Thumb dir={dir} file={img.file} alt={`${entry.name}, ${VIEW_LABELS[view]} view`} /> : <div class="thumb thumb-empty">No image</div>}
              <div class="row">
                <button type="button" class="ghost small" onClick={() => void attach(view)}>{img ? 'Replace…' : 'Attach image…'}</button>
                {img && <button type="button" class="ghost small danger" onClick={() => put(view, undefined)}>Remove</button>}
              </div>
              {img && (
                <details class="provenance">
                  <summary>Provenance{img.provenance?.tool ? `: ${img.provenance.tool}` : ''}</summary>
                  <p class="muted file-path">{img.file}</p>
                  <TextField label="Tool" field={`images.${view}.tool`} value={img.provenance?.tool} onChange={(tool) => setProv({ tool })} placeholder="e.g. Grok Bot, Meshy, hand drawn" />
                  <TextField label="Prompt" field={`images.${view}.prompt`} value={img.provenance?.prompt} onChange={(prompt) => setProv({ prompt })} />
                  <TextField label="Date made" field={`images.${view}.date`} value={img.provenance?.date} onChange={(date) => setProv({ date })} placeholder="YYYY-MM-DD" />
                  <ListText label="Sources (one per line)" field={`images.${view}.sources`} value={img.provenance?.sources} onChange={(sources) => setProv({ sources })} resetKey={`${entry.id}:${img.file}`} multiline />
                  <TextField label="Rights note" field={`images.${view}.rights`} value={img.provenance?.rights} onChange={(rights) => setProv({ rights })} />
                </details>
              )}
            </section>
          );
        })}
      </div>
    </fieldset>
  );
}
