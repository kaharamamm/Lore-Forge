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

// @ts-expect-error plain JavaScript script, no types
import { releaseNotes, stampChangelog } from '../../../scripts/stamp-changelog.mjs';

const changelog = [
  '# Changelog', '', '## [Unreleased]', '', '### Fixed', '', '- A fix.', '',
  '## [1.1.0] - 2026-11-09', '', '### Added', '', '- Maps.', '',
  '[Unreleased]: https://github.com/o/r/compare/v1.1.0...HEAD',
  '[1.1.0]: https://github.com/o/r/compare/v1.0.0...v1.1.0', '',
].join('\n');

test('at release time the Unreleased section takes the version and date, with its compare link', () => {
  const out: string = stampChangelog(changelog, '1.2.0', '2026-11-12');
  assert.match(out, /^## \[1\.2\.0\] - 2026-11-12$/m);
  assert.doesNotMatch(out, /Unreleased/);
  assert.match(out, /^\[1\.2\.0\]: https:\/\/github\.com\/o\/r\/compare\/v1\.1\.0\.\.\.v1\.2\.0$/m);
  assert.equal(stampChangelog(out, '1.2.0', '2026-11-12'), out, 'stamped once: running it again changes nothing');
  assert.equal(releaseNotes(out, '1.2.0'), '### Fixed\n\n- A fix.');
  assert.equal(releaseNotes(out, '1.1.0'), '### Added\n\n- Maps.', 'no link lines in the notes');
  assert.equal(releaseNotes(out, '9.9.9'), '');
  // Windows line endings stay, and a file without an Unreleased link gets one for the release.
  const crlf: string = stampChangelog(changelog.replace(/\[Unreleased\]: .*\n/, '').replace(/\n/g, '\r\n'), '1.2.0', '2026-11-12');
  assert.ok(crlf.includes('\r\n## [1.2.0] - 2026-11-12\r\n'));
  assert.match(crlf, /\[1\.2\.0\]: https:\/\/github\.com\/o\/r\/compare\/v1\.1\.0\.\.\.v1\.2\.0\r\n\[1\.1\.0\]/);
  assert.throws(() => stampChangelog(changelog, '1.2', '2026-11-12'), /X\.Y\.Z/);
  // Notes for the version already there, and new Unreleased ones: a person puts them together, not the script.
  assert.throws(() => stampChangelog(out.replace('## [1.2.0]', '## [Unreleased]\n\n- More.\n\n## [1.2.0]'), '1.2.0', '2026-11-12'), /already/);
});

test('the real changelogs can be stamped, in both languages', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['CHANGELOG.md', 'CHANGELOG.tr.md']) {
    const md = readFileSync(join(import.meta.dirname, '..', '..', '..', f), 'utf8');
    const out: string = stampChangelog(md, '9.0.0', '2030-01-01');
    if (/^## \[Unreleased\]/m.test(md)) {
      assert.match(out, /^## \[9\.0\.0\] - 2030-01-01/m, f);
      assert.ok(releaseNotes(out, '9.0.0').length > 0, f);
    } else assert.equal(out, md, f);
  }
});
