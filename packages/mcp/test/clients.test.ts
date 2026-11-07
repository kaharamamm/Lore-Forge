import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claudeCodeAddArgs, claudeDesktopWindowsDir, clientDefs, connectJson, connectToml, disconnectJson, disconnectToml, jsonConnected, serversJson, shellLine, tomlConnected, withoutTomlTable,
  type McpLaunch,
} from '../src/clients.ts';

const exe = String.raw`C:\Users\Ann\AppData\Local\Programs\Lore-Forge\Lore-Forge.exe`;
const cli = String.raw`C:\Users\Ann\AppData\Local\Programs\Lore-Forge\resources\app.asar\dist\cli.cjs`;
const launch: McpLaunch = { command: exe, args: [cli, 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } };

test('JSON apps: lore-forge is added next to the other servers and removed again, the rest untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lore-clients-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'claude_desktop_config.json');
  writeFileSync(file, JSON.stringify({ globalShortcut: 'Ctrl+Space', mcpServers: { files: { command: 'npx', args: ['files'] } } }));
  assert.equal(jsonConnected(file), false);
  connectJson(file, launch);
  const d = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(d.globalShortcut, 'Ctrl+Space');
  assert.deepEqual(d.mcpServers.files, { command: 'npx', args: ['files'] });
  assert.deepEqual(d.mcpServers['lore-forge'], launch);
  assert.ok(jsonConnected(file));
  assert.ok(existsSync(`${file}.before-lore-forge`), 'the original is kept once');
  disconnectJson(file);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { globalShortcut: 'Ctrl+Space', mcpServers: { files: { command: 'npx', args: ['files'] } } });
  const missing = join(dir, 'new', 'mcp.json');
  connectJson(missing, launch);
  assert.ok(jsonConnected(missing), 'a missing file is created');
  writeFileSync(file, '{ not json');
  assert.throws(() => connectJson(file, launch), /not valid JSON/);
  assert.equal(readFileSync(file, 'utf8'), '{ not json', 'a broken file is left alone');
});

test('Codex: the [mcp_servers.lore-forge] table is added, replaced and removed without touching other tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lore-codex-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'config.toml');
  writeFileSync(file, 'model = "gpt-5"\n\n[mcp_servers.files]\ncommand = "npx"\n\n[mcp_servers.lore-forge]\ncommand = "old"\n\n[mcp_servers.lore-forge.env]\nX = "1"\n\n[profiles.fast]\nmodel = "mini"\n');
  connectToml(file, launch);
  const text = readFileSync(file, 'utf8');
  assert.equal(text.match(/\[mcp_servers\.lore-forge\]/g)?.length, 1);
  assert.ok(!text.includes('command = "old"') && !text.includes('X = "1"'), 'the old table and its sub-table are gone');
  assert.match(text, /\[mcp_servers\.files\]\ncommand = "npx"/);
  assert.match(text, /\[profiles\.fast\]\nmodel = "mini"/);
  assert.ok(text.includes(`command = '${exe}'`), 'Windows paths are TOML literal strings, backslashes as they are');
  assert.ok(text.includes(`args = ['${cli}', 'mcp']`));
  assert.match(text, /env = \{ ELECTRON_RUN_AS_NODE = '1' \}/);
  assert.ok(tomlConnected(file));
  disconnectToml(file);
  assert.ok(!tomlConnected(file));
  assert.match(readFileSync(file, 'utf8'), /^model = "gpt-5"\n\n\[mcp_servers\.files\]/);
  assert.equal(withoutTomlTable('[a]\nx = 1\n[mcp_servers."lore-forge"]\ny = 2\n[b]\n'), '[a]\nx = 1\n[b]\n');
});

test('Claude Code gets a user-scope `claude mcp add` line; every app has a config place', () => {
  assert.deepEqual(claudeCodeAddArgs(launch).slice(0, 4), ['mcp', 'add', '--env', 'ELECTRON_RUN_AS_NODE=1']);
  // The name right after a single-value option: Claude Code's --env takes several values and would swallow it.
  assert.deepEqual(claudeCodeAddArgs(launch).slice(-9, -4), ['--transport', 'stdio', '--scope', 'user', 'lore-forge']);
  assert.deepEqual(claudeCodeAddArgs(launch).slice(-4), ['--', exe, cli, 'mcp']);
  assert.equal(shellLine('claude', ['mcp', 'add', String.raw`C:\Program Files\x.exe`], 'win32'), String.raw`claude mcp add "C:\Program Files\x.exe"`);
  assert.equal(shellLine('claude', ['a b'], 'linux'), "claude 'a b'");
  const defs = clientDefs({ APPDATA: String.raw`C:\Users\Ann\AppData\Roaming` }, 'win32', String.raw`C:\Users\Ann`);
  assert.deepEqual(defs.map((d) => d.id), ['claude-desktop', 'claude-code', 'codex', 'cursor']);
  assert.match(defs[0]!.file, /Roaming[\\/]Claude[\\/]claude_desktop_config\.json$/);
  assert.equal(JSON.parse(serversJson(launch)).mcpServers['lore-forge'].command, exe);
});

test('Claude Desktop on Windows: the folder its kind of install reads', () => {
  const home = mkdtempSync(join(tmpdir(), 'lore-claude-desktop-'));
  after(() => rmSync(home, { recursive: true, force: true }));
  const env = { APPDATA: join(home, 'Roaming'), LOCALAPPDATA: join(home, 'Local') };
  assert.equal(claudeDesktopWindowsDir(env, home), join(home, 'Roaming', 'Claude'), 'the classic installer');
  const redirected = join(home, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
  mkdirSync(redirected, { recursive: true });
  assert.equal(claudeDesktopWindowsDir(env, home), redirected, 'an older Microsoft Store build: its redirected AppData');
  writeFileSync(join(redirected, '.user-data-left.claude_pzs8sxrjxfjjc'), '');
  assert.equal(claudeDesktopWindowsDir(env, home), join(home, 'Roaming', 'Claude'), 'a redirected folder whose data moved away is not used');
  const data = join(home, 'Local', 'Claude-Data', 'claude_pzs8sxrjxfjjc');
  mkdirSync(data, { recursive: true });
  assert.equal(claudeDesktopWindowsDir(env, home), data, 'a newer Microsoft Store build: Claude-Data');
  assert.equal(clientDefs(env, 'win32', home)[0]!.file, join(data, 'claude_desktop_config.json'));
});
