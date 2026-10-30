export interface BodyLink {
  ref: string;
  /** Character offset in the body. */
  index: number;
}

const WIKI = /\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;
const MENTION = /(^|[\s(])@([A-Za-z0-9][\w-]*)/g;

/** References in free text: [[id]], [[Name]], [[id|label]] and @id. */
export function bodyLinks(body: string): BodyLink[] {
  const out: BodyLink[] = [];
  for (const m of body.matchAll(WIKI)) out.push({ ref: m[1]!.trim(), index: m.index });
  for (const m of body.matchAll(MENTION)) out.push({ ref: m[2]!, index: m.index + m[1]!.length });
  return out.sort((a, b) => a.index - b.index);
}
