/** Lore-Forge world format, schema version 1. Mirrors schemas/*.schema.json. */
import type { IconName } from './icons.ts';

export const SCHEMA_VERSION = 1;

export const ENTRY_TYPES = ['character', 'place', 'faction', 'item', 'event', 'note'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Folder (inside the world) holding each entry type, and its display label. */
export const TYPE_FOLDERS: Record<EntryType, string> = {
  character: 'characters',
  place: 'places',
  faction: 'factions',
  item: 'items',
  event: 'events',
  note: 'notes',
};
export const TYPE_LABELS: Record<EntryType, string> = {
  character: 'Characters',
  place: 'Places',
  faction: 'Factions',
  item: 'Items',
  event: 'Events',
  note: 'Notes',
};

/** One emoji per type, used everywhere the type is shown (always next to a word, never alone). */
export const TYPE_EMOJI: Record<EntryType, string> = {
  character: '🧑',
  place: '🏰',
  faction: '🛡️',
  item: '🗡️',
  event: '⚔️',
  note: '📜',
};
/** Icon (game-icons.net) for each entry type, used by the app and the PDF. */
export const TYPE_ICON: Record<EntryType, IconName> = {
  character: 'person',
  place: 'castle',
  faction: 'checked-shield',
  item: 'broadsword',
  event: 'crossed-swords',
  note: 'scroll-unfurled',
};
export const TYPE_SINGULAR: Record<EntryType, string> = {
  character: 'Character',
  place: 'Place',
  faction: 'Faction',
  item: 'Item',
  event: 'Event',
  note: 'Note',
};

/**
 * A date as written in the files: `[~]DATE [ERA]` or `unknown`, where DATE is YYYY, MM.YYYY, DD.MM.YYYY,
 * DD.MM (year unknown) or the older YYYY-MM / YYYY-MM-DD. `~` means approximate.
 * Examples: "1800", "~1800", "03.1920", "12.03.1920", "1920-03-12", "12.03", "312 OK", "unknown".
 */
export type DateText = string;

export interface Era {
  /** Short code used in dates, e.g. "AS". */
  id: string;
  name: string;
  /** Absolute year on the world's single axis that this era's year 1 maps to. */
  start: number;
  /** Optional last absolute year of the era (inclusive). Without it the era lasts until the next one starts. */
  end?: number;
  /** Optional colour of the era's band on the timeline, #rrggbb. */
  color?: string;
}

export interface Month {
  name: string;
  days: number;
}

export interface Calendar {
  eras: Era[];
  /** Era used when a date has no era code. */
  defaultEra: string;
  /** Months of the year. Defaults to 12 months of 30 days. */
  months?: Month[];
  /** How many years `~` widens a date in each direction. Default 5. */
  approxYears?: number;
}

export type Severity = 'error' | 'warning' | 'info';
export type RuleSetting = Severity | 'off';

export interface WorldManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  /** One line describing the look of every picture made for this world, used by image tools (the MCP server's create_image). */
  artStyle?: string;
  calendar: Calendar;
  /** Per-rule severity overrides, e.g. { "duplicate-name": "off" }. */
  rules?: Record<string, RuleSetting>;
  /** Story Book export settings. */
  book?: BookSettings;
  /** How the world's book looks on the library shelf. */
  cover?: WorldCoverSettings;
}

/**
 * A place on the front cover, in percent of the room an element has inside the gold frame: x 0 puts its left edge
 * on the frame's left margin, 100 its right edge on the right margin, 50 centres it; y the same from top to
 * bottom. Because it is measured in the room left over by the element's own size, any value from 0 to 100 keeps
 * the whole element inside the frame.
 */
export interface CoverPosition { x: number; y: number }

export interface WorldCoverSettings {
  /** Cover colour (the top of the gradient), #rrggbb or #rrggbbaa. Without it the colours come from the world id. */
  color?: string;
  /** Bottom of the gradient. The same as "color" for a plain cover; without it a darker shade of "color". */
  color2?: string;
  /** game-icons.net emblem name, or "none". Without it one is picked by the world id. */
  icon?: string;
  /** Emblem colour. Default gold. */
  iconColor?: string;
  /** Cover picture, relative to the world folder (e.g. images/cover.png), or "none" for no picture at all. */
  image?: string;
  /** Title lettering: "display" (Cinzel capitals, the default), "serif" or "sans". */
  titleStyle?: string;
  /** Title colour. Default parchment white. */
  titleColor?: string;
  /** Title font family: a bundled cover font (see BUNDLED_FONTS) or a system font. Without it, the title style's lettering. */
  font?: string;
  /** false hides the title on the front cover (it stays on the spine). Default true. */
  showTitle?: boolean;
  /** false hides the emblem on the front cover (it stays on the spine). Default true. */
  showEmblem?: boolean;
  /** Where the title sits on the front cover (see CoverPosition). Without it, the default place. */
  titlePos?: CoverPosition;
  /** Where the emblem sits on the front cover (see CoverPosition). Without it, the default place, near the top. */
  emblemPos?: CoverPosition;
  /** Spine colour on the shelf. Without it, the left edge of the cover picture, else a darker shade of the cover colour. */
  spineColor?: string;
  /** Spine title colour. Without it, gold, parchment or ink, whichever reads on the spine. */
  spineInk?: string;
  /**
   * What the generated parts (colours, emblem and stars left unset, the book's height) come from instead of the
   * world id. A Duplicate gets its original's, so the copy looks exactly like it under its new id.
   */
  seed?: string;
}

export interface BookSettings {
  title?: string;
  author?: string;
  /** Split each era into chapters of this many years. Without it, one chapter per era. */
  chapterYears?: number;
  /** Print trim size. Default 6x9 inches. */
  trim?: TrimSize;
  /**
   * For printed books: start the title page, dedication, epigraph, contents and every chapter on a right-hand page,
   * with the copyright page on the back of the title page. Adds blank pages. Default false (no blank pages).
   */
  rightHandChapters?: boolean;
  dedication?: string;
  epigraph?: string;
  epigraphSource?: string;
  /** Copyright page text. The page is always printed; a plain notice with the author and year is used when this is empty. */
  copyright?: string;
  publisher?: string;
  /** First letter of each chapter: none, raised (big, on the first line's baseline; the default) or dropped (two lines deep). */
  dropCap?: DropCapStyle;
  /** Show the date (with era) at the top right of each chapter opening, and on chronicle pages. Default true. */
  dateStamps?: boolean;
  /** Body text font family: DejaVu Serif (default), DejaVu Sans or a bundled font. */
  bodyFont?: string;
  /** Body text size in points (8 to 16). Default 10.5. */
  bodySize?: number;
  /** Body text colour, #rrggbb. Default #222222. */
  bodyColor?: string;
  /** Chapter title font family. Default the body font. */
  chapterFont?: string;
  /** Chapter title size in points (12 to 40). Default 19. */
  chapterSize?: number;
  /** Chapter title colour, #rrggbb. Default #3d2a14. */
  chapterColor?: string;
  /** Line spacing as a multiple of the body size (1 to 2.2). Default 1.45. */
  lineSpacing?: number;
  /** Page margins. Default normal. */
  margins?: 'narrow' | 'normal' | 'wide';
  /** Front cover title colour for the book, #rrggbb; default the cover's own title colour. */
  coverTitleColor?: string;
  /** Front cover title size in percent of the default (50 to 200). */
  coverTitleSize?: number;
  /** Author line size on the cover and title page, in percent of the default (50 to 200). */
  authorSize?: number;
}
export type TrimSize = '6x9' | '5.5x8.5' | 'a5' | 'a4' | 'letter';
export type DropCapStyle = 'none' | 'raised' | 'dropped';

export interface Relation {
  /** parent-of, child-of, member-of, leader-of, ally-of, enemy-of, rules, owns, killed, spouse-of, sibling-of, ... */
  type: string;
  target: string;
  /** Optional dates. A relation with `from` counts as something the entry did at that time. */
  from?: DateText;
  to?: DateText;
  note?: string;
}

export interface LocationSpan {
  place: string;
  from?: DateText;
  to?: DateText;
  note?: string;
}

/**
 * Suggested reference-image views per entry type: what the app offers and what exports expect.
 * `view` may be any kebab-case label; one outside this list gets an info-level `image-view` warning.
 */
export const IMAGE_VIEWS: Record<EntryType, readonly string[]> = {
  character: ['a-pose', 'front', 'back', 'left', 'right', 'three-quarter', 'concept'],
  place: ['establishing', 'map', 'interior', 'exterior', 'mood', 'concept'],
  faction: ['emblem', 'banner', 'uniform', 'headquarters', 'concept'],
  item: ['front', 'back', 'side', 'top', 'detail', 'concept'],
  event: ['scene', 'establishing', 'map', 'mood', 'concept'],
  note: ['illustration', 'map', 'concept'],
};
export type ImageView = string;

const VIEW_LABELS: Record<string, string> = {
  'a-pose': 'A-pose',
  'three-quarter': 'Three-quarter',
  establishing: 'Establishing shot',
  headquarters: 'Headquarters',
};
/** Display label for a view id, e.g. "a-pose" -> "A-pose", "establishing" -> "Establishing shot". */
export function viewLabel(view: string): string {
  return VIEW_LABELS[view] ?? view.charAt(0).toUpperCase() + view.slice(1).replace(/-/g, ' ');
}

/**
 * Optional free-text visual description fields per type, for artists and image/3D tools.
 * Stored under `visual:` in the front matter. Other keys are allowed and kept.
 */
export const VISUAL_FIELDS: Record<EntryType, readonly { key: string; label: string; hint: string }[]> = {
  character: [
    { key: 'appearance', label: 'Appearance', hint: 'Species, face, hair, skin, age as seen' },
    { key: 'build', label: 'Height & build', hint: 'e.g. 1.9 m, broad-shouldered' },
    { key: 'clothing', label: 'Clothing', hint: 'What they usually wear' },
    { key: 'palette', label: 'Colour palette', hint: 'Main colours' },
    { key: 'features', label: 'Distinguishing features', hint: 'Scars, marks, posture' },
    { key: 'props', label: 'Props', hint: 'Things they always carry' },
  ],
  place: [
    { key: 'architecture', label: 'Architecture', hint: 'Buildings, materials, style' },
    { key: 'climate', label: 'Climate & weather', hint: 'Light, weather, season' },
    { key: 'palette', label: 'Colour palette', hint: 'Main colours' },
    { key: 'scale', label: 'Scale', hint: 'Size, population, distances' },
  ],
  faction: [
    { key: 'emblem', label: 'Emblem & symbols', hint: 'Banner, sigil' },
    { key: 'attire', label: 'Attire', hint: 'Uniforms, armour, colours worn' },
    { key: 'palette', label: 'Colour palette', hint: 'Main colours' },
  ],
  item: [
    { key: 'material', label: 'Material', hint: 'What it is made of' },
    { key: 'size', label: 'Size', hint: 'Dimensions, weight' },
    { key: 'details', label: 'Details', hint: 'Engravings, wear, moving parts' },
  ],
  event: [
    { key: 'scene', label: 'Scene description', hint: 'What a picture of it shows' },
    { key: 'mood', label: 'Mood', hint: 'Light, atmosphere, emotion' },
  ],
  note: [],
};

export interface Provenance {
  tool?: string;
  prompt?: string;
  /** Real-world ISO date the image was made, e.g. 2026-10-30. */
  date?: string;
  /** Source files or URLs the image was derived from. */
  sources?: string[];
  rights?: string;
}

export interface RefImage {
  /** Path relative to the world folder, e.g. images/char-orsan/front.png */
  file: string;
  view: ImageView;
  provenance?: Provenance;
}

/** Card picture choice: a game-icon, colours, or one of the entry's images. Missing parts use the defaults. */
export interface Picture {
  /** game-icons.net icon name, e.g. "castle". */
  icon?: string;
  /** Background colour, #rrggbb or #rrggbbaa. */
  color?: string;
  /** Icon (accent) colour, #rrggbb or #rrggbbaa. */
  accent?: string;
  /** Image to show, relative to the world folder (also listed in `images`). */
  image?: string;
}

export interface Participant {
  id: string;
  role?: string;
}

export interface Action {
  actor: string;
  /** Past-tense verb, e.g. killed, crowned, betrayed, founded. */
  verb: string;
  target?: string;
}

interface EntryBase {
  id: string;
  name: string;
  aliases?: string[];
  tags?: string[];
  summary?: string;
  relations?: Relation[];
  /** Reference images. Views come from IMAGE_VIEWS[type]. */
  images?: RefImage[];
  /** How the entry's card looks when it has no image of its own (or which image to show). Set from the Home page. */
  picture?: Picture;
  /** Free-text visual description; keys from VISUAL_FIELDS[type]. */
  visual?: Record<string, string>;
  /** Story Book: put this page in a chapter with this title instead of the automatic era/year chapter. */
  chapter?: string;
  /** Story Book: order inside the chapter. Default 0; lower comes first; ties go by date, then name. */
  bookOrder?: number;
  /**
   * Optional detail fields from DETAIL_FIELDS[type] (gender, occupation, ruler, ...), stored as top-level
   * front-matter keys. Text, or a list for list/refs fields. Missing means unknown.
   */
  details?: Record<string, string | string[]>;
  /** Markdown body. May reference entries as [[id]], [[Name]], [[id|label]] or @id. */
  body: string;
  /** Front-matter keys Lore-Forge does not know. Kept as-is when the file is saved. */
  extra?: Record<string, unknown>;
}

export interface Character extends EntryBase {
  type: 'character';
  /**
   * Race or kind, free text: human, camel-folk, ghoul, vampire... Several are comma-separated ("elf, human");
   * a YAML list is read the same way. Each links to an entry when one has this id or name.
   */
  race?: string;
  born?: DateText;
  died?: DateText;
  status?: 'alive' | 'dead' | 'unknown';
  locations?: LocationSpan[];
}
export type PlaceStatus = 'standing' | 'destroyed' | 'unknown';
export type FactionStatus = 'active' | 'dissolved' | 'unknown';
export type ItemStatus = 'intact' | 'destroyed' | 'lost' | 'unknown';

export interface Place extends EntryBase {
  type: 'place';
  status?: PlaceStatus;
  founded?: DateText;
  destroyed?: DateText;
  /** Id of the larger place/region this one is inside. */
  partOf?: string;
}
export interface Faction extends EntryBase {
  type: 'faction';
  status?: FactionStatus;
  founded?: DateText;
  dissolved?: DateText;
}
export interface Item extends EntryBase {
  type: 'item';
  status?: ItemStatus;
  created?: DateText;
  destroyed?: DateText;
}
export interface LoreEvent extends EntryBase {
  type: 'event';
  date?: DateText;
  end?: DateText;
  place?: string;
  participants?: Participant[];
  actions?: Action[];
}
export interface Note extends EntryBase {
  type: 'note';
  /** Optional in-world date the page is about; used to place it in the Story Book. */
  date?: DateText;
}

export type Entry = Character | Place | Faction | Item | LoreEvent | Note;

export interface IntendedMark {
  warningId: string;
  note?: string;
  /** Real-world ISO date the mark was made. */
  markedAt?: string;
}

/** Everything in one world folder, after parsing. */
export interface World {
  manifest: WorldManifest;
  entries: Entry[];
  intended: IntendedMark[];
  /** Entry id -> path of its file relative to the world folder. */
  files: Record<string, string>;
  /** Files that could not be read cleanly. Reported by the file-error rule. */
  issues: LoadIssue[];
  /** The story manuscript (story/*.md), in reading order. Missing or empty in worlds without a story. */
  story?: StoryChapter[];
  /** Story proposals the author chose to ignore (story-ignored.json). */
  storyIgnored?: StoryIgnore[];
}

/** One chapter of the story manuscript: story/NN-slug.md, YAML header (title, order, date) and Markdown prose. */
export interface StoryChapter {
  /** Path inside the world folder. Chosen when the chapter is made; it stays put when the title or order changes. */
  file: string;
  title: string;
  /** Reading order; lower comes first. */
  order: number;
  /** Optional in-world date the chapter is set at, written like any date ("1920", "312 OK"). */
  date?: DateText;
  /** Markdown prose. Names of entries are linked automatically, like entry text. */
  body: string;
  /** Header keys Lore-Forge does not know. Kept as-is when the file is saved. */
  extra?: Record<string, unknown>;
}

/** A story proposal the author ignored, so it does not come back. */
export interface StoryIgnore {
  /** Proposal key (see Proposal.key). */
  key: string;
  /** Name shown in the list, for people reading the file. */
  name?: string;
  /** Real-world ISO date. */
  ignoredAt?: string;
}

export interface LoadIssue {
  /** Path relative to the world folder. */
  file: string;
  message: string;
}

/** Points at one fact in the world. */
export interface FactRef {
  entryId: string;
  /** Field inside the entry, e.g. "died", "actions[0]", "body". */
  field: string;
  /** Human-readable source, e.g. "Characters/Orsan the Grey" or "Story/The Salt Road". */
  source: string;
  /** Story facts only: the chapter file (story/NN-slug.md) and the [start, end) offsets in its text. */
  chapter?: string;
  span?: [number, number];
}

export interface Warning {
  /** Stable id, used to mark a warning as intended. */
  id: string;
  ruleId: string;
  severity: Severity;
  message: string;
  /** The fact that breaks canon. */
  offending: FactRef;
  /** The canon fact it conflicts with, when there is one. */
  conflicting?: FactRef;
  /** Present when the author marked this warning as intended. */
  intended?: IntendedMark;
}
