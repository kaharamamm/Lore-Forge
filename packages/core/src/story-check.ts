/**
 * Live story warnings and turning proposals into entries.
 *
 * The story is checked "as if": every open proposal is applied to a copy of the world, every dated deed
 * becomes a small event, and the normal rules run over that copy. Warnings that are new compared to the
 * real world and come from the story are reported with a FactRef pointing at the sentence.
 */
import { detailField } from './details.ts';
import { checkWorld, sortWarnings, type Rule } from './engine.ts';
import { reconcile, ruleExtractor, type Extraction, type Proposal, type ProposalFields, type Reconciled, type SourceSpan } from './extract.ts';
import { DEFAULT_STATUS, LIFECYCLE } from './lifecycle.ts';
import { afterDeath, beforeBirth, dateOrder, deadMarkedAlive, parentBornAfterChild, parentCycle, participantNotExisting, placeNotExisting, twoPlacesAtOnce } from './rules/index.ts';
import { slugify } from './story.ts';
import { normalizeName, WorldIndex } from './world-index.ts';
import type { Entry, EntryType, FactRef, StoryChapter, Warning, World } from './types.ts';

/** Prefix of FactRef.entryId for facts that live in the story, e.g. "story:story/01-the-salt-road.md". */
export const STORY_REF_PREFIX = 'story:';

const ID_PREFIX: Record<EntryType, string> = { character: 'char', place: 'place', faction: 'fac', item: 'item', event: 'evt', note: 'note' };

/** A free entry id like "char-camel" (then "char-camel-2"). */
export function newEntryId(type: EntryType, name: string, taken: ReadonlySet<string>): string {
  const base = `${ID_PREFIX[type]}-${slugify(name)}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function storyFact(world: World, span: SourceSpan): FactRef {
  const ch = world.story?.find((c) => c.file === span.chapter);
  return { entryId: STORY_REF_PREFIX + span.chapter, field: 'body', source: `Story/${ch?.title ?? span.chapter}`, chapter: span.chapter, span: [span.start, span.end] };
}

export const isStoryFact = (f: FactRef): boolean => f.entryId.startsWith(STORY_REF_PREFIX);

/** Rules that make sense for story facts. File, image and reference rules do not. */
const STORY_RULES: readonly Rule[] = [afterDeath, beforeBirth, participantNotExisting, placeNotExisting, twoPlacesAtOnce, parentCycle, parentBornAfterChild, deadMarkedAlive, dateOrder];

const STORY_CONTRADICTION = 'story-contradiction';
export const storyContradiction = {
  id: STORY_CONTRADICTION,
  title: 'Story disagrees with an entry',
  description: 'A sentence in the story gives a different date, place, status or title than the entry has.',
  severity: 'warning' as const,
};

// ------------------------------------------------------------------------------------- proposal -> entry

function resolveRef(ix: WorldIndex, ref: string, pending: ReadonlyMap<string, string>): string {
  return ix.resolve(ref)?.id ?? ix.resolve(ref.replace(/^the\s+/i, ''))?.id ?? ix.resolve(`The ${ref}`)?.id ?? pending.get(normalizeName(ref).replace(/^the /, '')) ?? ref;
}

/**
 * Apply proposal fields to an entry (a copy is returned). References are turned into ids when the entry
 * exists; `pending` maps names of entries being created in the same go to their new ids.
 * Only fields that fit the entry type are used.
 */
export function applyFields(entry: Entry, f: ProposalFields, world: World, pending: ReadonlyMap<string, string> = new Map()): Entry {
  const ix = new WorldIndex(world);
  const ref = (r: string) => resolveRef(ix, r, pending);
  const e = structuredClone(entry) as Entry & Record<string, unknown>;
  if (f.title !== undefined && f.title.trim()) {
    if (detailField(e.type, 'title')) e.details = { ...e.details, title: f.title.trim() };
    else e.extra = { ...e.extra, title: f.title.trim() };
  }
  if (e.type === 'character') {
    for (const k of ['occupation', 'gender'] as const) if (f[k]?.trim()) e.details = { ...e.details, [k]: f[k]!.trim() };
  }
  if (f.aliases?.length) {
    const have = new Set([e.name, ...(e.aliases ?? [])].map(normalizeName));
    const add = f.aliases.filter((a) => !have.has(normalizeName(a)));
    if (add.length) e.aliases = [...(e.aliases ?? []), ...add];
  }
  if (e.type === 'character') {
    if (f.born !== undefined) e.born = f.born;
    if (f.died !== undefined) e.died = f.died;
    if (f.status === 'alive' || f.status === 'dead' || f.status === 'unknown') e.status = f.status;
    else if (f.died !== undefined && (!e.status || e.status === 'unknown')) e.status = 'dead';
  }
  if (e.type === 'event' || e.type === 'note') {
    if (f.date !== undefined) e.date = f.date;
  }
  if (e.type === 'event') {
    if (f.place !== undefined) e.place = ref(f.place);
    if (f.participants?.length) e.participants = [...(e.participants ?? []), ...f.participants.map((p) => ({ id: ref(p) }))];
    if (f.actions?.length) e.actions = [...(e.actions ?? []), ...f.actions.map((a) => ({ ...a, actor: ref(a.actor), ...(a.target ? { target: ref(a.target) } : {}) }))];
  }
  if (f.relations?.length) e.relations = [...(e.relations ?? []), ...f.relations.map((r) => ({ ...r, target: ref(r.target) }))];
  return e;
}

/** A new entry for a create proposal (or an edited one). `taken` = ids already used. */
export function proposalEntry(p: Pick<Proposal, 'entryType' | 'name' | 'fields' | 'sourceSpan'>, world: World, taken: ReadonlySet<string>, pending?: ReadonlyMap<string, string>): Entry {
  const id = newEntryId(p.entryType, p.name, taken);
  const base = { id, type: p.entryType, name: p.name.trim(), body: p.sourceSpan.quote ? `> ${p.sourceSpan.quote}\n` : '' } as Entry;
  if (LIFECYCLE[p.entryType]) (base as { status?: string }).status = DEFAULT_STATUS;
  return applyFields(base, p.fields, world, pending);
}

// ------------------------------------------------------------------------------------------- analysis

export interface StoryAnalysis extends Reconciled {
  extraction: Extraction;
  /** Story-sourced warnings (already sorted, intended marks applied). */
  warnings: Warning[];
}

const chapters = (world: World): StoryChapter[] => world.story ?? [];

/** Extract, reconcile and check the story. Cheap enough to run on every (debounced) keystroke. */
export function analyzeStory(world: World, extraction: Extraction = ruleExtractor.extract({ world, chapters: chapters(world) })): StoryAnalysis {
  const rec = reconcile(world, extraction.proposals);
  if (!chapters(world).length) return { ...rec, extraction, warnings: [] };
  const ix = new WorldIndex(world);
  const taken = new Set(world.entries.map((e) => e.id));
  /** entry id or `${id}|field` -> the sentence that introduced it. */
  const introduced = new Map<string, SourceSpan>();
  const pending = new Map<string, string>();
  const creates = rec.proposals.filter((p) => p.kind === 'create');
  for (const p of creates) {
    const id = newEntryId(p.entryType, p.name, taken);
    taken.add(id);
    pending.set(normalizeName(p.name).replace(/^the /, ''), id);
  }
  const entries = new Map(world.entries.map((e) => [e.id, e]));
  const hypo: World = { ...world, entries: [] };
  const warnings: Warning[] = [];
  const marks = new Map(world.intended.map((m) => [m.warningId, m]));
  const setting = world.manifest.rules?.[STORY_CONTRADICTION] ?? storyContradiction.severity;

  for (const p of creates) {
    const id = pending.get(normalizeName(p.name).replace(/^the /, ''))!;
    const e = proposalEntry(p, world, new Set(), pending);
    e.id = id;
    entries.set(id, e);
    introduced.set(id, p.sourceSpan);
  }
  for (const p of rec.proposals) {
    if (p.kind !== 'update' || !p.matchedExistingId) continue;
    const cur = entries.get(p.matchedExistingId)!;
    const adds: ProposalFields = {};
    for (const [k, v] of Object.entries(p.fields)) if (!(k in (p.previous ?? {}))) (adds as Record<string, unknown>)[k] = v;
    const next = applyFields(cur, adds, world, pending);
    for (const k of Object.keys(adds)) {
      const list = (next as unknown as Record<string, unknown>)[k];
      const before = ((cur as unknown as Record<string, unknown>)[k] as unknown[] | undefined)?.length ?? 0;
      if (Array.isArray(list)) for (let i = before; i < list.length; i++) introduced.set(`${cur.id}|${k}[${i}]`, p.sourceSpan);
      else introduced.set(`${cur.id}|${k}`, p.sourceSpan);
    }
    entries.set(cur.id, next);
    if (setting === 'off') continue;
    for (const [k, was] of Object.entries(p.previous ?? {})) {
      if (k === 'status' && p.fields.died !== undefined) continue;
      const now = (p.fields as Record<string, unknown>)[k];
      const target = ix.resolve(p.matchedExistingId)!;
      const label = k === 'born' ? 'was born' : k === 'died' ? 'died' : k === 'date' ? 'happened' : k === 'place' ? 'happened at' : k === 'title' ? 'has the title' : 'is';
      const shown = (v: unknown, at: boolean) => {
        if (k === 'place') return ix.nameOf(String(v));
        if (k === 'title') return `"${String(v)}"`;
        const d = k === 'born' || k === 'died' || k === 'date' ? ix.date(String(v)) : undefined;
        return d ? (at ? ix.at(d) : ix.fmt(d)) : String(v);
      };
      const id = `${STORY_CONTRADICTION}:${target.id}:${k}:${slugify(String(now))}`;
      const w: Warning = {
        id,
        ruleId: STORY_CONTRADICTION,
        severity: setting,
        message: `The story says ${target.name} ${label} ${shown(now, true)}, but ${ix.source(target)} says ${shown(was, false)}.`,
        offending: storyFact(world, p.sourceSpan),
        conflicting: ix.fact(target, k),
      };
      const mark = marks.get(id);
      if (mark) w.intended = mark;
      warnings.push(w);
    }
  }
  // Dated deeds become one small event each.
  extraction.appearances.forEach((a, n) => {
    const actor = resolveRef(ix, a.actor, pending);
    const who = entries.get(actor);
    if (!who || who.type === 'event' || who.type === 'note') return;
    const id = `story~${slugify(a.sourceSpan.chapter.replace(/^story\//, '').replace(/\.md$/, ''))}~${n}`;
    const ev: Entry = { id, type: 'event', name: a.sourceSpan.quote, body: '', date: a.date, actions: [{ actor, verb: a.verb, ...(a.target ? { target: resolveRef(ix, a.target, pending) } : {}) }] };
    if (a.place) ev.place = resolveRef(ix, a.place, pending);
    entries.set(id, ev);
    introduced.set(id, a.sourceSpan);
  });
  hypo.entries = [...entries.values()];

  const base = new Set(checkWorld(world, STORY_RULES).map((w) => w.id));
  const map = (f: FactRef | undefined): FactRef | undefined => {
    if (!f) return undefined;
    const span = introduced.get(f.entryId) ?? introduced.get(`${f.entryId}|${f.field}`) ?? introduced.get(`${f.entryId}|${f.field.replace(/\.(from|to)$/, '')}`);
    return span ? storyFact(world, span) : undefined;
  };
  /** One warning per sentence and fact: "Hadi fought at Saltmere" is a deed and an event, but one mistake. The deed reads better. */
  const seen = new Map<string, number>();
  for (const w of checkWorld(hypo, STORY_RULES)) {
    if (base.has(w.id)) continue;
    const off = map(w.offending);
    const con = map(w.conflicting);
    if (!off && !con) continue;
    let message = w.message;
    // Facts that only exist in the story are quoted from the story, not from an entry that is not there yet.
    for (const [orig, now] of [[w.offending, off], [w.conflicting, con]] as const) {
      if (orig && now && !ix.byIdOf(orig.entryId)) message = message.split(`(source: ${orig.source})`).join(`(source: ${now.source})`);
    }
    const out: Warning = { ...w, message, offending: off ?? w.offending };
    // The story sentence is the thing to fix; the entry it collides with is the conflicting fact.
    if (!off && con) {
      out.offending = con;
      out.conflicting = w.offending;
    } else if (con) out.conflicting = con;
    else if (w.conflicting) out.conflicting = w.conflicting;
    const key = `${out.ruleId}|${out.offending.chapter ?? out.offending.entryId}|${out.offending.span ?? ''}|${out.conflicting?.entryId ?? ''}|${out.conflicting?.field ?? ''}`;
    const dup = seen.get(key);
    if (dup !== undefined) {
      if (w.offending?.entryId.startsWith('story~')) warnings[dup] = out;
      continue;
    }
    seen.set(key, warnings.length);
    warnings.push(out);
  }
  return { ...rec, extraction, warnings: sortWarnings(warnings) };
}
