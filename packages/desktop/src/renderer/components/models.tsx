import { useEffect, useRef, useState } from 'preact/hooks';
import type { Entry } from '@lore-forge/core';
import type { ModelFile } from '@lore-forge/core/node';
import type { LoreViewerApi, ViewerHandle } from '../viewer/viewer.ts';
import { t, tj } from '../i18n.tsx';
import { ConfirmDialog } from './confirm.tsx';
import { Icon } from './icon.tsx';

/** Above this a model still loads, with a warning that it may be slow. */
const LARGE_BYTES = 25 * 1024 * 1024;

const size = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const extOf = (file: string): string => file.slice(file.lastIndexOf('.')).toLowerCase();
const message = (e: unknown): string => ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '\w+': (Error: )?/, '');

/** three.js is bundled apart (viewer.js) and loaded the first time a model is shown. */
let viewer: Promise<LoreViewerApi> | null = null;
function loadViewer(): Promise<LoreViewerApi> {
  viewer ??= new Promise<LoreViewerApi>((ok, fail) => {
    const s = document.createElement('script');
    s.src = './viewer.js';
    s.onload = () => ok((window as unknown as { LoreViewer: LoreViewerApi }).LoreViewer);
    s.onerror = () => {
      viewer = null;
      fail(new Error(t('The 3D viewer could not be loaded.')));
    };
    document.head.appendChild(s);
  });
  return viewer;
}

/** Models turn by themselves when they open, unless the system asks for reduced motion. */
const spinsAtStart = (): boolean => !matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Smoke test: the live viewer of each mounted model view. */
export const viewers = new WeakMap<Element, ViewerHandle>();

function ModelViewer({ dir, model }: { dir: string; model: ModelFile }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<ViewerHandle | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [problem, setProblem] = useState('');
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    let live = true;
    setState('loading');
    const spinning = spinsAtStart();
    setSpin(spinning);
    void Promise.all([loadViewer(), window.lore.readModel(dir, model.file)])
      .then(async ([api, bytes]) => {
        if (!live || !host.current) return;
        const h = await api.mount(host.current, bytes, extOf(model.file));
        if (!live) return h.dispose();
        h.setAutoRotate(spinning);
        handle.current = h;
        viewers.set(host.current, h);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (!live) return;
        const text = message(e);
        setProblem(/WebGL/.test(text) ? t('this computer’s graphics driver does not offer 3D graphics (WebGL) to Lore-Forge.') : text);
        setState('error');
      });
    return () => {
      live = false;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [dir, model.file]);
  const toggle = () => {
    handle.current?.setAutoRotate(!spin);
    setSpin(!spin);
  };
  return (
    <div class={`model-stage is-${state}`}>
      <div ref={host} class="model-viewer" aria-label={t('3D view of {name}', { name: model.name })} role="img" />
      {state === 'loading' && <p class="model-status" role="status"><Icon name="cube" class="model-spinner" /> {t('Loading the model…')}</p>}
      {state === 'error' && (
        <p class="model-status model-error" role="alert"><Icon name="hazard-sign" /> {t('Could not show this model: {problem}', { problem })}<br /><span class="muted">{t('glTF (.glb or embedded .gltf) works best; OBJ and FBX load without some materials.')}</span></p>
      )}
      {state === 'ready' && (
        <div class="model-tools">
          <button type="button" class="ghost small" onClick={() => handle.current?.reset()} title={t('Back to the starting view')}><Icon name="return-arrow" /> {t('Reset view')}</button>
          <button type="button" class="ghost small" aria-pressed={spin} onClick={toggle} title={t('Turn the model slowly')}><Icon name="clockwise-rotation" /> {t('Auto-rotate')}</button>
          <span class="muted model-hint">{t('Drag to turn · scroll to zoom · right-drag to pan')}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The 3D model tab of an entry: models are files in models/<entry-id>/ (glTF, OBJ or FBX), several per entry, picked
 * from a row of chips. Nothing about them goes into the entry's Markdown, so worlds without models are unchanged.
 */
export function ModelPanel({ dir, entry, look }: { dir: string; entry: Entry; look?: string }) {
  const [models, setModels] = useState<ModelFile[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<ModelFile | null>(null);
  /** Where the last copy went (Download…), with a way to show it. */
  const [saved, setSaved] = useState<string | null>(null);
  const refresh = async (pick?: string | null) => {
    const list = await window.lore.listModels(dir, entry.id, look);
    setModels(list);
    setCurrent((cur) => (pick && list.some((m) => m.file === pick) ? pick : cur && list.some((m) => m.file === cur) ? cur : (list[0]?.file ?? null)));
  };
  useEffect(() => {
    setCurrent(null);
    setRenaming(null);
    setSaved(null);
    void refresh().catch((e: unknown) => setProblem(message(e)));
  }, [dir, entry.id, look]);
  const run = async (task: () => Promise<string | null | void>) => {
    setProblem(null);
    try {
      const file = await task();
      await refresh(typeof file === 'string' ? file : undefined);
    } catch (e) {
      setProblem(message(e));
    }
  };
  const model = models?.find((m) => m.file === current);
  return (
    <section class="models" aria-label={t('3D models')}>
      <div class="models-bar">
        <ul class="model-picker" aria-label={t('Models of this entry')}>
          {models?.map((m) => (
            <li key={m.file}>
              {renaming === m.file ? (
                <form class="model-rename" onSubmit={(e) => { e.preventDefault(); const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value; setRenaming(null); void run(() => window.lore.renameModel(dir, m.file, name)); }}>
                  <input name="name" type="text" defaultValue={m.name} aria-label={t('Model name')} ref={(el) => el?.focus()} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setRenaming(null))} />
                  <button type="submit" class="ghost small">{t('Save')}</button>
                </form>
              ) : (
                <button type="button" class="model-chip" aria-pressed={m.file === current} onClick={() => setCurrent(m.file)} title={m.file}>
                  <Icon name="cube" /> <span class="model-chip-name">{m.name}</span> <span class="muted">{extOf(m.file).slice(1).toUpperCase()} · {size(m.bytes)}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
        <div class="row-actions">
          <button type="button" class="ghost small model-add" onClick={() => void run(() => window.lore.importModel(dir, entry.id, look))}><Icon name="cloud-upload" /> {t('Add model…')}</button>
          {model && <button type="button" class="ghost small model-download" title={t('Save a copy of this model anywhere, to use it in other programs')} onClick={() => { setProblem(null); void window.lore.saveCopy(dir, model.file).then((to) => to && setSaved(to), (e: unknown) => setProblem(message(e))); }}><Icon name="cloud-download" /> {t('Download…')}</button>}
          {model && <button type="button" class="ghost small" onClick={() => setRenaming(model.file)}><Icon name="pencil" /> {t('Rename')}</button>}
          {model && <button type="button" class="ghost small danger" onClick={() => setDoomed(model)}><Icon name="trash-can" /> {t('Delete')}</button>}
        </div>
      </div>
      <p class="muted models-help">{tj('.glb, embedded .gltf, .obj or .fbx · copied into {path}', { path: <code>models/{entry.id}/{look ? `${look}/` : ''}</code> })}</p>
      {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
      {saved && <p class="muted saved-copy" role="status"><Icon name="check-mark" /> {t('Saved a copy: {path}', { path: saved })} <button type="button" class="link-button" onClick={() => void window.lore.showInFolder(saved)}>{t('Show in folder')}</button></p>}
      {model && model.bytes > LARGE_BYTES && <p class="model-warning" role="note"><Icon name="hazard-sign" /> {t('Large model ({size}): it may take a while to load and turn slowly.', { size: size(model.bytes) })}</p>}
      {models && !models.length && (
        <button type="button" class="models-empty" onClick={() => void run(() => window.lore.importModel(dir, entry.id, look))}>
          <Icon name="cube" class="models-empty-mark" />
          <span>{t('No 3D model yet. Add a .glb, .gltf, .obj or .fbx file to turn it around here.')}</span>
        </button>
      )}
      {model && <ModelViewer key={model.file} dir={dir} model={model} />}
      {doomed && (
        <ConfirmDialog title={t('Delete “{name}”?', { name: doomed.name })} confirmLabel={t('Delete model')} onClose={() => setDoomed(null)} onConfirm={() => run(() => window.lore.deleteModel(dir, doomed.file)).then(() => setDoomed(null))}
          subject={<div class="confirm-world"><span class="confirm-chapter" aria-hidden="true"><Icon name="cube" /></span><div><strong class="confirm-name">{doomed.name}</strong><span class="muted">{doomed.file} · {size(doomed.bytes)}</span></div></div>}>
          <p>{t('Deletes this model file from the world folder.')}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
