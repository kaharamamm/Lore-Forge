#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { check, report, snapshot, storyBook, TRIMS, worldCodex, WorldFormatError, type TrimSize, type Warning, type World } from '@lore-forge/core';
import { duplicateWorld, loadWorld } from '@lore-forge/core/node';
import { writeDocx, writePublication } from '@lore-forge/pdf';

const USAGE = `Usage:
  lore check <worldDir> [--json]     Print consistency warnings. Exit 1 if there are errors.
  lore export <worldDir> [--out <file>]  Write one versioned JSON snapshot (stdout by default).
  lore codex <worldDir> [-o <file.pdf>]  World Codex PDF for artists and AI tools, plus a .md copy (alias: bible).
  lore book <worldDir> [-o <file.pdf|file.docx>] [--trim 6x9|5.5x8.5|a5|a4|letter]
                                         Print-ready Story Book: PDF plus a .md copy, or a Word .docx.
  lore duplicate <worldDir> [name] [--into <folder>]
                                         Copy a world to a new folder with a new name and id
                                         (default name "<name> (copy)", default folder next to the original).

Exit codes: 0 = no errors, 1 = errors found, 2 = bad usage or unreadable world.`;

const LABEL: Record<Warning['severity'], string> = { error: 'ERROR  ', warning: 'WARNING', info: 'INFO   ' };

/** 'Story/The Salt Road (story/01-the-salt-road.md): "Hadi fought..."' for story facts; "Characters/Hadi (born)" for entry facts. */
function where(f: Warning['offending'], world: World | undefined): string {
  if (!f.chapter || !f.span) return `${f.source} (${f.field})`;
  const quote = world?.story?.find((c) => c.file === f.chapter)?.body.slice(f.span[0], f.span[1]);
  return `${f.source} (${f.chapter})${quote ? `: "${quote.length > 100 ? `${quote.slice(0, 97)}...` : quote}"` : ''}`;
}

function formatWarning(w: Warning, world?: World): string {
  const tag = w.intended ? 'INTENDED' : LABEL[w.severity];
  const lines = [`${tag} [${w.ruleId}] ${w.message}`, `         at ${where(w.offending, world)}`];
  if (w.intended?.note) lines.push(`         note: ${w.intended.note}`);
  return lines.join('\n');
}

export async function run(argv: string[], out: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  const [given, dir, ...rest] = argv;
  const cmd = given === 'bible' ? 'codex' : given;
  if (!cmd || !['check', 'export', 'codex', 'book', 'duplicate'].includes(cmd) || !dir) {
    out(USAGE + '\n');
    return 2;
  }
  if (cmd === 'duplicate') return duplicate(dir, rest, out);
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
  if (cmd === 'codex' || cmd === 'book') {
    const i = Math.max(rest.indexOf('-o'), rest.indexOf('--out'));
    const file = i >= 0 ? rest[i + 1] : `${world.manifest.id}-${cmd}.pdf`;
    if (!file) {
      out(USAGE + '\n');
      return 2;
    }
    const t = rest.indexOf('--trim');
    const trim = t >= 0 ? rest[t + 1] : undefined;
    if (t >= 0 && (cmd !== 'book' || !trim || !(trim in TRIMS))) {
      out(USAGE + '\n');
      return 2;
    }
    const doc = cmd === 'codex' ? worldCodex(world) : storyBook(world, trim ? { trim: trim as TrimSize } : {});
    if (cmd === 'book' && file.toLowerCase().endsWith('.docx')) {
      await writeDocx(doc, resolve(dir), file);
      out(`Wrote ${file}\n`);
      return 0;
    }
    // The CLI that ships inside the app finds the app's bundled fonts through these (see the lore wrapper scripts).
    const r = await writePublication(doc, resolve(dir), file, process.env.LORE_FORGE_FONTS || undefined, process.env.LORE_FORGE_COVER_FONTS || undefined);
    out(`Wrote ${r.pdf} (${r.pages} pages)\nWrote ${r.md}\n${r.notes.map((n) => `Note: ${n}\n`).join('')}`);
    return 0;
  }
  const r = report(world, check(world));
  if (rest.includes('--json')) out(JSON.stringify(r, null, 2) + '\n');
  else {
    const chapters = world.story?.length ?? 0;
    out(`${world.manifest.name}: ${world.entries.length} entries${chapters ? `, ${chapters} story chapter${chapters === 1 ? '' : 's'}` : ''}\n\n`);
    for (const w of r.warnings) out(formatWarning(w, world) + '\n\n');
    out(`${r.counts.error} errors, ${r.counts.warning} warnings, ${r.counts.info} info, ${r.counts.intended} marked intended\n`);
  }
  return r.counts.error > 0 ? 1 : 0;
}

async function duplicate(dir: string, rest: string[], out: (s: string) => void): Promise<number> {
  const i = rest.indexOf('--into');
  const into = i >= 0 ? rest[i + 1] : dirname(resolve(dir));
  const name = rest.find((a, j) => !a.startsWith('--') && (i < 0 || (j !== i && j !== i + 1)));
  if (!into || rest.length > (name ? 1 : 0) + (i >= 0 ? 2 : 0)) {
    out(USAGE + '\n');
    return 2;
  }
  try {
    const copy = await duplicateWorld(resolve(dir), resolve(into), name ?? '');
    const world = await loadWorld(copy);
    out(`Duplicated ${dir} as "${world.manifest.name}" (id ${world.manifest.id})\nWrote ${copy}\n`);
    return 0;
  } catch (e) {
    out(`lore: cannot duplicate ${dir}: ${(e as Error).message}\n`);
    return 2;
  }
}

// Run when started directly (the app's bundled `lore` starts it through src/cli.ts in the desktop package instead).
const entry = process.argv[1];
if (entry && pathToFileURL(realpathSync(entry)).href === import.meta.url) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
