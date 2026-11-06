import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCheck, canDownload, canInstall, debInstallCommand, initialUpdateState, isNewer, nextUpdateState, notesText, releasePage, showToast, updateErrorText, updaterOff, updateText, type UpdateEvent, type UpdateState } from '../src/shared/update-state.ts';

const run = (events: UpdateEvent[], s: UpdateState = initialUpdateState('1.0.0', null)) => events.reduce(nextUpdateState, s);
const packaged = { isPackaged: true, smoke: false, disabled: false, platform: 'win32' };

test('the updater is off in development, the smoke test, by hand, and for Linux packages that cannot update', () => {
  assert.match(updaterOff({ ...packaged, isPackaged: false })!, /from source/);
  assert.match(updaterOff({ ...packaged, smoke: true })!, /smoke/);
  assert.match(updaterOff({ ...packaged, disabled: true })!, /LORE_FORGE_NO_UPDATE/);
  assert.match(updaterOff({ ...packaged, platform: 'linux', packageType: 'rpm' })!, /cannot update itself/);
  assert.equal(updaterOff({ ...packaged, platform: 'linux', packageType: 'deb' }), null);
  assert.equal(updaterOff({ ...packaged, platform: 'linux', appImage: true }), null);
  assert.equal(updaterOff({ ...packaged, platform: 'darwin' }), null);
});

test('off stays off whatever happens, and says why', () => {
  const s = run([{ type: 'check' }, { type: 'found', version: '2.0.0' }, { type: 'download' }, { type: 'downloaded', version: '2.0.0' }], initialUpdateState('1.0.0', 'Updates are off when running from source.'));
  assert.equal(s.status, 'off');
  assert.equal(updateText(s), 'Updates are off when running from source.');
  assert.ok(!canCheck(s) && !canInstall(s) && !canDownload(s) && !showToast(s));
});

test('check, found (Download / Later / What\'s new), download with progress, ready: Restart to update', () => {
  let s = run([{ type: 'check' }]);
  assert.equal(s.status, 'checking');
  assert.ok(!canCheck(s) && !showToast(s));
  s = run([{ type: 'found', version: '1.1.0', notes: 'Duplicate worlds.' }], s);
  assert.equal(updateText(s), 'Lore-Forge 1.1.0 is available.');
  assert.ok(canDownload(s) && showToast(s) && canCheck(s));
  s = run([{ type: 'download' }, { type: 'progress', percent: 41.6 }], s);
  assert.deepEqual(s, { status: 'downloading', version: '1.0.0', latest: '1.1.0', notes: 'Duplicate worlds.', percent: 42 });
  assert.equal(updateText(s), 'Downloading Lore-Forge 1.1.0… 42%');
  s = run([{ type: 'downloaded', version: '1.1.0' }], s);
  assert.ok(canInstall(s) && !canCheck(s) && !canDownload(s));
  assert.equal(updateText(s), 'Lore-Forge 1.1.0 is ready. Restart to update.');
  assert.equal(s.notes, 'Duplicate worlds.');
  assert.equal(run([{ type: 'install' }], s).status, 'installing');
});

test('nothing newer: up to date, and a manual check can run again', () => {
  const s = run([{ type: 'check' }, { type: 'none' }]);
  assert.equal(s.status, 'current');
  assert.equal(updateText(s), 'Lore-Forge is up to date.');
  assert.ok(canCheck(s));
});

test('a download or ready update survives a later check, "nothing new" and an error', () => {
  const ready = run([{ type: 'found', version: '1.1.0' }, { type: 'download' }, { type: 'downloaded', version: '1.1.0' }]);
  for (const e of [{ type: 'check' }, { type: 'none' }, { type: 'found', version: '1.1.0' }, { type: 'progress', percent: 10 }, { type: 'error', message: 'offline' }] as UpdateEvent[]) {
    assert.equal(nextUpdateState(ready, e), ready, e.type);
  }
  const downloading = run([{ type: 'found', version: '1.1.0' }, { type: 'download' }]);
  assert.equal(nextUpdateState(downloading, { type: 'check' }), downloading);
});

test('a cancelled password prompt keeps the update ready and says why', () => {
  const installing = run([{ type: 'found', version: '1.1.0' }, { type: 'download' }, { type: 'downloaded', version: '1.1.0' }, { type: 'install' }]);
  const s = nextUpdateState(installing, { type: 'install-failed', message: 'the password prompt was cancelled.' });
  assert.equal(s.status, 'ready');
  assert.match(updateText(s), /did not install: the password prompt was cancelled/);
  assert.ok(canInstall(s));
});

test('errors are shown, then a new check clears them; install or download before their time does nothing', () => {
  const s = run([{ type: 'check' }, { type: 'error', message: 'you seem to be offline.' }]);
  assert.equal(updateText(s), 'Could not check for updates: you seem to be offline.');
  assert.ok(canCheck(s));
  assert.equal(run([{ type: 'check' }], s).error, undefined);
  assert.equal(run([{ type: 'install' }], s), s);
  assert.equal(run([{ type: 'download' }], s), s);
});

test('macOS (unsigned): a found update is downloaded by hand, never through the updater', () => {
  const s = run([{ type: 'check' }, { type: 'found', version: '1.1.0' }], initialUpdateState('1.0.0', null, true));
  assert.deepEqual(s, { status: 'available', version: '1.0.0', manual: true, latest: '1.1.0' });
  assert.ok(canDownload(s));
  assert.equal(run([{ type: 'download' }], s), s);
});

test('the .deb installs with one password prompt, the path passed as an argument', () => {
  const [cmd, args] = debInstallCommand('/tmp/a b/Lore-Forge 1.1.0.deb');
  assert.equal(cmd, 'pkexec');
  assert.deepEqual(args, ['/bin/sh', '-c', 'dpkg -i "$1" || apt-get install -f -y', 'lore-forge-update', '/tmp/a b/Lore-Forge 1.1.0.deb']);
  assert.deepEqual(debInstallCommand('/x.deb', 'sudo -n'), ['sudo', ['-n', '/bin/sh', '-c', 'dpkg -i "$1" || apt-get install -f -y', 'lore-forge-update', '/x.deb']]);
});

test('versions compare by number, and a pre-release is older than its release', () => {
  assert.ok(isNewer('1.0.1', '1.0.0'));
  assert.ok(isNewer('1.10.0', '1.9.3'));
  assert.ok(isNewer('v2.0.0', '1.99.99'));
  assert.ok(!isNewer('1.0.0', '1.0.0'));
  assert.ok(!isNewer('0.9.0', '1.0.0'));
  assert.ok(isNewer('1.1.0', '1.1.0-beta.2'));
  assert.ok(!isNewer('1.1.0-beta.2', '1.1.0'));
  assert.ok(isNewer('1.1.0-beta.10', '1.1.0-beta.2'));
});

test('release notes become plain text; the release page is per version', () => {
  assert.equal(notesText('<h2>What\'s new</h2><ul><li>Duplicate &amp; tour</li><li>3D models</li></ul>'), "What's new\n• Duplicate & tour\n• 3D models");
  assert.equal(notesText([{ version: '1.1.0', note: '<p>One</p>' }, { version: '1.0.1', note: 'Two' }]), 'One\n\nTwo');
  assert.equal(notesText(null), '');
  assert.equal(releasePage('1.1.0'), 'https://github.com/kaharamamm/Lore-Forge/releases/tag/v1.1.0');
  assert.equal(releasePage(), 'https://github.com/kaharamamm/Lore-Forge/releases/latest');
});

test('updater errors read as one short line', () => {
  assert.equal(updateErrorText('HttpError: 404 \n"method: GET url: https://github.com/kaharamamm/Lore-Forge/releases.atom'), 'no public release found on GitHub.');
  assert.equal(updateErrorText('net::ERR_INTERNET_DISCONNECTED'), 'you seem to be offline.');
  assert.equal(updateErrorText('sha512 checksum mismatch\nexpected x'), 'sha512 checksum mismatch');
});
