import { useEffect, useRef } from 'preact/hooks';
import { ENTRY_ICON_NAMES, TYPE_ICON, type Entry, type IconName, type Picture } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { entryEmblem, Portrait } from './cover.tsx';
import { ColorField } from './color.tsx';
import { IconPicker } from './icon-picker.tsx';

const BACKGROUNDS = ['#3a2a1e', '#4a2323', '#24402c', '#1f3a52', '#33285a', '#4a2448', '#2b2f3a', '#5a4a1e', '#14161b', '#e0bd6a'];
const ACCENTS = ['#e0bd6a', '#fbf3df', '#ffab91', '#8fd18f', '#82cfff', '#c9b3ff', '#ff8a8a', '#f6c667', '#14161b', '#ffffff'];
/** Icons offered for every type: the type icons first, then all the defaults the keyword tables use. */
export const ICON_CHOICES: IconName[] = [...new Set<IconName>([...Object.values(TYPE_ICON), ...ENTRY_ICON_NAMES])];

/**
 * Change how an entry looks on the Home page and everywhere else its portrait shows: icon, background
 * and icon colour, or an uploaded picture (kept as a "concept" reference image). Reset goes back to the default.
 */
export function PictureEditor({ dir, entry, onChange, onClose }: { dir: string; entry: Entry; onChange: (e: Entry) => void; onClose: () => void }) {
  const pic: Picture = entry.picture ?? {};
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const set = (patch: Partial<Picture>) => {
    const next = Object.fromEntries(Object.entries({ ...pic, ...patch }).filter(([, v]) => v)) as Picture;
    const { picture: _old, ...rest } = entry;
    onChange(Object.keys(next).length ? { ...rest, picture: next } : (rest as Entry));
  };
  const upload = async () => {
    const file = await window.lore.importImage(dir, entry.id, 'concept');
    if (!file) return;
    const images = (entry.images ?? []).filter((i) => i.view !== 'concept');
    const prev = entry.images?.find((i) => i.view === 'concept');
    const { picture: _old, ...rest } = entry;
    onChange({ ...rest, images: [...images, { file, view: 'concept', provenance: { ...prev?.provenance, date: new Date().toISOString().slice(0, 10) } }], picture: { ...pic, image: file } } as Entry);
  };
  const current = entryEmblem(entry);
  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section class={`about picture-editor t-${entry.type}`} role="dialog" aria-modal="true" aria-labelledby="picture-title">
        <div class="picture-head">
          <span class="picture-preview"><Portrait entry={entry} size="lg" /></span>
          <div>
            <h2 id="picture-title">Picture for {entry.name}</h2>
            <p class="muted">Pick an icon and colours, or upload your own picture. It shows on Home, in the sidebar and in the graphs.</p>
            <div class="row-actions">
              <button ref={first} type="button" class="ghost small" onClick={() => void upload()}><Icon name="cloud-upload" /> Upload image…</button>
              {pic.image && <button type="button" class="ghost small" onClick={() => set({ image: undefined, icon: current })}>Use the icon instead</button>}
              <button type="button" class="ghost small" disabled={!entry.picture} onClick={() => { const { picture: _p, ...rest } = entry; onChange(rest as Entry); }}><Icon name="cycle" /> Reset to default</button>
            </div>
          </div>
        </div>
        <h3>Icon</h3>
        <IconPicker label="Icon" choices={ICON_CHOICES} value={current} onPick={(name) => name && set({ icon: name })} />
        <div class="grid-2 picture-colours">
          <ColorField label="Background" value={pic.color ?? '#2b2f3a'} swatches={BACKGROUNDS} onChange={(c) => set({ color: c })} />
          <ColorField label="Icon colour" value={pic.accent ?? '#e0bd6a'} swatches={ACCENTS} onChange={(c) => set({ accent: c })} />
        </div>
        <div class="dialog-actions"><button type="button" class="primary" onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
}
