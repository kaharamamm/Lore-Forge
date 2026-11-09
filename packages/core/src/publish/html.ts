/**
 * A book as a small website: the World Codex as index.html and, when the book has a story, the Story Book as
 * story.html. Plain pages that open in any browser, offline, without a server. Pictures keep their paths inside the
 * book folder (images/…, maps/…), so they go next to the pages; names of entries in the text link to their part of
 * index.html, and the places on a map link to theirs.
 */
import { ICONS, type IconName } from '../icons.ts';
import type { World } from '../types.ts';
import { WorldIndex } from '../world-index.ts';
import { anchorOf, inlineRuns, type Block, type Doc, type MapMark } from './doc.ts';

export interface SitePage {
  /** File name inside the site folder. */
  file: string;
  html: string;
}

/** Words the pages need around the book's own text, in the app's language. */
export interface SiteLabels {
  contents: string;
  world: string;
  story: string;
  /** The line at the foot of every page, e.g. "Made with Lore-Forge". */
  footer: string;
}

export interface BookSite {
  pages: SitePage[];
  /** Pictures the pages show, relative to the book folder: copy them to the same paths next to the pages. */
  files: string[];
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A picture path as a link: each part encoded, the slashes kept. */
const href = (file: string): string => file.split('/').map(encodeURIComponent).join('/');

function icon(name: IconName | null | undefined, cls = 'icon'): string {
  const paths = name ? (ICONS as Record<string, readonly string[]>)[name] : undefined;
  return paths ? `<svg class="${cls}" viewBox="0 0 512 512" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>` : '';
}

/**
 * The pages of a book's website. `codex` and `story` are the documents as the app builds them (in its language).
 * `icon` names the tab icon files that go next to the pages (Lore-Forge's own): an SVG, and a PNG for browsers that
 * want one (and phones' home screens).
 */
export function bookSite(world: World, codex: Doc, story: Doc | undefined, opts: { lang: string; labels: SiteLabels; icon?: { svg: string; png?: string } }): BookSite {
  const ix = new WorldIndex(world);
  const files = new Set<string>();
  const anchors = new Set(codex.blocks.flatMap((b) => (b.kind === 'heading' && b.anchor ? [b.anchor] : [])));

  // Names link once in each part (an entry, a chapter), so prose does not turn into a list of links; facts link
  // every time, and an entry never links to itself.
  let linked = new Set<string>();
  let self: string | undefined;
  /** Text with **bold** and *italic*, line breaks kept, and entry names linked to their part of the World page. */
  const text = (s: string, page: string, link: 'once' | 'always' | false = 'once'): string => s.split('\n').map((line) => inlineRuns(line).map((r) => {
    let out = '';
    let at = 0;
    for (const m of link ? ix.mentions.find(r.text, self ? { exclude: self } : {}) : []) {
      const id = m.ids.length === 1 ? m.ids[0]! : undefined;
      if (!id || !anchors.has(anchorOf(id)) || (link === 'once' && linked.has(id))) continue;
      if (link === 'once') linked.add(id);
      out += esc(r.text.slice(at, m.start)) + `<a href="${page === 'index.html' ? '' : 'index.html'}#${anchorOf(id)}">${esc(m.text)}</a>`;
      at = m.end;
    }
    out += esc(r.text.slice(at));
    return r.bold ? `<strong>${out}</strong>` : r.italic ? `<em>${out}</em>` : out;
  }).join('')).join('<br>');

  const map = (file: string, caption: string, pins: MapMark[], page: string): string => {
    const at = (p: MapMark): string => (p.id && anchors.has(anchorOf(p.id)) ? `${page === 'index.html' ? '' : 'index.html'}#${anchorOf(p.id)}` : '');
    const pin = (p: MapMark): string => (at(p) ? `<a class="pin" href="${at(p)}" style="left:${p.x}%;top:${p.y}%" title="${esc(p.name)}">${p.n}</a>` : `<span class="pin" style="left:${p.x}%;top:${p.y}%" title="${esc(p.name)}">${p.n}</span>`);
    const legend = pins.length ? `<ol class="legend">${pins.map((p) => `<li><span class="pin">${p.n}</span> ${at(p) ? `<a href="${at(p)}">${esc(p.name)}</a>` : esc(p.name)}</li>`).join('')}</ol>` : '';
    return `<figure class="map"><div class="map-frame"><img src="${href(file)}" alt="${esc(caption)}">${pins.map(pin).join('')}</div>${legend}</figure>`;
  };

  const block = (b: Block, page: string, i: number): string => {
    switch (b.kind) {
      case 'toc': return '';
      case 'heading': {
        const id = b.anchor ?? `part-${i}`;
        if (b.level <= 2) {
          linked = new Set();
          self = b.anchor?.startsWith('entry-') ? b.anchor.slice('entry-'.length) : undefined;
        }
        return `<h${b.level + 1} id="${esc(id)}"${b.newPage || b.opener ? ' class="part"' : ''}>${icon(b.icon)}${esc(b.text)}${icon(b.mark, 'icon mark')}${b.stamp ? ` <small class="stamp">${esc(b.stamp)}</small>` : ''}</h${b.level + 1}>`;
      }
      case 'para': return `<p${b.style ? ` class="${b.style}"` : b.dropCap ? ' class="opening"' : ''}>${text(b.text, page)}</p>`;
      case 'front': return `<section class="front front-${b.role}">${b.lines.filter((l) => l !== '').map((l) => `<p>${text(l, page, false)}</p>`).join('')}</section>`;
      case 'facts': return `<dl class="facts">${b.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${text(v, page, 'always')}</dd></div>`).join('')}</dl>`;
      case 'list': return `<ul>${b.items.map((x) => `<li>${text(x, page)}</li>`).join('')}</ul>`;
      case 'image':
        files.add(b.file);
        if (b.pins) return map(b.file, b.caption, b.pins, page);
        return `<figure><img src="${href(b.file)}" alt="${esc(b.caption)}" loading="lazy"><figcaption>${esc(b.caption)}</figcaption></figure>`;
      case 'prompt': return `<div class="prompt"><p class="prompt-label">${esc(b.label)}</p><pre>${esc(b.text)}</pre></div>`;
      case 'box': return `<aside class="box"><p class="box-title">${esc(b.title)}</p>${b.blocks.map((x, j) => block(x, page, i * 1000 + j)).join('')}</aside>`;
    }
  };

  const art = codex.cover.art;
  if (art?.image) files.add(art.image);
  const nav = (page: string): string => story
    ? `<nav class="pages"><a href="index.html"${page === 'index.html' ? ' aria-current="page"' : ''}>${esc(opts.labels.world)}</a><a href="story.html"${page === 'story.html' ? ' aria-current="page"' : ''}>${esc(opts.labels.story)}</a></nav>`
    : '';
  // The tab icon: the PNG first, so a browser that can show the SVG takes that one.
  const icons = opts.icon
    ? `${opts.icon.png ? `<link rel="icon" type="image/png" href="${href(opts.icon.png)}">\n<link rel="apple-touch-icon" href="${href(opts.icon.png)}">\n` : ''}<link rel="icon" type="image/svg+xml" href="${href(opts.icon.svg)}">\n`
    : '';
  const page = (file: string, doc: Doc): SitePage => {
    const toc = doc.blocks.flatMap((b, i) => (b.kind === 'heading' && (b.toc || b.opener) && b.level <= 2 ? [{ level: b.level, text: b.text, id: b.anchor ?? `part-${i}` }] : []));
    const head = art
      ? `<header class="cover" style="--top:${art.top};--bottom:${art.bottom};--glow:${art.glow};--title:${art.titleColor};--emblem:${art.iconColor}">${art.image ? `<img class="cover-picture" src="${href(art.image)}" alt="" style="opacity:${art.imageOpacity}">` : ''}<div class="cover-text">${art.showEmblem ? icon(art.icon, 'emblem') : ''}<h1>${esc(doc.cover.title)}</h1><p class="subtitle">${esc(doc.cover.subtitle)}</p></div>${nav(file)}</header>`
      : `<header class="cover plain"><div class="cover-text"><h1>${esc(doc.cover.title)}</h1><p class="subtitle">${esc(doc.cover.subtitle)}</p></div>${nav(file)}</header>`;
    const contents = toc.length ? `<nav class="contents" aria-label="${esc(opts.labels.contents)}"><p>${esc(opts.labels.contents)}</p><ul>${toc.map((h) => `<li class="l${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('')}</ul></nav>` : '';
    linked = new Set();
    self = undefined;
    const body = doc.blocks.map((b, i) => block(b, file, i)).join('\n');
    return {
      file,
      html: `<!doctype html>
<html lang="${esc(opts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
${icons}<style>${CSS}</style>
</head>
<body>
${head}
<div class="layout">
${contents}
<main>
${body}
</main>
</div>
<footer>${esc(opts.labels.footer)}</footer>
</body>
</html>
`,
    };
  };
  const pages = [page('index.html', codex), ...(story ? [page('story.html', story)] : [])];
  return { pages, files: [...files].sort() };
}

const CSS = `
:root { --ink: #23201b; --muted: #6d665b; --paper: #faf7f0; --card: #fffdf8; --line: #e3dccd; --accent: #8a5a1f; --link: #7a4a12; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.6 Georgia, 'DejaVu Serif', 'Times New Roman', serif; }
a { color: var(--link); text-decoration-color: rgb(122 74 18 / 0.35); text-underline-offset: 2px; }
a:hover { text-decoration-color: currentColor; }
.icon { width: 1em; height: 1em; vertical-align: -0.12em; margin-right: 0.35em; fill: currentColor; }
.icon.mark { margin: 0 0 0 0.35em; opacity: 0.7; }
.cover { position: relative; overflow: hidden; color: var(--title, #fff); background: radial-gradient(ellipse at 50% 40%, var(--glow, transparent), transparent 60%), linear-gradient(var(--top, #2c3340), var(--bottom, #14161b)); padding: 3.2rem 1.5rem 1.4rem; text-align: center; }
.cover.plain { background: #2c2a26; color: #fff8e6; }
.cover-picture { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cover-text { position: relative; }
.cover h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.4rem); letter-spacing: 0.04em; text-shadow: 0 2px 12px rgb(0 0 0 / 0.55); }
.cover .subtitle { margin: 0.3rem 0 0; font-style: italic; opacity: 0.9; text-shadow: 0 1px 6px rgb(0 0 0 / 0.6); }
.emblem { width: 3.2rem; height: 3.2rem; fill: var(--emblem, currentColor); filter: drop-shadow(0 2px 6px rgb(0 0 0 / 0.5)); }
.pages { position: relative; display: flex; justify-content: center; gap: 0.5rem; margin-top: 1.4rem; }
.pages a { color: inherit; text-decoration: none; padding: 0.3rem 1rem; border: 1px solid rgb(255 255 255 / 0.4); border-radius: 999px; background: rgb(0 0 0 / 0.25); }
.pages a[aria-current="page"] { background: rgb(255 255 255 / 0.18); border-color: currentColor; }
.layout { display: grid; grid-template-columns: minmax(13rem, 17rem) minmax(0, 46rem); justify-content: center; gap: 2.5rem; padding: 2rem 1.5rem 3rem; }
.contents { position: sticky; top: 1rem; align-self: start; max-height: calc(100vh - 2rem); overflow-y: auto; font-size: 0.9rem; }
.contents p { margin: 0 0 0.4rem; font-weight: bold; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.75rem; }
.contents ul { list-style: none; margin: 0; padding: 0; }
.contents li { margin: 0.15rem 0; }
.contents li.l1 { margin-top: 0.6rem; font-weight: bold; }
.contents li.l2 { padding-left: 0.9rem; }
.contents a { text-decoration: none; }
main { min-width: 0; }
h2, h3, h4 { color: var(--accent); line-height: 1.25; scroll-margin-top: 1rem; }
h2 { font-size: 1.9rem; margin: 2.6rem 0 1rem; padding-bottom: 0.35rem; border-bottom: 2px solid var(--line); }
h2.part:first-child, main > h2:first-child { margin-top: 0; }
h3 { font-size: 1.35rem; margin: 2rem 0 0.6rem; }
h4 { font-size: 1.05rem; margin: 1.4rem 0 0.4rem; }
.stamp { font-size: 0.6em; font-weight: normal; color: var(--muted); }
p.lead { font-size: 1.1rem; font-style: italic; }
p.muted { color: var(--muted); }
p.opening::first-letter { float: left; font-size: 3.1em; line-height: 0.9; padding: 0.06em 0.08em 0 0; color: var(--accent); }
.facts { display: grid; grid-template-columns: minmax(7rem, max-content) 1fr; gap: 0.25rem 1rem; margin: 0.8rem 0 1.2rem; padding: 0.8rem 1rem; background: var(--card); border: 1px solid var(--line); border-radius: 8px; font-size: 0.95rem; }
.facts div { display: contents; }
.facts dt { color: var(--muted); font-weight: bold; }
.facts dd { margin: 0; }
figure { margin: 1.2rem 0; text-align: center; }
figure img { max-width: 100%; max-height: 32rem; border-radius: 6px; box-shadow: 0 2px 10px rgb(0 0 0 / 0.18); }
figcaption { margin-top: 0.4rem; color: var(--muted); font-style: italic; font-size: 0.9rem; }
.map-frame { position: relative; display: inline-block; max-width: 100%; }
.map-frame img { display: block; max-height: none; }
.pin { display: inline-grid; place-items: center; min-width: 1.4rem; height: 1.4rem; padding: 0 0.25rem; border-radius: 999px; background: #22252d; border: 2px solid #c9a24f; color: #fff; font: bold 0.72rem/1 system-ui, sans-serif; text-decoration: none; }
.map-frame .pin { position: absolute; transform: translate(-50%, -50%); box-shadow: 0 2px 6px rgb(0 0 0 / 0.5); }
.map-frame a.pin:hover { background: #c9a24f; color: #1b1408; }
.legend { list-style: none; columns: 3 11rem; gap: 1.2rem; margin: 0.9rem 0 0; padding: 0; text-align: left; font-size: 0.92rem; }
.legend li { display: flex; align-items: center; gap: 0.45rem; break-inside: avoid; margin-bottom: 0.35rem; }
.prompt pre { white-space: pre-wrap; background: #f1ede3; padding: 0.7rem 0.9rem; border-radius: 6px; font-size: 0.85rem; }
.prompt-label { font-weight: bold; margin-bottom: 0.2rem; }
.box { margin: 1.2rem 0; padding: 0.4rem 1rem 0.8rem; border-left: 3px solid var(--accent); background: var(--card); }
.box-title { font-weight: bold; color: var(--accent); }
.front { margin: 2rem 0; text-align: center; }
.front-title p:first-child { font-size: 2rem; font-weight: bold; }
.front-copyright { font-size: 0.85rem; color: var(--muted); }
.front-dedication, .front-epigraph { font-style: italic; }
footer { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--line); }
@media (max-width: 820px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 1rem; padding: 1.2rem 1rem 2rem; }
  .contents { position: static; max-height: 16rem; padding: 0.8rem 1rem; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
}
@media print { .contents, .pages { display: none; } .layout { display: block; } }
`;
