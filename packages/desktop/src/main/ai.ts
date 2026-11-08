/**
 * Connect AI (library → Connect AI): adds the Lore-Forge MCP server to AI apps (Claude Desktop, Claude Code, Codex,
 * Cursor; any other app through a copied snippet) and keeps the picture service settings (service, key, model).
 * API keys stay in the main process; the window only ever sees their last four characters.
 */
import { app, clipboard, ipcMain } from 'electron';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  claudeCodeAddArgs, claudeCodeRemoveArgs, clientDefs, connectJson, connectToml, disconnectJson, disconnectToml, serversJson, shellLine, SERVER_KEY,
  type ClientDef, type McpLaunch,
} from '@lore-forge/mcp/clients';
import { IMAGE_PROVIDERS, listImageModels, pickImageModel, PROVIDER_INFO, readImageSettings, writeImageSettings, type ImageProvider } from '@lore-forge/mcp/images';
import type { AiClient, AiPictures, AiState, PictureCheck, PictureProvider } from '../shared/api.ts';
import { t } from '../shared/i18n.ts';

/** How AI apps start the server: this app's own Electron in Node mode, running the bundled `lore mcp`. */
function mcpLaunch(defaultWorldsDir: string): { launch: McpLaunch | null; unavailable?: string } {
  if (process.env['APPIMAGE']) {
    return { launch: null, unavailable: t('The AppImage unpacks itself to a new place every time it starts, so an AI app could not find it again. Install the .deb, or run Lore-Forge from source, to connect an AI app.') };
  }
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1', LORE_FORGE_DATA: app.getPath('userData') };
  // From source, new books go to the repository's worlds/ folder, as in the app.
  if (!app.isPackaged) env['LORE_FORGE_WORLDS'] = defaultWorldsDir;
  return { launch: { command: process.execPath, args: [join(app.getAppPath(), 'dist', 'cli.cjs'), 'mcp'], env } };
}

/** The `claude` command of Claude Code, if installed (GUI apps on macOS do not see the shell's PATH: known places too). */
function findClaude(): string | null {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const found = out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && existsSync(s));
    const best = found.find((s) => /\.exe$/i.test(s)) ?? found.find((s) => /\.(cmd|bat)$/i.test(s)) ?? (process.platform === 'win32' ? undefined : found[0]);
    if (best) return best;
  } catch { /* not on PATH */ }
  const home = homedir();
  const places = process.platform === 'win32'
    ? [join(home, '.local', 'bin', 'claude.exe'), join(process.env['APPDATA'] ?? '', 'npm', 'claude.cmd')]
    : [join(home, '.local', 'bin', 'claude'), join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude'];
  return places.find((p) => p && existsSync(p)) ?? null;
}

function runClaude(path: string, args: string[]): void {
  const script = /\.(cmd|bat)$/i.test(path);
  const r = script
    ? spawnSync(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', `"${[path, ...args].map((a) => `"${a}"`).join(' ')}"`], { encoding: 'utf8', timeout: 60_000, windowsHide: true, windowsVerbatimArguments: true })
    : spawnSync(path, args, { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  if (r.status !== 0) throw new Error(t('Claude Code said: {output}', { output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() || r.error?.message || `exit ${r.status}` }));
}

/** The command the app's lore-forge entry starts, or null when there is none. */
function connectedCommand(def: ClientDef): string | null {
  try {
    if (!existsSync(def.file)) return null;
    const text = readFileSync(def.file, 'utf8');
    if (def.format === 'toml') {
      const table = text.split(/\r?\n\s*\[/).find((t) => new RegExp(`^\\s*\\[?mcp_servers\\.("?)${SERVER_KEY}\\1\\]`).test(t));
      if (!table) return null;
      return /command\s*=\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/.exec(table)?.slice(1).find((x) => x !== undefined)?.replace(/\\\\/g, '\\') ?? '';
    }
    const entry = (JSON.parse(text.replace(/^﻿/, '')) as { mcpServers?: Record<string, { command?: string }> }).mcpServers?.[SERVER_KEY];
    return entry ? (entry.command ?? '') : null;
  } catch {
    return null;
  }
}

function clientState(def: ClientDef, launch: McpLaunch | null, claude: string | null): AiClient {
  const command = connectedCommand(def);
  return {
    id: def.id,
    name: def.name,
    installed: existsSync(def.home) || (def.id === 'claude-code' && !!claude),
    connected: command === null ? 'no' : !launch || command === launch.command ? 'yes' : 'elsewhere',
    canConnect: !!launch && (def.format !== 'cli' || !!claude),
    after: def.after,
    ...(def.format === 'cli' && launch ? { command: shellLine('claude', claudeCodeAddArgs(launch)) } : {}),
  };
}

function picturesState(): AiPictures {
  const s = readImageSettings(app.getPath('userData'));
  const keys: AiPictures['keys'] = {};
  for (const p of IMAGE_PROVIDERS) {
    const k = s.keys?.[p];
    if (k) keys[p] = `…${k.slice(-4)}`;
  }
  return {
    provider: s.provider ?? 'none',
    keys,
    models: { ...s.models },
    providers: IMAGE_PROVIDERS.map((p) => ({ id: p, label: PROVIDER_INFO[p].label, keyPage: PROVIDER_INFO[p].keyPage })),
  };
}

export function registerAi(defaultWorldsDir: () => string): void {
  ipcMain.handle('aiState', (): AiState => {
    const { launch, unavailable } = mcpLaunch(defaultWorldsDir());
    const claude = findClaude();
    return {
      clients: clientDefs().map((d) => clientState(d, launch, claude)),
      pictures: picturesState(),
      setup: launch ? serversJson(launch) : null,
      ...(unavailable ? { unavailable } : {}),
    };
  });

  ipcMain.handle('aiConnect', (_e, id: string, on: boolean): AiClient => {
    const def = clientDefs().find((d) => d.id === id);
    if (!def) throw new Error(t('Unknown AI app {id}.', { id }));
    const { launch, unavailable } = mcpLaunch(defaultWorldsDir());
    if (on && !launch) throw new Error(unavailable);
    const claude = def.format === 'cli' ? findClaude() : null;
    if (def.format === 'json') (on ? connectJson(def.file, launch!) : disconnectJson(def.file));
    else if (def.format === 'toml') (on ? connectToml(def.file, launch!) : disconnectToml(def.file));
    else {
      if (!claude) throw new Error(t('Claude Code\'s "claude" command was not found. Copy the command and run it in a terminal instead.'));
      // Replace an older entry (another install, or the app moved) rather than fail on "already exists".
      if (connectedCommand(def) !== null) runClaude(claude, claudeCodeRemoveArgs());
      if (on) runClaude(claude, claudeCodeAddArgs(launch!));
    }
    return clientState(def, launch, claude);
  });

  ipcMain.handle('aiCheckPictures', async (_e, provider: PictureProvider, key?: string): Promise<PictureCheck> => {
    const p = provider as ImageProvider;
    if (!IMAGE_PROVIDERS.includes(p)) return { ok: false, error: t('Choose a picture service first.') };
    const useKey = key?.trim() || readImageSettings(app.getPath('userData')).keys?.[p];
    if (!useKey) return { ok: false, error: t('Paste an API key first.') };
    try {
      const models = await listImageModels(p, useKey);
      const model = pickImageModel(p, models);
      if (!model) return { ok: false, error: t("The key works, but {service} offers it no image model. Check the account's access to image generation.", { service: PROVIDER_INFO[p].label }) };
      return { ok: true, model, models };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('aiSavePictures', (_e, next: { provider: PictureProvider | 'none'; key?: string; model?: string }): AiPictures => {
    const dir = app.getPath('userData');
    const s = readImageSettings(dir);
    const p = next.provider;
    const keys = { ...s.keys };
    const models = { ...s.models };
    if (p !== 'none') {
      if (next.key?.trim()) keys[p] = next.key.trim();
      if (next.model?.trim()) models[p] = next.model.trim();
      else if (next.key?.trim()) delete models[p]; // a new key: find its best model again
    }
    writeImageSettings(dir, { provider: p, keys, models });
    return picturesState();
  });

  ipcMain.handle('aiForgetKey', (_e, provider: PictureProvider): AiPictures => {
    const dir = app.getPath('userData');
    const s = readImageSettings(dir);
    const keys = { ...s.keys };
    const models = { ...s.models };
    delete keys[provider];
    delete models[provider];
    writeImageSettings(dir, { ...s, provider: s.provider === provider ? 'none' : s.provider ?? 'none', keys, models });
    return picturesState();
  });

  ipcMain.handle('copyText', (_e, text: string) => clipboard.writeText(text));
}
