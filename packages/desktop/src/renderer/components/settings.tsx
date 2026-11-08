import { useEffect, useState } from 'preact/hooks';
import { autoZoom, fits, MODE_LABELS, RESOLUTIONS, resolutionIndex, SCALES, sizeLabel, WINDOW_MODES, type DisplaySettings, type DisplayState, type InterfaceScale, type WindowMode } from '../../shared/display.ts';
import { LANGUAGES, pct, switchLanguage, t, useLanguage, type Lang } from '../i18n.tsx';
import { Dialog } from './dialog.tsx';
import { Flag } from './flag.tsx';
import { Icon } from './icon.tsx';

/** One pill of a PillChoices row. A pill that cannot be chosen says why in `why` (its tooltip). */
interface PillChoice<T extends string> { value: T; label: preact.ComponentChildren; why?: string }

/**
 * A row of pills that is one radio group, like Connect AI's service picker: the chosen pill is the group's Tab stop,
 * and the arrow keys, Home and End move the choice over the pills that can be chosen (the others stay in view, greyed,
 * with their reason as a tooltip).
 */
function PillChoices<T extends string>({ labelId, choices, value, onPick, class: extra }: { labelId: string; choices: PillChoice<T>[]; value: T; onPick: (v: T) => void; class?: string }) {
  const open = choices.filter((c) => !c.why);
  const stop = choices.some((c) => c.value === value && !c.why) ? value : open[0]?.value;
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!open.length || (!step && e.key !== 'Home' && e.key !== 'End')) return;
    e.preventDefault();
    const at = open.findIndex((c) => c.value === value);
    const next = e.key === 'Home' ? open[0]! : e.key === 'End' ? open[open.length - 1]! : open[at < 0 ? (step > 0 ? 0 : open.length - 1) : (at + step + open.length) % open.length]!;
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
    if (next.value !== value) onPick(next.value);
  };
  return (
    <div class={`status-pills${extra ? ` ${extra}` : ''}`} role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown}>
      {choices.map((c) => (
        <button key={c.value} type="button" role="radio" class="pill" data-value={c.value} aria-checked={c.value === value} aria-disabled={c.why ? 'true' : undefined} title={c.why} tabIndex={c.value === stop ? 0 : -1}
          onClick={() => { if (!c.why && c.value !== value) onPick(c.value); }}>{c.label}</button>
      ))}
    </div>
  );
}

const sizeKey = (s: { width: number; height: number }) => `${s.width}x${s.height}`;
const scaleKey = (s: InterfaceScale) => (s === 'auto' ? 'auto' : String(s));
const percent = (zoom: number) => pct(Math.round(zoom * 100));

/** Set while the language changes: the views are drawn anew, and the new language's pill takes the focus back. */
let refocusLanguage = false;
/** Set while the language changes from Settings: the library is drawn anew too, and opens Settings again. */
let reopen = false;
/** The library asks this when it is drawn: true right after a language change made in Settings (once). */
export const reopenSettings = (): boolean => {
  const r = reopen;
  reopen = false;
  return r;
};

/**
 * Settings, Language: English or Turkish, each with its flag. Applies at once, everywhere (the views are drawn again
 * in the new language), and is saved in settings.json for the next start and for the main process's dialogs.
 */
function LanguageSection() {
  const lang = useLanguage();
  useEffect(() => {
    if (!refocusLanguage) return;
    refocusLanguage = false;
    document.querySelector<HTMLElement>('.language-choice [aria-checked="true"]')?.focus();
  }, []);
  const pick = (l: Lang) => {
    refocusLanguage = true;
    reopen = true;
    void window.lore.saveSettings({ language: l });
    switchLanguage(l);
  };
  return (
    <section class="settings-section language-settings" aria-labelledby="settings-language">
      <h3 id="settings-language" class="settings-heading">{t('Language')}</h3>
      <div class="settings-row is-pills">
        <span class="settings-label" id="language-label">{t('App language')}</span>
        <PillChoices<Lang> labelId="language-label" class="language-choice" value={lang} onPick={pick}
          choices={LANGUAGES.map((l) => ({ value: l.code, label: <><Flag lang={l.code} /><span lang={l.code}>{l.name}</span></> }))} />
      </div>
    </section>
  );
}

/**
 * Settings, Display: the window (in a window, maximized or full screen), its page size in a window, and the
 * interface scale. Unlike the library part of the dialog these apply at once (main/display.ts saves them), and follow
 * the window when it changes some other way (F11, its title bar, a drag). Shows nothing without display settings
 * (the smoke test).
 */
function DisplaySection() {
  const [d, setD] = useState<DisplayState | null>(null);
  useEffect(() => {
    let live = true;
    void window.lore.displayState().then((s) => { if (live) setD(s); });
    const stop = window.lore.onDisplayChanged((s) => { if (live) setD(s); });
    return () => { live = false; stop(); };
  }, []);
  if (!d) return null;
  const s = d.settings;
  // The pill shows the choice at once; the window's answer follows.
  const set = (patch: Partial<DisplaySettings>) => {
    setD((x) => x && { ...x, settings: { ...x.settings, ...patch } });
    void window.lore.setDisplay(patch).then((next) => { if (next) setD(next); });
  };
  // A size a pixel or two off a listed one (fractional Windows scaling) is that one.
  const listed = RESOLUTIONS[resolutionIndex(s)];
  const own = !listed;
  const tooBig = t('Larger than this screen: a window here shows at most {size}', { size: sizeLabel(d.room) });
  const sizes: PillChoice<string>[] = [
    ...RESOLUTIONS.map((r) => ({ value: sizeKey(r), label: sizeLabel(r), ...(fits(r, d.room) ? {} : { why: tooBig }) })),
    ...(own ? [{ value: sizeKey(s), label: <>{t('Custom')} <span class="pill-note">({sizeLabel(s)})</span></> }] : []),
  ];
  const scales: PillChoice<string>[] = [
    { value: 'auto', label: <>{t('Auto')} <span class="pill-note">{percent(autoZoom(d.page))}</span></> },
    ...SCALES.map((z) => ({ value: scaleKey(z), label: percent(z) })),
  ];
  return (
    <section class="settings-section display-settings" aria-labelledby="settings-display">
      <h3 id="settings-display" class="settings-heading">{t('Display')}</h3>
      <div class="settings-row is-pills">
        <span class="settings-label" id="display-mode-label">{t('Window')}</span>
        <PillChoices<WindowMode> labelId="display-mode-label" class="display-mode" value={s.mode} onPick={(mode) => set({ mode })}
          choices={WINDOW_MODES.map((m) => ({ value: m, label: t(MODE_LABELS[m]) }))} />
      </div>
      <div class="settings-row is-pills">
        <span class="settings-label" id="display-size-label">{t('Resolution')}</span>
        <PillChoices labelId="display-size-label" class="display-size" value={sizeKey(listed ?? s)} choices={sizes}
          onPick={(k) => { const [width = s.width, height = s.height] = k.split('x').map(Number); set({ mode: 'windowed', width, height }); }} />
      </div>
      <div class="settings-row is-pills">
        <span class="settings-label" id="display-scale-label">{t('Interface scale')}</span>
        <PillChoices labelId="display-scale-label" class="display-scale" value={scaleKey(s.scale)} choices={scales}
          onPick={(k) => set({ scale: k === 'auto' ? 'auto' : Number(k) })} />
      </div>
    </section>
  );
}

/**
 * Settings, from the library (the gear) and from inside a book (the top bar): the language and the display, which
 * apply at once, then where new worlds go (a folder field with Browse…) and whether the sample world is on the shelf.
 * Those two are a draft until Save, and Cancel, Escape or a click outside leave them as they were.
 */
export function AppSettings({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [s, setS] = useState<{ worldsDir: string; defaultWorldsDir: string; hideSample: boolean } | null>(null);
  const [dir, setDir] = useState('');
  const [showSample, setShowSample] = useState(true);
  const [busy, setBusy] = useState(false);
  // Drawn again after a language change (inside a book Settings stays open by itself): nothing to reopen any more.
  useEffect(() => void reopenSettings(), []);
  useEffect(() => void window.lore.settings().then((x) => {
    setS({ worldsDir: x.worldsDir, defaultWorldsDir: x.defaultWorldsDir, hideSample: !!x.hideSample });
    setDir(x.worldsDir);
    setShowSample(!x.hideSample);
  }), []);
  const dirty = !!s && (dir !== s.worldsDir || showSample === s.hideSample);
  const save = async () => {
    if (!s) return;
    setBusy(true);
    if (dirty) {
      await window.lore.saveSettings({ worldsDir: dir === s.defaultWorldsDir ? '' : dir, hideSample: !showSample });
      onSaved?.();
    }
    onClose();
  };
  return (
    <Dialog title={t('Settings')} onClose={onClose} class="library-settings"
      footer={<>
        <span class={`settings-status${dirty ? ' is-dirty' : ''}`} role="status">{dirty ? t('Unsaved changes') : ''}</span>
        <button type="button" class="ghost settings-cancel" onClick={onClose}>{t('Cancel')}</button>
        <button type="button" class="primary settings-save" disabled={!s || busy} onClick={() => void save()}><Icon name="check-mark" /> {t('Save')}</button>
      </>}>
      {s && (
        <>
          <LanguageSection />
          <DisplaySection />
          <section class="settings-section" aria-labelledby="settings-where">
            <h3 id="settings-where" class="settings-heading">{t('Where new worlds go')}</h3>
            <div class="settings-row">
              <label class="settings-label" for="worlds-dir">{t('Folder')}</label>
              <div class="folder-picker">
                <input id="worlds-dir" class="folder-input" type="text" readOnly value={dir} title={dir} aria-describedby="worlds-dir-help" />
                <button type="button" class="ghost folder-browse" onClick={() => void window.lore.chooseFolder(t('Default folder for new worlds'), dir).then((d) => { if (d) setDir(d); })}><Icon name="open-folder" /> {t('Browse…')}</button>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label" aria-hidden="true" />
              <p id="worlds-dir-help" class="muted settings-help">
                {t('New books and copies go here.')}{' '}
                {dir !== s.defaultWorldsDir
                  ? <button type="button" class="link-button folder-default" onClick={() => setDir(s.defaultWorldsDir)}>{t('Use the app\'s worlds folder')}</button>
                  : t('This is the app\'s own worlds folder.')}
              </p>
            </div>
          </section>
          <section class="settings-section" aria-labelledby="settings-sample">
            <h3 id="settings-sample" class="settings-heading">{t('Sample world')}</h3>
            <div class="settings-row">
              <span class="settings-label">Camelamamm</span>
              <label class="check"><input type="checkbox" class="show-sample" checked={showSample} onChange={(e) => setShowSample(e.currentTarget.checked)} /> {t('Show sample world on the shelf')}</label>
            </div>
            <div class="settings-row">
              <span class="settings-label" aria-hidden="true" />
              <p class="muted settings-help">{t('The sample comes with Lore-Forge and the tour uses it. Hiding it deletes nothing.')}</p>
            </div>
          </section>
        </>
      )}
    </Dialog>
  );
}
