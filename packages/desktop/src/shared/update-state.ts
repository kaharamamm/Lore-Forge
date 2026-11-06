/**
 * Self-update state, kept pure so it can be tested without Electron. The main process feeds it events from
 * electron-updater; the renderer only reads the state (the toast, and Updates in About).
 *
 * Flow: check -> available (Download / Later / What's new) -> downloading -> ready (Restart to update) -> installing.
 * macOS builds are unsigned and cannot install themselves, so there "Download" opens the download page.
 */
export type UpdateStatus = 'off' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  /** The running app's version. */
  version: string;
  /** Why updates are off (development, the smoke test, a package type that cannot update itself...). */
  offReason?: string;
  /** The newer version, once one is found. */
  latest?: string;
  /** Its release notes, as plain text. */
  notes?: string;
  /** Download progress, 0-100. */
  percent?: number;
  error?: string;
  /** macOS: a found update is downloaded by hand from the release page. */
  manual?: boolean;
}

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'none' }
  | { type: 'found'; version: string; notes?: string }
  | { type: 'download' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'install' }
  | { type: 'install-failed'; message: string }
  | { type: 'error'; message: string };

export interface UpdaterEnv {
  isPackaged: boolean;
  smoke: boolean;
  /** LORE_FORGE_NO_UPDATE=1 turns it off by hand. */
  disabled: boolean;
  platform: string;
  /** Linux: electron-builder's resources/package-type (deb, rpm, pacman), if any. */
  packageType?: string | null;
  /** Linux: running from an AppImage (the APPIMAGE environment variable). */
  appImage?: boolean;
}

/** Whether the updater runs, and if not, why: never in development or the smoke test. */
export function updaterOff(env: UpdaterEnv): string | null {
  if (env.smoke) return 'Updates are off in the smoke test.';
  if (!env.isPackaged) return 'Updates are off when running from source.';
  if (env.disabled) return 'Updates are turned off (LORE_FORGE_NO_UPDATE).';
  if (env.platform === 'linux' && !env.appImage && env.packageType !== 'deb') return 'This package cannot update itself. Download the new .deb or AppImage from the releases page.';
  return null;
}

export function initialUpdateState(version: string, offReason: string | null, manual = false): UpdateState {
  if (offReason) return { status: 'off', version, offReason };
  return manual ? { status: 'idle', version, manual } : { status: 'idle', version };
}

const BUSY: readonly UpdateStatus[] = ['downloading', 'ready', 'installing'];

export function nextUpdateState(s: UpdateState, e: UpdateEvent): UpdateState {
  if (s.status === 'off') return s;
  const base: UpdateState = { status: s.status, version: s.version, ...(s.manual ? { manual: true } : {}) };
  const found = { ...(s.latest ? { latest: s.latest } : {}), ...(s.notes ? { notes: s.notes } : {}) };
  switch (e.type) {
    // A check while downloading, ready or installing changes nothing.
    case 'check': return BUSY.includes(s.status) ? s : { ...base, ...found, status: 'checking' };
    case 'none': return BUSY.includes(s.status) ? s : { ...base, status: 'current' };
    case 'found': return BUSY.includes(s.status) ? s : { ...base, status: 'available', latest: e.version, ...(e.notes ? { notes: e.notes } : {}) };
    case 'download': return s.status === 'available' && !s.manual ? { ...base, ...found, status: 'downloading', percent: 0 } : s;
    case 'progress': return s.status === 'downloading' || s.status === 'available' ? { ...base, ...found, status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(e.percent))) } : s;
    case 'downloaded': return s.status === 'installing' ? s : { ...base, ...found, status: 'ready', latest: e.version };
    case 'install': return s.status === 'ready' ? { ...s, status: 'installing' } : s;
    // A cancelled password prompt or a failed install keeps the downloaded update ready for another try.
    case 'install-failed': return s.status === 'installing' ? { ...s, status: 'ready', error: e.message } : s;
    // An error after the download keeps the update ready to install.
    case 'error': return s.status === 'ready' || s.status === 'installing' ? s : { ...base, ...found, status: 'error', error: e.message };
  }
}

/** electron-updater's error, shortened to one readable line. GitHub answers 404 for a private repository too. */
export function updateErrorText(message: string): string {
  if (/\b404\b/.test(message)) return 'no public release found on GitHub.';
  if (/ENOTFOUND|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|ETIMEDOUT/.test(message)) return 'you seem to be offline.';
  return (message.split('\n')[0] ?? message).trim().slice(0, 160) || 'unknown error.';
}

/** One line for the toast and About. */
export function updateText(s: UpdateState): string {
  switch (s.status) {
    case 'off': return s.offReason ?? 'Updates are off.';
    case 'idle': return '';
    case 'checking': return 'Checking for updates…';
    case 'current': return 'Lore-Forge is up to date.';
    case 'available': return `Lore-Forge ${s.latest} is available.`;
    case 'downloading': return `Downloading Lore-Forge ${s.latest ?? ''}… ${s.percent ?? 0}%`.replace('  ', ' ');
    case 'ready': return s.error ? `Lore-Forge ${s.latest} is ready, but did not install: ${s.error}` : `Lore-Forge ${s.latest} is ready. Restart to update.`;
    case 'installing': return 'Installing the update…';
    case 'error': return `Could not check for updates: ${s.error}`;
  }
}

/** "Download" (or, on macOS, the download page) for a found update. */
export const canDownload = (s: UpdateState): boolean => s.status === 'available';
/** "Restart to update" only once the update is downloaded. */
export const canInstall = (s: UpdateState): boolean => s.status === 'ready';
/** "Check now" unless updates are off or one is already on its way. */
export const canCheck = (s: UpdateState): boolean => !(['off', 'checking', ...BUSY] as UpdateStatus[]).includes(s.status);
/** The toast shows while there is something to act on or watch. */
export const showToast = (s: UpdateState): boolean => (['available', 'downloading', 'ready', 'installing'] as UpdateStatus[]).includes(s.status);

/** Newer by number: 1.10.0 > 1.9.3; a pre-release (1.2.0-beta) is older than its release. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const [main = '', pre] = v.replace(/^v/, '').split('-', 2);
    return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return d > 0;
  }
  if (a.pre === b.pre) return false;
  if (a.pre === null) return true;
  if (b.pre === null) return false;
  return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0;
}

/** GitHub release notes arrive as HTML (or a list of them); the app shows them as plain text. */
export function notesText(notes: unknown): string {
  const list = Array.isArray(notes) ? notes.map((n) => (n && typeof n === 'object' && 'note' in n ? String((n as { note: unknown }).note ?? '') : String(n))) : [typeof notes === 'string' ? notes : ''];
  return list
    .join('\n\n')
    .replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The release page for a version, for "What's new". */
export const releasePage = (version?: string): string =>
  version ? `https://github.com/kaharamamm/Lore-Forge/releases/tag/v${version.replace(/^v/, '')}` : 'https://github.com/kaharamamm/Lore-Forge/releases/latest';

/**
 * Linux .deb install: one password prompt (pkexec) runs dpkg and, only if dependencies are missing, apt-get -f in
 * the same root shell. The file path is passed as an argument, never spliced into the script. `sudo` may be swapped
 * (LORE_FORGE_UPDATE_SUDO) for a test machine without a polkit agent.
 */
export function debInstallCommand(file: string, sudo = 'pkexec'): [string, string[]] {
  const [cmd = 'pkexec', ...pre] = sudo.trim().split(/\s+/);
  return [cmd, [...pre, '/bin/sh', '-c', 'dpkg -i "$1" || apt-get install -f -y', 'lore-forge-update', file]];
}
