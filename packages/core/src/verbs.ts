import { fixed, msg, msgIn, template, verbatim } from './i18n.ts';
import type { EntryType } from './types.ts';

/** Past-tense verb or relation type -> [active base form, passive form]. Unknown verbs fall back to a quoted phrase. */
const VERBS: Record<string, [string, string]> = {
  killed: ['kill', 'be killed by'],
  murdered: ['murder', 'be murdered by'],
  slew: ['slay', 'be slain by'],
  slain: ['slay', 'be slain by'],
  executed: ['execute', 'be executed by'],
  wounded: ['wound', 'be wounded by'],
  attacked: ['attack', 'be attacked by'],
  defeated: ['defeat', 'be defeated by'],
  betrayed: ['betray', 'be betrayed by'],
  captured: ['capture', 'be captured by'],
  imprisoned: ['imprison', 'be imprisoned by'],
  freed: ['free', 'be freed by'],
  rescued: ['rescue', 'be rescued by'],
  saved: ['save', 'be saved by'],
  healed: ['heal', 'be healed by'],
  exiled: ['exile', 'be exiled by'],
  banished: ['banish', 'be banished by'],
  crowned: ['crown', 'be crowned by'],
  married: ['marry', 'marry'],
  met: ['meet', 'meet'],
  fought: ['fight', 'fight'],
  taught: ['teach', 'be taught by'],
  founded: ['found', 'be founded by'],
  destroyed: ['destroy', 'be destroyed by'],
  stole: ['steal', 'be stolen by'],
  forged: ['forge', 'be forged by'],
  wielded: ['wield', 'be wielded by'],
  joined: ['join', 'be joined by'],
  led: ['lead', 'be led by'],
  ruled: ['rule', 'be ruled by'],
  visited: ['visit', 'be visited by'],
  // relation types
  rules: ['rule', 'be ruled by'],
  owns: ['own', 'be owned by'],
  'member-of': ['be a member of', 'have as a member'],
  'leader-of': ['lead', 'be led by'],
  'ally-of': ['be an ally of', 'be an ally of'],
  'enemy-of': ['be an enemy of', 'be an enemy of'],
  'spouse-of': ['be married to', 'be married to'],
  'serves': ['serve', 'be served by'],
};

/**
 * The phrases as translatable templates, one set per verb: "kill {0}", "be killed by {0}" and "was killed by {0}".
 * A language that marks the object (Turkish) needs to know what kind of entry is acted on ("capture" a person or a
 * city), so the phrases carry the target's entry type as their context (see msgIn).
 */
const FORMS: Record<string, { base: string; active: TemplateStringsArray; passive: TemplateStringsArray; was: TemplateStringsArray }> = Object.fromEntries(
  Object.entries(VERBS).map(([verb, [active, passive]]) => [
    verb,
    { base: active, active: template(`${active} `, ''), passive: template(`${passive} `, ''), was: template(`${passive.replace(/^be /, 'was ')} `, '') },
  ]),
);
const formsOf = (key: string) => (Object.hasOwn(FORMS, key) ? FORMS[key] : undefined);

/**
 * What the actor does, in base form: "kill Queen Ilsa". `targetType` is the target's entry type, when known;
 * `relation` says the verb is a relation type (a phrase for an unknown one quotes a relation, not a deed).
 */
export function activePhrase(verb: string, actorName: string, targetName: string | undefined, targetType?: EntryType, relation = false): string {
  const key = verb.toLowerCase();
  const v = VERBS[key];
  if (v) {
    const f = formsOf(key);
    if (!targetName) return f ? fixed(f.base) : v[0];
    return f ? msgIn(targetType)(f.active, targetName) : `${v[0]} ${targetName}`;
  }
  const say = msgIn(relation ? 'relation' : undefined);
  return targetName ? say`be part of "${actorName} ${verbatim(verb)} ${targetName}"` : say`be part of "${actorName} ${verbatim(verb)}"`;
}

/** What happens to the target, in base form: "be killed by Orsan". `targetType` is the target's entry type, when known. */
export function passivePhrase(verb: string, actorName: string, targetName: string, targetType?: EntryType): string {
  const key = verb.toLowerCase();
  const v = VERBS[key];
  if (v) {
    const f = formsOf(key);
    return f ? msgIn(targetType)(f.passive, actorName) : `${v[1]} ${actorName}`;
  }
  return msg`be part of "${actorName} ${verbatim(verb)} ${targetName}"`;
}

/** The same in the past, for a killing: "was killed by Orsan", "was slain by Orsan". */
export function killedPhrase(verb: string, actorName: string, targetName: string): string {
  const key = verb.toLowerCase();
  const v = VERBS[key];
  if (v) {
    const f = formsOf(key);
    return f ? msg(f.was, actorName) : `${v[1]} ${actorName}`.replace(/^be /, 'was ');
  }
  return msg`was part of "${actorName} ${verbatim(verb)} ${targetName}"`;
}
