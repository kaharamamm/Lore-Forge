import { RULE_SETTINGS, SCHEMA_VERSION, type FactRef, type RuleSetting, type Severity, type Warning, type World } from './types.ts';
import { WorldIndex } from './world-index.ts';
import { appearances, type Appearance } from './appearances.ts';

/** What a rule reports; the engine adds id, severity and intended marks. */
export interface Finding {
  /**
   * Stable key, unique within the rule. Becomes the warning id `${ruleId}:${key}`. Build it from what the
   * warning is about (ids, relation types, dates, file names), never from list positions or counters, so an
   * intended mark stays on its warning when unrelated rows or entries are added or removed.
   */
  key: string;
  /**
   * The key older versions of Lore-Forge gave this finding, when it was different (keys used to hold list
   * positions such as `locations:0`, or running numbers). intended.json may still hold marks made under
   * `${ruleId}:${legacyKey}`; the engine applies such a mark when there is none under the new id, so upgrading
   * does not lose marks. New marks are written under the new id (the app does that).
   */
  legacyKey?: string;
  message: string;
  offending: FactRef;
  conflicting?: FactRef;
}

export interface RuleContext {
  world: World;
  ix: WorldIndex;
  /** Precomputed dated appearances, shared by the timeline rules. */
  appearances: readonly Appearance[];
}

export interface Rule {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  check(ctx: RuleContext): Finding[];
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
/** The same order as String#localeCompare() with no arguments, made once (sorting runs on every check). */
const ID_ORDER = new Intl.Collator();
/**
 * Where each id of the last list sorted with ID_ORDER came in it. Most keystrokes change no warning, so the next list
 * usually has only known ids and sorts by these numbers, which gives the same order without comparing strings.
 */
let idRank = new Map<string, number>();

/**
 * A rule's setting from world.json `rules`: error, warning, info or off. A missing or unknown value (such as
 * "Off" or "Error"; parseManifest reports those) gives the rule's default severity.
 */
export function ruleSetting(world: World, ruleId: string, fallback: Severity): RuleSetting {
  const rules: unknown = world.manifest.rules;
  const v = typeof rules === 'object' && rules !== null ? (rules as Record<string, unknown>)[ruleId] : undefined;
  return (RULE_SETTINGS as readonly unknown[]).includes(v) ? (v as RuleSetting) : fallback;
}

/** Run rules over a world. Rule severities can be changed or turned off in world.json `rules`. */
export function checkWorld(world: World, rules: readonly Rule[]): Warning[] {
  const ix = new WorldIndex(world);
  const ctx: RuleContext = { world, ix, appearances: appearances(ix) };
  const marks = new Map(world.intended.map((m) => [m.warningId, m]));
  const seen = new Set<string>();
  const out: Warning[] = [];
  for (const rule of rules) {
    const setting = ruleSetting(world, rule.id, rule.severity);
    if (setting === 'off') continue;
    for (const f of rule.check(ctx)) {
      const id = `${rule.id}:${f.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const w: Warning = { id, ruleId: rule.id, severity: setting, message: f.message, offending: f.offending };
      if (f.conflicting) w.conflicting = f.conflicting;
      // A mark under the new id wins; one made by an older version under the old id still counts.
      const mark = marks.size ? (marks.get(id) ?? (f.legacyKey !== undefined ? marks.get(`${rule.id}:${f.legacyKey}`) : undefined)) : undefined;
      if (mark) w.intended = mark;
      out.push(w);
    }
  }
  return sortWarnings(out);
}

/** Report order: open before intended, then by severity, then by id (String#localeCompare order). Sorts in place. */
export function sortWarnings(ws: Warning[]): Warning[] {
  if (ws.length < 2) return ws;
  if (!ws.every((w) => idRank.has(w.id))) {
    const ids = [...new Set(ws.map((w) => w.id))].sort((a, b) => ID_ORDER.compare(a, b));
    idRank = new Map(ids.map((id, i) => [id, i]));
  }
  const n = idRank.size;
  const keyed = ws.map((w) => ({ w, k: ((w.intended ? 3 : 0) + (SEVERITY_ORDER[w.severity] ?? 3)) * n + idRank.get(w.id)! }));
  keyed.sort((a, b) => a.k - b.k);
  keyed.forEach((x, i) => (ws[i] = x.w));
  return ws;
}

/** A list of rules you can extend: `registry.register(myRule)`. */
export class RuleRegistry {
  private readonly rules = new Map<string, Rule>();
  constructor(initial: readonly Rule[] = []) {
    for (const r of initial) this.register(r);
  }
  register(rule: Rule): this {
    if (this.rules.has(rule.id)) throw new Error(`Rule "${rule.id}" is already registered.`);
    this.rules.set(rule.id, rule);
    return this;
  }
  list(): Rule[] {
    return [...this.rules.values()];
  }
  check(world: World): Warning[] {
    return checkWorld(world, this.list());
  }
}

export interface CheckReport {
  schemaVersion: number;
  world: { id: string; name: string };
  counts: Record<Severity | 'intended', number>;
  warnings: Warning[];
}

export function report(world: World, warnings: Warning[]): CheckReport {
  const counts = { error: 0, warning: 0, info: 0, intended: 0 };
  for (const w of warnings) {
    if (w.intended) counts.intended++;
    else counts[w.severity]++;
  }
  return { schemaVersion: SCHEMA_VERSION, world: { id: world.manifest.id, name: world.manifest.name }, counts, warnings };
}
