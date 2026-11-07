/**
 * Adding Lore-Forge to AI apps: where each app keeps its MCP servers, and adding or removing the one "lore-forge"
 * entry without touching anything else in those files. A file that cannot be read safely is left alone.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const SERVER_KEY = 'lore-forge';

/** How an AI app starts the Lore-Forge MCP server. */
export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type ClientId = 'claude-desktop' | 'claude-code' | 'codex' | 'cursor';

export interface ClientDef {
  id: ClientId;
  name: string;
  /** Where the app keeps its MCP servers. */
  file: string;
  /** json: an "mcpServers" map; toml: Codex's [mcp_servers.<name>] tables; cli: changed with the app's own command. */
  format: 'json' | 'toml' | 'cli';
  /** A folder that exists once the app has been installed and run. */
  home: string;
  /** What to do after connecting so the app sees the change. */
  after: string;
}

/**
 * Claude Desktop's folder on Windows, which depends on how it was installed. The Microsoft Store (MSIX) build keeps it
 * in %LOCALAPPDATA%\Claude-Data\claude_<package id> (newer) or in the package's redirected copy of AppData (older,
 * until its data moves and leaves a ".user-data-left" mark there); the classic installer in %APPDATA%\Claude.
 */
export function claudeDesktopWindowsDir(env: NodeJS.ProcessEnv, home: string): string {
  const local = env['LOCALAPPDATA'] || join(home, 'AppData', 'Local');
  const folders = (dir: string, name: RegExp): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && name.test(d.name)).map((d) => join(dir, d.name));
    } catch {
      return [];
    }
  };
  const changed = (dir: string) => { try { return statSync(dir).mtimeMs; } catch { return 0; } };
  const data = folders(join(local, 'Claude-Data'), /^claude_/i).sort((a, b) => changed(b) - changed(a))[0];
  if (data) return data;
  for (const pkg of folders(join(local, 'Packages'), /^Claude_/i)) {
    const redirected = join(pkg, 'LocalCache', 'Roaming', 'Claude');
    try {
      if (!readdirSync(redirected).some((n) => n.startsWith('.user-data-left'))) return redirected;
    } catch { /* not there */ }
  }
  return join(env['APPDATA'] || join(home, 'AppData', 'Roaming'), 'Claude');
}

export function clientDefs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): ClientDef[] {
  const claudeDesktop = platform === 'win32' ? claudeDesktopWindowsDir(env, home)
    : platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude')
    : join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'Claude');
  const codex = env['CODEX_HOME'] || join(home, '.codex');
  return [
    { id: 'claude-desktop', name: 'Claude Desktop', file: join(claudeDesktop, 'claude_desktop_config.json'), format: 'json', home: claudeDesktop, after: 'Quit Claude Desktop completely and open it again.' },
    { id: 'claude-code', name: 'Claude Code', file: join(home, '.claude.json'), format: 'cli', home: join(home, '.claude'), after: 'Start a new Claude Code session.' },
    { id: 'codex', name: 'Codex', file: join(codex, 'config.toml'), format: 'toml', home: codex, after: 'Start a new Codex session.' },
    { id: 'cursor', name: 'Cursor', file: join(home, '.cursor', 'mcp.json'), format: 'json', home: join(home, '.cursor'), after: 'Reload Cursor (or open Settings → MCP).' },
  ];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The usual { "mcpServers": { "lore-forge": ... } } snippet, for any other MCP app. */
export function serversJson(launch: McpLaunch): string {
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: { command: launch.command, args: launch.args, env: launch.env } } }, null, 2);
}

function readJson(file: string): Obj {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON, so Lore-Forge left it alone. Fix it (or move it away) and try again.`);
  }
  if (!isObj(v)) throw new Error(`${file} does not hold a JSON object, so Lore-Forge left it alone.`);
  return v;
}

/** The first time Lore-Forge changes another app's file, a copy of the original is kept next to it. */
function keepOriginal(file: string): void {
  const copy = `${file}.before-lore-forge`;
  if (existsSync(file) && !existsSync(copy)) copyFileSync(file, copy);
}

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  keepOriginal(file);
  writeFileSync(file, text, 'utf8');
}

export function jsonConnected(file: string): boolean {
  try {
    const servers = readJson(file)['mcpServers'];
    return isObj(servers) && SERVER_KEY in servers;
  } catch {
    return false;
  }
}

export function connectJson(file: string, launch: McpLaunch): void {
  const d = readJson(file);
  const servers = isObj(d['mcpServers']) ? d['mcpServers'] : {};
  d['mcpServers'] = { ...servers, [SERVER_KEY]: { command: launch.command, args: launch.args, env: launch.env } };
  write(file, JSON.stringify(d, null, 2) + '\n');
}

export function disconnectJson(file: string): void {
  if (!existsSync(file)) return;
  const d = readJson(file);
  if (!isObj(d['mcpServers']) || !(SERVER_KEY in d['mcpServers'])) return;
  const { [SERVER_KEY]: _gone, ...rest } = d['mcpServers'];
  d['mcpServers'] = rest;
  write(file, JSON.stringify(d, null, 2) + '\n');
}

// ------------------------------------------------------------------------------------------------ Codex (TOML)

/** A TOML string: literal ('...') when it can be, so Windows backslashes stay as they are. */
const tomlString = (s: string): string => (/['\n\r]/.test(s) ? JSON.stringify(s) : `'${s}'`);
const OUR_TABLE = new RegExp(`^mcp_servers\\.(?:"${SERVER_KEY}"|${SERVER_KEY})(?:\\..*)?$`);

export function tomlTable(launch: McpLaunch): string {
  const env = Object.entries(launch.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(', ');
  return `[mcp_servers.${SERVER_KEY}]\ncommand = ${tomlString(launch.command)}\nargs = [${launch.args.map(tomlString).join(', ')}]\n${env ? `env = { ${env} }\n` : ''}`;
}

/** The text without the [mcp_servers.lore-forge] table (and its sub-tables): everything up to the next table header. */
export function withoutTomlTable(text: string): string {
  const out: string[] = [];
  let skip = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) skip = OUR_TABLE.test(header[1]!.replace(/\s*\.\s*/g, '.'));
    if (!skip) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function tomlConnected(file: string): boolean {
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8').split(/\r?\n/).some((line) => {
    const header = /^\s*\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/.exec(line);
    return !!header && OUR_TABLE.test(header[1]!.replace(/\s*\.\s*/g, '.'));
  });
}

export function connectToml(file: string, launch: McpLaunch): void {
  const rest = existsSync(file) ? withoutTomlTable(readFileSync(file, 'utf8')).trimEnd() : '';
  write(file, rest ? `${rest}\n\n${tomlTable(launch)}` : tomlTable(launch));
}

export function disconnectToml(file: string): void {
  if (!tomlConnected(file)) return;
  write(file, withoutTomlTable(readFileSync(file, 'utf8')).trimEnd() + '\n');
}

// ------------------------------------------------------------------------------------------------ Claude Code

/** `claude mcp add` arguments: user scope, so every Claude Code project has Lore-Forge. */
export function claudeCodeAddArgs(launch: McpLaunch): string[] {
  // --env takes several values, so it would swallow the name: the env options go first, the name after --scope user.
  return ['mcp', 'add', ...Object.entries(launch.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--transport', 'stdio', '--scope', 'user', SERVER_KEY, '--', launch.command, ...launch.args];
}
export const claudeCodeRemoveArgs = (): string[] => ['mcp', 'remove', '--scope', 'user', SERVER_KEY];

/** One line to paste into a terminal. */
export function shellLine(command: string, args: string[], platform: NodeJS.Platform = process.platform): string {
  const q = (s: string) => (/^[\w@%+=:,./\\-]+$/.test(s) ? s : platform === 'win32' ? `"${s.replace(/"/g, '\\"')}"` : `'${s.replace(/'/g, `'\\''`)}'`);
  return [command, ...args].map(q).join(' ');
}

/** Claude Code keeps user-scope servers in ~/.claude.json; reading it is safe, writing is left to `claude mcp`. */
export const claudeCodeConnected = (file: string): boolean => jsonConnected(file);
