/**
 * Ask AI: runs Claude Code or Codex on the open book, on the user's own plan and with only Lore-Forge's tools, and
 * keeps each book's conversation: in memory, and on disk between runs (userData/ask-ai). The window shows it and
 * words it; the book itself changes through the tools, and the app's folder watch shows each change as it lands.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AskAbout, AskAgent, AskAgentId, AskChat, AskItem } from '../shared/api.ts';
import { t } from '../shared/i18n.ts';
import { findClaude, serverLaunch } from './ai.ts';
import { beginTask, finishTask, setBusy, undoTask } from './book-history.ts';
import type { Pending } from './history.ts';
import {
  aboutLabel, aboutText, bookContext, claudeArgs, cleanAbout, claudeAuth, claudeCaps, ClaudeReader, codexArgs, codexAuth, codexCaps, codexNative, CodexReader, lostSession, SERVER,
  shimScript, signInProblem, Turn, type ClaudeCaps, type CodexCaps,
} from './ask-stream.ts';

/** The book's writing style from its world.json, for what the AI is told (none when it has none, or the file cannot be read). */
async function writingStyleOf(dir: string): Promise<{ writingStyle?: string }> {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'world.json'), 'utf8')) as { writingStyle?: unknown };
    return typeof raw.writingStyle === 'string' && raw.writingStyle.trim() ? { writingStyle: raw.writingStyle.trim() } : {};
  } catch {
    return {};
  }
}

/** How to start a tool: a program, what comes before its own arguments (a script, for Node), and extra environment. */
interface Launcher {
  command: string;
  prefix: string[];
  env: Record<string, string>;
}

interface Found {
  agent: AskAgent;
  launcher?: Launcher;
  claude?: ClaudeCaps;
  codex?: CodexCaps;
}

const NAMES: Record<AskAgentId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

/** A script run with this app's own Node (Electron in Node mode): a GUI app may not find `node` on the PATH. */
const viaNode = (script: string): Launcher => ({ command: process.execPath, prefix: [script], env: { ELECTRON_RUN_AS_NODE: '1' } });

/** The native program of an npm-installed Codex (it saves the Node launcher a step), when it is there. */
function codexProgram(script: string): Launcher | undefined {
  const exe = codexNative(dirname(dirname(script)), process.platform, process.arch).find((p) => existsSync(p));
  return exe ? { command: exe, prefix: [], env: { CODEX_MANAGED_BY_NPM: '1' } } : undefined;
}

/**
 * How to start a found command. An npm command is a shim around a script: on Windows a .cmd file (cmd.exe would
 * mangle the arguments, so the script runs directly), elsewhere a link to it.
 */
function launcherFor(path: string, agent: AskAgentId): Launcher | undefined {
  const script = (file: string): Launcher => (agent === 'codex' ? codexProgram(file) : undefined) ?? viaNode(file);
  if (process.platform === 'win32') {
    if (/\.exe$/i.test(path)) return { command: path, prefix: [], env: {} };
    if (!/\.(cmd|bat)$/i.test(path)) return undefined;
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
    const rel = shimScript(text);
    const file = rel ? join(dirname(path), rel) : '';
    return file && existsSync(file) ? script(file) : undefined;
  }
  let real = path;
  try {
    real = realpathSync(path);
  } catch { /* keep the path */ }
  return /\.[cm]?js$/i.test(real) ? script(real) : { command: path, prefix: [], env: {} };
}

/** Every place a command is found on the PATH. */
function onPath(name: string): Promise<string[]> {
  return new Promise((done) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', process.platform === 'win32' ? [name] : ['-a', name], { encoding: 'utf8', timeout: 5000, windowsHide: true }, (_e, out) => {
      done(String(out ?? '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && existsSync(s)));
    });
  });
}

/** The `codex` command (GUI apps on macOS do not see the shell's PATH: known places too). */
async function findCodex(): Promise<string | null> {
  const found = await onPath('codex');
  const win = process.platform === 'win32';
  const best = win ? found.find((s) => /\.exe$/i.test(s)) ?? found.find((s) => /\.(cmd|bat)$/i.test(s)) : found[0];
  if (best) return best;
  const home = homedir();
  const places = win
    ? [join(process.env['APPDATA'] ?? '', 'npm', 'codex.cmd')]
    : ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', join(home, '.local', 'bin', 'codex'), join(home, '.npm-global', 'bin', 'codex'), join(home, '.volta', 'bin', 'codex')];
  return places.find((p) => p && existsSync(p)) ?? null;
}

/** Run a launcher briefly; what it printed (stdout, then stderr), or '' when it could not run. */
function quick(l: Launcher, args: string[]): Promise<string> {
  return new Promise((done) => {
    execFile(l.command, [...l.prefix, ...args], { env: { ...process.env, ...l.env }, timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (_e, stdout, stderr) => done(`${stdout ?? ''}${stderr ?? ''}`));
  });
}

async function detectClaude(): Promise<Found> {
  const agent: AskAgent = { id: 'claude-code', name: NAMES['claude-code'], installed: false, signedIn: null };
  // Tests: a script that answers like Claude Code.
  const fake = process.env['LORE_FORGE_ASK_SCRIPT'];
  if (fake) return { agent: { ...agent, installed: true, signedIn: true }, launcher: viaNode(fake), claude: { partial: true, dontAsk: true, settingSources: true } };
  const path = await findClaude();
  const launcher = path ? launcherFor(path, 'claude-code') : undefined;
  if (!launcher) return { agent };
  const [help, auth] = await Promise.all([quick(launcher, ['--help']), quick(launcher, ['auth', 'status'])]);
  const caps = claudeCaps(help);
  return { agent: { ...agent, installed: true, ...claudeAuth(auth), ...(caps ? {} : { outdated: true }) }, launcher, ...(caps ? { claude: caps } : {}) };
}

async function detectCodex(): Promise<Found> {
  const agent: AskAgent = { id: 'codex', name: NAMES.codex, installed: false, signedIn: null };
  const path = await findCodex();
  const launcher = path ? launcherFor(path, 'codex') : undefined;
  if (!launcher) return { agent };
  const [help, features, auth] = await Promise.all([quick(launcher, ['exec', '--help']), quick(launcher, ['features', 'list']), quick(launcher, ['login', 'status'])]);
  const caps = codexCaps(help, features);
  return { agent: { ...agent, installed: true, ...codexAuth(auth), ...(caps ? {} : { outdated: true }) }, launcher, ...(caps ? { codex: caps } : {}) };
}

let found: { at: number; agents: Promise<Map<AskAgentId, Found>> } | null = null;

/** Both tools, looked up again after a minute (or when asked: Check again, a sign-in problem). */
function detect(refresh = false): Promise<Map<AskAgentId, Found>> {
  if (!found || refresh || Date.now() - found.at > 60_000) {
    found = { at: Date.now(), agents: Promise.all([detectClaude(), detectCodex()]).then((list) => new Map(list.map((f) => [f.agent.id, f]))) };
  }
  return found.agents;
}

// ----------------------------------------------------------------------------------------------- conversations

interface Chat extends AskChat {
  /** Each tool's own conversation id, to continue it. */
  sessions: Partial<Record<AskAgentId, string>>;
}

const MAX_ITEMS = 400;
const chats = new Map<string, Promise<Chat>>();
/** The tool working on each book, and how to end its run at once (quitting). */
const runs = new Map<string, { child: ChildProcess; stopped: boolean; end: (code: number | null) => void; chat: Chat }>();
/** Tools whose usage warning was said in this app session. */
const warned = new Set<AskAgentId>();

const keyOf = (dir: string): string => (process.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir));
/** The app's data folder (a throwaway one in the smoke test). */
let dataDir: () => string = () => app.getPath('userData');
const askDir = (): string => join(dataDir(), 'ask-ai');
const chatFile = (dir: string): string => join(askDir(), `${createHash('sha1').update(keyOf(dir)).digest('hex').slice(0, 20)}.json`);
/** The installed sample (resources/worlds/...): the tools refuse to change it. */
const readOnlyBook = (dir: string): boolean => /[\\/]resources[\\/]worlds[\\/][^\\/]+[\\/]?$/i.test(resolve(dir));
const isAgent = (v: unknown): v is AskAgentId => v === 'claude-code' || v === 'codex';

/** A saved item the panel can show (a file written by an older or newer app may hold others). */
function validItem(v: unknown): v is AskItem {
  if (!v || typeof v !== 'object') return false;
  const it = v as Record<string, unknown>;
  if (it['kind'] === 'you') return typeof it['text'] === 'string';
  if (it['kind'] === 'ai') return typeof it['text'] === 'string' && typeof it['id'] === 'string';
  if (it['kind'] === 'tool') return typeof it['tool'] === 'string' && typeof it['id'] === 'string';
  if (it['kind'] === 'note') return !!it['note'] && typeof it['note'] === 'object';
  if (it['kind'] === 'changes') return typeof it['task'] === 'string' && Array.isArray(it['files']);
  return false;
}

function chatOf(dir: string): Promise<Chat> {
  const key = keyOf(dir);
  let chat = chats.get(key);
  if (!chat) {
    chat = (async () => {
      const c: Chat = { dir: resolve(dir), agent: null, items: [], running: false, readOnly: readOnlyBook(dir), sessions: {} };
      try {
        const saved = JSON.parse(await readFile(chatFile(dir), 'utf8')) as Record<string, unknown>;
        if (Array.isArray(saved['items'])) c.items = saved['items'].filter(validItem).slice(-MAX_ITEMS);
        if (isAgent(saved['agent'])) c.agent = saved['agent'];
        const sessions = saved['sessions'] && typeof saved['sessions'] === 'object' ? (saved['sessions'] as Record<string, unknown>) : {};
        for (const a of ['claude-code', 'codex'] as const) if (typeof sessions[a] === 'string') c.sessions[a] = sessions[a];
        // A run that was cut off (the app closed during it) has no running steps left.
        for (const it of c.items) if (it.kind === 'tool' && it.state === 'running') it.state = 'stopped';
      } catch { /* no conversation yet */ }
      return c;
    })();
    chats.set(key, chat);
  }
  return chat;
}

const shown = (c: Chat): AskChat => ({ dir: c.dir, agent: c.agent, items: c.items, running: c.running, ...(c.started ? { started: c.started } : {}), readOnly: c.readOnly });

/** What a conversation file holds. */
const saved = (c: Chat): string => JSON.stringify({ version: 1, dir: c.dir, agent: c.agent, sessions: c.sessions, items: c.items });

/** The same as save, at once: the app is quitting and will not wait. */
function saveNow(c: Chat): void {
  const file = chatFile(c.dir);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.${process.pid}.tmp`, saved(c), 'utf8');
    renameSync(`${file}.${process.pid}.tmp`, file);
  } catch { /* nothing more can be done while quitting */ }
}

/** Written whole (a temporary file, then a rename), so a crash never leaves half a conversation. */
async function save(c: Chat): Promise<void> {
  const file = chatFile(c.dir);
  if (!c.items.length && !Object.keys(c.sessions).length) {
    await rm(file, { force: true }).catch(() => undefined);
    return;
  }
  if (c.items.length > MAX_ITEMS) c.items.splice(0, c.items.length - MAX_ITEMS);
  const text = saved(c);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, file);
  } catch {
    await rm(tmp, { force: true }).catch(() => undefined);
    await writeFile(file, text, 'utf8').catch(() => undefined);
  }
}

const timers = new Map<string, NodeJS.Timeout>();

/** Tell the window, at most every 60 ms while text streams in (at once when a run starts or ends). */
function emit(c: Chat, now = false): void {
  const key = keyOf(c.dir);
  const waiting = timers.get(key);
  if (waiting && !now) return;
  if (waiting) clearTimeout(waiting);
  const send = (): void => {
    timers.delete(key);
    const data = shown(c);
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('ask-changed', data);
  };
  if (now) send();
  else timers.set(key, setTimeout(send, 60));
}

/** The last few lines a tool printed on stderr, for a failure it did not explain itself. */
const lastLines = (text: string): string => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join('\n').slice(-600);

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  // On Windows a kill ends only the tool, not the Lore-Forge server it started: end the whole tree.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}

async function send(dir: string, agentId: AskAgentId, text: string, bookName: string, worldsDir: string, aboutIn?: unknown): Promise<AskChat> {
  const about: AskAbout | null = cleanAbout(aboutIn);
  if (!isAgent(agentId)) throw new Error(t('Unknown AI app {id}.', { id: String(agentId) }));
  const message = String(text ?? '').trim().slice(0, 20_000);
  if (!message) throw new Error(t('Write what the AI should do first.'));
  const c = await chatOf(dir);
  const key = keyOf(dir);
  // The book is claimed before anything else waits: two quick sends never start two runs on one book.
  if (c.running) throw new Error(t('An AI is already working on this book. Wait for it to finish, or stop it.'));
  c.running = true;
  c.started = Date.now();
  setBusy(c.dir, true);
  let f: Found | undefined;
  try {
    f = (await detect()).get(agentId);
    if (!f?.launcher || !f.agent.installed) throw new Error(t('{agent} was not found on this computer.', { agent: NAMES[agentId] }));
    if (f.agent.outdated || (agentId === 'claude-code' ? !f.claude : !f.codex)) throw new Error(t('This version of {agent} is too old for Ask AI. Update it, then try again.', { agent: NAMES[agentId] }));
  } catch (e) {
    c.running = false;
    delete c.started;
    setBusy(c.dir, false);
    throw e;
  }

  if (c.agent && c.agent !== agentId && c.items.length) c.items.push({ kind: 'note', note: { code: 'switched', agent: agentId } });
  c.agent = agentId;
  c.items.push({ kind: 'you', text: message, at: Date.now(), ...(about ? { about: aboutLabel(about) } : {}) });
  const turn = new Turn(agentId, randomUUID().slice(0, 8), c.items, () => emit(c), !warned.has(agentId));
  const l = f.launcher!;
  let out = '';
  let errors = '';
  let ended = false;
  let reader: ClaudeReader | CodexReader | undefined;
  /** The book before the task, for its undo (book history). */
  let pending: Pending | null = null;
  const run = { child: null as unknown as ChildProcess, stopped: false, end: (code: number | null) => end(code), chat: c };
  // However the run ends (done, failed, stopped, or it never started), the book is free again and the conversation saved.
  const end = (code: number | null, problem?: string): void => {
    if (ended) return;
    ended = true;
    if (out.trim()) reader?.line(out.trim());
    if (runs.get(key) === run) runs.delete(key);
    turn.settle();
    if (run.stopped) turn.note({ code: 'stopped' });
    else if (turn.failed || !turn.done) {
      const why = turn.failed || problem || lastLines(errors) || t('It stopped with exit code {code}.', { code: String(code) });
      turn.note({ code: 'failed', agent: agentId, text: why, ...(signInProblem(why) ? { signIn: true } : {}) });
      if (lostSession(why)) delete c.sessions[agentId];
      // Signed out, or its sign-in ran out: look again, so the panel says so.
      if (signInProblem(why)) found = null;
    }
    if (turn.session && !(turn.failed && lostSession(turn.failed))) c.sessions[agentId] = turn.session;
    if (!turn.warnUsage) warned.add(agentId);
    emit(c, true);
    // What the task changed in the book is kept so it can be undone (also when it was stopped half way); the book
    // is free again after that.
    void (async () => {
      const task = pending ? await finishTask(c.dir, pending, message) : null;
      if (task) c.items.push({ kind: 'changes', task: task.id, files: task.files.map((x) => x.path), ...(task.names ? { names: task.names } : {}) });
      c.running = false;
      delete c.started;
      setBusy(c.dir, false);
      emit(c, true);
      await save(c);
    })();
  };
  // What the message is about goes before it, for the AI only.
  let input = about ? `${aboutText(about)}\n\n${message}` : message;
  try {
    pending = await beginTask(c.dir);
    const context = bookContext({ name: bookName || 'Untitled', dir: c.dir, readOnly: c.readOnly, ...(await writingStyleOf(c.dir)) });
    const server = serverLaunch(worldsDir);
    let args: string[];
    if (agentId === 'claude-code') {
      await mkdir(askDir(), { recursive: true });
      const config = join(askDir(), 'lore-forge-mcp.json');
      await writeFile(config, JSON.stringify({ mcpServers: { [SERVER]: server } }, null, 2), 'utf8');
      args = claudeArgs({ mcpConfig: config, context, ...(c.sessions['claude-code'] ? { session: c.sessions['claude-code'] } : {}), caps: f.claude! });
      reader = new ClaudeReader(turn);
    } else {
      args = codexArgs({ server, dir: c.dir, ...(c.sessions.codex ? { session: c.sessions.codex } : {}), caps: f.codex! });
      // Codex has no option for this: it reads where it is with the first message of a conversation.
      if (!c.sessions.codex) input = `${context}\n\n---\n\n${input}`;
      reader = new CodexReader(turn);
    }
    const env: NodeJS.ProcessEnv = { ...process.env, ...l.env };
    if (!l.env['ELECTRON_RUN_AS_NODE']) delete env['ELECTRON_RUN_AS_NODE'];
    run.child = spawn(l.command, [...l.prefix, ...args], { cwd: c.dir, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    end(null, (e as Error).message);
    return shown(c);
  }
  const lines = reader;
  const child = run.child;
  runs.set(key, run);
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    out += chunk;
    for (let i = out.indexOf('\n'); i >= 0; i = out.indexOf('\n')) {
      const line = out.slice(0, i).trim();
      out = out.slice(i + 1);
      if (line) lines.line(line);
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => { errors = (errors + chunk).slice(-8000); });
  // The prompt goes on stdin, so no shell ever sees the user's text.
  child.stdin!.on('error', () => undefined);
  child.stdin!.end(input, 'utf8');
  child.on('error', (e) => end(null, e.message));
  child.on('close', (code) => end(code));
  emit(c, true);
  return shown(c);
}

function stop(dir: string): void {
  const run = runs.get(keyOf(dir));
  if (!run) return;
  run.stopped = true;
  killTree(run.child);
}

async function clear(dir: string): Promise<AskChat> {
  const c = await chatOf(dir);
  if (c.running) throw new Error(t('Stop the AI first.'));
  c.items = [];
  c.sessions = {};
  await save(c);
  emit(c, true);
  return shown(c);
}

/** Take an Ask AI task back (book history), and mark it undone in its conversation. */
async function undo(dir: string, task: string, force: boolean): Promise<{ conflicts: string[]; changed: string[] }> {
  const c = await chatOf(dir);
  if (c.running) throw new Error(t('Stop the AI first.'));
  const r = await undoTask(c.dir, task, force);
  if (!r.conflicts.length || force) {
    for (const it of c.items) if (it.kind === 'changes' && it.task === task) it.undone = true;
    emit(c, true);
    await save(c);
  }
  return r;
}

export function registerAsk(defaultWorldsDir: () => string, data?: () => string): void {
  if (data) dataDir = data;
  ipcMain.handle('askAgents', async (_e, refresh?: boolean): Promise<AskAgent[]> => [...(await detect(!!refresh)).values()].map((f) => f.agent));
  ipcMain.handle('askChat', async (_e, dir: string): Promise<AskChat> => shown(await chatOf(dir)));
  ipcMain.handle('askSend', (_e, dir: string, agent: AskAgentId, text: string, bookName: string, about?: unknown) => send(dir, agent, text, bookName, defaultWorldsDir(), about));
  ipcMain.handle('askStop', (_e, dir: string) => stop(dir));
  ipcMain.handle('askClear', (_e, dir: string) => clear(dir));
  ipcMain.handle('askUndo', (_e, dir: string, task: string, force?: boolean) => undo(dir, task, !!force));
  // Quitting stops every AI still working (what it saved stays in the book) and keeps its conversation.
  app.on('before-quit', () => {
    for (const run of [...runs.values()]) {
      run.stopped = true;
      killTree(run.child);
      run.end(null);
      saveNow(run.chat);
    }
  });
}
