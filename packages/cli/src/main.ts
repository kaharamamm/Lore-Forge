#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { check, report, snapshot, storyBook, worldBible, WorldFormatError, type Warning } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { writePublication } from '@lore-forge/pdf';

const USAGE = `Usage:
  lore check <worldDir> [--json]     Print consistency warnings. Exit 1 if there are errors.
  lore export <worldDir> [--out <file>]  Write one versioned JSON snapshot (stdout by default).
  lore bible <worldDir> [-o <file.pdf>]  World Bible PDF for artists and AI tools, plus a .md copy.
  lore book <worldDir> [-o <file.pdf>]   Story Book PDF: events and notes in story order, plus a .md copy.

Exit codes: 0 = no errors, 1 = errors found, 2 = bad usage or unreadable world.`;

const LABEL: Record<Warning['severity'], string> = { error: 'ERROR  ', warning: 'WARNING', info: 'INFO   ' };

function formatWarning(w: Warning): string {
  const tag = w.intended ? 'INTENDED' : LABEL[w.severity];
  const lines = [`${tag} [${w.ruleId}] ${w.message}`, `         at ${w.offending.source} (${w.offending.field})`];
  if (w.intended?.note) lines.push(`         note: ${w.intended.note}`);
  return lines.join('\n');
}

export async function run(argv: string[], out: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  const [cmd, dir, ...rest] = argv;
  if (!cmd || !['check', 'export', 'bible', 'book'].includes(cmd) || !dir) {
    out(USAGE + '\n');
    return 2;
  }
  let world;
  try {
    world = await loadWorld(resolve(dir));
  } catch (e) {
    out(`lore: ${e instanceof WorldFormatError ? e.message : `cannot read ${dir}: ${(e as Error).message}`}\n`);
    return 2;
  }
  if (cmd === 'export') {
    const json = JSON.stringify(snapshot(world), null, 2) + '\n';
    const i = rest.indexOf('--out');
    const file = i >= 0 ? rest[i + 1] : undefined;
    if (i >= 0 && !file) {
      out(USAGE + '\n');
      return 2;
    }
    if (file) {
      await writeFile(file, json, 'utf8');
      out(`Wrote ${file} (${world.entries.length} entries)\n`);
    } else out(json);
    return 0;
  }
  if (cmd === 'bible' || cmd === 'book') {
    const i = Math.max(rest.indexOf('-o'), rest.indexOf('--out'));
    const file = i >= 0 ? rest[i + 1] : `${world.manifest.id}-${cmd}.pdf`;
    if (!file) {
      out(USAGE + '\n');
      return 2;
    }
    const doc = cmd === 'bible' ? worldBible(world) : storyBook(world);
    const r = await writePublication(doc, resolve(dir), file);
    out(`Wrote ${r.pdf} (${r.pages} pages)\nWrote ${r.md}\n`);
    return 0;
  }
  const r = report(world, check(world));
  if (rest.includes('--json')) out(JSON.stringify(r, null, 2) + '\n');
  else {
    out(`${world.manifest.name}: ${world.entries.length} entries\n\n`);
    for (const w of r.warnings) out(formatWarning(w) + '\n\n');
    out(`${r.counts.error} errors, ${r.counts.warning} warnings, ${r.counts.info} info, ${r.counts.intended} marked intended\n`);
  }
  return r.counts.error > 0 ? 1 : 0;
}

const entry = process.argv[1];
if (entry && pathToFileURL(realpathSync(entry)).href === import.meta.url) {
  process.exitCode = await run(process.argv.slice(2));
}
