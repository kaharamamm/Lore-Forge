import { monthsOf } from '../dates.ts';
import { checkWorld } from '../engine.ts';
import { builtinRules } from '../rules/index.ts';
import { GENERATOR } from '../snapshot.ts';
import { ENTRY_TYPES, TYPE_LABELS, VISUAL_FIELDS, viewLabel, type Entry, type RefImage, type Warning, type World } from '../types.ts';
import { normalizeName, WorldIndex } from '../world-index.ts';
import { artBrief } from './art.ts';
import { anchorOf, bodyBlocks, dateWithEra, showDate, type Block, type Doc } from './doc.ts';

export const BIBLE_FORMAT_VERSION = 1;

const SINGULAR: Record<Entry['type'], string> = { character: 'Character', place: 'Place', faction: 'Faction', item: 'Item', event: 'Event', note: 'Note' };
const rel = (type: string): string => type.replace(/-/g, ' ');
const byName = (a: Entry, b: Entry): number => a.name.localeCompare(b.name);

export function imageBlock(img: RefImage, entry: Entry): Block {
  const p = img.provenance ?? {};
  const details = [
    `File: ${img.file}`,
    p.tool && `Made with: ${p.tool}`,
    p.prompt && `Prompt: ${p.prompt}`,
    p.date && `Date: ${p.date}`,
    p.sources?.length && `Sources: ${p.sources.join('; ')}`,
    p.rights && `Rights: ${p.rights}`,
  ].filter((x): x is string => typeof x === 'string');
  return { kind: 'image', file: img.file, caption: `${entry.name}: ${viewLabel(img.view)}`, details };
}

function entryFacts(e: Entry, ix: WorldIndex, file: string | undefined): [string, string][] {
  const rows: [string, string | undefined][] = [
    ['Type', SINGULAR[e.type]],
    ['Id', e.id],
    ['Also known as', e.aliases?.join(', ')],
    ['Tags', e.tags?.join(', ')],
  ];
  const ref = (r: string | undefined) => (r ? ix.nameOf(r) : undefined);
  switch (e.type) {
    case 'character':
      rows.push(['Born', showDate(e.born, ix)], ['Died', showDate(e.died, ix)], ['Status', e.status]);
      rows.push(['Lived at', e.locations?.map((l) => `${ix.nameOf(l.place)}${l.from || l.to ? ` (${showDate(l.from, ix) ?? '?'} – ${showDate(l.to, ix) ?? '?'})` : ''}`).join('; ')]);
      break;
    case 'place':
      rows.push(['Founded', showDate(e.founded, ix)], ['Destroyed', showDate(e.destroyed, ix)], ['Part of', ref(e.partOf)]);
      break;
    case 'faction':
      rows.push(['Founded', showDate(e.founded, ix)], ['Dissolved', showDate(e.dissolved, ix)]);
      break;
    case 'item':
      rows.push(['Made', showDate(e.created, ix)], ['Destroyed', showDate(e.destroyed, ix)]);
      break;
    case 'event':
      rows.push(['Date', showDate(e.date, ix)], ['Until', showDate(e.end, ix)], ['Place', ref(e.place)]);
      rows.push(['Participants', e.participants?.map((p) => `${ix.nameOf(p.id)}${p.role ? ` (${p.role})` : ''}`).join(', ')]);
      rows.push(['What happened', e.actions?.map((a) => `${ix.nameOf(a.actor)} ${a.verb}${a.target ? ` ${ix.nameOf(a.target)}` : ''}`).join('; ')]);
      break;
    case 'note':
      rows.push(['Date', showDate(e.date, ix)]);
      break;
  }
  rows.push(['File', file]);
  return rows.filter((r): r is [string, string] => typeof r[1] === 'string' && r[1] !== '');
}

interface Triple { from: Entry; type: string; to: string; toEntry?: Entry; when?: string }

function triples(ix: WorldIndex): Triple[] {
  const out: Triple[] = [];
  for (const e of ix.entries) {
    for (const r of e.relations ?? []) {
      const t = ix.resolve(r.target);
      const when = r.from || r.to ? `${showDate(r.from, ix) ?? '?'} – ${showDate(r.to, ix) ?? '?'}` : undefined;
      out.push({ from: e, type: r.type, to: t?.name ?? `${r.target} (missing)`, ...(t ? { toEntry: t } : {}), ...(when ? { when } : {}) });
    }
  }
  return out;
}
const tripleText = (t: Triple): string => `${t.from.name} — ${rel(t.type)} — ${t.to}${t.when ? ` (${t.when})` : ''}`;

function eventsOf(e: Entry, ix: WorldIndex): string[] {
  const out: string[] = [];
  for (const ev of ix.entries) {
    if (ev.type !== 'event' || ev.id === e.id) continue;
    const roles = [
      ...(ev.participants ?? []).filter((p) => ix.resolve(p.id)?.id === e.id).map((p) => p.role ?? 'participant'),
      ...(ev.actions ?? []).filter((a) => ix.resolve(a.actor)?.id === e.id || ix.resolve(a.target)?.id === e.id).map((a) => `${ix.nameOf(a.actor)} ${a.verb}${a.target ? ` ${ix.nameOf(a.target)}` : ''}`),
      ...(ix.resolve(ev.place)?.id === e.id ? ['place of the event'] : []),
    ];
    if (roles.length) out.push(`${ev.name}${ev.date ? ` (${showDate(ev.date, ix)})` : ''}: ${[...new Set(roles)].join('; ')}`);
  }
  return out;
}

function entrySection(e: Entry, ix: WorldIndex, world: World, all: Triple[]): Block[] {
  const blocks: Block[] = [{ kind: 'heading', level: 2, text: e.name, anchor: anchorOf(e.id), toc: true }];
  if (e.summary) blocks.push({ kind: 'para', text: e.summary, style: 'lead' });
  blocks.push({ kind: 'facts', rows: entryFacts(e, ix, world.files[e.id]) });

  const mine = all.filter((t) => t.from.id === e.id || t.toEntry?.id === e.id).map(tripleText);
  const events = eventsOf(e, ix);
  if (mine.length) blocks.push({ kind: 'heading', level: 3, text: 'Relationships' }, { kind: 'list', items: mine });
  if (events.length) blocks.push({ kind: 'heading', level: 3, text: 'Appears in' }, { kind: 'list', items: events });

  const fields = VISUAL_FIELDS[e.type];
  const visual = e.visual ?? {};
  const known = fields.filter((f) => visual[f.key]).map((f): [string, string] => [f.label, visual[f.key]!]);
  const other = Object.entries(visual).filter(([k]) => !fields.some((f) => f.key === k));
  if (known.length || other.length) blocks.push({ kind: 'heading', level: 3, text: 'Visual description' }, { kind: 'facts', rows: [...known, ...other] });

  const body = bodyBlocks(e.body, ix);
  if (body.length) blocks.push({ kind: 'heading', level: 3, text: 'Text' }, ...body);

  if (e.images?.length) {
    blocks.push({ kind: 'heading', level: 3, text: 'Reference images' });
    for (const img of e.images) blocks.push(imageBlock(img, e));
  }

  const brief = artBrief(e, ix);
  if (brief) {
    const inner: Block[] = [{ kind: 'prompt', label: e.type === 'place' ? 'Image prompt (establishing shot)' : 'Image prompt', text: brief.prompt }];
    if (brief.turnaround) inner.push({ kind: 'prompt', label: '3D turnaround brief', text: brief.turnaround });
    if (brief.missing.length) inner.push({ kind: 'para', text: `Not described yet (add for a better brief): ${brief.missing.join(', ')}.`, style: 'muted' });
    blocks.push({ kind: 'box', title: `Art brief: ${e.name}`, blocks: inner });
  }
  return blocks;
}

function warningLine(w: Warning): string {
  return `${w.severity.toUpperCase()} [${w.ruleId}] ${w.message} (at ${w.offending.source}, ${w.offending.field})${w.intended?.note ? ` Note: ${w.intended.note}` : ''}`;
}

/** The World Bible: everything an artist, writer or AI tool needs to understand the world. */
export function worldBible(world: World): Doc {
  const ix = new WorldIndex(world);
  const m = world.manifest;
  const cal = m.calendar;
  const warnings = checkWorld(world, builtinRules);
  const imageCount = world.entries.reduce((n, e) => n + (e.images?.length ?? 0), 0);
  const all = triples(ix);
  const blocks: Block[] = [{ kind: 'toc' }];

  blocks.push(
    { kind: 'heading', level: 1, text: 'About this document', toc: true, newPage: true },
    { kind: 'para', text: `This World Bible was generated by Lore-Forge from the world files of "${m.name}". It lists every entry with its structured facts, relationships, visual description, the author's text and the reference images with their provenance. Characters, places, items and events end with an **art brief**: a ready-to-use image prompt and, for characters and items, a 3D turnaround brief built from the visual description.` },
    { kind: 'para', text: 'Dates use the world\'s own calendar and always name their era (for example "1920 AS"); "c." means approximate. Names in the text are resolved from links. Consistency warnings that are still open are listed in the appendix. A Markdown copy of the same content (bible.md) is written next to the PDF for tools that read text.' },
  );

  const counts = ENTRY_TYPES.map((t) => [TYPE_LABELS[t], String(world.entries.filter((e) => e.type === t).length)] as [string, string]);
  blocks.push({ kind: 'heading', level: 1, text: 'World overview', toc: true, newPage: true });
  if (m.description) blocks.push({ kind: 'para', text: m.description, style: 'lead' });
  blocks.push({ kind: 'facts', rows: [['World id', m.id], ...counts, ['Reference images', String(imageCount)]] });
  blocks.push(
    { kind: 'heading', level: 2, text: 'Calendar', toc: true },
    { kind: 'facts', rows: [
      ...cal.eras.map((e): [string, string] => [`Era ${e.id}`, `${e.name}; its year 1 is absolute year ${e.start}${e.id === cal.defaultEra ? ' (default era)' : ''}`]),
      ['Months', monthsOf(cal).map((mo) => `${mo.name} (${mo.days} days)`).join(', ')],
      ['Approximate dates', `"~" or "c." widens a date by ${cal.approxYears ?? 5} years either way`],
    ] },
  );

  for (const type of ENTRY_TYPES) {
    const list = world.entries.filter((e) => e.type === type).sort(byName);
    if (!list.length) continue;
    blocks.push({ kind: 'heading', level: 1, text: TYPE_LABELS[type], toc: true, newPage: true });
    for (const e of list) blocks.push(...entrySection(e, ix, world, all));
  }

  // Timeline: every dated start/end, in world order.
  const moments: { lo: number; text: string }[] = [];
  for (const e of world.entries) {
    const life = ix.life(e);
    for (const p of [life.start, life.end]) {
      if (!p) continue;
      const what = e.type === 'event' ? `${e.name} ${p.word}${e.place ? ` (at ${ix.nameOf(e.place)})` : ''}` : e.type === 'note' ? `Lore: ${e.name}` : `${e.name} ${p.word}`;
      moments.push({ lo: p.date.lo, text: `${dateWithEra(p.date, cal)}: ${what}` });
    }
  }
  moments.sort((a, b) => a.lo - b.lo || a.text.localeCompare(b.text));
  blocks.push({ kind: 'heading', level: 1, text: 'Timeline', toc: true, newPage: true });
  blocks.push(moments.length ? { kind: 'list', items: moments.map((x) => x.text) } : { kind: 'para', text: 'No dated entries yet.', style: 'muted' });

  blocks.push({ kind: 'heading', level: 1, text: 'Relationship summary', toc: true, newPage: true });
  const types = [...new Set(all.map((t) => t.type))].sort();
  if (!types.length) blocks.push({ kind: 'para', text: 'No relationships yet.', style: 'muted' });
  for (const t of types) blocks.push({ kind: 'heading', level: 3, text: rel(t) }, { kind: 'list', items: all.filter((x) => x.type === t).map(tripleText) });

  const names: [string, string][] = [];
  for (const e of world.entries) {
    names.push([e.name, `${SINGULAR[e.type]} (${e.id})`]);
    for (const a of e.aliases ?? []) names.push([a, `${SINGULAR[e.type]}: alias of ${e.name}`]);
  }
  names.sort((a, b) => normalizeName(a[0]).localeCompare(normalizeName(b[0])));
  blocks.push({ kind: 'heading', level: 1, text: 'Glossary of names', toc: true, newPage: true }, { kind: 'facts', rows: names });

  const open = warnings.filter((w) => !w.intended);
  const intended = warnings.filter((w) => w.intended);
  blocks.push({ kind: 'heading', level: 1, text: 'Appendix: consistency warnings', toc: true, newPage: true });
  blocks.push(open.length ? { kind: 'list', items: open.map(warningLine) } : { kind: 'para', text: 'No open warnings.', style: 'muted' });
  if (intended.length) blocks.push({ kind: 'heading', level: 3, text: 'Marked intended by the author (treat as canon)' }, { kind: 'list', items: intended.map(warningLine) });

  return {
    kind: 'bible',
    title: `${m.name}: World Bible`,
    cover: {
      title: m.name,
      subtitle: 'World Bible',
      lines: [
        ...(m.description ? [m.description] : []),
        `${world.entries.length} entries · ${imageCount} reference images · ${open.length} open warnings`,
        `Generated by ${GENERATOR} (world bible format ${BIBLE_FORMAT_VERSION}, world schema ${m.schemaVersion})`,
      ],
    },
    blocks,
  };
}

