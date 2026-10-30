import { SCHEMA_VERSION, type FactRef, type Severity, type Warning, type World } from './types.ts';
import { WorldIndex } from './world-index.ts';
import { appearances, type Appearance } from './appearances.ts';

/** What a rule reports; the engine adds id, severity and intended marks. */
export interface Finding {
  /** Stable key, unique within the rule. Becomes the warning id `${ruleId}:${key}`. */
  key: string;
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

/** Run rules over a world. Rule severities can be changed or turned off in world.json `rules`. */
export function checkWorld(world: World, rules: readonly Rule[]): Warning[] {
  const ix = new WorldIndex(world);
  const ctx: RuleContext = { world, ix, appearances: appearances(ix) };
  const marks = new Map(world.intended.map((m) => [m.warningId, m]));
  const seen = new Set<string>();
  const out: Warning[] = [];
  for (const rule of rules) {
    const setting = world.manifest.rules?.[rule.id] ?? rule.severity;
    if (setting === 'off') continue;
    for (const f of rule.check(ctx)) {
      const id = `${rule.id}:${f.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const w: Warning = { id, ruleId: rule.id, severity: setting, message: f.message, offending: f.offending };
      if (f.conflicting) w.conflicting = f.conflicting;
      const mark = marks.get(id);
      if (mark) w.intended = mark;
      out.push(w);
    }
  }
  return out.sort((a, b) => Number(!!a.intended) - Number(!!b.intended) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
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
