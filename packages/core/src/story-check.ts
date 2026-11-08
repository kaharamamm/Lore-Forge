/**
 * Live story warnings and turning proposals into entries.
 *
 * The story is checked "as if": every open proposal is applied to a copy of the world, every dated deed
 * becomes a small event, and the normal rules run over that copy. Warnings that are new compared to the
 * real world and come from the story are reported with a FactRef pointing at the sentence.
 */
import { detailField } from './details.ts';
import { checkWorld, ruleSetting, sortWarnings, type Rule } from './engine.ts';
import { findExisting, reconcile, ruleExtractor, type Extraction, type Proposal, type ProposalFields, type RawProposal, type Reconciled, type SourceSpan } from './extract.ts';
import { msg, rewritten, verbatim } from './i18n.ts';
import { DEFAULT_STATUS, LIFECYCLE, statusOf } from './lifecycle.ts';
import { afterDeath, beforeBirth, dateOrder, deadMarkedAlive, parentBornAfterChild, parentCycle, participantNotExisting, placeNotExisting, twoPlacesAtOnce } from './rules/index.ts';
import { slugify } from './story.ts';
import { normalizeName, STORY_REF_PREFIX, WorldIndex } from './world-index.ts';
import { statusWord } from './words.ts';
import type { Entry, EntryType, FactRef, IntendedMark, StoryChapter, Warning, World } from './types.ts';

export { STORY_REF_PREFIX };

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
  return { entryId: STORY_REF_PREFIX + span.chapter, field: 'body', source: msg`Story/${ch?.title ?? span.chapter}`, chapter: span.chapter, span: [span.start, span.end] };
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
 * Only fields that fit the entry type are used. Pass `ix` (an index of `world`) when applying many proposals.
 */
export function applyFields(entry: Entry, f: ProposalFields, world: World, pending: ReadonlyMap<string, string> = new Map(), ix: WorldIndex = new WorldIndex(world)): Entry {
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

/** A new entry for a create proposal (or an edited one). `taken` = ids already used. Pass `ix` (an index of `world`) when making many. */
export function proposalEntry(p: Pick<Proposal, 'entryType' | 'name' | 'fields' | 'sourceSpan'>, world: World, taken: ReadonlySet<string>, pending?: ReadonlyMap<string, string>, ix?: WorldIndex): Entry {
  const id = newEntryId(p.entryType, p.name, taken);
  const base = { id, type: p.entryType, name: p.name.trim(), body: p.sourceSpan.quote ? `> ${p.sourceSpan.quote}\n` : '' } as Entry;
  if (LIFECYCLE[p.entryType]) (base as { status?: string }).status = DEFAULT_STATUS;
  return applyFields(base, p.fields, world, pending, ix);
}

// ------------------------------------------------------------------------------------------- analysis

export interface StoryAnalysis extends Reconciled {
  extraction: Extraction;
  /** Story-sourced warnings (already sorted, intended marks applied). */
  warnings: Warning[];
}

const chapters = (world: World): StoryChapter[] => world.story ?? [];
const nameKey = (s: string) => normalizeName(s).replace(/^the /, '');
const LIST_FIELDS = ['relations', 'participants', 'actions'] as const;
/** Fields a sentence can say differently than the entry: what story-contradiction compares. */
const CLAIMS = ['born', 'died', 'date', 'place', 'title', 'status'] as const;
type Claim = (typeof CLAIMS)[number];

const stable = (v: unknown): string => JSON.stringify(v ?? null);

function sameDate(ix: WorldIndex, a: string, b: string): boolean {
  const x = ix.parse(a);
  const y = ix.parse(b);
  if (x.kind === 'date' && y.kind === 'date') return x.date.lo === y.date.lo && x.date.hi === y.date.hi && x.date.approx === y.date.approx;
  return a.trim() === b.trim();
}

/**
 * What the entry says instead, when a sentence's `k` disagrees with it; undefined when they agree or the entry has
 * nothing there yet (then the sentence only adds). The same comparison reconcile() makes for update proposals.
 */
function disagreement(ix: WorldIndex, e: Entry, k: Claim, said: string): string | undefined {
  const rec = e as unknown as Record<string, unknown>;
  switch (k) {
    case 'born':
    case 'died':
    case 'date': {
      const fits = k === 'date' ? e.type === 'event' || e.type === 'note' : e.type === 'character';
      const cur = rec[k];
      if (!fits || typeof cur !== 'string' || !cur.trim() || cur === 'unknown' || sameDate(ix, cur, said)) return undefined;
      return cur;
    }
    case 'status': {
      if (e.type !== 'character') return undefined;
      const cur = statusOf(e);
      return cur && cur !== 'unknown' && cur !== said ? cur : undefined;
    }
    case 'title': {
      const cur = e.details?.['title'] ?? e.extra?.['title'];
      if (typeof cur !== 'string' || !cur.trim() || normalizeName(cur) === normalizeName(said)) return undefined;
      // "Queen Ilsa" names the title; it does not change it.
      return normalizeName(e.name).startsWith(`${normalizeName(said)} `) ? undefined : cur;
    }
    case 'place': {
      if (e.type !== 'event' || !e.place) return undefined;
      const id = (r: string) => findExisting(ix, r)?.id ?? r;
      return id(e.place) === id(said) ? undefined : e.place;
    }
  }
}

/** Extract, reconcile and check the story. Cheap enough to run on every (debounced) keystroke. */
export function analyzeStory(world: World, extraction: Extraction = ruleExtractor.extract({ world, chapters: chapters(world) })): StoryAnalysis {
  const rec = reconcile(world, extraction.proposals);
  if (!chapters(world).length) return { ...rec, extraction, warnings: [] };
  const ix = new WorldIndex(world);
  const taken = new Set(world.entries.map((e) => e.id));
  /** `${entry id}|${field}` -> the sentence that gave that field; a bare entry id -> the sentence that made the entry. */
  const introduced = new Map<string, SourceSpan>();
  const pending = new Map<string, string>();
  const creates = rec.proposals.filter((p) => p.kind === 'create');
  for (const p of creates) {
    const id = newEntryId(p.entryType, p.name, taken);
    taken.add(id);
    pending.set(nameKey(p.name), id);
  }
  const entries = new Map(world.entries.map((e) => [e.id, e]));
  const hypo: World = { ...world, entries: [] };
  const warnings: Warning[] = [];
  const marks = new Map(world.intended.map((m) => [m.warningId, m]));
  const setting = ruleSetting(world, STORY_CONTRADICTION, storyContradiction.severity);

  // Raw proposals (in story order, as reconcile() merges them), grouped the way reconcile() groups them: by the
  // entry they are about, or by type and name for things that do not exist yet. One findExisting per name.
  const found = new Map<string, Entry | undefined>();
  const about: { r: RawProposal; existing: Entry | undefined }[] = [];
  const fresh = new Map<string, RawProposal[]>();
  const known = new Map<string, RawProposal[]>();
  const push = (m: Map<string, RawProposal[]>, k: string, r: RawProposal) => {
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  };
  for (const r of extraction.proposals) {
    const k = `${r.entryType}|${normalizeName(r.name)}`;
    if (!found.has(k)) found.set(k, findExisting(ix, r.name, r.entryType));
    const existing = found.get(k);
    about.push({ r, existing });
    if (!existing) push(fresh, `${r.entryType}|${nameKey(r.name)}`, r);
    else if (existing.type === r.entryType) push(known, existing.id, r);
  }

  /** The sentence that first said field `k` (or, for a list, this item of it) among the raw proposals merged into one. */
  const sourceOf = (merged: readonly RawProposal[], k: keyof ProposalFields, item?: unknown): SourceSpan | undefined => {
    const want = item === undefined ? undefined : JSON.stringify(item);
    for (const r of merged) {
      const v = r.fields[k];
      if (v === undefined) continue;
      if (want === undefined || (Array.isArray(v) && v.some((x) => JSON.stringify(x) === want))) return r.sourceSpan;
    }
    return undefined;
  };
  /**
   * Point each field that `fields` gives entry `id` at the sentence that said it (list items from index `from[k]`
   * on). `was` and `now` are the entry before and after, to see a status that a death date changed.
   */
  const remember = (id: string, p: Proposal, fields: ProposalFields, merged: readonly RawProposal[], was: Entry, now: Entry, from: Partial<Record<string, number>> = {}): void => {
    for (const k of Object.keys(fields) as (keyof ProposalFields)[]) {
      const v = fields[k];
      if ((LIST_FIELDS as readonly string[]).includes(k) && Array.isArray(v)) {
        v.forEach((item, i) => introduced.set(`${id}|${k}[${(from[k] ?? 0) + i}]`, sourceOf(merged, k, item) ?? p.sourceSpan));
      } else introduced.set(`${id}|${k}`, sourceOf(merged, k) ?? p.sourceSpan);
    }
    // A death date makes an entry without a status dead: that status comes from the same sentence.
    if (fields.died !== undefined && fields.status === undefined && statusOf(was) !== statusOf(now)) introduced.set(`${id}|status`, introduced.get(`${id}|died`)!);
  };

  for (const p of creates) {
    const id = pending.get(nameKey(p.name))!;
    const e = proposalEntry(p, world, new Set(), pending, ix);
    const blank = { ...e, status: DEFAULT_STATUS } as Entry;
    e.id = id;
    entries.set(id, e);
    introduced.set(id, p.sourceSpan);
    // Merged like reconcile() does: the same type and name, then a lone first name of a new person ("Rhys" after
    // "Rhys Varn") when its sentences were merged in.
    const key = nameKey(p.name);
    const spans = new Set([p.sourceSpan, ...(p.alsoAt ?? [])].map((x) => `${x.chapter}|${x.start}`));
    const first = key.includes(' ') && p.entryType === 'character' ? fresh.get(`character|${key.split(' ')[0]}`) ?? [] : [];
    const merged = [...(fresh.get(`${p.entryType}|${key}`) ?? []), ...first.filter((r) => spans.has(`${r.sourceSpan.chapter}|${r.sourceSpan.start}`))];
    remember(id, p, p.fields, merged, blank, e);
  }
  for (const p of rec.proposals) {
    if (p.kind !== 'update' || !p.matchedExistingId) continue;
    const cur = entries.get(p.matchedExistingId)!;
    const adds: ProposalFields = {};
    for (const [k, v] of Object.entries(p.fields)) if (!(k in (p.previous ?? {}))) (adds as Record<string, unknown>)[k] = v;
    const next = applyFields(cur, adds, world, pending, ix);
    const merged = known.get(cur.id) ?? [];
    const before = Object.fromEntries(LIST_FIELDS.map((k) => [k, ((cur as unknown as Record<string, unknown>)[k] as unknown[] | undefined)?.length ?? 0]));
    remember(cur.id, p, adds, merged, cur, next, before);
    entries.set(cur.id, next);
  }

  // A sentence that says something else than an entry. Every sentence is compared on its own: when one chapter
  // agrees and a later one does not, the later one is still reported. Claims of ignored proposals stay quiet.
  if (setting !== 'off') {
    const ignored = new Set<string>();
    for (const p of rec.ignored) {
      if (p.kind === 'update' && p.matchedExistingId) for (const [k, v] of Object.entries(p.fields)) ignored.add(`${p.matchedExistingId}|${k}|${stable(v)}`);
    }
    const reported = new Set<string>();
    for (const { r, existing: target } of about) {
      if (!target || target.type !== r.entryType || !CLAIMS.some((k) => r.fields[k] !== undefined)) continue;
      for (const k of CLAIMS) {
        const now = r.fields[k];
        if (now === undefined || (k === 'status' && r.fields.died !== undefined)) continue;
        const was = disagreement(ix, target, k, now);
        if (was === undefined || ignored.has(`${target.id}|${k}|${stable(now)}`)) continue;
        const id = `${STORY_CONTRADICTION}:${target.id}:${k}:${slugify(String(now))}`;
        if (reported.has(id)) continue;
        reported.add(id);
        // Dates read as "in 1800" in the sentence and "1800" for the entry; a date that cannot be read is quoted as written.
        const shown = (v: string, at: boolean): unknown => {
          if (k === 'place') return ix.nameOf(v);
          const d = k === 'born' || k === 'died' || k === 'date' ? ix.date(v) : undefined;
          return d ? (at ? ix.at(d) : ix.fmt(d)) : verbatim(v);
        };
        const name = target.name;
        const source = ix.source(target);
        const message =
          k === 'born' ? msg`The story says ${name} was born ${shown(now, true)}, but ${source} says ${shown(was, false)}.`
          : k === 'died' ? msg`The story says ${name} died ${shown(now, true)}, but ${source} says ${shown(was, false)}.`
          : k === 'date' ? msg`The story says ${name} happened ${shown(now, true)}, but ${source} says ${shown(was, false)}.`
          : k === 'place' ? msg`The story says ${name} happened at ${shown(now, true)}, but ${source} says ${shown(was, false)}.`
          : k === 'title' ? msg`The story says ${name} has the title "${verbatim(now)}", but ${source} says "${verbatim(was)}".`
          : msg`The story says ${name} is ${statusWord(now)}, but ${source} says ${statusWord(was)}.`;
        const w: Warning = {
          id,
          ruleId: STORY_CONTRADICTION,
          severity: setting,
          message,
          offending: storyFact(world, r.sourceSpan),
          conflicting: ix.fact(target, k),
        };
        const mark = marks.get(id);
        if (mark) w.intended = mark;
        warnings.push(w);
      }
    }
  }

  // Dated deeds become one small event each. Its id comes from what the sentence says (actor, verb, target, date,
  // place), numbered only when one chapter says the very same thing twice, so warning ids (and intended marks) stay
  // put when sentences are added elsewhere. Older versions numbered every deed in the story: `legacy` maps the new
  // ids to those, so marks made back then still apply.
  const legacy = new Map<string, string>();
  const used = new Map<string, number>();
  extraction.appearances.forEach((a, n) => {
    const actor = resolveRef(ix, a.actor, pending);
    const who = entries.get(actor);
    if (!who || who.type === 'event' || who.type === 'note') return;
    const chapter = slugify(a.sourceSpan.chapter.replace(/^story\//, '').replace(/\.md$/, ''));
    let id = `story~${chapter}~${slugify([a.actor, a.verb, a.target ?? '', a.date, a.place ?? ''].join(' '), 'deed')}`;
    const seen = (used.get(id) ?? 0) + 1;
    used.set(id, seen);
    if (seen > 1) id = `${id}~${seen}`;
    legacy.set(id, `story~${chapter}~${n}`);
    const ev: Entry = { id, type: 'event', name: a.sourceSpan.quote, body: '', date: a.date, actions: [{ actor, verb: a.verb, ...(a.target ? { target: resolveRef(ix, a.target, pending) } : {}) }] };
    if (a.place) ev.place = resolveRef(ix, a.place, pending);
    entries.set(id, ev);
    introduced.set(id, a.sourceSpan);
  });
  hypo.entries = [...entries.values()];

  /** A mark made under an older id of this warning: deed events had running numbers. */
  const oldMark = (id: string): IntendedMark | undefined => {
    if (!legacy.size || !id.includes('story~')) return undefined;
    const old = id.replace(/story~[a-z0-9-]+~[a-z0-9-]+(?:~\d+)?/g, (m) => legacy.get(m) ?? m);
    const [rule, ...rest] = old.split(':');
    const pair = rest.join(':').split('|');
    return marks.get(old) ?? (pair.length === 2 ? marks.get(`${rule}:${pair[1]}|${pair[0]}`) : undefined);
  };

  const base = new Set(checkWorld(world, STORY_RULES).map((w) => w.id));
  const map = (f: FactRef | undefined): FactRef | undefined => {
    if (!f) return undefined;
    const span =
      introduced.get(`${f.entryId}|${f.field}`) ??
      introduced.get(`${f.entryId}|${f.field.replace(/\.(from|to)$/, '')}`) ??
      introduced.get(f.entryId) ??
      // An entry dated by the story: everything it has happens then because the story says so.
      introduced.get(`${f.entryId}|date`) ??
      introduced.get(`${f.entryId}|end`);
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
    // A fact that comes from the story is quoted from the story, not from the entry it was added to.
    for (const [orig, now] of [[w.offending, off], [w.conflicting, con]] as const) {
      if (orig && now && orig.source !== now.source) {
        const quoted = message.split(`(source: ${orig.source})`).join(`(source: ${now.source})`);
        message = rewritten(message, quoted, (v) => (v === orig.source ? now.source : v));
      }
    }
    const out: Warning = { ...w, message, offending: off ?? w.offending };
    if (!out.intended) {
      const mark = oldMark(w.id);
      if (mark) out.intended = mark;
    }
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
