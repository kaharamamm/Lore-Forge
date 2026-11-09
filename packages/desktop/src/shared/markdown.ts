/**
 * The block Markdown an AI writes in a reply, for the Ask AI panel: paragraphs, headings, bullet and numbered lists,
 * quotes, code blocks and tables (shown as they are typed). Lines stay inline Markdown (see `inline`).
 */
export type MdBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'pre'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

export function mdBlocks(md: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) code.push(lines[i]!);
      out.push({ kind: 'pre', text: code.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A table keeps its lines as typed.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows: string[] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(lines[i]!.trim());
      i--;
      out.push({ kind: 'pre', text: rows.join('\n') });
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      out.push({ kind: 'h', text: heading[1]! });
      continue;
    }
    const bullet = /^\s*[-*+•]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || number) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const last = out[out.length - 1];
      const text = (bullet ?? number)![1]!;
      if (last && (last.kind === 'ul' || last.kind === 'ol') && last.kind === kind) last.items.push(text);
      else out.push(bullet ? { kind: 'ul', items: [text] } : { kind: 'ol', items: [text] });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const last = out[out.length - 1];
      if (last && last.kind === 'quote') last.text += ` ${quote[1]}`;
      else out.push({ kind: 'quote', text: quote[1]! });
      continue;
    }
    // An indented line under a list item goes on with that item.
    const last = out[out.length - 1];
    if (!para.length && /^\s{2,}\S/.test(line) && last && (last.kind === 'ul' || last.kind === 'ol')) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}
