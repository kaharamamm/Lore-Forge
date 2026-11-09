import type { Block, Doc } from './doc.ts';

const slug = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

/**
 * Plain Markdown version of a Doc, so AI tools can read it without OCR.
 * `imageHref` maps a world-relative image path to a link usable from where the Markdown is saved.
 * `t` translates the few words the Markdown adds itself (the contents heading, the comment at the top), for a Doc
 * that was localized with localizeDoc: pass (s) => localize(s, table).
 */
export function toMarkdown(doc: Doc, imageHref: (file: string) => string = (f) => f, t: (text: string) => string = (s) => s): string {
  const out: string[] = [];
  const headings = doc.blocks.filter((b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading' && !!b.toc);
  const anchor = (b: Extract<Block, { kind: 'heading' }>) => b.anchor ?? slug(b.text);
  out.push(`<!-- ${t(doc.kind === 'codex' ? 'Lore-Forge World Codex; same content as the PDF.' : 'Lore-Forge Story Book; same content as the PDF.')} -->`, '');
  out.push(`# ${doc.cover.title}`, '', `**${doc.cover.subtitle}**`, '');
  for (const l of doc.cover.lines) out.push(l, '');

  const write = (b: Block, depth = 0): void => {
    switch (b.kind) {
      case 'toc':
        out.push(`## ${t('Contents')}`, '');
        for (const h of headings) out.push(`${'  '.repeat(h.level - 1)}- [${h.text}](#${anchor(h)})`);
        out.push('');
        break;
      case 'heading':
        if (b.toc) out.push(`<a id="${anchor(b)}"></a>`, '');
        out.push(`${'#'.repeat(Math.min(b.level + 1 + depth, 6))} ${b.text}`, '');
        if (b.stamp) out.push(`<p align="right"><i>${b.stamp}</i></p>`, '');
        break;
      case 'para':
        out.push(b.style === 'lead' ? `*${b.text}*` : b.text.replace(/\n/g, '  \n'), '');
        break;
      case 'facts':
        for (const [k, v] of b.rows) out.push(`- **${k}:** ${v}`);
        out.push('');
        break;
      case 'list':
        for (const i of b.items) out.push(`- ${i}`);
        out.push('');
        break;
      case 'image':
        // A map's heading names it already: no caption line.
        out.push(`![${b.caption}](${imageHref(b.file).replace(/ /g, '%20')})`, '', ...(b.pins ? [] : [`*${b.caption}*`, '']));
        for (const d of b.details) out.push(`- ${d}`);
        if (b.details.length) out.push('');
        for (const p of b.pins ?? []) out.push(`${p.n}. ${p.name}`);
        if (b.pins?.length) out.push('');
        break;
      case 'prompt':
        out.push(`**${b.label}:**`, '', '```text', b.text, '```', '');
        break;
      case 'front':
        // The cover above already gives the title page; the other front pages follow as plain text.
        if (b.role === 'copyright') out.push(...b.lines.map((l) => `<small>${l}</small>  `), '');
        if (b.role === 'dedication') out.push(...b.lines.map((l) => `*${l}*`), '');
        if (b.role === 'epigraph') out.push(...b.lines.map((l) => `> ${l}`), '');
        break;
      case 'box':
        out.push(`${'#'.repeat(Math.min(4 + depth, 6))} ${b.title}`, '');
        for (const inner of b.blocks) write(inner, depth + 1);
        break;
    }
  };
  for (const b of doc.blocks) write(b);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
