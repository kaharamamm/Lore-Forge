import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
// @ts-expect-error plain JavaScript script, no types
import { bumpVersion, latestVersion, resolveRelease } from '../../../scripts/release-version.mjs';

const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'release-version.mjs');

test('after v1.0.0 the next release is 1.0.1, 1.1.0 or 2.0.0', () => {
  const tags = ['v1.0.0', 'ready-base'];
  assert.deepEqual(resolveRelease(tags, 'patch'), { latest: '1.0.0', version: '1.0.1', tag: 'v1.0.1', skip: false });
  assert.equal(resolveRelease(tags, 'minor').version, '1.1.0');
  assert.equal(resolveRelease(tags, 'major').version, '2.0.0');
});

test('the newest vX.Y.Z wins by number, not by text; other tags are ignored', () => {
  const tags = ['v0.0.9', 'v0.0.10', 'v0.2.0', 'v0.10.0', 'v045-base', 'v1.0.0-beta.1', 'release-2', 'v0.9.99'];
  assert.equal(latestVersion(tags), '0.10.0');
  assert.equal(resolveRelease(tags, 'patch').tag, 'v0.10.1');
  assert.equal(latestVersion(['v045-base', 'nightly']), null);
  assert.equal(resolveRelease([], 'patch').version, '0.0.1');
});

test('bumps reset the lower parts', () => {
  assert.equal(bumpVersion('1.4.7', 'patch'), '1.4.8');
  assert.equal(bumpVersion('1.4.7', 'minor'), '1.5.0');
  assert.equal(bumpVersion('1.4.7', 'major'), '2.0.0');
  assert.throws(() => bumpVersion('1.4.7', 'huge'), /patch, minor or major/);
});

test('an exact version wins over the bump, and an existing tag means skip', () => {
  assert.deepEqual(resolveRelease(['v1.0.0'], 'patch', 'v1.1.0'), { latest: '1.0.0', version: '1.1.0', tag: 'v1.1.0', skip: false });
  assert.equal(resolveRelease(['v1.0.0'], 'patch', '1.0.0').skip, true);
  assert.throws(() => resolveRelease([], 'patch', '1.2'), /X\.Y\.Z/);
});

test('the command line prints GITHUB_OUTPUT lines from a tag list on stdin', () => {
  const out = execFileSync(process.execPath, [script, 'minor'], { input: 'v1.0.0\nv0.0.12\r\nready-base\n', encoding: 'utf8' });
  assert.equal(out, 'latest=1.0.0\nversion=1.1.0\ntag=v1.1.0\nskip=false\n');
  assert.equal(execFileSync(process.execPath, [script, 'patch', '1.0.0'], { input: 'v1.0.0\n', encoding: 'utf8' }), 'latest=1.0.0\nversion=1.0.0\ntag=v1.0.0\nskip=true\n');
  assert.throws(() => execFileSync(process.execPath, [script, 'sideways'], { input: '', stdio: 'pipe' }));
});
