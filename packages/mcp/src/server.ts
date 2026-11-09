/**
 * The Lore-Forge MCP server: tools an assistant uses to write a whole world and its story into Lore-Forge.
 * `lore mcp` runs it on stdin/stdout for Claude Desktop, Claude Code, Codex, Cursor and other MCP clients.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { check, DETAIL_FIELDS, ENTRY_TYPES } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import {
  attachPicture, bookOverview, checkBook, createBook, deleteEntry, duplicateBook, entryJson, exportBook, findEntry, formatWarning, linkEntries,
  loadPictureSource, looksOn, mapView, markIntended, patchBook, pictureBrief, readStory, saveEntries, saveMap, storyProposals, writeChapter, type BookPatch,
  type EntryInput,
} from './books.ts';
import { guide, INSTRUCTIONS, writeStoryPrompt } from './guide.ts';
import {
  aspectFor, generateImage, imageSetup, listImageModels, NO_IMAGE_SETUP, pickImageModel, PROVIDER_INFO, readImageSettings, writeImageSettings,
  type FetchLike, type ImageSetup,
} from './images.ts';
import { bundledResources, Library, readManifestInfo, type LibraryOptions } from './library.ts';

export const SERVER_VERSION = '1.3.0';

export interface ServerOptions extends LibraryOptions {
  /** fetch for the image services (tests replace it). */
  fetch?: FetchLike;
  /** Fonts for PDF export; default: the app's bundled fonts, else the development copies. */
  fontDir?: string;
  coverFontDir?: string;
}

type Text = { type: 'text'; text: string };
type Picture = { type: 'image'; data: string; mimeType: string };
type Result = { content: (Text | Picture)[]; isError?: boolean };
const ok = (v: unknown): Result => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const fail = (e: unknown): Result => ({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true });
async function attempt(fn: () => Promise<Result | unknown>): Promise<Result> {
  try {
    const r = await fn();
    return r && typeof r === 'object' && 'content' in r ? (r as Result) : ok(r);
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------------------------------------ schemas

const date = z.union([z.string(), z.number()]);
const textList = z.union([z.array(z.string()), z.string()]);
const opt = <T extends z.ZodType>(s: T) => s.nullable().optional();
const bookRef = z.string().describe('The book: its name, id or folder (see list_books).');

/** Detail fields of every type, from the core table, so the client sees every field name. */
const detailShape: Record<string, z.ZodType> = {};
for (const t of ENTRY_TYPES) {
  for (const f of DETAIL_FIELDS[t]) {
    if (detailShape[f.key]) continue;
    const hint = `${f.label}${f.kind === 'ref' ? ': the name of one entry' : f.kind === 'refs' ? ': names of entries' : ''}.`;
    detailShape[f.key] = opt(f.kind === 'refs' || f.kind === 'list' ? textList : z.string()).describe(hint);
  }
}

const lookSchema = z.object({
  id: z.string().optional().describe('The look\'s id, to change or rename that look. Leave out for a new look: its id is made from its name and never changes, because its pictures use it.'),
  name: z.string().optional().describe('e.g. "After the war", "Coronation robes", "Old age". Needed for a new look.'),
  reason: opt(z.string()).describe('Why it looks different: a wound, a new title, new clothes, age.'),
  from: opt(date).describe('The look applies from this date.'),
  to: opt(date).describe('The look applies until this date.'),
  era: opt(z.string()).describe('An era code: the look applies while that era lasts.'),
  after: opt(z.string()).describe('An event (or another entry with a date), by name: the look applies once it is over.'),
  before: opt(z.string()).describe('An event (or another entry with a date), by name: the look applies until it starts.'),
  visual: opt(z.record(z.string(), z.string())).describe('Only the visual fields that change, e.g. {features: "An eye patch"}. The rest come from the Default look.'),
  remove: z.boolean().optional().describe('true removes this look. Its pictures go back to the Default look.'),
}).loose();

const entrySchema = z.object({
  id: z.string().optional().describe('Id of an existing entry to update. Leave out to create (an existing entry with the same type and name is updated too).'),
  type: z.enum(ENTRY_TYPES).optional().describe('Needed for a new entry.'),
  name: z.string().optional(),
  aliases: opt(textList).describe('Other names, nicknames, titles with the name.'),
  summary: opt(z.string()).describe('One or two lines; shown on cards and hover cards.'),
  body: opt(z.string()).describe('Markdown text about the entry. Names of other entries link themselves.'),
  status: opt(z.string()).describe('character alive|dead|unknown, place standing|destroyed|unknown, faction active|dissolved|unknown, item intact|destroyed|lost|unknown.'),
  race: opt(z.string()).describe('Character: race or kind, e.g. human, camel-folk.'),
  born: opt(date), died: opt(date), founded: opt(date), dissolved: opt(date), created: opt(date), destroyed: opt(date),
  date: opt(date).describe('Event or note date.'),
  end: opt(date).describe('Event: last day, for events that last.'),
  place: opt(z.string()).describe('Event: where it happened.'),
  partOf: opt(z.string()).describe('Place: the larger place it lies in.'),
  participants: opt(z.array(z.union([z.string(), z.object({ id: z.string().describe('Name or id'), role: z.string().optional() })]))).describe('Event: who took part.'),
  actions: opt(z.array(z.object({ actor: z.string(), verb: z.string().describe('Past tense: killed, crowned, betrayed...'), target: z.string().optional() }))).describe('Event: who did what to whom.'),
  locations: opt(z.array(z.object({ place: z.string(), from: date.optional(), to: date.optional(), note: z.string().optional() }))).describe('Character: where they lived, when.'),
  relations: opt(z.array(z.object({ type: z.string(), target: z.string(), from: date.optional(), to: date.optional(), note: z.string().optional() }))).describe('Replaces the whole list; link_entries adds one at a time.'),
  visual: opt(z.record(z.string(), z.string())).describe('How it looks, for pictures: character appearance, build, clothing, palette, features, props; place architecture, climate, palette, scale; faction emblem, attire, palette; item material, size, details; event scene, mood. This is the Default look.'),
  looks: opt(z.array(lookSchema)).describe('Other looks over time. When the appearance changes for good or for a while (a war wound, a coronation, new clothes, growing old), add a look instead of rewriting visual. Each look given changes the look with its id (else its name), only in the fields given, or is added; looks you leave out stay.'),
  picture: opt(z.object({ icon: z.string().optional(), color: z.string().optional(), accent: z.string().optional(), image: z.string().optional() })).describe('Card look: a game-icons.net icon name and #rrggbb colours, or one of its images.'),
  chapter: opt(z.string()), bookOrder: opt(z.number()),
  pins: opt(z.array(z.object({
    map: z.string().describe('The map\'s name or id.'),
    x: z.union([z.number(), z.string()]).optional().describe('Percent of the picture from its left edge (0 to 100).'),
    y: z.union([z.number(), z.string()]).optional().describe('Percent of the picture from its top edge (0 to 100).'),
    remove: z.boolean().optional().describe('true takes the place off this map.'),
  }))).describe('Place: where it is on the book\'s maps (look with get_map first). Matched by map: pins on maps you leave out stay.'),
  ...detailShape,
}).loose();

const calendarSchema = z.object({
  eras: z.array(z.object({
    id: z.string().describe('Short code used in dates, letters first: "CR", "BW".'),
    name: z.string(),
    start: z.number().int().describe('Absolute year on which this era\'s year 1 falls. The first era usually starts at 1 or a negative year.'),
    end: z.number().int().optional(),
    color: z.string().optional().describe('#rrggbb for the timeline band.'),
  })).min(1),
  defaultEra: z.string().describe('Era code used by dates without one.'),
  months: z.array(z.object({ name: z.string(), days: z.number().int().positive() })).optional(),
  approxYears: z.number().int().min(0).optional(),
});

const detailsSchema = z.object({
  title: opt(z.string()).describe('Book title (default: the book name).'),
  author: opt(z.string()),
  dedication: opt(z.string()),
  epigraph: opt(z.string()).describe('An opening quotation.'),
  epigraphSource: opt(z.string()),
  publisher: opt(z.string()),
  copyright: opt(z.string()),
  trim: opt(z.enum(['6x9', '5.5x8.5', 'a5', 'a4', 'letter'])).describe('Page size. Default 6x9.'),
  dropCap: opt(z.enum(['none', 'raised', 'dropped'])),
}).loose().describe('Story Book details. null removes one.');

const coverSchema = z.object({
  color: opt(z.string()).describe('#rrggbb, top of the cover gradient.'),
  color2: opt(z.string()).describe('#rrggbb, bottom of the gradient.'),
  icon: opt(z.string()).describe('Emblem: a game-icons.net name such as crown, dragon-head, castle, compass, camel-head, or "none".'),
  iconColor: opt(z.string()),
  titleColor: opt(z.string()),
  font: opt(z.string()).describe('Title font, e.g. Cinzel Decorative, Uncial Antiqua, IM Fell English, EB Garamond, Pirata One.'),
}).loose().describe('How the book looks on the shelf. create_image with entry "cover" makes a cover picture.');

const bookFields = {
  description: opt(z.string()).describe('One line about the world.'),
  artStyle: opt(z.string()).describe('One style line used for every picture of this book.'),
  calendar: calendarSchema.optional(),
  details: detailsSchema.optional(),
  cover: coverSchema.optional(),
};

const toPatch = (a: { name?: string; description?: string | null; artStyle?: string | null; calendar?: z.infer<typeof calendarSchema>; details?: Record<string, unknown>; cover?: Record<string, unknown> }): BookPatch => ({
  ...(a.name ? { name: a.name } : {}),
  ...(a.description !== undefined ? { description: a.description } : {}),
  ...(a.artStyle !== undefined ? { artStyle: a.artStyle } : {}),
  ...(a.calendar ? { calendar: a.calendar } : {}),
  ...(a.details ? { book: a.details } : {}),
  ...(a.cover ? { cover: a.cover } : {}),
});

// ------------------------------------------------------------------------------------------------ server

export function createServer(opts: ServerOptions = {}): McpServer {
  const lib = new Library(opts);
  const env = opts.env ?? process.env;
  const fetchFn: FetchLike = opts.fetch ?? fetch;
  const resources = bundledResources();
  const fontDir = opts.fontDir ?? env['LORE_FORGE_FONTS'] ?? (resources && existsSync(join(resources, 'fonts')) ? join(resources, 'fonts') : undefined);
  const coverFontDir = opts.coverFontDir ?? env['LORE_FORGE_COVER_FONTS'] ?? (resources && existsSync(join(resources, 'app.asar', 'dist', 'renderer', 'fonts', 'cover')) ? join(resources, 'app.asar', 'dist', 'renderer', 'fonts', 'cover') : undefined);

  const server = new McpServer({ name: 'lore-forge', title: 'Lore-Forge', version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  const writable = (ref: string): string => {
    const dir = lib.resolveBook(ref);
    if (lib.isReadOnly(dir)) throw new Error('This is the sample book that comes with Lore-Forge; it cannot be changed. Make an editable copy with duplicate_book and work on that.');
    return dir;
  };

  server.registerTool('lore_forge_guide', {
    title: 'Lore-Forge guide',
    description: 'The playbook for writing a whole story and world in Lore-Forge, and every field name of the format. Read it once before writing.',
    annotations: { readOnlyHint: true },
  }, async () => ok(guide()));

  server.registerTool('list_books', {
    title: 'List books',
    description: 'The books (worlds) on the user\'s Lore-Forge shelf, and whether pictures are set up.',
    annotations: { readOnlyHint: true },
  }, async () => attempt(async () => {
    const books = await Promise.all(lib.bookDirs().map(async (dir) => {
      const info = readManifestInfo(dir);
      try {
        const w = await loadWorld(dir);
        return { name: info?.name, id: info?.id, folder: dir, entries: w.entries.length, chapters: w.story?.length ?? 0, ...(lib.isReadOnly(dir) ? { readOnly: true } : {}) };
      } catch {
        return { name: info?.name, id: info?.id, folder: dir, unreadable: true };
      }
    }));
    const setup = imageSetup(lib.dataDir, env);
    return { books, newBooksGoTo: lib.worldsDir(), pictures: setup ? `set up: ${PROVIDER_INFO[setup.provider].label}` : `not set up. ${NO_IMAGE_SETUP}` };
  }));

  server.registerTool('create_book', {
    title: 'Create a book',
    description: 'Start a new book (world) on the user\'s Lore-Forge shelf. Use for any new story, world, setting or lore the user asks for.',
    inputSchema: { name: z.string().describe('The world\'s name, shown on the spine.'), ...bookFields },
  }, async (a) => attempt(async () => {
    const r = await createBook(lib, { ...toPatch(a), name: a.name });
    return { book: r, next: 'Add entries with save_entries, relationships with link_entries, chapters with write_chapter.' };
  }));

  server.registerTool('get_book', {
    title: 'Read a book',
    description: 'A book at a glance: description, art style, calendar, Story Book details, cover, every entry in short (id, type, name, status, dates, summary, looks), the chapters, and the warning counts.',
    inputSchema: { book: bookRef },
    annotations: { readOnlyHint: true },
  }, async (a) => attempt(() => bookOverview(lib, lib.resolveBook(a.book))));

  server.registerTool('update_book', {
    title: 'Change a book',
    description: 'Change a book\'s name, description, art style, calendar, Story Book details or cover look. Only the fields given change; null removes one.',
    inputSchema: { book: bookRef, name: z.string().optional().describe('New name (the id and folder stay).'), ...bookFields },
  }, async (a) => attempt(async () => {
    const dir = writable(a.book);
    await patchBook(dir, toPatch(a));
    return `Saved. ${a.calendar ? 'Calendar replaced. ' : ''}`.trim();
  }));

  server.registerTool('duplicate_book', {
    title: 'Copy a book',
    description: 'Copy a book (for example the read-only sample) into the user\'s worlds folder as a new, editable book.',
    inputSchema: { book: bookRef, name: z.string().optional().describe('Name of the copy; default "<name> (copy)".') },
  }, async (a) => attempt(() => duplicateBook(lib, lib.resolveBook(a.book), a.name ?? '')));

  server.registerTool('get_entry', {
    title: 'Read an entry',
    description: 'One entry in full: every field as stored (its looks too), its body text, and the open warnings that involve it.',
    inputSchema: { book: bookRef, entry: z.string().describe('The entry\'s id, name or alias.') },
    annotations: { readOnlyHint: true },
  }, async (a) => attempt(async () => {
    const world = await loadWorld(lib.resolveBook(a.book));
    const e = findEntry(world, a.entry);
    const warnings = check(world).filter((w) => !w.intended && (w.offending.entryId === e.id || w.conflicting?.entryId === e.id)).map((w) => formatWarning(world, w));
    return { ...entryJson(world, e), ...(warnings.length ? { warnings } : {}) };
  }));

  server.registerTool('look_at', {
    title: 'How it looks on a date',
    description: 'How entries look on an in-world date: the look in effect (of the looks that cover the date, the one that started last) or the Default look, with when it applies, why, and the full visual description. Ask before you write a dated chapter, and describe everyone as they look then. Without entry: every entry that does not have its Default look on that date.',
    inputSchema: {
      book: bookRef,
      date: date.describe('The in-world date, for example the chapter\'s date.'),
      entry: z.union([z.string(), z.array(z.string())]).optional().describe('An entry\'s name or id, or a list of them.'),
    },
    annotations: { readOnlyHint: true },
  }, async (a) => attempt(() => looksOn(lib.resolveBook(a.book), String(a.date), a.entry === undefined ? undefined : typeof a.entry === 'string' ? [a.entry] : a.entry)));

  server.registerTool('save_entries', {
    title: 'Save entries',
    description: 'Create or update characters, places, factions, items, events and notes (up to 40 per call). For an update give the id (or the same type and name) and only the fields that change; null removes a field; lists replace the whole list, except looks, which are matched one by one (see looks). Refer to other entries by name. Returns what was saved and any contradictions it caused.',
    inputSchema: { book: bookRef, entries: z.array(entrySchema).min(1).max(40) },
  }, async (a) => attempt(async () => {
    const r = await saveEntries(writable(a.book), a.entries as EntryInput[]);
    return { ...r, ...(r.problems.length ? {} : { problems: undefined }), ...(r.notes.length ? {} : { notes: undefined }) };
  }));

  server.registerTool('delete_entry', {
    title: 'Delete an entry',
    description: 'Delete one entry\'s file. Links to it from other entries then show up in check_book.',
    inputSchema: { book: bookRef, entry: z.string() },
    annotations: { destructiveHint: true },
  }, async (a) => attempt(async () => {
    const r = await deleteEntry(writable(a.book), a.entry);
    return `Deleted ${r.name} (${r.file}).`;
  }));

  server.registerTool('link_entries', {
    title: 'Link entries',
    description: 'Add (or remove) relationships: "<entry> <type> <target>", e.g. {entry: "Mr Camel", type: "ally-of", target: "Queen Samira"}. Types: parent-of, child-of, spouse-of, sibling-of, friend-of, mentor-of, ally-of, enemy-of, member-of, leader-of, serves, rules, founded, owns, wields, made, lives-in, located-in, part-of, took-place-at, killed, involved-in, caused, about, related-to (or your own). Each is written once; the other entry shows the reverse.',
    inputSchema: {
      book: bookRef,
      links: z.array(z.object({
        entry: z.string().describe('Name or id of the entry the link is about.'),
        type: z.string(),
        target: z.string().describe('Name or id of the other entry.'),
        from: z.string().optional().describe('When it started (a date).'),
        to: z.string().optional().describe('When it ended.'),
        note: z.string().optional(),
        remove: z.boolean().optional().describe('true removes this link.'),
      })).min(1).max(60),
    },
  }, async (a) => attempt(() => linkEntries(writable(a.book), a.links)));

  server.registerTool('write_chapter', {
    title: 'Write a chapter',
    description: 'Write one story chapter (Markdown prose). A chapter with the same title is replaced; otherwise it is added after the last one. Use the exact names of entries in the text. Returns the names and facts the chapter mentions that the world does not have yet (proposals), any contradictions with the entries, and, for a dated chapter, the looks the entries it names have on that date (looks): check that the text describes them that way.',
    inputSchema: {
      book: bookRef,
      title: z.string(),
      text: z.string().describe('The chapter\'s prose, without its title.'),
      date: z.string().optional().describe('In-world date the chapter is set at.'),
      number: z.number().int().positive().optional().describe('Reading position for a new chapter (1 = first). Default: after the last.'),
      replace: z.union([z.string(), z.number()]).optional().describe('Replace this chapter (its number or title), e.g. to rename it.'),
    },
  }, async (a) => attempt(() => writeChapter(writable(a.book), { title: a.title, text: a.text, ...(a.date !== undefined ? { date: a.date } : {}), ...(a.number ? { number: a.number } : {}), ...(a.replace !== undefined ? { replace: a.replace } : {}) })));

  server.registerTool('read_story', {
    title: 'Read the story',
    description: 'Without chapter: the list of chapters. With chapter (number or title): that chapter\'s full text.',
    inputSchema: { book: bookRef, chapter: z.union([z.string(), z.number()]).optional() },
    annotations: { readOnlyHint: true },
  }, async (a) => attempt(() => readStory(lib.resolveBook(a.book), a.chapter)));

  server.registerTool('story_proposals', {
    title: 'Story proposals',
    description: 'What the chapters mention that the world does not have yet (new people, places, dates, titles), as proposals with keys. accept: keys to add (or ["all"]); ignore: keys to drop for good. Returns what is still open.',
    inputSchema: { book: bookRef, accept: z.array(z.string()).optional(), ignore: z.array(z.string()).optional() },
  }, async (a) => attempt(async () => {
    const dir = a.accept?.length || a.ignore?.length ? writable(a.book) : lib.resolveBook(a.book);
    return storyProposals(dir, { ...(a.accept ? { accept: a.accept } : {}), ...(a.ignore ? { ignore: a.ignore } : {}) });
  }));

  server.registerTool('check_book', {
    title: 'Check a book',
    description: 'Run Lore-Forge\'s consistency rules: someone acting after their death or before their birth, a parent younger than a child, a date outside its era, a broken link, a story sentence that contradicts an entry, and more. Fix every error and warning, or mark it intended.',
    inputSchema: {
      book: bookRef,
      entry: z.string().optional().describe('Only warnings that involve this entry.'),
      include_info: z.boolean().optional().describe('Also list info-level notes.'),
      include_intended: z.boolean().optional().describe('Also list warnings already marked intended.'),
    },
    annotations: { readOnlyHint: true },
  }, async (a) => attempt(() => checkBook(lib.resolveBook(a.book), { ...(a.entry ? { entry: a.entry } : {}), ...(a.include_info ? { includeInfo: true } : {}), ...(a.include_intended ? { includeIntended: true } : {}) })));

  server.registerTool('mark_intended', {
    title: 'Mark a warning intended',
    description: 'Keep a contradiction on purpose (a ghost, a resurrection, an unreliable narrator), with a short note. Use the warning id from check_book.',
    inputSchema: { book: bookRef, warning: z.string().describe('Warning id from check_book.'), note: z.string() },
  }, async (a) => attempt(async () => `Marked intended: ${await markIntended(writable(a.book), a.warning, a.note)}`));

  /** Models found this session, per service and key (a key from the environment has no saved model). */
  const found = new Map<string, string>();
  /** The image model for this setup: saved, else found from the service's list (and saved for next time). */
  const modelFor = async (setup: ImageSetup, avoid?: string): Promise<string> => {
    if (setup.model && setup.model !== avoid) return setup.model;
    const known = found.get(`${setup.provider}\n${setup.key}`);
    if (known && known !== avoid) return known;
    let model: string | undefined;
    try {
      model = pickImageModel(setup.provider, (await listImageModels(setup.provider, setup.key, fetchFn)).filter((m) => m !== avoid));
    } catch { /* fall back below */ }
    model ??= PROVIDER_INFO[setup.provider].fallbackModel;
    found.set(`${setup.provider}\n${setup.key}`, model);
    const s = readImageSettings(lib.dataDir);
    if (s.keys?.[setup.provider]) writeImageSettings(lib.dataDir, { ...s, models: { ...s.models, [setup.provider]: model } });
    return model;
  };

  server.registerTool('create_image', {
    title: 'Create a picture',
    description: 'Make a picture with the user\'s image service and attach it: to an entry (its card shows it), to one of its looks, or, with entry "cover", to the book cover. The prompt is built from the entry\'s visual description (or the look\'s, with the reason for it), summary and the book\'s artStyle unless you give one. Takes 10–60 seconds.',
    inputSchema: {
      book: bookRef,
      entry: z.string().describe('Name or id of the entry, or "cover" for the book cover.'),
      look: z.string().optional().describe('One of the entry\'s looks (its id or name): the picture shows the entry in that look and is kept with it. Leave out for the Default look.'),
      view: z.string().optional().describe('character three-quarter (default), front, a-pose, concept...; place establishing (default), interior, map...; item front; faction emblem; event scene; note illustration.'),
      prompt: z.string().optional().describe('Your own picture description (the book\'s art style is added).'),
      aspect: z.enum(['portrait', 'landscape', 'square', 'cover']).optional(),
    },
    annotations: { openWorldHint: true },
  }, async (a, extra) => attempt(async () => {
    const dir = writable(a.book);
    const setup = imageSetup(lib.dataDir, env);
    if (!setup) return fail(NO_IMAGE_SETUP);
    const brief = await pictureBrief(dir, a.entry, a.view, a.look);
    let prompt = a.prompt?.trim() || brief.prompt;
    if (brief.artStyle && !prompt.toLowerCase().includes(brief.artStyle.toLowerCase())) prompt = `${prompt} Style: ${brief.artStyle}.`;
    const aspect = a.aspect ?? aspectFor(brief.entry?.type ?? 'cover', brief.view);
    // Keep the client's request alive while the service draws.
    const token = extra._meta?.progressToken;
    let tick = 0;
    const timer = token !== undefined ? setInterval(() => void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++tick, message: 'Drawing the picture...' } }).catch(() => {}), 5000) : undefined;
    try {
      let model = await modelFor(setup);
      let img;
      try {
        img = await generateImage({ provider: setup.provider, key: setup.key, model, prompt, aspect }, fetchFn);
      } catch (e) {
        const msg = (e as Error).message;
        if (!/model/i.test(msg) || !/not found|does not exist|unknown|invalid|no longer|deprecated|retired|not supported/i.test(msg)) throw e;
        model = await modelFor({ ...setup, model: '' }, model);
        img = await generateImage({ provider: setup.provider, key: setup.key, model, prompt, aspect }, fetchFn);
      }
      const saved = await attachPicture(dir, a.entry, brief.view, img.data, img.ext, { tool: `${PROVIDER_INFO[setup.provider].label} ${img.model} via Lore-Forge`, prompt }, brief.look?.id);
      return { saved: saved.file, for: saved.entry ?? 'the book cover', ...(brief.look ? { look: brief.look.name || brief.look.id } : {}), view: brief.view, model: img.model, prompt };
    } finally {
      if (timer) clearInterval(timer);
    }
  }));

  server.registerTool('add_image', {
    title: 'Add a picture',
    description: 'Attach a picture you already have to an entry, one of its looks, or "cover": a local file path, an http(s) address or a data:image/...;base64 URL. PNG and JPEG also print in the PDFs.',
    inputSchema: {
      book: bookRef,
      entry: z.string().describe('Name or id of the entry, or "cover".'),
      look: z.string().optional().describe('One of the entry\'s looks (its id or name), when the picture shows the entry in that look.'),
      source: z.string(),
      view: z.string().optional().describe('e.g. three-quarter, establishing, front, emblem, scene, illustration.'),
      prompt: z.string().optional().describe('How it was made, if you know (kept with the picture).'),
      tool: z.string().optional().describe('What made it, e.g. "DALL-E" or "photo".'),
    },
  }, async (a) => attempt(async () => {
    const dir = writable(a.book);
    const brief = await pictureBrief(dir, a.entry, a.view, a.look);
    const pic = await loadPictureSource(a.source, fetchFn as typeof fetch);
    const saved = await attachPicture(dir, a.entry, brief.view, pic.data, pic.ext, { ...(a.tool ? { tool: a.tool } : {}), ...(a.prompt ? { prompt: a.prompt } : {}), ...(/^https?:/i.test(a.source) ? { sources: [a.source] } : {}) }, brief.look?.id);
    return { saved: saved.file, for: saved.entry ?? 'the book cover', ...(brief.look ? { look: brief.look.name || brief.look.id } : {}), view: brief.view };
  }));

  server.registerTool('save_map', {
    title: 'Save a map',
    description: 'Add a map of the world, or change or remove one. A new map needs a picture: a local file, an http(s) address, a data:image URL, or a picture the book already has (its path inside the book, such as one create_image made of a place with view "map"). Then look at it with get_map and pin places on it with save_entries (a place\'s pins).',
    inputSchema: {
      book: bookRef,
      map: z.string().describe('The map\'s name or id. A name no map has adds a new map.'),
      name: z.string().optional().describe('A new name for the map (its id stays).'),
      picture: z.string().optional().describe('The map\'s picture; replaces the one it had.'),
      place: opt(z.string()).describe('The place the map shows (a city, a region), by name: its pin on other maps opens this map. null: the whole world.'),
      remove: z.boolean().optional().describe('true removes the map, its picture and every pin on it.'),
    },
  }, async (a) => attempt(() => saveMap(writable(a.book), { map: a.map, ...(a.name !== undefined ? { name: a.name } : {}), ...(a.picture !== undefined ? { picture: a.picture } : {}), ...(a.place !== undefined ? { place: a.place } : {}), ...(a.remove ? { remove: true } : {}) }, fetchFn as typeof fetch)));

  server.registerTool('get_map', {
    title: 'Look at a map',
    description: 'One of the book\'s maps: its picture, so you can see where things are, every place pinned on it with x and y (percent of the picture from its left and top edges), and the places not on it yet.',
    inputSchema: { book: bookRef, map: z.string().optional().describe('The map\'s name or id; default the first one.') },
    annotations: { readOnlyHint: true },
  }, async (a) => attempt(async () => {
    const r = await mapView(lib.resolveBook(a.book), a.map);
    return { content: [{ type: 'text', text: JSON.stringify(r.info, null, 1) }, ...(r.image ? [{ type: 'image' as const, ...r.image }] : [])] };
  }));

  server.registerTool('export_book', {
    title: 'Export a book',
    description: 'Write the Story Book (PDF or Word) or the World Codex (PDF, every entry with art briefs) to a file. Default: the book\'s exports folder.',
    inputSchema: {
      book: bookRef,
      kind: z.enum(['story-book', 'codex']).optional().describe('Default story-book.'),
      format: z.enum(['pdf', 'docx']).optional().describe('Default pdf. Word is for the Story Book only.'),
      output: z.string().optional().describe('A file or folder path.'),
    },
  }, async (a) => attempt(() => exportBook(lib.resolveBook(a.book), { kind: a.kind ?? 'story-book', format: a.format ?? 'pdf', ...(a.output ? { output: a.output } : {}), ...(fontDir ? { fontDir } : {}), ...(coverFontDir ? { coverFontDir } : {}) })));

  server.registerPrompt('write_story', {
    title: 'Write a story in Lore-Forge',
    description: 'Write a complete story as a Lore-Forge book: world, characters, places, relationships, chapters, checks and pictures.',
    argsSchema: {
      idea: z.string().describe('What the story is about.'),
      chapters: z.string().optional().describe('How many chapters, or how long.'),
      audience: z.string().optional().describe('Who it is for, e.g. children, adults, a game\'s players.'),
      style: z.string().optional().describe('Picture style.'),
    },
  }, (a) => ({ messages: [{ role: 'user', content: { type: 'text', text: writeStoryPrompt(a) } }] }));

  return server;
}

/** Runs the server on stdin/stdout until the client goes away. Nothing else may write to stdout. */
export async function runStdio(opts: ServerOptions = {}): Promise<void> {
  const server = createServer(opts);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((done) => {
    transport.onclose = () => done();
    process.stdin.on('end', () => done());
  });
  await server.connect(transport);
  await closed;
}
