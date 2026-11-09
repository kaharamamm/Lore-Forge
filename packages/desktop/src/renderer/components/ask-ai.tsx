/**
 * Ask AI, in the side panel: a conversation with Claude Code or Codex working on the open book. The app runs the
 * tool (main/ask.ts) on the user's own plan, with only Lore-Forge's tools; its replies and steps stream in here,
 * and each change to the book shows up in the rest of the window as it lands.
 */
import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { World } from '@lore-forge/core';
import type { AskAbout, AskAgent, AskAgentId, AskChat, AskItem, AskNote } from '../../shared/api.ts';
import { inline, type Inline } from '../../shared/changelog.ts';
import { localeOf } from '../../shared/i18n.ts';
import { mdBlocks } from '../../shared/markdown.ts';
import { describeFile } from '../describe.ts';
import { worldIndex } from '../hooks.ts';
import { language, t, tj } from '../i18n.tsx';
import { ConfirmDialog } from './confirm.tsx';
import { Icon } from './icon.tsx';

const AGENT_KEY = 'lore:ask-agent';
const NAMES: Record<AskAgentId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const message = (e: unknown): string => ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '\w+': (Error: )?/, '');
/** The same folder, however it is written (case and slashes on Windows). */
const sameDir = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() === b.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();

function storedAgent(): AskAgentId | null {
  try {
    const v = localStorage.getItem(AGENT_KEY);
    return v === 'claude-code' || v === 'codex' ? v : null;
  } catch {
    return null;
  }
}

/** Ready (signed in, new enough), unsure (it could not say), or not usable now. */
const stateOf = (a: AskAgent): 'ready' | 'unsure' | 'off' | 'missing' => (!a.installed ? 'missing' : a.outdated || a.signedIn === false ? 'off' : a.signedIn ? 'ready' : 'unsure');

/** A time a limit resets, in the app's language: a weekday and a clock time. */
const resetTime = (ms: number): string => new Date(ms).toLocaleString(localeOf(language()), { weekday: 'long', hour: '2-digit', minute: '2-digit' });

/** Inline Markdown, and *italics* between single asterisks (which `inline` leaves as they are). */
function Md({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? <Italics key={i} text={p} />
        : 'bold' in p ? <strong key={i}><Md parts={p.bold} /></strong>
        : 'code' in p ? <code key={i}>{p.code}</code>
        : /^https?:/.test(p.link) ? <a key={i} href={p.link} target="_blank" rel="noreferrer"><Md parts={p.text} /></a>
        : <Md key={i} parts={p.text} />))}
    </>
  );
}

function Italics({ text }: { text: string }) {
  const bits = text.split(/(\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)/g);
  return <>{bits.map((b, i) => (i % 2 ? <em key={i}>{b.slice(1, -1)}</em> : b))}</>;
}

/** A reply: paragraphs, headings, lists, quotes and code, as the AI wrote them. */
function Reply({ text }: { text: string }) {
  const blocks = useMemo(() => mdBlocks(text), [text]);
  return (
    <div class="ask-reply">
      {blocks.map((b, i) => {
        if (b.kind === 'ul' || b.kind === 'ol') {
          const items = b.items.map((it, j) => <li key={j}><Md parts={inline(it)} /></li>);
          return b.kind === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
        }
        if (b.kind === 'pre') return <pre key={i}>{b.text}</pre>;
        if (b.kind === 'h') return <p key={i} class="ask-reply-head"><strong><Md parts={inline(b.text)} /></strong></p>;
        if (b.kind === 'quote') return <blockquote key={i}><Md parts={inline(b.text)} /></blockquote>;
        return <p key={i}><Md parts={inline(b.text)} /></p>;
      })}
    </div>
  );
}

interface Links {
  world: World;
  onOpen: (id: string) => void;
  onOpenChapter: (title: string) => void;
}

/** An entry the AI named: a link to it once the book has it, else the name as written. */
function EntryRef({ name, links }: { name: string; links: Links }) {
  const e = name ? worldIndex(links.world).resolve(name) : undefined;
  return e ? <button type="button" class="link ask-ref" onClick={() => links.onOpen(e.id)}>{e.name}</button> : <>{name}</>;
}

/** A few names with links, then how many more. */
function EntryRefs({ names, links }: { names: string[]; links: Links }) {
  const shown = names.slice(0, 4);
  return (
    <>
      {shown.map((n, i) => <span key={i}>{i > 0 && ', '}<EntryRef name={n} links={links} /></span>)}
      {names.length > shown.length && <> {t('and {count} more', { count: names.length - shown.length })}</>}
    </>
  );
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** What a step did, in words, with links to what it touched. */
function stepText(it: Extract<AskItem, { kind: 'tool' }>, links: Links): ComponentChildren {
  const input = it.input ?? {};
  const entry = textOf(input['entry']);
  switch (it.tool) {
    case 'lore_forge_guide': return t('Read the Lore-Forge guide');
    case 'list_books': return t('Look at the books on the shelf');
    case 'get_book': return t('Read the book');
    case 'get_entry': return entry ? tj('Read {entry}', { entry: <EntryRef name={entry} links={links} /> }) : t('Read an entry');
    case 'save_entries': {
      const list = Array.isArray(input['entries']) ? (input['entries'] as Record<string, unknown>[]) : [];
      const names = list.map((e) => textOf(e?.['name']) || textOf(e?.['id'])).filter(Boolean);
      if (!names.length) return t('Save entries');
      if (names.length === 1) return tj('Save {entry}', { entry: <EntryRef name={names[0]!} links={links} /> });
      return tj('Save {count} entries: {names}', { count: names.length, names: <EntryRefs names={names} links={links} /> });
    }
    case 'delete_entry': return entry ? tj('Delete {entry}', { entry: <EntryRef name={entry} links={links} /> }) : t('Delete an entry');
    case 'link_entries': {
      const list = Array.isArray(input['links']) ? (input['links'] as Record<string, unknown>[]) : [];
      const one = list.length === 1 ? list[0]! : null;
      if (one && textOf(one['entry']) && textOf(one['target'])) {
        return tj('Link {entry} and {target}', { entry: <EntryRef name={textOf(one['entry'])} links={links} />, target: <EntryRef name={textOf(one['target'])} links={links} /> });
      }
      return list.length ? t('Link {count} relationships', { count: list.length }) : t('Link entries');
    }
    case 'write_chapter': {
      const title = textOf(input['title']);
      return title ? tj('Write the chapter “{title}”', { title: <button type="button" class="link ask-ref" onClick={() => links.onOpenChapter(title)}>{title}</button> }) : t('Write a chapter');
    }
    case 'read_story': return input['chapter'] !== undefined ? t('Read chapter {chapter}', { chapter: textOf(input['chapter']) }) : t('Read the story');
    case 'story_proposals': return t("Go through the story's proposals");
    case 'check_book': return t('Check the book for contradictions');
    case 'mark_intended': return t('Mark a warning as intended');
    case 'create_image':
      if (entry.toLowerCase() === 'cover') return t('Make the cover picture');
      return entry ? tj('Make a picture of {entry}', { entry: <EntryRef name={entry} links={links} /> }) : t('Make a picture');
    case 'add_image':
      if (entry.toLowerCase() === 'cover') return t('Add the cover picture');
      return entry ? tj('Add a picture to {entry}', { entry: <EntryRef name={entry} links={links} /> }) : t('Add a picture');
    case 'look_at': return textOf(input['date']) ? t('Look up how everyone looks on {date}', { date: textOf(input['date']) }) : t('Look up how everyone looks');
    case 'export_book': return t('Export the book');
    case 'create_book': return textOf(input['name']) ? t('Create the book “{name}”', { name: textOf(input['name']) }) : t('Create a book');
    case 'update_book': return t("Change the book's settings");
    case 'duplicate_book': return t('Make a copy of the book');
    default: return t('Use {tool}', { tool: it.tool });
  }
}

const STEP_ICONS = { running: 'cycle', done: 'check-mark', failed: 'cancel', stopped: 'hourglass' } as const;

function Steps({ steps, links }: { steps: Extract<AskItem, { kind: 'tool' }>[]; links: Links }) {
  return (
    <ul class="ask-steps">
      {steps.map((s) => (
        <li key={s.id} class={`ask-step is-${s.state}`}>
          <Icon name={STEP_ICONS[s.state]} />
          <span class="ask-step-text">{stepText(s, links)}{s.state === 'stopped' && <span class="muted"> ({t('stopped')})</span>}</span>
          {s.error && <span class="ask-step-error">{s.error.split('\n')[0]}</span>}
        </li>
      ))}
    </ul>
  );
}

/** What a task changed in the book, with links, and its Undo (the book history kept it). */
function Changes({ item, links, onUndo }: { item: Extract<AskItem, { kind: 'changes' }>; links: Links; onUndo: () => void }) {
  const files = item.files.map((f) => describeFile(links.world, f, item.names?.[f]));
  const shown = files.slice(0, 6);
  const names = (
    <>
      {shown.map((d, i) => (
        <span key={i}>
          {i > 0 && ', '}
          {d.entryId && !item.undone ? <button type="button" class="link ask-ref" onClick={() => links.onOpen(d.entryId!)}>{d.label}</button>
            : d.chapter && !item.undone ? <button type="button" class="link ask-ref" onClick={() => links.onOpenChapter(d.chapter!)}>{d.label}</button>
            : d.label}
        </span>
      ))}
      {files.length > shown.length && <> {t('and {count} more', { count: files.length - shown.length })}</>}
    </>
  );
  return (
    <div class={`ask-changes${item.undone ? ' is-undone' : ''}`}>
      <Icon name={item.undone ? 'cycle' : 'quill'} />
      <span class="ask-changes-text">{item.undone ? tj('Undone: {files}', { files: names }) : tj('Changed: {files}', { files: names })}</span>
      {!item.undone && <button type="button" class="ghost small ask-undo" onClick={onUndo} title={t('Put these back as they were before this task')}>{t('Undo')}</button>}
    </div>
  );
}

/** A conversation as shown: steps in a row are one group. */
type Group = AskItem | Extract<AskItem, { kind: 'tool' }>[];

/**
 * The conversation. A memo: it is drawn again only when the conversation changes, or the names in the book do
 * (`names`), not on every key typed in the editor.
 */
const ChatLog = memo(function ChatLog({ groups, links, onUndo }: { groups: Group[]; names: string; links: Links; onUndo: (task: string) => void }) {
  return (
    <>
      {groups.map((g, i) => (Array.isArray(g) ? <Steps key={g[0]!.id} steps={g} links={links} />
        : g.kind === 'you' ? (
          <div key={i} class="ask-you">
            {g.about && <span class="ask-you-about"><Icon name="magic-lamp" /> {t('About {what}', { what: g.about })}</span>}
            {g.text}
          </div>
        )
        : g.kind === 'ai' ? <Reply key={g.id} text={g.text} />
        : g.kind === 'note' ? <Note key={i} note={g.note} />
        : g.kind === 'changes' ? <Changes key={g.task} item={g} links={links} onUndo={() => onUndo(g.task)} />
        : null))}
    </>
  );
});

/** How to sign in to a tool, from a terminal. */
const signIn = (agent: AskAgentId): ComponentChildren => (agent === 'codex'
  ? tj('To sign in, open a terminal and run {command}, then press Check again.', { command: <code>codex login</code> })
  : tj('To sign in, open a terminal, run {command} and follow its steps, then press Check again.', { command: <code>claude</code> }));

function Note({ note }: { note: AskNote }) {
  switch (note.code) {
    case 'stopped':
      return <p class="ask-note"><Icon name="hourglass" /> {t('Stopped. What it already saved stays in the book.')}</p>;
    case 'switched':
      return <p class="ask-note ask-switched"><Icon name="info" /> {t('Now talking to {agent}. It does not see the messages above, but it reads the book as it is now.', { agent: NAMES[note.agent] })}</p>;
    case 'failed':
      return (
        <div class="ask-note is-error" role="alert">
          <p class="ask-note-title"><Icon name="hazard-sign" /> {t('{agent} could not finish:', { agent: NAMES[note.agent] })}</p>
          <pre class="ask-error-text">{note.text}</pre>
          {note.signIn && <p class="ask-note-hint">{signIn(note.agent)}</p>}
        </div>
      );
    case 'usage': {
      const text = /five_hour/.test(note.window) ? t('You have used {percent}% of your Claude usage for this 5-hour window.', { percent: note.percent })
        : /seven_day/.test(note.window) ? t('You have used {percent}% of your weekly Claude usage.', { percent: note.percent })
        : t('You have used {percent}% of your Claude usage.', { percent: note.percent });
      return <p class="ask-note is-warning"><Icon name="hourglass" /> {text}{note.resets ? ` ${t('It resets on {time}.', { time: resetTime(note.resets) })}` : ''}</p>;
    }
    case 'limit':
      return <p class="ask-note is-error" role="alert"><Icon name="hourglass" /> {t('You have reached your Claude usage limit.')}{note.resets ? ` ${t('It resets on {time}.', { time: resetTime(note.resets) })}` : ''}</p>;
    case 'no-tools':
      return <p class="ask-note is-error" role="alert"><Icon name="hazard-sign" /> {t("Lore-Forge's tools did not start ({status}). Try again; if it keeps happening, restart Lore-Forge.", { status: note.text })}</p>;
  }
}

/** The line under the AI picker, only when something needs the user: too old, signed out, or billed per message. */
function Status({ agent }: { agent: AskAgent }) {
  if (agent.outdated) {
    return <p class="ask-status is-off">{tj('This version of {agent} is too old for Ask AI. Update it ({command}), then press Check again.', { agent: agent.name, command: <code>{agent.id === 'codex' ? 'npm install -g @openai/codex@latest' : 'claude update'}</code> })}</p>;
  }
  if (agent.signedIn === false) return <p class="ask-status is-off">{t('{agent} is not signed in.', { agent: agent.name })} {signIn(agent.id)}</p>;
  if (agent.billed) return <p class="ask-status is-unsure">{t('Signed in with an API key or account: each message is billed to it.')}</p>;
  return null;
}

/** m:ss since a run started. */
const elapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Suggestions for a message about an entry or a chapter (a part of it, when one is chosen). */
function aboutExamples(about: AskAbout): string[] {
  if (about.kind === 'entry') {
    return [
      t('Improve the description of {name}', { name: about.name }),
      t('Write a visual description for {name}', { name: about.name }),
      t('Suggest relationships for {name}', { name: about.name }),
      t('Check {name} against the story', { name: about.name }),
    ];
  }
  return about.quote
    ? [t('Rewrite this part'), t('Continue the story from this part'), t('Check this part against the book')]
    : [t('Continue this chapter'), t('Check this chapter against the book'), t('Suggest a title for this chapter')];
}

/** The "About" tag on the message box: what the next message is about, with its × to drop it. */
function aboutTag(about: AskAbout): string {
  if (about.kind === 'entry') return about.name;
  const q = about.quote?.replace(/\s+/g, ' ').trim();
  return q ? `${about.title}: “${q.length > 48 ? `${q.slice(0, 47).trimEnd()}…` : q}”` : about.title;
}

export interface AskAiProps extends Links {
  dir: string;
  /** What the next message is about (Ask AI on an entry or a chapter), and dropping it. */
  about: AskAbout | null;
  onAbout: (about: AskAbout | null) => void;
  /** Save what is waiting to be saved before an undo; false when that failed. */
  beforeChange: () => Promise<boolean>;
  /** Files an undo changed (to read again at once). */
  onRestored: (files: string[]) => void;
  /** The panel is on screen (the tab is open): the AI tools are looked up the first time it is. */
  shown: boolean;
  /** Changes when Ctrl+J asks for the message box. */
  focusKey: number;
  onRunning: (running: boolean) => void;
}

export function AskAiPanel({ dir, world, shown, focusKey, onOpen, onOpenChapter, onRunning, beforeChange, onRestored, about, onAbout }: AskAiProps) {
  const [chat, setChat] = useState<AskChat | null>(null);
  const [agents, setAgents] = useState<AskAgent[] | null>(null);
  const [agent, setAgent] = useState<AskAgentId | null>(storedAgent);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  /** An undo that found files changed again since the task: asked about first. */
  const [conflict, setConflict] = useState<{ task: string; files: string[] } | null>(null);
  const [now, setNow] = useState(Date.now());
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  /** A message on its way to the app: Enter pressed twice sends it once. */
  const sending = useRef(false);
  /** The Ctrl+J count already answered: drawn again (a language change), the panel does not take the focus. */
  const focused = useRef(focusKey);
  const atEnd = useRef(true);
  const links: Links = { world, onOpen, onOpenChapter };
  // The conversation is drawn again only when it changes, or when entries' names or chapters' titles do: typing
  // in the editor redraws the world on every key, and a long conversation should not slow that down.
  const linksRef = useRef(links);
  linksRef.current = links;
  const stableLinks = useMemo<Links>(() => ({
    get world() { return linksRef.current.world; },
    onOpen: (id: string) => linksRef.current.onOpen(id),
    onOpenChapter: (title: string) => linksRef.current.onOpenChapter(title),
  }), []);
  const namesKey = useMemo(() => `${world.entries.map((e) => `${e.id}\u0001${e.name}`).join('\u0002')}\u0003${(world.story ?? []).map((c) => c.title).join('\u0002')}`, [world]);

  useEffect(() => {
    let live = true;
    void window.lore.askChat(dir).then((c) => live && setChat(c));
    const off = window.lore.onAskChanged((c) => { if (sameDir(c.dir, dir)) setChat(c); });
    return () => { live = false; off(); };
  }, [dir]);

  const look = async (refresh: boolean): Promise<void> => {
    setChecking(true);
    try {
      const list = await window.lore.askAgents(refresh);
      setAgents(list);
      // Keep the chosen one when it can run; else the first that can, else the first installed.
      setAgent((cur) => {
        const ok = (id: AskAgentId | null) => !!id && list.some((a) => a.id === id && a.installed);
        if (ok(cur)) return cur;
        return (list.find((a) => stateOf(a) === 'ready') ?? list.find((a) => a.installed))?.id ?? null;
      });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => { if (shown && !agents && !checking) void look(false); }, [shown]);

  const running = !!chat?.running;
  useEffect(() => onRunning(running), [running]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  // A conversation that grows stays scrolled to its end, unless the user scrolled up to read.
  useEffect(() => {
    const el = log.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [chat, shown]);
  useEffect(() => {
    if (focusKey === focused.current) return;
    focused.current = focusKey;
    box.current?.focus();
  }, [focusKey]);

  const choose = (id: AskAgentId): void => {
    setAgent(id);
    try { localStorage.setItem(AGENT_KEY, id); } catch { /* not kept */ }
  };
  const current = agents?.find((a) => a.id === agent) ?? null;
  const usable = !!current && current.installed && !current.outdated;
  const send = async (): Promise<void> => {
    const msg = text.trim();
    if (!msg || !agent || running || sending.current) return;
    sending.current = true;
    setProblem(null);
    atEnd.current = true;
    try {
      setChat(await window.lore.askSend(dir, agent, msg, world.manifest.name, about));
      setText('');
      onAbout(null);
    } catch (e) {
      setProblem(message(e));
    } finally {
      sending.current = false;
    }
  };

  const undo = async (task: string, force = false): Promise<void> => {
    setProblem(null);
    try {
      if (!(await beforeChange())) throw new Error(t('Some changes could not be saved first, so nothing was undone. Try again in a moment.'));
      const r = await window.lore.askUndo(dir, task, force);
      if (r.conflicts.length && !force) {
        setConflict({ task, files: r.conflicts });
        return;
      }
      setConflict(null);
      onRestored(r.changed);
    } catch (e) {
      setProblem(message(e));
    }
  };

  const undoRef = useRef(undo);
  undoRef.current = undo;
  const undoLatest = useMemo(() => (task: string) => void undoRef.current(task), []);

  const items = chat?.items ?? [];
  // Steps in a row show as one list; replies not begun yet are not shown.
  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const it of items) {
      if (it.kind === 'tool') {
        const last = out[out.length - 1];
        if (Array.isArray(last)) last.push(it);
        else out.push([it]);
      } else if (!(it.kind === 'ai' && !it.text.trim())) out.push(it);
    }
    return out;
  }, [chat]);
  const place = world.entries.find((e) => e.type === 'place')?.name;
  const examples = [
    place ? t('Add three new characters who live in {place}', { place }) : t('Add three new characters to this world'),
    t('Write the next chapter of the story'),
    t('Fix the open warnings'),
    t('Give every character a visual description'),
    t('Summarize the story so far'),
  ];
  const none = agents !== null && !agents.some((a) => a.installed);

  return (
    <section class="ask" aria-label={t('Ask AI')}>
      <div class="ask-head">
        <div class="segmented ask-agents" role="radiogroup" aria-label={t('AI to ask')}>
          {(agents ?? [{ id: 'claude-code', name: NAMES['claude-code'], installed: false, signedIn: null }, { id: 'codex', name: NAMES.codex, installed: false, signedIn: null }] as AskAgent[]).map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={agent === a.id} disabled={!a.installed || running} onClick={() => choose(a.id)}
              title={!agents ? t('Looking for it…') : !a.installed ? t('Not installed on this computer') : a.name}>
              <span class={`ask-dot is-${agents ? stateOf(a) : 'missing'}`} aria-hidden="true" />{a.name}
            </button>
          ))}
        </div>
        <button type="button" class="ghost small icon-only" onClick={() => void look(true)} disabled={checking} aria-label={t('Check again')} title={t('Check again: look for the AI apps and their sign-in')}>
          <Icon name="cycle" class={checking ? 'ask-spin' : ''} />
        </button>
        <button type="button" class="ghost small icon-only" onClick={() => setConfirmNew(true)} disabled={running || !items.length} aria-label={t('New conversation')} title={t('New conversation')}>
          <Icon name="scroll-unfurled" />
        </button>
      </div>
      {current && current.installed && <Status agent={current} />}
      {chat?.readOnly && <p class="ask-readonly"><Icon name="info" /> {t('This is the read-only sample book. The AI can read it and answer questions; to let it change things, duplicate the book in the Library and open the copy.')}</p>}

      <div class="ask-log" ref={log} onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }} aria-live="polite">
        {!items.length && (
          <div class="ask-intro">
            <p class="ask-intro-mark" aria-hidden="true"><Icon name="magic-lamp" /></p>
            {none ? (
              <>
                <p>{t('Ask AI runs Claude Code or Codex on this book, on your own plan. Neither is installed on this computer yet.')}</p>
                <p>
                  {tj('Install {claude} or {codex}, sign in once in a terminal, then press Check again.', {
                    claude: <a href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noreferrer">Claude Code</a>,
                    codex: <a href="https://github.com/openai/codex" target="_blank" rel="noreferrer">Codex</a>,
                  })}
                </p>
              </>
            ) : (
              <>
                <p>{t("Tell the AI what to do with this book. It reads and changes the book with Lore-Forge's own tools, and every change shows up in the app as it happens.")}</p>
                <div class="ask-examples">
                  {examples.map((ex) => <button key={ex} type="button" class="ask-example" onClick={() => { setText(ex); box.current?.focus(); }}>{ex}</button>)}
                </div>
              </>
            )}
          </div>
        )}
        <ChatLog groups={groups} names={namesKey} links={stableLinks} onUndo={undoLatest} />
        {running && (
          <p class="ask-working" role="status">
            <Icon name="cycle" class="ask-spin" /> {t('{agent} is working…', { agent: chat?.agent ? NAMES[chat.agent] : t('The AI') })}
            <span class="muted">{elapsed(now - (chat?.started ?? now))}</span>
          </p>
        )}
      </div>

      <form class="ask-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
        {about && (
          <div class="ask-about">
            <span class="ask-about-tag">
              <Icon name="magic-lamp" /> <span class="ask-about-what">{t('About {what}', { what: aboutTag(about) })}</span>
              <button type="button" class="ghost small icon-only" onClick={() => onAbout(null)} aria-label={t('Not about this any more')} title={t('Not about this any more')}><Icon name="cancel" /></button>
            </span>
            <div class="ask-examples">
              {aboutExamples(about).map((ex) => <button key={ex} type="button" class="ask-example" onClick={() => { setText(ex); box.current?.focus(); }}>{ex}</button>)}
            </div>
          </div>
        )}
        <textarea ref={box} rows={3} value={text} maxLength={20000} disabled={!usable}
          placeholder={usable ? t('Ask {agent} to work on this book…', { agent: current!.name }) : t('Install and sign in to an AI app first.')}
          aria-label={t('Message to the AI')}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send(); } }} />
        <div class="ask-compose-bar">
          {running
            ? <button type="button" class="danger small ask-stop" onClick={() => void window.lore.askStop(dir)}><Icon name="cancel" /> {t('Stop')}</button>
            : <button type="submit" class="primary small ask-send" disabled={!usable || !text.trim()}><Icon name="play-button" /> {t('Send')}</button>}
        </div>
      </form>
      {conflict && (
        <ConfirmDialog title={t('Undo anyway?')} confirmLabel={t('Undo anyway')} confirmIcon="cycle" onClose={() => setConflict(null)}
          onConfirm={async () => { const c = conflict; setConflict(null); await undo(c.task, true); }}>
          <p>{t('These changed again after the AI task: {names}. Undoing puts them back as they were before the task. Their later changes are kept in the book history.', { names: conflict.files.map((f) => describeFile(world, f).label).join(', ') })}</p>
        </ConfirmDialog>
      )}
      {confirmNew && (
        <ConfirmDialog title={t('Start a new conversation?')} confirmLabel={t('New conversation')} confirmIcon="scroll-unfurled" onClose={() => setConfirmNew(false)}
          onConfirm={async () => { setChat(await window.lore.askClear(dir)); setConfirmNew(false); }}>
          <p>{t('The AI forgets this conversation. The book keeps every change it made.')}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
