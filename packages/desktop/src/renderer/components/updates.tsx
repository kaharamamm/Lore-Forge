import { useEffect, useState } from 'preact/hooks';
import { canCheck, canDownload, canInstall, releasePage, showToast, updateText, type UpdateState } from '../../shared/update-state.ts';
import { t, tj } from '../i18n.tsx';
import { Icon } from './icon.tsx';

/** The self-update state from the main process, kept live. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    void window.lore.updateState().then((s) => live && setState(s));
    window.lore.onUpdateState((s) => live && setState(s));
    return () => void (live = false);
  }, []);
  return state;
}

const WhatsNew = ({ state }: { state: UpdateState }) => (
  <a class="button-link ghost small" href={releasePage(state.latest)} target="_blank" rel="noreferrer">{t("What's new")}</a>
);

function UpdateActions({ state, onLater }: { state: UpdateState; onLater?: () => void }) {
  return (
    <>
      {canDownload(state) && <button type="button" class="primary small update-download" onClick={() => void window.lore.downloadUpdate()}><Icon name="cloud-download" /> {state.manual ? t('Download page') : t('Download')}</button>}
      {canInstall(state) && <button type="button" class="primary small update-install" onClick={() => void window.lore.installUpdate()}><Icon name="upgrade" /> {t('Restart to update')}</button>}
      {onLater && (canDownload(state) || canInstall(state)) && <button type="button" class="ghost small update-later" onClick={onLater}>{t('Later')}</button>}
      {state.latest && canDownload(state) && <WhatsNew state={state} />}
    </>
  );
}

/**
 * The small update popup, bottom left: "Lore-Forge X.Y.Z is available" (Download / Later / What's new), then the
 * download's progress, then "Restart to update". Later hides it until the next step or the next version.
 */
export function UpdateToast() {
  const state = useUpdateState();
  const [later, setLater] = useState<string | null>(null);
  if (!state || !showToast(state)) return null;
  const key = `${state.status}:${state.latest}`;
  if (later === key) return null;
  return (
    <aside class="update-toast" role="status" aria-live="polite">
      <Icon name="upgrade" class="update-mark" />
      <div class="update-body">
        <strong class="update-text">{updateText(state)}</strong>
        {state.status === 'downloading' && <span class="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? 0}><span style={{ width: `${state.percent ?? 0}%` }} /></span>}
        <div class="update-actions"><UpdateActions state={state} onLater={() => setLater(key)} /></div>
      </div>
    </aside>
  );
}

/** Updates in About: the version, Check now, the automatic check switch, and the release notes. */
export function UpdatesSection() {
  const state = useUpdateState();
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => void window.lore.settings().then((s) => setAuto(s.autoUpdate !== false)), []);
  const toggle = async (on: boolean) => {
    setAuto(on);
    await window.lore.saveSettings({ autoUpdate: on });
  };
  if (!state) return null;
  const line = updateText(state);
  return (
    <section class="updates" aria-labelledby="updates-title">
      <h3 id="updates-title">{t('Updates')}</h3>
      <p class="updates-version">{tj('You have Lore-Forge {version}.', { version: <strong>{state.version}</strong> })}{line && <> <span class={state.status === 'error' ? 'error-line' : 'muted'}>{line}</span></>}</p>
      {state.status === 'downloading' && <span class="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? 0}><span style={{ width: `${state.percent ?? 0}%` }} /></span>}
      <div class="row-actions">
        <button type="button" class="ghost small update-check" disabled={!canCheck(state)} onClick={() => void window.lore.checkForUpdates()}><Icon name="cycle" /> {t('Check now')}</button>
        <UpdateActions state={state} />
        <label class="update-auto">
          <input type="checkbox" checked={auto ?? true} disabled={state.status === 'off' || auto === null} onChange={(e) => void toggle(e.currentTarget.checked)} /> {t('Check automatically (at start and every few hours)')}
        </label>
      </div>
      {state.notes && (
        <details class="update-notes" open>
          <summary>{t("What's new in {version}", { version: state.latest ?? '' })}</summary>
          <p>{state.notes}</p>
        </details>
      )}
    </section>
  );
}
