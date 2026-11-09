/**
 * What the assistant reads: the short server instructions, the full playbook and format guide (lore_forge_guide), and
 * the write_story prompt. The field and rule lists are built from the core tables, so they always match the app.
 */
import {
  builtinRules, DATE_FORMATS_HINT, DETAIL_FIELDS, ENTRY_TYPES, IMAGE_VIEWS, LIFECYCLE, RELATION_KINDS, TYPE_SINGULAR, VISUAL_FIELDS,
  type EntryType,
} from '@lore-forge/core';

export const INSTRUCTIONS = `Lore-Forge is the user's desktop app for game worlds and stories. When the user asks you to write a story, build a world, invent lore, characters or a game setting, make it in Lore-Forge with these tools (it appears on their Lore-Forge shelf, live if the app is open), not only in the chat.
Start with lore_forge_guide once: it has the step-by-step playbook and every field name. Then: create_book, save_entries (characters, places, factions, items, events, notes), link_entries (relationships), write_chapter (the story, chapter by chapter), check_book (fix every contradiction it finds), create_image (cover and main pictures, when pictures are set up). For an existing book use list_books and get_book first.`;

const TYPE_FIELDS: Record<EntryType, string> = {
  character: 'race (free text: human, camel-folk, elf...), born, died (dates), locations (list of {place, from, to})',
  place: 'founded, destroyed (dates), partOf (the larger place it is in)',
  faction: 'founded, dissolved (dates)',
  item: 'created, destroyed (dates)',
  event: 'date, end (dates), place (where), participants (list of {id: name or id, role}), actions (list of {actor, verb, target}: "Samira arrested Malquor" = {actor: "Samira", verb: "arrested", target: "Malquor"}; the verb is past tense)',
  note: 'date (when it is set, optional)',
};

function typeSection(t: EntryType): string {
  const life = LIFECYCLE[t];
  const details = DETAIL_FIELDS[t].map((f) => {
    const what = f.kind === 'ref' ? ` (one ${f.to?.map((x) => TYPE_SINGULAR[x].toLowerCase()).join(' or ')})` : f.kind === 'refs' ? ` (list of ${f.to?.map((x) => TYPE_SINGULAR[x].toLowerCase()).join('/')}s)` : f.kind === 'list' ? ' (list)' : f.kind === 'long' ? ' (a few sentences)' : '';
    return `${f.key}${what}`;
  });
  const visual = VISUAL_FIELDS[t].map((v) => `${v.key} (${v.hint})`);
  return [
    `### ${t}`,
    life ? `- status: ${life.statuses.map((s) => s.value).join(' | ')}${life.endField ? ` (with ${life.endField} when ${life.ended.join('/')})` : ''}` : '',
    `- ${TYPE_FIELDS[t]}`,
    details.length ? `- details: ${details.join(', ')}` : '',
    visual.length ? `- visual: ${visual.join('; ')}` : '',
    `- picture views: ${IMAGE_VIEWS[t].join(', ')}`,
  ].filter(Boolean).join('\n');
}

export function guide(): string {
  const relations = RELATION_KINDS.map((k) => `- ${k.type}: ${k.from.join('/')} → ${k.to.join('/')}${k.symmetric ? ' (both ways)' : `; shown on the other side as "${k.inverse}"`}`).join('\n');
  const rules = builtinRules.map((r) => `- ${r.id} (${r.severity}): ${r.title}`).join('\n');
  return `# Lore-Forge guide for assistants

Lore-Forge keeps each world as a **book**: its entries (characters, places, factions, items, events, notes), the relationships between them, a story written chapter by chapter, pictures, and a Story Book that prints like a real book. Everything you write appears in the user's Lore-Forge app.

## Playbook: "Write me a story about ..."
Build the whole thing in Lore-Forge; do not only answer in chat. Do not stop to ask questions the user did not leave open: choose sensibly and say what you chose at the end.
1. Plan: premise, tone, audience, the main cast (3–8 characters), places, factions, important items, the key events in order, and the chapters (default 4–6 chapters of about 800–1,500 words, unless the user asked otherwise). Choose one art style line for every picture (e.g. "painterly fantasy concept art, warm desert light, soft brush strokes").
2. create_book: name, a one-line description, artStyle, a calendar whose eras fit the world (dates without an era code use the default era), cover colours and an emblem, and book details (title, author if known, dedication, epigraph).
3. save_entries, several per call: every main character with status, born (and died if dead), race, gender, title, occupation, personality, goals, skills, home, affiliations, possessions, a visual description, a one-line summary and a short body; places (kind, founded, ruler, features, visual); factions (kind, leader, headquarters, ideology, allies, enemies); items (kind, origin, owners, powers, visual); events (date, place, participants, actions, causes, outcome); notes for lore, songs, legends. Refer to other entries by name; Lore-Forge links them (entries of the same call can refer to each other).
4. link_entries: family (parent-of, spouse-of, sibling-of), bonds (friend-of, mentor-of, ally-of, enemy-of), power (member-of, leader-of, serves, rules), possessions (owns, wields, made), places (lives-in, located-in, part-of), story (killed, involved-in, caused). Write each link once, from the entry it is about.
5. write_chapter for each chapter in order. Use the exact names of entries in the prose: they become links, and the story is checked against the entries. Keep ages, deaths, dates and places consistent; give a chapter a date when the story has a clear time. Stories read best in plain Markdown paragraphs; no chapter title inside the text. For a dated chapter, look_at (and the looks in the write_chapter answer) tells how the people in it look on that date: describe them that way.
6. Each write_chapter answer lists proposals: names and facts the text mentions that the world does not have yet. Add the ones that matter (story_proposals with accept, or save_entries with more detail) and ignore the rest.
7. check_book: fix every error and warning by changing the entry or the chapter. Only when a contradiction is on purpose (a ghost, a liar, a resurrection), mark_intended with a short note.
8. Pictures, when the user has set them up (create_image tells you if not): the cover ("cover"), each main character (view three-quarter), the main places (establishing), key items (front) and big events (scene). Fill the visual fields first: the picture prompt is built from them and the book's artStyle. If pictures are not set up, tell the user once how to turn them on, and finish everything else.
9. update_book with the Story Book details you have not set yet. export_book only if the user wants a PDF or Word file.
10. Finish with a short summary: the book name, what is in it, and that it is on their Lore-Forge shelf.

To continue or change an existing book: list_books, get_book, get_entry or read_story first, then the same tools. A read-only book (the sample that comes with the app) must be copied with duplicate_book first.

## Entry fields
Every entry: name, aliases (list), summary (one or two lines; shown on cards), body (Markdown text), relations (list of {type, target, from, to, note}; link_entries is easier), visual (map of the keys below; this is the Default look), looks (other looks over time, see Looks), chapter and bookOrder (where an event or note goes in a Story Book without chapters).
Dates are text: ${DATE_FORMATS_HINT}. Era codes come from the book's calendar ("476", "~1200", "12.03.512", "3 BW").

${ENTRY_TYPES.map(typeSection).join('\n\n')}

## Relationship types
Any kebab-case type works; these are understood (and checked to fit the two entry types):
${relations}

## Calendar
A calendar has eras: {id: short code like "CR", name, start: the absolute year its year 1 falls on, end?, color?}, a defaultEra (used by dates without a code), optional months [{name, days}] (default 12 months of 30 days) and approxYears (how far "~" widens a date, default 5). One era is fine for most stories.

## Looks
When an entry's appearance changes for good or for a while (a war wound, a coronation, new clothes, old age), add a look instead of rewriting visual: visual stays the Default look. A look is {name, reason (why it looks different), from and to (dates), era (an era code), after or before (an event or another dated entry, by name), visual (only the fields that change)}. Give it one kind of time: between dates, in an era, after an event or before one. A look after an event starts once the event is over, and one before an event ends as it begins, so the event itself shows the look the entry had going in. On a date, the newest look that covers it applies, else the Default look.
save_entries matches looks one by one, by id or else by name: give only the looks and the fields that change; looks you leave out stay. {id, remove: true} removes a look, and its pictures and 3D models go back to the Default look.
look_at tells how entries look on a date (without entry: everyone who is not in their Default look then). create_image and add_image take look to make or attach a picture of the entry in that look; it is kept with that look.

## Maps
A book can have maps: pictures of the world (or of one city or region) with places pinned on them. save_map adds one from a picture: a file, a web address, a data: URL, or a picture the book already has (create_image can draw one: a place with view "map"). Give place for a map of one place; its pin on the other maps then opens it. get_map shows you the picture with the pins and the places not on it yet. A place's pins are [{map, x, y}], x and y in percent of the picture from its left and top edges: look at the map first and put each place where the picture shows it (a city on the coast on the coast). save_entries matches pins by map, so pins on other maps stay; {map, remove: true} takes a place off a map.

## What check_book checks
${rules}
- story-contradiction (warning): a sentence in the story disagrees with an entry (a date, place, status or title).

## Pictures
create_image makes a picture with the user's own image service and attaches it: to an entry (its card shows it) or to the book cover. Its prompt is built from the entry's visual description and summary plus the book's artStyle; pass prompt to write it yourself. add_image attaches a picture you already have (a file path, a web address or a data: URL). Both take look for a picture of the entry in one of its looks.`;
}

export function writeStoryPrompt(a: { idea: string; chapters?: string; audience?: string; style?: string }): string {
  return `Write a complete story in Lore-Forge: ${a.idea.trim()}
${a.chapters ? `Chapters: ${a.chapters}.\n` : ''}${a.audience ? `Audience: ${a.audience}.\n` : ''}${a.style ? `Picture style: ${a.style}.\n` : ''}
Follow the Lore-Forge playbook (call lore_forge_guide first): create the book, fill in the characters, places, factions, items, events and notes with their details and visual descriptions, link their relationships, write every chapter with write_chapter, add the entries the chapters propose, run check_book and fix everything it reports, then make the cover and the main pictures with create_image if pictures are set up. Do not stop half-way to ask me; make sensible choices and tell me at the end what you made.`;
}
