/**
 * Ask AI, the parts that need no Electron: the command lines that run Claude Code and Codex on a book with only
 * Lore-Forge's tools, reading their JSON output into the panel's items, and finding the program behind an npm command.
 */
import { join } from 'node:path';
import type { AskAbout, AskAgentId, AskItem, AskNote } from '../shared/api.ts';

/** The MCP server's name in both tools' settings, and the prefix of its tools in Claude Code ("mcp__lore-forge__"). */
export const SERVER = 'lore-forge';

/** How to start Lore-Forge's MCP server (the same as Connect AI). */
export interface ServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** What the AI is told about where it is: appended to Claude Code's system prompt; Codex gets it before the first message. */
export function bookContext(book: { name: string; dir: string; readOnly: boolean }): string {
  return [
    `You are working inside the Lore-Forge desktop app, in its Ask AI panel. The user has the book "${book.name}" open; its folder is ${book.dir}.`,
    `Work on that book unless the user names another one: pass book: ${JSON.stringify(book.dir)} to the Lore-Forge tools. You can only use the Lore-Forge tools.`,
    'Call lore_forge_guide once before you add or change anything.',
    book.readOnly
      ? 'This book is the read-only sample that comes with the app: you can read it and answer questions about it, but not change it. If the user asks for changes, tell them to duplicate the book in the Library first and open the copy.'
      : '',
    'The user watches every change appear in the app as you make it, so do not repeat whole entries or chapters in your reply.',
    'Keep replies short: what you did, the choices you made, and anything you need from the user. Write plain Markdown: short paragraphs and lists.',
    'Reply in the language the user writes in.',
  ].filter(Boolean).join('\n');
}

/** The longest part of a chapter a message can be about. */
export const MAX_QUOTE = 4000;

/** What the AI is told a message is about, before the message: the entry or chapter to read first, and the part meant. */
export function aboutText(about: AskAbout): string {
  if (about.kind === 'entry') return `This message is about the entry "${about.name}" (id: ${about.id}). Read it with get_entry first.`;
  const head = `This message is about the chapter "${about.title}" (${about.file}). Read it with read_story first.`;
  const quote = about.quote?.trim().slice(0, MAX_QUOTE);
  return quote ? `${head}\nThe part of it I mean:\n${quote.split(/\r?\n/).map((l) => `> ${l}`).join('\n')}` : head;
}

/** The same, in a few words for the conversation ("Mr Camel", "The Storm: “the well sang…”"). */
export function aboutLabel(about: AskAbout): string {
  if (about.kind === 'entry') return about.name;
  const quote = about.quote?.replace(/\s+/g, ' ').trim();
  return quote ? `${about.title}: “${quote.length > 60 ? `${quote.slice(0, 59).trimEnd()}…` : quote}”` : about.title;
}

/** A message's "about" as the window sent it, checked (anything else is dropped). */
export function cleanAbout(v: unknown): AskAbout | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).slice(0, 300) : '');
  if (o['kind'] === 'entry' && s('id') && s('name')) return { kind: 'entry', id: s('id'), name: s('name') };
  if (o['kind'] === 'chapter' && s('file') && typeof o['title'] === 'string') {
    const quote = typeof o['quote'] === 'string' ? o['quote'].slice(0, MAX_QUOTE) : '';
    return { kind: 'chapter', file: s('file'), title: s('title') || s('file'), ...(quote.trim() ? { quote } : {}) };
  }
  return null;
}

/** Options of the installed Claude Code that Ask AI uses when it has them. */
export interface ClaudeCaps {
  partial: boolean;
  dontAsk: boolean;
  settingSources: boolean;
}

/** What Claude Code's --help says it can do; null when it lacks something Ask AI cannot do without. */
export function claudeCaps(help: string): ClaudeCaps | null {
  if (!/--mcp-config/.test(help) || !/--strict-mcp-config/.test(help) || !/stream-json/.test(help) || !/--tools\b/.test(help)) return null;
  return { partial: /--include-partial-messages/.test(help), dontAsk: /dontAsk/.test(help), settingSources: /--setting-sources/.test(help) };
}

/**
 * Claude Code in print mode, streaming JSON, the prompt on stdin. Only Lore-Forge's tools: no built-in tool (no
 * shell, no file editing, no web), no other MCP server, and the book folder's own settings (hooks, servers) unread.
 */
export function claudeArgs(o: { mcpConfig: string; context: string; session?: string; caps: ClaudeCaps }): string[] {
  return [
    '-p', '--output-format', 'stream-json', '--verbose',
    ...(o.caps.partial ? ['--include-partial-messages'] : []),
    '--mcp-config', o.mcpConfig, '--strict-mcp-config',
    '--tools', '',
    '--allowedTools', `mcp__${SERVER}`,
    ...(o.caps.dontAsk ? ['--permission-mode', 'dontAsk'] : []),
    ...(o.caps.settingSources ? ['--setting-sources', 'user'] : []),
    '--append-system-prompt', o.context,
    ...(o.session ? ['--resume', o.session] : []),
  ];
}

/** Options of the installed Codex that Ask AI uses when it has them. */
export interface CodexCaps {
  ignoreUserConfig: boolean;
  /** Features to switch off (those this Codex has): its shell, connectors, plugins, browser and hooks. */
  disable: string[];
}

/** Codex features that would give the AI more than Lore-Forge's tools. */
export const CODEX_EXTRAS = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'browser_use', 'computer_use', 'in_app_browser', 'hooks'];

/** What `codex exec --help` and `codex features list` say; null when it lacks something Ask AI cannot do without. */
export function codexCaps(execHelp: string, features: string): CodexCaps | null {
  if (!/--json\b/.test(execHelp) || !/--skip-git-repo-check/.test(execHelp)) return null;
  const has = new Set(features.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean));
  return { ignoreUserConfig: /--ignore-user-config/.test(execHelp), disable: CODEX_EXTRAS.filter((f) => has.has(f)) };
}

/** A TOML string: a JSON string is one (the same escapes). */
const tomlString = (s: string): string => JSON.stringify(s);

/**
 * Codex's non-interactive mode, JSON events, the prompt on stdin. Only Lore-Forge's MCP server (the user's other
 * servers and connectors are left out), a read-only sandbox, and nothing asks for approval: no one could answer.
 * Codex lets an MCP tool that changes something run only once approved, so Lore-Forge's own tools are approved
 * up front (default_tools_approval_mode); everything else stays off or read-only.
 */
export function codexArgs(o: { server: ServerLaunch; dir: string; session?: string; caps: CodexCaps }): string[] {
  const s = o.server;
  const env = Object.entries(s.env).map(([k, v]) => `${k}=${tomlString(v)}`).join(', ');
  const table = `mcp_servers.${SERVER}={command=${tomlString(s.command)}, args=[${s.args.map(tomlString).join(', ')}], env={${env}}, default_tools_approval_mode="approve"}`;
  const common = [
    '--json', '--skip-git-repo-check',
    ...(o.caps.ignoreUserConfig ? ['--ignore-user-config'] : []),
    '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"', '-c', table,
    ...o.caps.disable.flatMap((f) => ['--disable', f]),
  ];
  return o.session ? ['exec', 'resume', o.session, ...common, '-'] : ['exec', ...common, '-C', o.dir, '-'];
}

/** The Lore-Forge tool name without Claude Code's "mcp__lore-forge__" prefix. */
export const toolName = (name: string): string => (name.startsWith(`mcp__${SERVER}__`) ? name.slice(SERVER.length + 7) : name);

/** The text of a tool result (a string, or a list of content blocks). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '')).join('\n');
  return '';
}

/** A failure that means the tool is not signed in (or its sign-in ran out). */
export const signInProblem = (text: string): boolean => /\/login|not logged in|log ?in again|invalid api key|unauthori[sz]ed|\b401\b|authenticat|\bsign(ed)? ?in\b/i.test(text);

/** A failure that means the conversation to continue is gone. */
export const lostSession = (text: string): boolean => /no conversation found|session[^.]*not found|thread[^.]*not found|no (rollout|session) found/i.test(text);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * One run of an AI: the items it adds to the conversation, and what it said about itself (its session, whether it
 * finished, its own error). The readers below fill it from each tool's output.
 */
export class Turn {
  session?: string;
  /** The run ended the way it should (a result, or a completed turn). */
  done = false;
  /** The AI's own error text, when the run failed. */
  failed?: string;
  /** Say the next usage warning (one per app session is enough). */
  warnUsage: boolean;
  readonly agent: AskAgentId;
  /** Names this run's items where a tool numbers them from the start in every run. */
  readonly run: string;
  private items: AskItem[];
  private changed: () => void;

  constructor(agent: AskAgentId, run: string, items: AskItem[], changed: () => void, warnUsage = true) {
    this.agent = agent;
    this.run = run;
    this.items = items;
    this.changed = changed;
    this.warnUsage = warnUsage;
  }

  private find<K extends AskItem['kind']>(kind: K, id: string): Extract<AskItem, { kind: K }> | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      if (it.kind === kind && (it as { id?: string }).id === id) return it as Extract<AskItem, { kind: K }>;
    }
    return undefined;
  }

  /** A reply's text: set (a whole block) or appended (a piece of one as it streams). */
  text(id: string, text: string, how: 'set' | 'append'): void {
    const it = this.find('ai', id);
    if (it) it.text = how === 'set' ? text : it.text + text;
    else this.items.push({ kind: 'ai', id, text });
    this.changed();
  }

  /** A tool call began; its input may come now or later. */
  toolStart(id: string, tool: string, input?: unknown): void {
    const it = this.find('tool', id);
    const args = input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length ? (input as Record<string, unknown>) : undefined;
    if (it) {
      if (args) it.input = args;
    } else this.items.push({ kind: 'tool', id, tool, ...(args ? { input: args } : {}), state: 'running' });
    this.changed();
  }

  toolEnd(id: string, ok: boolean, error?: string): void {
    const it = this.find('tool', id);
    if (!it) return;
    it.state = ok ? 'done' : 'failed';
    if (!ok && error?.trim()) it.error = error.trim().slice(0, 600);
    this.changed();
  }

  note(note: AskNote): void {
    this.items.push({ kind: 'note', note });
    this.changed();
  }

  /** Steps still running when the run ended: stopped (or cut short). */
  settle(): void {
    for (const it of this.items) if (it.kind === 'tool' && it.state === 'running') it.state = 'stopped';
    this.changed();
  }
}

/**
 * Claude Code's stream-json output. With partial messages, text arrives in pieces (stream_event); each finished
 * block then comes once more, whole, as an "assistant" event of its message, in order, so a block's place in its
 * message (its index) names it both ways. Tool calls start with the stream, their input comes with the whole block,
 * and their results come back as "user" events.
 */
export class ClaudeReader {
  private message = '';
  private open = new Map<number, string>();
  private blocks = new Map<string, number>();
  private turn: Turn;

  constructor(turn: Turn) {
    this.turn = turn;
  }

  line(raw: string): void {
    let o: Obj;
    try {
      o = obj(JSON.parse(raw));
    } catch {
      return;
    }
    // Subagents' own steps are not the conversation.
    if (o['parent_tool_use_id']) return;
    switch (o['type']) {
      case 'system': {
        if (o['subtype'] !== 'init') return;
        if (str(o['session_id'])) this.turn.session = str(o['session_id']);
        const server = (Array.isArray(o['mcp_servers']) ? o['mcp_servers'] : []).map(obj).find((s) => s['name'] === SERVER);
        if (server && server['status'] !== 'connected') this.turn.note({ code: 'no-tools', text: str(server['status']) || 'not connected' });
        return;
      }
      case 'stream_event': {
        const e = obj(o['event']);
        if (e['type'] === 'message_start') {
          this.message = str(obj(e['message'])['id']);
          this.open.clear();
        } else if (e['type'] === 'content_block_start') {
          const b = obj(e['content_block']);
          const index = Number(e['index']);
          if (b['type'] === 'text') {
            const id = `${this.message}:${index}`;
            this.open.set(index, id);
            this.turn.text(id, str(b['text']), 'set');
          } else if (b['type'] === 'tool_use') this.turn.toolStart(str(b['id']), toolName(str(b['name'])));
        } else if (e['type'] === 'content_block_delta') {
          const d = obj(e['delta']);
          const id = this.open.get(Number(e['index']));
          if (id && d['type'] === 'text_delta') this.turn.text(id, str(d['text']), 'append');
        }
        return;
      }
      case 'assistant': {
        const m = obj(o['message']);
        const mid = str(m['id']);
        const content = Array.isArray(m['content']) ? m['content'].map(obj) : [];
        const seen = this.blocks.get(mid) ?? 0;
        content.forEach((b, k) => {
          if (b['type'] === 'text') this.turn.text(`${mid}:${seen + k}`, str(b['text']), 'set');
          else if (b['type'] === 'tool_use') this.turn.toolStart(str(b['id']), toolName(str(b['name'])), b['input']);
        });
        this.blocks.set(mid, seen + content.length);
        return;
      }
      case 'user': {
        const m = obj(o['message']);
        for (const b of (Array.isArray(m['content']) ? m['content'] : []).map(obj)) {
          if (b['type'] === 'tool_result') this.turn.toolEnd(str(b['tool_use_id']), b['is_error'] !== true, b['is_error'] === true ? resultText(b['content']) : undefined);
        }
        return;
      }
      case 'rate_limit_event': {
        const info = obj(o['rate_limit_info']);
        const resets = typeof info['resetsAt'] === 'number' ? info['resetsAt'] * 1000 : undefined;
        if (info['status'] === 'rejected') this.turn.note({ code: 'limit', agent: 'claude-code', ...(resets ? { resets } : {}) });
        else if (info['status'] === 'allowed_warning' && this.turn.warnUsage && typeof info['utilization'] === 'number') {
          this.turn.warnUsage = false;
          this.turn.note({ code: 'usage', agent: 'claude-code', percent: Math.round(info['utilization'] * 100), window: str(info['rateLimitType']), ...(resets ? { resets } : {}) });
        }
        return;
      }
      case 'result': {
        this.turn.done = true;
        if (str(o['session_id'])) this.turn.session = str(o['session_id']);
        if (o['is_error'] === true || o['subtype'] !== 'success') {
          const errors = Array.isArray(o['errors']) ? o['errors'].map(String).join(' ') : '';
          this.turn.failed = str(o['result']) || errors || str(o['subtype']) || 'error';
        }
        return;
      }
    }
  }
}

/**
 * Codex's JSON events: a thread (its session), then items that start, change and complete: its messages, its MCP
 * tool calls, errors. Item ids start again at item_0 in every run, so the run names them.
 */
export class CodexReader {
  private turn: Turn;

  constructor(turn: Turn) {
    this.turn = turn;
  }

  line(raw: string): void {
    let o: Obj;
    try {
      o = obj(JSON.parse(raw));
    } catch {
      return;
    }
    switch (o['type']) {
      case 'thread.started':
        if (str(o['thread_id'])) this.turn.session = str(o['thread_id']);
        return;
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.item(obj(o['item']), o['type'] === 'item.completed');
        return;
      case 'turn.completed':
        // An error it recovered from (a dropped connection, retried) is no failure once the turn completes.
        this.turn.done = true;
        delete this.turn.failed;
        return;
      case 'turn.failed':
        this.turn.done = true;
        this.turn.failed = str(obj(o['error'])['message']) || 'failed';
        return;
      case 'error':
        this.turn.failed = str(o['message']) || 'error';
        return;
    }
  }

  private item(it: Obj, completed: boolean): void {
    const id = `${this.turn.run}:${str(it['id'])}`;
    switch (it['type']) {
      case 'agent_message':
        if (str(it['text'])) this.turn.text(id, str(it['text']), 'set');
        return;
      case 'mcp_tool_call': {
        const server = str(it['server']);
        this.turn.toolStart(id, server === SERVER || !server ? str(it['tool']) : `${server}.${str(it['tool'])}`, it['arguments']);
        const status = str(it['status']);
        if (completed || status === 'completed' || status === 'failed') {
          const result = obj(it['result']);
          const error = it['error'] ? (typeof it['error'] === 'string' ? it['error'] : str(obj(it['error'])['message'])) : '';
          const isError = status === 'failed' || !!error || result['is_error'] === true || result['isError'] === true;
          this.turn.toolEnd(id, !isError, isError ? error || resultText(result['content']) : undefined);
        }
        return;
      }
      case 'error':
        if (str(it['message'])) this.turn.note({ code: 'failed', agent: 'codex', text: str(it['message']) });
        return;
    }
  }
}

/**
 * The script an npm command shim (a Windows .cmd file) runs, relative to the shim's folder: npm writes
 * `"%dp0%\node_modules\@openai\codex\bin\codex.js" %*`. Null when it is not such a shim.
 */
export function shimScript(cmd: string): string | null {
  const m = /"%~?dp0%?\\([^"]+?\.[cm]?js)"/i.exec(cmd) ?? /%~?dp0%?\\(\S+?\.[cm]?js)/i.exec(cmd);
  return m ? m[1]!.replace(/\\/g, '/') : null;
}

const TRIPLES: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
};

/** Where the npm package @openai/codex (its folder) keeps its native program, most likely first. */
export function codexNative(pkgRoot: string, platform: NodeJS.Platform, arch: string): string[] {
  const triple = TRIPLES[`${platform}-${arch}`];
  if (!triple) return [];
  const exe = platform === 'win32' ? 'codex.exe' : 'codex';
  const pkg = `codex-${platform}-${arch}`;
  return [
    join(pkgRoot, 'node_modules', '@openai', pkg, 'vendor', triple, 'bin', exe),
    join(pkgRoot, '..', pkg, 'vendor', triple, 'bin', exe),
    join(pkgRoot, 'vendor', triple, 'bin', exe),
    join(pkgRoot, 'vendor', triple, 'codex', exe),
  ];
}

/** `claude auth status` (JSON): signed in, and whether with a plan (claude.ai) or a billed account. */
export function claudeAuth(out: string): { signedIn: boolean | null; billed?: boolean } {
  const start = out.indexOf('{');
  if (start < 0) return { signedIn: null };
  try {
    const j = obj(JSON.parse(out.slice(start)));
    if (typeof j['loggedIn'] !== 'boolean') return { signedIn: null };
    const plan = str(j['authMethod']) === 'claude.ai';
    return { signedIn: j['loggedIn'], ...(j['loggedIn'] && !plan ? { billed: true } : {}) };
  } catch {
    return { signedIn: null };
  }
}

/** `codex login status`: "Logged in using ChatGPT", "Logged in using an API key ...", or "Not logged in". */
export function codexAuth(out: string): { signedIn: boolean | null; billed?: boolean } {
  if (/not logged in/i.test(out)) return { signedIn: false };
  if (/logged in/i.test(out)) return { signedIn: true, ...(/api key/i.test(out) ? { billed: true } : {}) };
  return { signedIn: null };
}
