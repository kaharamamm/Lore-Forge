// Starts unpackaged Electron. On Ubuntu, AppArmor blocks the user-namespace sandbox and
// chrome-sandbox in node_modules is not a root setuid helper, so Electron aborts.
// Pass --no-sandbox only in that case. A chmod 4755 helper keeps the sandbox on.
import { execFileSync, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electron = require('electron');

function helperIsSetuidRoot() {
  try {
    const st = statSync(join(dirname(electron), 'chrome-sandbox'));
    return st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}

function userNamespacesRestricted() {
  try {
    return execFileSync('sysctl', ['-n', 'kernel.apparmor_restrict_unprivileged_userns'], { encoding: 'utf8' }).trim() === '1';
  } catch {
    return false;
  }
}

const args = ['.'];
const env = { ...process.env };
if (process.platform === 'linux' && (env.LORE_FORGE_NO_SANDBOX === '1' || (!helperIsSetuidRoot() && userNamespacesRestricted()))) {
  args.unshift('--no-sandbox');
  env.LORE_FORGE_NO_SANDBOX = '1';
}

const child = spawn(electron, args, { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
