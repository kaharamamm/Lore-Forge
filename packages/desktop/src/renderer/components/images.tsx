import { useEffect, useState } from 'preact/hooks';
import { IMAGE_VIEWS, viewLabel, type Entry, type Provenance, type RefImage } from '@lore-forge/core';
import { ListText, TextField } from './fields.tsx';

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

const HELP: Partial<Record<Entry['type'], string>> = {
  character: 'For turnaround sheets and 3D tools (Tripo3D, Meshy).',
  item: 'For prop sheets and 3D tools.',
  place: 'Establishing shots, maps and mood boards.',
  event: 'Scenes and battle maps; used as illustrations in the Story Book.',
};

/**
 * One slot per usual view for the entry's type, plus any other view already in the file.
 * Images are copied into the world folder; provenance is stored in the entry.
 */
export function ImageSlots({ dir, entry, onChange }: { dir: string; entry: Entry; onChange: (images: RefImage[] | undefined) => void }) {
  const images = entry.images ?? [];
  const usual = IMAGE_VIEWS[entry.type];
  const views = [...usual, ...images.map((i) => i.view).filter((v, i, all) => !usual.includes(v) && all.indexOf(v) === i)];
  const put = (view: string, img: RefImage | undefined): void => {
    const rest = images.filter((i) => i.view !== view);
    const next = img ? [...rest, img].sort((a, b) => views.indexOf(a.view) - views.indexOf(b.view)) : rest;
    onChange(next.length ? next : undefined);
  };
  const attach = async (view: string): Promise<void> => {
    const file = await window.lore.importImage(dir, entry.id, view);
    if (file) put(view, { file, view, provenance: { ...images.find((i) => i.view === view)?.provenance, date: new Date().toISOString().slice(0, 10) } });
  };
  return (
    <fieldset class="list-editor" data-field="images">
      <legend>Reference images</legend>
      <p class="muted">{HELP[entry.type] ?? ''} Files are copied into <code>images/{entry.id}/</code> inside the world.</p>
      <div class="image-grid">
        {views.map((view) => {
          const index = images.findIndex((i) => i.view === view);
          const img = images[index];
          const label = viewLabel(view);
          const setProv = (p: Partial<Provenance>): void => {
            if (!img) return;
            const provenance = Object.fromEntries(Object.entries({ ...img.provenance, ...p }).filter(([, v]) => v !== undefined)) as Provenance;
            put(view, { ...img, provenance });
          };
          return (
            <section class={`image-slot${img ? '' : ' image-slot-empty'}`} key={view} aria-label={`${label} view`} data-field={img ? `images[${index}]` : undefined}>
              <h4>{label}{usual.includes(view) ? '' : ' (unusual view)'}</h4>
              {img ? <Thumb dir={dir} file={img.file} alt={`${entry.name}, ${label}`} /> : <div class="thumb thumb-empty">No image</div>}
              <div class="row">
                <button type="button" class="ghost small" onClick={() => void attach(view)}>{img ? 'Replace…' : 'Attach image…'}</button>
                {img && <button type="button" class="ghost small danger" onClick={() => put(view, undefined)}>Remove</button>}
              </div>
              {img && (
                <details class="provenance">
                  <summary>Provenance{img.provenance?.tool ? `: ${img.provenance.tool}` : ''}</summary>
                  <p class="muted file-path">{img.file}</p>
                  <TextField label="Tool" field={`images.${view}.tool`} value={img.provenance?.tool} onChange={(tool) => setProv({ tool })} placeholder="e.g. Grok Bot, Meshy, hand drawn" />
                  <TextField label="Prompt" field={`images.${view}.prompt`} value={img.provenance?.prompt} onChange={(prompt) => setProv({ prompt })} multiline />
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
