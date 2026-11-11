import { monthsOf } from '../dates.ts';
import { ageAtDeathText, detailRelations, filledDetails } from '../details.ts';
import { customFields, fieldValueText } from '../fields.ts';
import { entryIcon, racesOf } from '../entry-icons.ts';
import { isEnded, LIFECYCLE, statusLabel } from '../lifecycle.ts';
import { checkWorld } from '../engine.ts';
import { joined, msg, verbatim } from '../i18n.ts';
import { builtinRules } from '../rules/index.ts';
import { GENERATOR } from '../snapshot.ts';
import { references } from '../rules/references.ts';
import { relationLabel } from '../relation-kinds.ts';
import { ENTRY_TYPES, TYPE_ICON, TYPE_LABELS, TYPE_SINGULAR, type EntryType, VISUAL_FIELDS, viewLabel, type Entry, type Look, type RefImage, type Warning, type World } from '../types.ts';
import { normalizeName, WorldIndex } from '../world-index.ts';
import { lookImages, lookWhen } from '../looks.ts';
import { artBrief } from './art.ts';
import { mapModel } from '../views/map-model.ts';
import { worldCoverArt } from '../cover.ts';
import { anchorOf, bodyBlocks, dateWithEra, showDate, type Block, type Doc } from './doc.ts';

export const CODEX_FORMAT_VERSION = 1;

const rel = (type: string): string => relationLabel(type);
const byName = (a: Entry, b: Entry): number => a.name.localeCompare(b.name);

export function imageBlock(img: RefImage, entry: Entry, look?: Look): Block {
  const p = img.provenance ?? {};
  const details = [
    msg`File: ${img.file}`,
    p.tool && msg`Made with: ${p.tool}`,
    p.prompt && msg`Prompt: ${p.prompt}`,
    p.date && msg`Date: ${p.date}`,
    p.sources?.length && msg`Sources: ${p.sources.join('; ')}`,
    p.rights && msg`Rights: ${p.rights}`,
  ].filter((x): x is string => typeof x === 'string');
  const caption = look ? msg`${entry.name}: ${viewLabel(img.view)} (${look.name || look.id})` : msg`${entry.name}: ${viewLabel(img.view)}`;
  return { kind: 'image', file: img.file, caption, details };
}

/** "1920 AS – 1950 AS", "? – 1950 AS": a span of two dates for documents. */
const span = (from: string | undefined, to: string | undefined, ix: WorldIndex): string => msg`${showDate(from, ix) ?? '?'} – ${showDate(to, ix) ?? '?'}`;

function entryFacts(e: Entry, ix: WorldIndex, file: string | undefined): [string, string][] {
  const rows: [string, string | undefined][] = [
    [msg`Type`, TYPE_SINGULAR[e.type]],
    [msg`Id`, e.id],
    [msg`Also known as`, e.aliases?.join(', ')],
    [msg`Pronunciation`, e.pronunciation],
    [msg`Tags`, e.tags?.join(', ')],
  ];
  const ref = (r: string | undefined) => (r ? ix.nameOf(r) : undefined);
  switch (e.type) {
    case 'character':
      rows.push([msg`Race`, racesOf(e).map((r) => ix.nameOf(r)).join(', ')], [msg`Born`, showDate(e.born, ix)], [msg`Died`, showDate(e.died, ix)], [msg`Age at death`, ageAtDeathText(e, ix.calendar)], [msg`Status`, statusLabel(e)]);
      rows.push([msg`Lived at`, e.locations && joined(e.locations.map((l) => (l.from || l.to ? msg`${ix.nameOf(l.place)} (${span(l.from, l.to, ix)})` : ix.nameOf(l.place))), '; ')]);
      break;
    case 'place':
      rows.push([msg`Founded`, showDate(e.founded, ix)], [msg`Destroyed`, showDate(e.destroyed, ix)], [msg`Part of`, ref(e.partOf)]);
      break;
    case 'faction':
      rows.push([msg`Founded`, showDate(e.founded, ix)], [msg`Dissolved`, showDate(e.dissolved, ix)]);
      break;
    case 'item':
      rows.push([msg`Made`, showDate(e.created, ix)], [msg`Destroyed`, showDate(e.destroyed, ix)]);
      break;
    case 'event':
      rows.push([msg`Date`, showDate(e.date, ix)], [msg`Until`, showDate(e.end, ix)], [msg`Place`, ref(e.place)]);
      rows.push([msg`Participants`, e.participants?.map((p) => `${ix.nameOf(p.id)}${p.role ? ` (${p.role})` : ''}`).join(', ')]);
      rows.push([msg`What happened`, e.actions?.map((a) => `${ix.nameOf(a.actor)} ${a.verb}${a.target ? ` ${ix.nameOf(a.target)}` : ''}`).join('; ')]);
      break;
    case 'note':
      rows.push([msg`Date`, showDate(e.date, ix)]);
      break;
  }
  for (const { field, value } of filledDetails(e)) {
    if (field.kind === 'long') continue;
    const list = Array.isArray(value) ? value : [value];
    rows.push([field.label, (field.kind === 'ref' || field.kind === 'refs' ? list.map((r) => ix.nameOf(r)) : list).join(', ')]);
  }
  // The book's own fields (World settings), in their order.
  for (const f of customFields(ix.world.manifest, e.type)) rows.push([f.name, fieldValueText(e.fields?.[f.key])]);
  rows.push([msg`File`, file]);
  return rows.filter((r): r is [string, string] => typeof r[1] === 'string' && r[1] !== '');
}

interface Triple { from: Entry; type: string; to: string; toEntry?: Entry; when?: string }

function triples(ix: WorldIndex): Triple[] {
  const out: Triple[] = [];
  for (const e of ix.entries) {
    for (const r of e.relations ?? []) {
      const t = ix.resolve(r.target);
      const when = r.from || r.to ? span(r.from, r.to, ix) : undefined;
      out.push({ from: e, type: r.type, to: t?.name ?? msg`${verbatim(r.target)} (missing)`, ...(t ? { toEntry: t } : {}), ...(when ? { when } : {}) });
    }
    for (const d of detailRelations(e)) {
      const from = ix.resolve(d.source), t = ix.resolve(d.target);
      if (from && t) out.push({ from, type: d.type, to: t.name, toEntry: t });
    }
  }
  return out;
}
const tripleText = (t: Triple): string => (t.when ? msg`${t.from.name}: ${rel(t.type)} ${t.to} (${t.when})` : msg`${t.from.name}: ${rel(t.type)} ${t.to}`);

function eventsOf(e: Entry, ix: WorldIndex): string[] {
  const out: string[] = [];
  for (const ev of ix.entries) {
    if (ev.type !== 'event' || ev.id === e.id) continue;
    const roles = [
      ...(ev.participants ?? []).filter((p) => ix.resolve(p.id)?.id === e.id).map((p) => p.role ?? msg`participant`),
      ...(ev.actions ?? []).filter((a) => ix.resolve(a.actor)?.id === e.id || ix.resolve(a.target)?.id === e.id).map((a) => `${ix.nameOf(a.actor)} ${a.verb}${a.target ? ` ${ix.nameOf(a.target)}` : ''}`),
      ...(ix.resolve(ev.place)?.id === e.id ? [msg`place of the event`] : []),
    ];
    if (!roles.length) continue;
    const what = joined([...new Set(roles)], '; ');
    out.push(ev.date ? msg`${ev.name} (${showDate(ev.date, ix)}): ${what}` : msg`${ev.name}: ${what}`);
  }
  return out;
}

function entrySection(e: Entry, ix: WorldIndex, world: World, all: Triple[], mentionedIn: Map<string, string[]>, opts: Required<CodexOptions>): Block[] {
  const ended = isEnded(e) ? LIFECYCLE[e.type]?.endedIcon : undefined;
  const blocks: Block[] = [{ kind: 'heading', level: 2, text: e.name, anchor: anchorOf(e.id), toc: true, icon: entryIcon(e), ...(ended ? { mark: ended } : {}) }];
  if (e.summary) blocks.push({ kind: 'para', text: e.summary, style: 'lead' });
  blocks.push({ kind: 'facts', rows: entryFacts(e, ix, world.files[e.id]).filter(([k]) => opts.ids || (k !== msg`Id` && k !== msg`File`)) });

  const profile = filledDetails(e).filter((d) => d.field.kind === 'long').map((d): [string, string] => [d.field.label, String(d.value)]);
  if (profile.length) blocks.push({ kind: 'heading', level: 3, text: msg`Profile` }, { kind: 'facts', rows: profile });

  const mine = all.filter((t) => t.from.id === e.id || t.toEntry?.id === e.id).map(tripleText);
  const events = eventsOf(e, ix);
  if (mine.length) blocks.push({ kind: 'heading', level: 3, text: msg`Relationships` }, { kind: 'list', items: mine });
  if (events.length) blocks.push({ kind: 'heading', level: 3, text: msg`Appears in` }, { kind: 'list', items: events });
  const mentions = mentionedIn.get(e.id) ?? [];
  if (mentions.length) blocks.push({ kind: 'heading', level: 3, text: msg`Mentioned in` }, { kind: 'para', text: mentions.join(', ') });

  const fields = VISUAL_FIELDS[e.type];
  const visual = e.visual ?? {};
  const known = fields.filter((f) => visual[f.key]).map((f): [string, string] => [f.label, visual[f.key]!]);
  const other = Object.entries(visual).filter(([k]) => !fields.some((f) => f.key === k));
  if (known.length || other.length) blocks.push({ kind: 'heading', level: 3, text: msg`Visual description` }, { kind: 'facts', rows: [...known, ...other] });

  const body = bodyBlocks(e.body, ix);
  if (body.length) blocks.push({ kind: 'heading', level: 3, text: msg`Text` }, ...body);

  // The Default look's pictures (and pictures of a look that is gone); each look's own come with the look below.
  const pictures = lookImages(e, undefined);
  if (pictures.length) {
    blocks.push({ kind: 'heading', level: 3, text: msg`Reference images` });
    for (const img of pictures) blocks.push(imageBlock(img, e));
  }

  // The prompts themselves stay in English, the language image and 3D tools read best.
  const briefBox = (look?: Look): Block | undefined => {
    const brief = opts.artBriefs ? artBrief(e, ix, look) : undefined;
    if (!brief) return undefined;
    const inner: Block[] = [{ kind: 'prompt', label: e.type === 'place' ? msg`Image prompt (establishing shot)` : msg`Image prompt`, text: brief.prompt }];
    if (brief.turnaround) inner.push({ kind: 'prompt', label: msg`3D turnaround brief`, text: brief.turnaround });
    if (brief.missing.length) inner.push({ kind: 'para', text: msg`Not described yet (add for a better brief): ${joined(brief.missing, ', ')}.`, style: 'muted' });
    return { kind: 'box', title: look ? msg`Art brief: ${e.name} (${look.name || look.id})` : msg`Art brief: ${e.name}`, blocks: inner };
  };
  const brief = briefBox();
  if (brief) blocks.push(brief);

  // Each look: when and why, what it changes, its pictures and its own art brief.
  for (const look of e.looks ?? []) {
    blocks.push({ kind: 'heading', level: 3, text: msg`Look: ${look.name || look.id}` });
    const rows: [string, string][] = [];
    const when = lookWhen(look, ix);
    if (when) rows.push([msg`When`, when]);
    if (look.reason?.trim()) rows.push([msg`Why`, look.reason.trim()]);
    for (const f of fields) if (look.visual?.[f.key]?.trim()) rows.push([f.label, look.visual[f.key]!]);
    for (const [k, v] of Object.entries(look.visual ?? {})) if (!fields.some((f) => f.key === k) && v.trim()) rows.push([k, v]);
    if (rows.length) blocks.push({ kind: 'facts', rows });
    for (const img of lookImages(e, look)) blocks.push(imageBlock(img, e, look));
    const box = briefBox(look);
    if (box) blocks.push(box);
  }
  return blocks;
}

/** Each map of the book: its picture with the pinned places numbered (by name), and what the numbers are. */
function mapSections(world: World): Block[] {
  const blocks: Block[] = [];
  for (const map of world.manifest.maps ?? []) {
    const model = mapModel(world, map.id);
    if (!model || !map.image) continue;
    const places = [...model.pins].sort((a, b) => a.entry.name.localeCompare(b.entry.name));
    blocks.push({ kind: 'heading', level: 2, text: map.name, anchor: `map-${map.id}`, toc: true, icon: 'treasure-map' });
    // The place it shows, unless the map is named after it already.
    if (model.place && normalizeName(model.place.name) !== normalizeName(map.name)) blocks.push({ kind: 'para', text: msg`A map of ${model.place.name}.`, style: 'muted' });
    blocks.push({ kind: 'image', file: map.image, caption: map.name, details: [], pins: places.map((p, i) => ({ n: i + 1, x: p.x, y: p.y, name: p.entry.name, id: p.entry.id })) });
    if (!places.length) blocks.push({ kind: 'para', text: msg`No places are pinned on this map yet.`, style: 'muted' });
  }
  return blocks.length ? [{ kind: 'heading', level: 1, text: msg`Maps`, toc: true, newPage: true, icon: 'treasure-map' }, ...blocks] : [];
}

const SEVERITY_WORD: Record<Warning['severity'], string> = { error: msg`ERROR`, warning: msg`WARNING`, info: msg`INFO` };

function warningLine(w: Warning): string {
  const severity = SEVERITY_WORD[w.severity] ?? w.severity.toUpperCase();
  const field = verbatim(w.offending.field);
  return w.intended?.note
    ? msg`${severity} [${verbatim(w.ruleId)}] ${w.message} (at ${w.offending.source}, ${field}) Note: ${w.intended.note}`
    : msg`${severity} [${verbatim(w.ruleId)}] ${w.message} (at ${w.offending.source}, ${field})`;
}

export interface CodexOptions {
  /** Entry types to include, in the usual order. Default: all. */
  types?: readonly EntryType[];
  /** Add the consistency warnings appendix. Default: true. */
  warnings?: boolean;
  /** Add art briefs (image prompts, turnaround briefs). Default: true. */
  artBriefs?: boolean;
  /** Start with "About this document" (what the PDF holds and the codex.md next to it). Default: true. */
  about?: boolean;
  /** List the ids of the world and its entries, and each entry's file. Default: true; a website for readers leaves them out. */
  ids?: boolean;
}

/** Entries whose text names each entry, by [[link]], @mention or plain name. */
function mentionIndex(ix: WorldIndex): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of [...ix.entries].sort(byName)) {
    const ids = new Set(references(e, ix).filter((r) => r.field === 'body').map((r) => ix.resolve(r.ref)?.id).filter((id): id is string => !!id && id !== e.id));
    for (const id of ids) out.set(id, [...(out.get(id) ?? []), e.name]);
  }
  return out;
}

/** The World Codex: everything an artist, writer or AI tool needs to understand the world. */
export function worldCodex(world: World, options: CodexOptions = {}): Doc {
  const opts: Required<CodexOptions> = { types: options.types ?? ENTRY_TYPES, warnings: options.warnings ?? true, artBriefs: options.artBriefs ?? true, about: options.about ?? true, ids: options.ids ?? true };
  const ix = new WorldIndex(world);
  const mentionedIn = mentionIndex(ix);
  const m = world.manifest;
  const cal = m.calendar;
  const warnings = checkWorld(world, builtinRules);
  const imageCount = world.entries.reduce((n, e) => n + (e.images?.length ?? 0), 0);
  const all = triples(ix);
  const blocks: Block[] = [{ kind: 'toc' }];

  if (opts.about) blocks.push(
    { kind: 'heading', level: 1, text: msg`About this document`, toc: true, newPage: true },
    { kind: 'para', text: msg`This World Codex was generated by Lore-Forge from the world files of "${m.name}". It lists every entry with its structured facts, relationships, visual description, the author's text and the reference images with their provenance. Characters, places, items and events end with an **art brief**: a ready-to-use image prompt and, for characters and items, a 3D turnaround brief built from the visual description.` },
    { kind: 'para', text: msg`Dates use the world's own calendar and always name their era (for example "1920 AS"); "c." means approximate. Names in the text are resolved from links. Consistency warnings that are still open are listed in the appendix. A Markdown copy of the same content (codex.md) is written next to the PDF for tools that read text.` },
  );

  const counts = ENTRY_TYPES.map((t) => [TYPE_LABELS[t], String(world.entries.filter((e) => e.type === t).length)] as [string, string]);
  blocks.push({ kind: 'heading', level: 1, text: msg`World overview`, toc: true, newPage: true });
  if (m.description) blocks.push({ kind: 'para', text: m.description, style: 'lead' });
  blocks.push({ kind: 'facts', rows: [...(opts.ids ? [[msg`World id`, m.id] as [string, string]] : []), ...counts, [msg`Reference images`, String(imageCount)]] });
  blocks.push(
    { kind: 'heading', level: 2, text: msg`Calendar`, toc: true },
    { kind: 'facts', rows: [
      ...cal.eras.map((e): [string, string] => [
        msg`Era ${verbatim(e.id)}`,
        e.id === cal.defaultEra ? msg`${e.name}; its year 1 is absolute year ${e.start} (default era)` : msg`${e.name}; its year 1 is absolute year ${e.start}`,
      ]),
      [msg`Months`, joined(monthsOf(cal).map((mo) => msg`${mo.name} (${mo.days} days)`), ', ')],
      [msg`Approximate dates`, msg`"~" or "c." widens a date by ${cal.approxYears ?? 5} years either way`],
    ] },
  );

  blocks.push(...mapSections(world));

  for (const type of ENTRY_TYPES) {
    if (!opts.types.includes(type)) continue;
    const list = world.entries.filter((e) => e.type === type).sort(byName);
    if (!list.length) continue;
    blocks.push({ kind: 'heading', level: 1, text: TYPE_LABELS[type], toc: true, newPage: true, icon: TYPE_ICON[type] });
    for (const e of list) blocks.push(...entrySection(e, ix, world, all, mentionedIn, opts));
  }

  // Timeline: every dated start/end, in world order.
  const moments: { lo: number; text: string }[] = [];
  for (const e of world.entries) {
    const life = ix.life(e);
    for (const p of [life.start, life.end]) {
      if (!p) continue;
      const what = e.type === 'event'
        ? e.place ? msg`${e.name} ${p.word} (at ${ix.nameOf(e.place)})` : msg`${e.name} ${p.word}`
        : e.type === 'note' ? msg`Lore: ${e.name}` : msg`${e.name} ${p.word}`;
      moments.push({ lo: p.date.lo, text: msg`${dateWithEra(p.date, cal)}: ${what}` });
    }
  }
  moments.sort((a, b) => a.lo - b.lo || a.text.localeCompare(b.text));
  blocks.push({ kind: 'heading', level: 1, text: msg`Timeline`, toc: true, newPage: true });
  blocks.push(moments.length ? { kind: 'list', items: moments.map((x) => x.text) } : { kind: 'para', text: msg`No dated entries yet.`, style: 'muted' });

  blocks.push({ kind: 'heading', level: 1, text: msg`Relationship summary`, toc: true, newPage: true });
  const types = [...new Set(all.map((t) => t.type))].sort();
  if (!types.length) blocks.push({ kind: 'para', text: msg`No relationships yet.`, style: 'muted' });
  for (const t of types) blocks.push({ kind: 'heading', level: 3, text: rel(t) }, { kind: 'list', items: all.filter((x) => x.type === t).map(tripleText) });

  const names: [string, string][] = [];
  for (const e of world.entries) {
    names.push([e.name, e.pronunciation ? msg`${TYPE_SINGULAR[e.type]} (${verbatim(e.id)}), said ${verbatim(e.pronunciation)}` : msg`${TYPE_SINGULAR[e.type]} (${verbatim(e.id)})`]);
    for (const a of e.aliases ?? []) names.push([a, msg`${TYPE_SINGULAR[e.type]}: alias of ${e.name}`]);
  }
  names.sort((a, b) => normalizeName(a[0]).localeCompare(normalizeName(b[0])));
  blocks.push({ kind: 'heading', level: 1, text: msg`Glossary of names`, toc: true, newPage: true }, { kind: 'facts', rows: names });

  const open = warnings.filter((w) => !w.intended);
  const intended = warnings.filter((w) => w.intended);
  if (opts.warnings) {
    blocks.push({ kind: 'heading', level: 1, text: msg`Appendix: consistency warnings`, toc: true, newPage: true });
    blocks.push(open.length ? { kind: 'list', items: open.map(warningLine) } : { kind: 'para', text: msg`No open warnings.`, style: 'muted' });
    if (intended.length) blocks.push({ kind: 'heading', level: 3, text: msg`Marked intended by the author (treat as canon)` }, { kind: 'list', items: intended.map(warningLine) });
  }

  return {
    kind: 'codex',
    title: msg`${m.name}: World Codex`,
    cover: {
      title: m.name,
      subtitle: msg`World Codex`,
      lines: [
        ...(m.description ? [m.description] : []),
        msg`${world.entries.length} entries · ${imageCount} reference images · ${open.length} open warnings`,
        msg`Generated by ${GENERATOR} (world codex format ${CODEX_FORMAT_VERSION}, world schema ${m.schemaVersion})`,
      ],
      art: worldCoverArt(world),
    },
    blocks,
  };
}

