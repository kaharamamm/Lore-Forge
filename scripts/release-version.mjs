#!/usr/bin/env node
// Release version: the newest vX.Y.Z tag plus the chosen bump, or an exact version. CI passes the result to
// electron-builder (-c.extraMetadata.version) and never writes it back, so package.json is not bumped by hand.
//
//   git tag -l | node scripts/release-version.mjs patch          prints latest=, version=, tag=, skip= lines
//   git tag -l | node scripts/release-version.mjs patch 1.2.0    an exact version instead of the bump
//                                                               (append them to $GITHUB_OUTPUT)
import { pathToFileURL } from 'node:url';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The newest plain vX.Y.Z tag (pre-releases and other tags are ignored), without the v; null when none. */
export function latestVersion(tags) {
  let best = null;
  for (const raw of tags) {
    const m = SEMVER_TAG.exec(raw.trim());
    if (!m) continue;
    const v = m.slice(1, 4).map(Number);
    if (!best || (v[0] - best[0] || v[1] - best[1] || v[2] - best[2]) > 0) best = v;
  }
  return best ? best.join('.') : null;
}

export function bumpVersion(version, bump) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`Not an X.Y.Z version: ${version}`);
  const [major, minor, patch] = m.slice(1, 4).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`bump must be patch, minor or major, not "${bump}"`);
}

/** { latest, version, tag, skip }: skip is true when the tag already exists (nothing to release). */
export function resolveRelease(tags, bump, exact = '') {
  const latest = latestVersion(tags) ?? '0.0.0';
  const wanted = exact.trim().replace(/^v/, '');
  if (wanted && !SEMVER.test(wanted)) throw new Error(`Not an X.Y.Z version: ${exact}`);
  const version = wanted || bumpVersion(latest, bump);
  const tag = `v${version}`;
  return { latest, version, tag, skip: tags.some((t) => t.trim() === tag) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const bump = process.argv[2] || 'patch';
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const r = resolveRelease(input.split(/\r?\n/).filter(Boolean), bump, process.argv[3] ?? '');
    process.stdout.write(`latest=${r.latest}\nversion=${r.version}\ntag=${r.tag}\nskip=${r.skip}\n`);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
