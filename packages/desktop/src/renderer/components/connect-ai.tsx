import { useEffect, useState } from 'preact/hooks';
import type { AiClient, AiState, PictureCheck, PictureProvider } from '../../shared/api.ts';
import { Dialog } from './dialog.tsx';
import { Icon } from './icon.tsx';

type Notice = { tone: 'ok' | 'error'; text: string };

/**
 * Connect AI: puts Lore-Forge into AI apps (its MCP server, `lore mcp`), so an assistant asked for a story writes
 * the whole book here, and sets up the picture service it makes pictures with (the user's own key).
 */
export function ConnectAi({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<AiState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const note = (id: string, n: Notice | null) => setNotices((m) => { const next = { ...m }; if (n) next[id] = n; else delete next[id]; return next; });
  useEffect(() => void window.lore.aiState().then(setState), []);

  const toggle = async (c: AiClient) => {
    setBusy(c.id);
    note(c.id, null);
    try {
      const on = c.connected !== 'yes';
      const next = await window.lore.aiConnect(c.id, on);
      setState((s) => (s ? { ...s, clients: s.clients.map((x) => (x.id === c.id ? next : x)) } : s));
      note(c.id, { tone: 'ok', text: on ? `Connected. ${c.after}` : 'Removed from this app.' });
    } catch (e) {
      note(c.id, { tone: 'error', text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    } finally {
      setBusy(null);
    }
  };
  const copy = async (id: string, text: string) => {
    await window.lore.copyText(text);
    note(id, { tone: 'ok', text: 'Copied.' });
  };

  return (
    <Dialog title="Connect AI" onClose={onClose} class="connect-ai" footer={<button type="button" class="primary ai-done" onClick={onClose}>Done</button>}>
      <p class="ai-intro">
        <Icon name="magic-lamp" class="ai-intro-mark" />
        <span>Let an AI assistant write in Lore-Forge. Connect your AI app once, then ask it something like <q>Write me a story about camels in Lore-Forge</q>. It makes a new book on your shelf with characters, places, relationships, a timeline, the chapters and pictures, checks it for contradictions, and you can keep editing it here.</span>
      </p>
      {!state && <p class="muted" role="status">Looking for AI apps…</p>}
      {state && (
        <>
          <section class="settings-section" aria-labelledby="ai-apps">
            <h3 id="ai-apps" class="settings-heading">AI apps</h3>
            {state.unavailable && <p class="ai-notice is-error" role="alert">{state.unavailable}</p>}
            <ul class="ai-apps">
              {state.clients.map((c) => (
                <li key={c.id} class={`ai-app${c.connected === 'yes' ? ' is-connected' : ''}`}>
                  <span class="ai-app-name">{c.name}</span>
                  <span class="ai-app-status muted">
                    {c.connected === 'yes' ? <><Icon name="check-mark" /> Connected</> : c.connected === 'elsewhere' ? 'Connected to another copy of Lore-Forge' : c.installed ? 'Not connected' : 'Not found on this computer'}
                  </span>
                  {c.canConnect || c.connected === 'yes' ? (
                    <button type="button" class={c.connected === 'yes' ? 'ghost small ai-disconnect' : 'small ai-connect'} disabled={busy !== null} aria-label={`${c.connected === 'yes' ? 'Remove Lore-Forge from' : 'Connect Lore-Forge to'} ${c.name}`}
                      onClick={() => void toggle(c)}>
                      {busy === c.id ? 'Working…' : c.connected === 'yes' ? 'Remove' : c.connected === 'elsewhere' ? 'Connect this copy' : 'Connect'}
                    </button>
                  ) : c.command ? (
                    <button type="button" class="ghost small ai-copy-command" onClick={() => void copy(c.id, c.command!)} title={c.command}>Copy command</button>
                  ) : <span />}
                  {notices[c.id] && <p class={`ai-notice${notices[c.id]!.tone === 'error' ? ' is-error' : ''}`} role={notices[c.id]!.tone === 'error' ? 'alert' : 'status'}>{notices[c.id]!.text}{c.command && !c.canConnect && notices[c.id]!.tone === 'ok' ? ' Paste it into a terminal and press Enter.' : ''}</p>}
                </li>
              ))}
            </ul>
            {state.setup && (
              <p class="settings-help muted ai-other">
                Another app (Windsurf, VS Code, Gemini CLI, …)?{' '}
                <button type="button" class="link-button ai-copy-setup" onClick={() => void copy('setup', state.setup!)}>Copy the settings</button>{' '}
                and paste them into its MCP servers.
                {notices['setup'] && <span class="ai-copied" role="status"> {notices['setup'].text}</span>}
              </p>
            )}
          </section>
          <Pictures initial={state.pictures} onSaved={(pictures) => setState((s) => (s ? { ...s, pictures } : s))} />
        </>
      )}
    </Dialog>
  );
}

function Pictures({ initial, onSaved }: { initial: AiState['pictures']; onSaved: (p: AiState['pictures']) => void }) {
  const [pics, setPics] = useState(initial);
  const [provider, setProvider] = useState<PictureProvider | 'none'>(initial.provider);
  const [key, setKey] = useState('');
  const [result, setResult] = useState<Notice | null>(null);
  const [working, setWorking] = useState(false);
  const info = pics.providers.find((p) => p.id === provider);
  const savedKey = provider !== 'none' ? pics.keys[provider] : undefined;
  const dirty = provider !== pics.provider || key.trim() !== '';

  const save = async () => {
    setWorking(true);
    setResult(null);
    try {
      if (provider === 'none') {
        const next = await window.lore.aiSavePictures({ provider: 'none' });
        setPics(next);
        onSaved(next);
        setResult({ tone: 'ok', text: 'Saved. AI assistants will not make pictures; they still write visual descriptions.' });
        return;
      }
      const check: PictureCheck = await window.lore.aiCheckPictures(provider, key.trim() || undefined);
      if (!check.ok) {
        setResult({ tone: 'error', text: check.error });
        return;
      }
      const next = await window.lore.aiSavePictures({ provider, ...(key.trim() ? { key: key.trim() } : {}), model: check.model });
      setPics(next);
      onSaved(next);
      setKey('');
      setResult({ tone: 'ok', text: `Saved. Pictures will be made with ${info?.label} ${check.model}.` });
    } finally {
      setWorking(false);
    }
  };
  const forget = async () => {
    if (provider === 'none') return;
    const next = await window.lore.aiForgetKey(provider);
    setPics(next);
    onSaved(next);
    setProvider(next.provider);
    setResult({ tone: 'ok', text: 'The key was deleted from this computer.' });
  };

  return (
    <section class="settings-section ai-pictures" aria-labelledby="ai-pictures">
      <h3 id="ai-pictures" class="settings-heading">Pictures</h3>
      <p class="settings-help muted">
        AI assistants can make a picture for every character, place, item and event, and the book cover, with an image service you choose.
        It uses your own API key and account: each picture usually costs a few cents. The key stays on this computer.
      </p>
      <div class="settings-row">
        <span class="settings-label" id="ai-service-label">Service</span>
        <div class="status-pills ai-services" role="radiogroup" aria-labelledby="ai-service-label" onKeyDown={(e) => {
          // Arrow keys move the choice, as in any radio group.
          const ids: (PictureProvider | 'none')[] = ['none', ...pics.providers.map((p) => p.id)];
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const next = ids[(ids.indexOf(provider) + step + ids.length) % ids.length]!;
          setProvider(next);
          setKey('');
          setResult(null);
          requestAnimationFrame(() => (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
        }}>
          {([{ id: 'none', label: 'None' }, ...pics.providers] as { id: PictureProvider | 'none'; label: string }[]).map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={provider === p.id} tabIndex={provider === p.id ? 0 : -1} class={`pill ai-service-${p.id}`}
              onClick={() => { setProvider(p.id); setKey(''); setResult(null); }}>{p.label}</button>
          ))}
        </div>
      </div>
      {provider !== 'none' && info && (
        <>
          <div class="settings-row">
            <label class="settings-label" for="ai-key">API key</label>
            <div class="ai-key-row">
              <input id="ai-key" class="ai-key" type="password" autoComplete="off" spellcheck={false} value={key} onInput={(e) => setKey(e.currentTarget.value)}
                placeholder={savedKey ? `Saved key ${savedKey}; paste a new one to replace it` : `Paste your ${info.label} API key`} aria-describedby="ai-key-help" />
              <a class="ghost small ai-get-key button-link" href={info.keyPage} target="_blank" rel="noreferrer">Get a key <Icon name="plain-arrow" class="point-right" /></a>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label" aria-hidden="true" />
            <p id="ai-key-help" class="muted settings-help">
              {pics.models[provider] ? `Model: ${pics.models[provider]}, the newest your key could use when it was checked. Check and save looks for a newer one.` : 'The newest image model your key can use is found automatically.'}
              {savedKey && <> <button type="button" class="link-button ai-forget" onClick={() => void forget()}>Delete the saved key</button></>}
            </p>
          </div>
        </>
      )}
      <div class="ai-pictures-actions">
        {result && <p class={`ai-notice${result.tone === 'error' ? ' is-error' : ''}`} role={result.tone === 'error' ? 'alert' : 'status'}>{result.text}</p>}
        <button type="button" class="primary small ai-save-pictures" disabled={working || (!dirty && !(provider !== 'none' && savedKey))} onClick={() => void save()}>
          {working ? 'Checking…' : provider === 'none' ? 'Save' : 'Check and save'}
        </button>
      </div>
    </section>
  );
}
