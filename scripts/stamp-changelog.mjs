#!/usr/bin/env node
// The changelogs at release time: "## [Unreleased]" becomes "## [X.Y.Z] - YYYY-MM-DD" in CHANGELOG.md and
// CHANGELOG.tr.md, with its compare link, so the app's Patch notes and the release page name the version without a
// hand edit. The Release workflow runs it before building; a file that is already stamped is left as it is.
//
//   node scripts/stamp-changelog.mjs 1.2.0 2026-11-10    stamps both changelogs
//   node scripts/stamp-changelog.mjs --notes 1.2.0       prints that version's section of CHANGELOG.md (release notes)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['CHANGELOG.md', 'CHANGELOG.tr.md'];
const SEMVER = /^\d+\.\d+\.\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The text with its Unreleased section named after the release, and the compare links to match. */
export function stampChangelog(md, version, date) {
  if (!SEMVER.test(version)) throw new Error(`Not an X.Y.Z version: ${version}`);
  if (!DATE.test(date)) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  const nl = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => /^## \[Unreleased\]\s*$/i.test(l));
  if (at < 0) return md;
  if (hasRelease(md, version)) throw new Error(`There are notes for ${version} already, and Unreleased ones: put them together under one heading.`);
  lines[at] = `## [${version}] - ${date}`;
  // The version before it: the next release heading down the file.
  const before = lines.slice(at + 1).map((l) => /^## \[(\d+\.\d+\.\d+)\]/.exec(l)?.[1]).find(Boolean);
  const link = lines.findIndex((l) => /^\[Unreleased\]:\s*\S+/i.test(l));
  if (link >= 0) {
    const base = /^\[Unreleased\]:\s*(\S+?)\/compare\/\S+$/i.exec(lines[link])?.[1];
    if (base && before) lines[link] = `[${version}]: ${base}/compare/v${before}...v${version}`;
    else lines.splice(link, 1);
  } else if (before) {
    // No Unreleased link: one for this release, above the previous release's.
    const prev = lines.findIndex((l) => l.startsWith(`[${before}]: `));
    const base = prev >= 0 ? /^\[[^\]]+\]:\s*(https:\/\/github\.com\/[^/]+\/[^/]+)\//.exec(lines[prev])?.[1] : undefined;
    if (base) lines.splice(prev, 0, `[${version}]: ${base}/compare/v${before}...v${version}`);
  }
  return lines.join(nl);
}

/** Whether the changelog has a section for that version. */
export const hasRelease = (md, version) => md.split(/\r?\n/).some((l) => l.startsWith(`## [${version}]`));

/** One release's section (without its heading), trimmed: the notes of that release. '' when the file has none. */
export function releaseNotes(md, version) {
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (at < 0) return '';
  const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).filter((l) => !/^\[[^\]]+\]:\s+\S+$/.test(l)).join('\n').trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [first, second, third] = process.argv.slice(2);
  try {
    if (first === '--notes') {
      process.stdout.write(`${releaseNotes(readFileSync(join(ROOT, FILES[0]), 'utf8'), second ?? '')}\n`);
    } else {
      for (const f of FILES) {
        const path = join(ROOT, f);
        const before = readFileSync(path, 'utf8');
        const after = stampChangelog(before, first ?? '', second ?? third ?? '');
        if (!hasRelease(after, first)) throw new Error(`${f} has no notes for ${first}: write them under "## [Unreleased]" first.`);
        if (after !== before) writeFileSync(path, after);
        console.log(after === before ? `${f}: nothing to stamp` : `${f}: ${first} - ${second}`);
      }
    }
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
