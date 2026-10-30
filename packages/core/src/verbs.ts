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

export function activePhrase(verb: string, actorName: string, targetName: string | undefined): string {
  const v = VERBS[verb.toLowerCase()];
  if (v) return targetName ? `${v[0]} ${targetName}` : v[0];
  return `be part of "${actorName} ${verb}${targetName ? ` ${targetName}` : ''}"`;
}

export function passivePhrase(verb: string, actorName: string, targetName: string): string {
  const v = VERBS[verb.toLowerCase()];
  if (v) return `${v[1]} ${actorName}`;
  return `be part of "${actorName} ${verb} ${targetName}"`;
}
