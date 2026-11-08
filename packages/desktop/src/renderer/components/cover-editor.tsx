import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { bundledFont, COVER_EMBLEM, COVER_EMBLEMS, COVER_SAFE, coverArt, coverImageFile, coverPosition, coverSeed, TITLE_STYLE_LABELS, type CoverPosition, type IconName, type World, type WorldCoverSettings } from '@lore-forge/core';
import { lower, t } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { useEdgeColour, useImage, WorldCover } from './cover.tsx';
import { FontPicker, RecentPictures, useFontAvailable } from './cover-options.tsx';
import { ColorField, THEME_SWATCHES } from './color.tsx';
import { ICON_CHOICES } from './picture.tsx';
import { IconPicker } from './icon-picker.tsx';
import { ConfirmDialog, trapTab } from './confirm.tsx';

export const EMBLEM_CHOICES: IconName[] = [...new Set<IconName>([...COVER_EMBLEMS, ...ICON_CHOICES])];
const COVER_SWATCHES = ['#7a2e2e', '#8a5a1c', '#2f5d3a', '#1f4f6b', '#3b3478', '#5c2a5e', '#2b2f3a', '#6b4a2b', '#14161b', '#3a2a1e', ...THEME_SWATCHES.slice(0, 6)];

/** Where the sliders start when no place is chosen: the emblem's default spot, and the title near the bottom. */
export const DEFAULT_POS: Record<'titlePos' | 'emblemPos', CoverPosition> = {
  emblemPos: { x: 50, y: Math.round(((COVER_EMBLEM.y - COVER_SAFE.top) / (COVER_SAFE.bottom - COVER_SAFE.top - COVER_EMBLEM.size)) * 1000) / 10 },
  titlePos: { x: 50, y: 85 },
};

/**
 * X and Y for the title or the emblem: a slider and a number for each (0 to 100 of the room inside the frame, so
 * every value stays inside the border), and Reset position back to the default place.
 */
function PositionField({ label, which, value, onChange }: { label: string; which: 'title' | 'emblem'; value: CoverPosition | undefined; onChange: (p: CoverPosition | undefined) => void }) {
  const at = value ?? DEFAULT_POS[which === 'title' ? 'titlePos' : 'emblemPos'];
  const put = (axis: 'x' | 'y', raw: number) => { if (Number.isFinite(raw)) onChange(coverPosition({ ...at, [axis]: raw })); };
  return (
    <div class={`cover-position position-${which}`} role="group" aria-label={t('{label} position', { label })}>
      {(['x', 'y'] as const).map((axis) => (
        <label key={axis} class="position-axis">
          <span class="position-name">{axis === 'x' ? 'X' : 'Y'}<span class="sr-only"> {t('{label} position', { label: lower(label) })}</span></span>
          <input type="range" class={`position-range position-${axis}`} min={0} max={100} step={1} value={at[axis]} aria-label={axis === 'x' ? t('{label} X (left to right)', { label }) : t('{label} Y (top to bottom)', { label })} onInput={(e) => put(axis, e.currentTarget.valueAsNumber)} />
          <input type="number" class={`position-number position-${axis}-number`} min={0} max={100} step={1} value={at[axis]} aria-label={t('{label} {axis} in percent', { label, axis: axis.toUpperCase() })}
            // Typing moves it live while the number is in range; leaving the field clamps anything else to 0–100.
            onInput={(e) => { const v = e.currentTarget.valueAsNumber; if (v >= 0 && v <= 100) put(axis, v); }}
            onBlur={(e) => { const v = e.currentTarget.valueAsNumber; if (Number.isFinite(v)) put(axis, v); else e.currentTarget.value = String(at[axis]); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
        </label>
      ))}
      <button type="button" class="ghost small position-reset" disabled={!value} onClick={() => onChange(undefined)}><Icon name="cycle" /> {t('Reset position')}</button>
    </div>
  );
}

/** Cover settings in a fixed key order, to tell whether a draft differs from what is saved. */
const same = (a: WorldCoverSettings, b: WorldCoverSettings) => {
  const key = (c: WorldCoverSettings) => JSON.stringify(Object.entries(c).filter(([, v]) => v !== undefined && v !== '').sort(([x], [y]) => x.localeCompare(y)));
  return key(a) === key(b);
};

/**
 * Change a world's book cover: background colour or gradient, emblem and its colour, an uploaded picture, the title
 * font and the spine. Everything is a draft shown live in the preview until Save writes it to world.json "cover";
 * the shelf, the small cover in the top bar, Home and the PDFs all use it. Cancel drops the draft; Escape or a click
 * outside asks first when there are unsaved changes.
 */
export function CoverEditor({ dir, world, onSave, onClose }: { dir: string; world: World; onSave: (cover: WorldCoverSettings, picked?: string) => Promise<void>; onClose: () => void }) {
  const saved = world.manifest.cover ?? {};
  const [draft, setDraft] = useState<WorldCoverSettings>(saved);
  const [picked, setPicked] = useState<{ path: string; src: string | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLElement>(null);
  const dirty = !!picked || !same(draft, saved);
  // Escape, a click outside: close at once when nothing changed, else ask whether to drop the changes.
  const leave = useRef(() => {});
  leave.current = () => (dirty ? setAsking(true) : onClose());
  const askingNow = useRef(false);
  askingNow.current = asking;
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !askingNow.current) leave.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const fallback = coverImageFile(world.entries);
  // A freshly picked picture shows from its preview until it is saved into the world folder.
  const settings = picked ? { ...draft, image: 'picked' } : draft;
  const seed = coverSeed({ id: world.manifest.id, cover: settings });
  const stored = useImage(dir, picked ? undefined : coverArt(seed, settings, fallback).image);
  const image = picked ? picked.src : stored;
  // The spine follows the picture's left edge unless a spine colour is chosen.
  const art = coverArt(seed, settings, fallback, useEdgeColour(image));
  const fontOk = useFontAvailable(draft.font);
  const set = (patch: Partial<WorldCoverSettings>) => setDraft((d) => Object.fromEntries(Object.entries({ ...d, ...patch }).filter(([, v]) => v !== undefined && v !== '')) as WorldCoverSettings);
  const plain = !!draft.color && draft.color2 === draft.color;
  const [uploads, setUploads] = useState(0);
  const upload = async () => {
    const p = await window.lore.pickImageFile();
    if (p) {
      setPicked({ path: p, src: await window.lore.readPickedImage(p) });
      setUploads((n) => n + 1);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await onSave(picked ? { ...draft, image: undefined } : draft, picked?.path);
      onClose();
    } catch (e) {
      setProblem((e as Error).message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''));
      setBusy(false);
    }
  };
  // Drag the title or the emblem on the preview: the pointer's move over the room left inside the frame (the
  // room minus the element's own size) is the change in percent, so the element follows the pointer and stops at
  // the border.
  const drag = useRef<{ key: 'titlePos' | 'emblemPos'; start: CoverPosition; px: number; py: number; roomW: number; roomH: number } | null>(null);
  const grab = (e: PointerEvent) => {
    const t = e.target as Element;
    const el = t.closest('.cover-emblem, .cover-title');
    const cover = (e.currentTarget as HTMLElement).querySelector('.world-cover');
    if (!el || !cover || e.button !== 0) return;
    const key = el.classList.contains('cover-title') ? 'titlePos' : 'emblemPos';
    const c = cover.getBoundingClientRect(), b = el.getBoundingClientRect();
    const roomW = c.width * (1 - (2 * COVER_SAFE.left) / 240) - b.width, roomH = c.height * (1 - (2 * COVER_SAFE.top) / 320) - b.height;
    drag.current = { key, start: draft[key] ?? DEFAULT_POS[key], px: e.clientX, py: e.clientY, roomW, roomH };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const x = d.roomW > 0 ? d.start.x + ((e.clientX - d.px) / d.roomW) * 100 : d.start.x;
    const y = d.roomH > 0 ? d.start.y + ((e.clientY - d.py) / d.roomH) * 100 : d.start.y;
    set({ [d.key]: coverPosition({ x: Math.round(x), y: Math.round(y) }) });
  };
  const drop = () => { drag.current = null; };
  const pictureMode = picked ? 'upload' : draft.image === 'none' ? 'none' : draft.image ? 'upload' : 'world';
  // In <body>, like every other modal: inside the world's page a panel beside it could paint over its buttons.
  return createPortal(
    <div class="modal-backdrop cover-editor-backdrop" onMouseDown={(e) => e.target === e.currentTarget && leave.current()}>
      <section ref={box} class="about cover-editor" role="dialog" aria-modal="true" aria-labelledby="cover-editor-title" onKeyDown={(e) => trapTab(box.current, e)}>
        {/* Three parts: the title and the buttons stay put, only the body between them scrolls. */}
        <header class="cover-editor-head">
          <h2 id="cover-editor-title">{t('Book cover')}</h2>
          <p class="muted">{t('How {name} looks on the shelf, on Home and on the PDF covers.', { name: world.manifest.name })}</p>
        </header>
        <div class="cover-editor-body">
          <div class="cover-editor-preview" onPointerDown={grab} onPointerMove={move} onPointerUp={drop} onPointerCancel={drop}>
            <span class="world-cover" aria-hidden="true"><WorldCover art={art} image={image} title={world.manifest.name} /></span>
            <p class="muted font-note">{t('Drag the title or the emblem to move it.')}</p>
          </div>
          <div class="cover-editor-fields">
            <fieldset class="field cover-group">
              <legend class="field-label">{t('Background')}</legend>
              <div class="segmented" role="group" aria-label={t('Background style')}>
                <button ref={first} type="button" aria-pressed={!plain} onClick={() => plain && set({ color2: undefined })}>{t('Gradient')}</button>
                <button type="button" aria-pressed={plain} onClick={() => set({ color: draft.color ?? art.top, color2: draft.color ?? art.top })}>{t('Plain colour')}</button>
              </div>
              <div class="cover-colours">
                <ColorField label={plain ? t('Colour') : t('Top colour')} value={draft.color ?? art.top} swatches={COVER_SWATCHES} onChange={(c) => set(plain ? { color: c, color2: c } : { color: c })} />
                {!plain && <ColorField label={t('Bottom colour')} value={draft.color2 ?? art.bottom} swatches={COVER_SWATCHES} onChange={(c) => set({ color2: c, color: draft.color ?? art.top })} />}
              </div>
            </fieldset>
            <fieldset class="field cover-group">
              <legend class="field-label">{t('Picture')}</legend>
              <div class="row-actions">
                <button type="button" class="ghost small" onClick={() => void upload()}><Icon name="cloud-upload" /> {t('Upload picture…')}</button>
                <button type="button" class="ghost small" aria-pressed={pictureMode === 'world'} disabled={!fallback} onClick={() => { setPicked(null); set({ image: undefined }); }}>{t('From the world')}</button>
                <button type="button" class="ghost small" aria-pressed={pictureMode === 'none'} onClick={() => { setPicked(null); set({ image: 'none' }); }}>{t('No picture')}</button>
              </div>
              <RecentPictures dir={dir} current={picked?.path ?? draft.image} refresh={uploads}
                onPick={(p) => (p.kind === 'world' ? (setPicked(null), set({ image: p.path })) : void window.lore.readPickedImage(p.path).then((src) => setPicked({ path: p.path, src })))} />
              <p class="muted font-note">{t("No picture only hides it: the file stays in the world's images folder and comes back from the list above.")}</p>
            </fieldset>
            <fieldset class="field cover-group">
              <legend class="field-label">{t('Emblem')}</legend>
              <IconPicker label={t('Emblem')} class="cover-emblems" choices={EMBLEM_CHOICES} value={art.icon} none={t('No emblem')} onPick={(name) => set({ icon: name ?? 'none' })} />
              <ColorField label={t('Emblem colour')} value={art.iconColor} onChange={(c) => set({ iconColor: c })} />
              <label class="check"><input type="checkbox" class="show-emblem" checked={art.showEmblem} onChange={(e) => set({ showEmblem: e.currentTarget.checked ? undefined : false })} /> {t('Show emblem on cover')}</label>
              <PositionField label={t('Emblem')} which="emblem" value={draft.emblemPos} onChange={(p) => set({ emblemPos: p })} />
            </fieldset>
            <fieldset class="field cover-group">
              <legend class="field-label">{t('Title')}</legend>
              <FontPicker value={draft.font} styleLabel={t(TITLE_STYLE_LABELS[art.titleStyle])} onChange={(f) => set(f ? { font: f } : { font: undefined, titleStyle: undefined })} />
              <ColorField label={t('Title colour')} value={art.titleColor} onChange={(c) => set({ titleColor: c })} />
              {draft.font && fontOk === false && <p class="muted font-note" role="status"><Icon name="info" /> {t('“{font}” is not installed on this computer, so covers use the {style} lettering. The choice is kept for computers that have it.', { font: draft.font, style: t(TITLE_STYLE_LABELS[art.titleStyle]) })}</p>}
              {draft.font && fontOk && !bundledFont(draft.font) && <p class="muted font-note">{t('A system font: the PDF embeds it when it is a TrueType or OpenType file, else it uses DejaVu.')}</p>}
              <label class="check"><input type="checkbox" class="show-title" checked={art.showTitle} onChange={(e) => set({ showTitle: e.currentTarget.checked ? undefined : false })} /> {t('Show title on cover')}</label>
              <PositionField label={t('Title')} which="title" value={draft.titlePos} onChange={(p) => set({ titlePos: p })} />
              <p class="muted font-note">{t('The title always stays on the spine.')}</p>
            </fieldset>
            <fieldset class="field cover-group">
              <legend class="field-label">{t('Spine')}</legend>
              <div class="spine-fields">
                <span class="spine-sample" aria-hidden="true" style={{ background: art.spine, color: art.spineInk }}><span>{world.manifest.name}</span></span>
                <ColorField label={t('Spine colour')} value={art.spine} alpha={false} swatches={COVER_SWATCHES} onChange={(c) => set({ spineColor: c })} />
                <ColorField label={t('Spine title colour')} value={art.spineInk} alpha={false} onChange={(c) => set({ spineInk: c })} />
                {(draft.spineColor || draft.spineInk) && <button type="button" class="ghost small spine-auto" onClick={() => set({ spineColor: undefined, spineInk: undefined })}><Icon name="cycle" /> {t('Automatic')}</button>}
              </div>
              <p class="muted font-note">{draft.spineColor ? t('Chosen spine colour.') : image ? t('Automatic: the colour down the left edge of the picture.') : t('Automatic: a darker shade of the cover colour.')}{draft.spineInk ? '' : ` ${t('The title colour is picked to stay readable.')}`}</p>
            </fieldset>
            {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
          </div>
        </div>
        <div class="dialog-actions cover-editor-actions">
          <button type="button" class="ghost" onClick={() => { setPicked(null); setDraft(saved.seed ? { seed: saved.seed } : {}); }}><Icon name="cycle" /> {t('Reset to default')}</button>
          <span class={`cover-status${dirty ? ' is-dirty' : ''}`} role="status">{dirty ? t('Unsaved changes') : t('No changes')}</span>
          <button type="button" class="ghost cover-cancel" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" class="primary cover-save" disabled={!dirty || busy} onClick={() => void save()}><Icon name="check-mark" /> {t('Save cover')}</button>
        </div>
      </section>
      {asking && (
        <ConfirmDialog title={t('Discard cover changes?')} confirmLabel={t('Discard changes')} confirmIcon="cycle" cancelLabel={t('Keep editing')} onClose={() => setAsking(false)} onConfirm={onClose}>
          <p>{t('The cover has changes that are not saved. Discard them, or keep editing and press Save cover.')}</p>
        </ConfirmDialog>
      )}
    </div>,
    document.body,
  );
}
