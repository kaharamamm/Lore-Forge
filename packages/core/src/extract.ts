/**
 * Story extraction: read the manuscript and propose entries (characters, places, items, events) and
 * changes to existing ones. Pure and deterministic: no AI, no network. Nothing is written; the app shows
 * the proposals and the author decides.
 *
 * Two steps:
 *  1. An Extractor reads text and returns raw proposals that name things (by name, not id).
 *  2. reconcile() matches those names against the world (name or alias, case-insensitive, Turkish i/ı folded),
 *     turns matches into updates only when they add or change a field, merges duplicates and drops ignored ones.
 * Any extractor (this rule-based one, or an LLM one, see docs/INTEGRATION.md) goes through the same step 2.
 */
import { parseDate } from './dates.ts';
import { namePattern } from './mentions.ts';
import { statusOf } from './lifecycle.ts';
import { normalizeName, WorldIndex } from './world-index.ts';
import type { Action, Calendar, DateText, Entry, EntryType, Relation, StoryChapter, World } from './types.ts';

/** Where in the manuscript a proposal comes from. Offsets are into the chapter body. */
export interface SourceSpan {
  chapter: string;
  start: number;
  end: number;
  quote: string;
}

/**
 * Field values a proposal sets, in entry terms. References to other entries (relation targets, actors,
 * participants, place) are names or ids; names of things that do not exist yet are fine.
 */
export interface ProposalFields {
  /** Title or rank, e.g. "King". Stored in the entry's `title` detail field. */
  title?: string;
  /** Character occupation ("magus"), from "Keller the grand magus" or "he was a wizard". */
  occupation?: string;
  /** Character gender ("male", "female"), from a role word or a following he/she. */
  gender?: string;
  aliases?: string[];
  born?: DateText;
  died?: DateText;
  status?: string;
  /** Events */
  date?: DateText;
  place?: string;
  participants?: string[];
  actions?: Action[];
  relations?: Relation[];
}

export type ProposalKind = 'create' | 'update';

export interface Proposal {
  /** Stable id; what story-ignored.json stores. */
  key: string;
  kind: ProposalKind;
  entryType: EntryType;
  name: string;
  /** For create: everything. For update: only fields that are new or different. */
  fields: ProposalFields;
  /** Update only: current values of the fields this proposal changes (not the ones it only adds). */
  previous?: ProposalFields;
  sourceSpan: SourceSpan;
  /** Other places the same proposal was found. */
  alsoAt?: SourceSpan[];
  /** 0..1, how sure the pattern is. */
  confidence: number;
  /** Update: the entry it changes. */
  matchedExistingId?: string;
  /** Which pattern found it, e.g. "born". */
  pattern: string;
}

/** What an extractor returns before matching: no kind, key or match yet. */
export type RawProposal = Omit<Proposal, 'key' | 'kind' | 'previous' | 'matchedExistingId' | 'alsoAt'>;

/**
 * A dated "Name did something" sentence ("Camel fought at Qarim in 1920."). Not a proposal: it only feeds
 * the live warnings, as if the story were an event.
 */
export interface StoryAppearance {
  actor: string;
  verb: string;
  target?: string;
  date: DateText;
  place?: string;
  sourceSpan: SourceSpan;
}

export interface Extraction {
  proposals: RawProposal[];
  appearances: StoryAppearance[];
}

export interface ExtractInput {
  world: World;
  chapters: readonly StoryChapter[];
}

/** Plug-in point. The rule-based extractor is synchronous; an LLM one can return a promise. */
export interface Extractor {
  id: string;
  extract(input: ExtractInput): Extraction | Promise<Extraction>;
}

// ---------------------------------------------------------------------------------------------- words

const TITLES = [
  'King', 'Queen', 'Prince', 'Princess', 'Lord', 'Lady', 'Sir', 'Dame', 'Emperor', 'Empress', 'Sultan', 'Sultana',
  'Khan', 'Shah', 'Emir', 'Caliph', 'Pharaoh', 'Duke', 'Duchess', 'Baron', 'Baroness', 'Count', 'Countess', 'Earl',
  'General', 'Captain', 'Commander', 'Master', 'Mistress', 'Saint', 'Elder', 'Chief', 'Chieftain', 'Warlord', 'Vizier',
];
const TITLE_SET = new Set(TITLES);
/** Capitalised words that start sentences but are not names. */
const STOP = new Set([
  'The', 'A', 'An', 'Then', 'When', 'After', 'Before', 'In', 'On', 'At', 'Later', 'Soon', 'One', 'His', 'Her', 'Their',
  'Its', 'And', 'But', 'So', 'Yet', 'Meanwhile', 'There', 'This', 'That', 'These', 'Those', 'He', 'She', 'They', 'It',
  'We', 'I', 'You', 'Years', 'Once', 'During', 'While', 'Since', 'By', 'From', 'With', 'Without', 'Of', 'For', 'To',
  'Long', 'Some', 'Many', 'All', 'No', 'Not', 'Every', 'Each', 'Now', 'Here', 'Today', 'Yesterday', 'Finally', 'Also',
  'Still', 'Only', 'Even', 'If', 'As', 'Where', 'Who', 'What', 'Why', 'How', 'Chapter',
  // More sentence starters, pronouns and time words that are never names.
  'Him', 'Them', 'My', 'Our', 'Your', 'Me', 'Us', 'Nobody', 'Everyone', 'Everybody', 'Someone', 'Somebody', 'Anyone', 'Nothing',
  'Something', 'Everything', 'Anything', 'Nowhere', 'Somewhere', 'Everywhere', 'Perhaps', 'Maybe', 'Indeed', 'However', 'Thus',
  'Therefore', 'Instead', 'Again', 'Until', 'Because', 'Although', 'Though', 'Unless', 'Whether', 'Or', 'Nor', 'Neither', 'Either',
  'Both', 'Few', 'Most', 'Several', 'Another', 'Other', 'Such', 'First', 'Next', 'Last', 'Night', 'Dawn', 'Dusk', 'Morning',
  'Evening', 'Noon', 'Midnight', 'Tonight', 'Tomorrow', 'Never', 'Always', 'Sometimes', 'Often', 'Ever', 'Yes', 'Oh', 'Ah', 'Alas',
  'Well', 'Please', 'Thank', 'Thanks', 'Hello', 'Behind', 'Above', 'Below', 'Beyond', 'Under', 'Over', 'Inside', 'Outside', 'Around',
  'Through', 'Across', 'Along', 'Among', 'Against', 'Toward', 'Towards', 'Into', 'Upon', 'Within', 'Which', 'Whose', 'Whom',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'God', 'Gods', 'Part', 'Prologue', 'Epilogue',
]);
const ITEM_WORDS = [
  'Sword', 'Blade', 'Crown', 'Compass', 'Ring', 'Amulet', 'Staff', 'Spear', 'Shield', 'Helm', 'Bow', 'Axe', 'Dagger',
  'Cup', 'Chalice', 'Lamp', 'Orb', 'Scepter', 'Sceptre', 'Book', 'Tome', 'Scroll', 'Key', 'Stone', 'Gem', 'Necklace',
  'Cloak', 'Mirror', 'Horn', 'Hammer', 'Banner', 'Map', 'Lantern', 'Talisman', 'Relic', 'Idol', 'Mask', 'Throne',
  'Wand', 'Rod', 'Bracelet', 'Pendant', 'Circlet', 'Diadem', 'Gauntlet', 'Armour', 'Armor', 'Elixir', 'Potion', 'Seal', 'Harp', 'Flute',
  // weapons
  'Scimitar', 'Sabre', 'Saber', 'Mace', 'Flail', 'Halberd', 'Lance', 'Trident', 'Glaive', 'Crossbow', 'Longbow', 'Knife', 'Javelin',
  'Whip', 'Rapier', 'Cutlass', 'Warhammer', 'Greatsword', 'Longsword', 'Arrow', 'Arrows', 'Sling',
  // other things
  'Medallion', 'Locket', 'Brooch', 'Jewel', 'Crystal', 'Tablet', 'Codex', 'Grimoire', 'Chest', 'Casket', 'Lyre', 'Drum', 'Bell',
  'Cauldron', 'Goblet', 'Urn', 'Censer', 'Mantle', 'Robe', 'Veil', 'Boots', 'Gloves', 'Armlet', 'Torc', 'Coin', 'Feather', 'Pearl', 'Hourglass',
];
/** Weapon and thing nouns for "a sword called Dawnbreaker". */
const ITEM_NOUNS = [...new Set(ITEM_WORDS.map((w) => w.toLowerCase()))];
/** Group words: "the Order of the Silver Flame", "the Thieves' Guild", "House Varr". */
const FACTION_WORDS = [
  'Order', 'Guild', 'Brotherhood', 'Sisterhood', 'Clan', 'Clans', 'Tribe', 'Tribes', 'House', 'Legion', 'Company', 'Circle', 'Council',
  'Cult', 'Church', 'League', 'Alliance', 'Covenant', 'Watch', 'Guard', 'Army', 'Fleet', 'Society', 'Syndicate', 'Brethren', 'Horde',
  'Knights', 'Riders', 'Fellowship', 'Coven', 'Conclave', 'Senate', 'Dynasty', 'Faction', 'Confederacy', 'Federation', 'Union', 'Band',
];
/** Faction words that also go before a name: "House Varr", "Clan Dorr". */
const FACTION_PREFIX = ['House', 'Clan', 'Tribe'];
/** "Name joined the Order": the relation from the person to the faction. */
const FACTION_VERBS: Record<string, string> = {
  joined: 'member-of', served: 'serves', led: 'leader-of', commanded: 'leader-of', headed: 'leader-of', founded: 'founded', betrayed: 'enemy-of',
  fought: 'enemy-of', opposed: 'enemy-of', defied: 'enemy-of', aided: 'ally-of',
};
/**
 * Role nouns for "Keller the grand magus", "Leyla, the healer," and "he was a wizard". Title words
 * (King, Queen, ...) count as roles too and give a title instead of an occupation.
 */
const ROLES = [
  'magus', 'mage', 'wizard', 'sorcerer', 'sorceress', 'witch', 'warlock', 'necromancer', 'enchanter', 'enchantress', 'alchemist',
  'druid', 'shaman', 'priest', 'priestess', 'monk', 'nun', 'cleric', 'oracle', 'seer', 'prophet', 'prophetess', 'sage', 'scholar',
  'scribe', 'healer', 'physician', 'knight', 'warrior', 'soldier', 'guard', 'archer', 'hunter', 'huntress', 'ranger', 'assassin',
  'thief', 'rogue', 'spy', 'smith', 'blacksmith', 'merchant', 'trader', 'farmer', 'fisherman', 'sailor', 'pirate', 'bard', 'minstrel',
  'poet', 'herald', 'scout', 'guide', 'nomad', 'shepherd', 'herder', 'innkeeper', 'cook', 'servant', 'squire', 'paladin',
  'champion', 'hero', 'heroine', 'ruler', 'tyrant', 'regent', 'steward', 'judge', 'magistrate', 'mercenary', 'sellsword', 'bandit',
  'raider', 'explorer', 'traveller', 'traveler', 'cartographer', 'weaver', 'potter', 'carpenter', 'mason', 'miner', 'jeweller',
  'jeweler', 'painter', 'sculptor', 'architect', 'engineer', 'inventor', 'tinker', 'apprentice', 'teacher', 'mentor', 'hermit',
  'pilgrim', 'caravaneer', 'cameleer', 'storyteller', 'chronicler', 'astronomer', 'astrologer', 'diviner', 'mystic', 'sultan',
  ...TITLES.map((t) => t.toLowerCase()),
];
const ROLE_SET = new Set(ROLES);
/** Rank words that turn a role into a title: "grand magus" -> title "Grand Magus", occupation "magus". */
const RANKS = new Set(['grand', 'high', 'arch', 'chief', 'royal', 'court', 'head', 'supreme', 'great', 'first', 'imperial', 'elder']);
/** Describing words dropped from an occupation: "a very good wizard" -> "wizard". */
const DESCRIBING = new Set([
  'very', 'good', 'great', 'old', 'young', 'wise', 'mighty', 'powerful', 'famous', 'skilled', 'cruel', 'kind', 'brave', 'wicked',
  'evil', 'tall', 'little', 'poor', 'rich', 'dark', 'mad', 'blind', 'last', 'former', 'true', 'fine', 'bad', 'gifted', 'clever',
  'humble', 'proud', 'lonely', 'quiet', 'fierce', 'gentle', 'bold', 'feared', 'beloved', 'renowned', 'legendary', 'talented', 'fair',
  'strong', 'weak', 'honest', 'loyal', 'most', 'rather', 'quite', 'really', 'truly', 'so', 'such', 'best', 'greatest', 'new', 'only',
]);
const FEMALE_ROLES = new Set(['queen', 'princess', 'empress', 'sultana', 'duchess', 'baroness', 'countess', 'lady', 'dame', 'mistress', 'priestess', 'sorceress', 'enchantress', 'witch', 'nun', 'heroine', 'huntress', 'prophetess']);
const MALE_ROLES = new Set(['king', 'prince', 'emperor', 'sultan', 'duke', 'baron', 'count', 'earl', 'lord', 'sir', 'monk', 'warlock', 'khan', 'shah', 'emir', 'caliph', 'pharaoh', 'fisherman']);
/** "Name created the X": the relation from the person to the item. */
const ITEM_VERBS: Record<string, string> = {
  created: 'made', made: 'made', forged: 'made', crafted: 'made', built: 'made', wrought: 'made', carved: 'made', wove: 'made',
  found: 'owns', stole: 'owns', carried: 'owns', took: 'owns', owned: 'owns', bought: 'owns', inherited: 'owns', kept: 'owns',
  held: 'owns', bore: 'owns', claimed: 'owns', won: 'owns', received: 'owns', wielded: 'wields', wore: 'owns',
};
/** Words before a name that make it a place: "in Qarim", "across Zarnak". */
const PLACE_BEFORE = /(?:^|[^\p{L}])(?:in|at|near|into|across|through|beyond|toward|towards|reached|entered|visited|left)[ \t]+$/u;
const PLACE_WORDS = [
  'City', 'Town', 'Village', 'Kingdom', 'Realm', 'Land', 'Lands', 'Isle', 'Island', 'Isles', 'Islands', 'Fortress', 'Castle', 'Oasis', 'Port', 'Valley',
  'Desert', 'Mountain', 'Mountains', 'Peak', 'Forest', 'Woods', 'River', 'Lake', 'Sea', 'Bay', 'Coast', 'Harbour', 'Harbor', 'Citadel', 'Keep',
  'Temple', 'Shrine', 'Abbey', 'Monastery', 'Pass', 'Plains', 'Dunes', 'Marsh', 'Marshes', 'Swamp', 'Hills', 'Caves', 'Mines', 'Springs',
  'Palace', 'Ruins', 'Bazaar', 'Wastes', 'Steppe', 'Gulf', 'Strait', 'Canyon', 'Gorge', 'Cliffs', 'Reach', 'Highlands', 'Lowlands',
];
/** Lowercase place nouns: "the city of Qarim", "Qarim, a port on the salt sea". */
const PLACE_NOUNS = [
  'city', 'town', 'village', 'hamlet', 'port', 'harbour', 'harbor', 'fortress', 'castle', 'citadel', 'stronghold', 'keep', 'outpost', 'oasis',
  'kingdom', 'realm', 'empire', 'country', 'province', 'region', 'land', 'island', 'isle', 'valley', 'desert', 'mountain', 'forest', 'river', 'lake',
  'sea', 'bay', 'temple', 'shrine', 'palace', 'capital', 'settlement', 'camp', 'well', 'mine', 'ruin', 'ruins', 'market', 'bazaar', 'tower',
];
const EVENT_WORDS = [
  'Battle', 'War', 'Siege', 'Fall', 'Sack', 'Burning', 'Destruction', 'Massacre', 'Rebellion', 'Uprising', 'Revolt', 'Treaty', 'Coronation',
  'Founding', 'Conquest', 'Liberation', 'Invasion', 'Raid', 'Fire', 'Plague', 'Flood', 'Famine', 'Exodus', 'Duel', 'Assault', 'Storming', 'Defence', 'Defense',
];
/** Event words whose "of X" names a place. "War of the Sands" does not. */
const EVENT_AT_PLACE = new Set(['Battle', 'Siege', 'Fall', 'Sack', 'Burning', 'Destruction', 'Massacre', 'Treaty', 'Founding', 'Conquest', 'Liberation', 'Invasion', 'Raid', 'Fire', 'Flood', 'Assault', 'Storming', 'Defence', 'Defense']);
/**
 * "Hadi fought at Saltmere": a deed at a place that makes an event, named by the noun. `at` verbs take a
 * preposition ("fought at X"); the others take the place as their object ("besieged X"). `sure` verbs are
 * nearly always about a place, so an unknown object still counts (with less confidence).
 */
const PLACE_DEEDS: Record<string, { noun: string; of: string; at?: boolean; sure?: boolean }> = {
  fought: { noun: 'Battle', of: 'of', at: true }, battled: { noun: 'Battle', of: 'of', at: true }, clashed: { noun: 'Battle', of: 'of', at: true },
  besieged: { noun: 'Siege', of: 'of', sure: true }, sacked: { noun: 'Sack', of: 'of', sure: true }, burned: { noun: 'Burning', of: 'of', sure: true },
  burnt: { noun: 'Burning', of: 'of', sure: true }, razed: { noun: 'Destruction', of: 'of', sure: true }, raided: { noun: 'Raid', of: 'on', sure: true },
  stormed: { noun: 'Storming', of: 'of', sure: true }, conquered: { noun: 'Conquest', of: 'of', sure: true }, invaded: { noun: 'Invasion', of: 'of', sure: true },
  attacked: { noun: 'Attack', of: 'on' }, defended: { noun: 'Defence', of: 'of' }, liberated: { noun: 'Liberation', of: 'of' }, founded: { noun: 'Founding', of: 'of' },
};
/** Motion before a place: "travelled to Qarim", "fled into the Wastes", "hailed from Saltmere". */
const MOTION = 'travel(?:l)?ed|journeyed|sailed|rode|fled|returned|marched|went|came|headed|moved|escaped|retreated|wandered|hurried|walked|flew|arrived|hailed';
const KILL_VERBS = ['killed', 'slew', 'murdered', 'executed', 'assassinated'];
const KILL_NOUN: Record<string, string> = { killed: 'Death', slew: 'Death', murdered: 'Murder', executed: 'Execution', assassinated: 'Assassination' };
/** Verbs the generic "Name verbed ... in DATE" pattern skips because a specific pattern covers them. */
const SPECIFIC_VERBS = new Set(['born', 'died', 'married', 'wed', ...KILL_VERBS, 'was', 'is', 'had', 'has', 'were']);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const either = (words: readonly string[]) => words.map((w) => `[${w[0]}${w[0]!.toLowerCase()}]${esc(w.slice(1))}`).join('|');
const S = '[ \\t]+';
const CAP = "\\p{Lu}[\\p{L}\\p{M}'’-]*";
const NAME = `${CAP}(?:${S}(?:(?:the|al|el|ibn|bin|bint|de|van|von)${S})?${CAP}){0,3}`;
const LOWER_STOP = 'of|the|a|an|was|is|who|and|had|has|born|died|married|killed|in|at|on|to|from|with|his|her|their';
const LOWER = `(?!(?:${LOWER_STOP})(?![\\p{L}]))\\p{Ll}[\\p{L}\\p{M}'’-]*`;
const TITLE = either(TITLES);
const WORD = `(?!(?:${LOWER_STOP})(?![\\p{L}]))[\\p{L}][\\p{L}\\p{M}'’-]*`;
const END = '(?![\\p{L}\\p{N}])';
const START = '(?<![\\p{L}\\p{N}])';

interface Patterns {
  person: string;
  date: string;
  datePhrase: RegExp;
  months: Set<string>;
  eras: Set<string>;
}

function patterns(world: World): Patterns {
  const cal: Calendar = world.manifest.calendar;
  const known = [...new Set(world.entries.flatMap((e) => [e.name, ...(e.aliases ?? [])]).map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.split(' ').map(namePattern).join(S));
  const knownAlt = known.length ? `(?:${known.join('|')})${END}|` : '';
  const person = `${START}(${knownAlt}(?:${TITLE})${S}(?:${NAME}|${LOWER})|${NAME})`;
  const eras = cal.eras.map((e) => e.id).filter(Boolean).sort((a, b) => b.length - a.length);
  const eraAlt = eras.length ? `(?:${S}(?:${eras.map(esc).join('|')})${END})?` : '';
  const date = `((?:~[ \\t]?|(?:[Aa]round|[Aa]bout|[Cc]irca)${S}|c\\.[ \\t]?)?(?:\\d{1,2}\\.\\d{1,2}\\.-?\\d+|\\d{1,2}\\.\\d{3,}|\\d{1,2}\\.\\d{1,2}|-?\\d{1,6})(?![\\d])${eraAlt}(?!${S}\\p{Lu}{2,3}${END}))`;
  const datePhrase = new RegExp(`${START}(?:(?:[Ii]n|[Oo]n|[Dd]uring|[Bb]y)${S}(?:the${S}year${S})?|(?=~|[Aa]round|[Aa]bout|[Cc]irca|c\\.))${date}`, 'gu');
  return {
    person,
    date,
    datePhrase,
    months: new Set((cal.months ?? []).map((m) => m.name)),
    eras: new Set(cal.eras.flatMap((e) => [e.id, e.name])),
  };
}

/** "around 1920 AS" -> "~1920 AS"; undefined when the calendar cannot read it. */
function toDate(raw: string | undefined, cal: Calendar): DateText | undefined {
  if (!raw) return undefined;
  const approx = /^(?:~|around|about|circa|c\.)/i.test(raw);
  const text = (approx ? '~' : '') + raw.replace(/^(?:~|around|about|circa|c\.)[ \t]*/i, '').replace(/[ \t]+/g, ' ');
  const r = parseDate(text, cal);
  return r.kind === 'date' || r.kind === 'yearless' ? text : undefined;
}

const capitalise = (w: string) => (/^\p{Ll}/u.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/** "King camel" -> { name: "Camel", title: "King", raw: "King camel" }; leading stop words go. */
function cleanName(raw: string): { name: string; title?: string; raw: string } | undefined {
  const words = raw.trim().split(/[ \t]+/);
  while (words.length && STOP.has(words[0]!)) words.shift();
  let title: string | undefined;
  if (words.length > 1 && TITLE_SET.has(capitalise(words[0]!))) title = capitalise(words.shift()!);
  if (!words.length) return undefined;
  const name = words.map((w, i) => (i === 0 || /^\p{Ll}/u.test(w) === false ? capitalise(w) : w)).join(' ');
  if (STOP.has(name) || TITLE_SET.has(name)) return undefined;
  return { name, raw: (title ? `${title} ` : '') + name, ...(title ? { title } : {}) };
}

/**
 * A role phrase ("grand magus", "very good wizard", "Caravan Master") as fields: rank words make a title,
 * describing words go, the rest is the occupation; role words like "queen" also give a gender.
 * Undefined when the phrase does not end in a role word.
 */
export function roleFields(phrase: string): Pick<ProposalFields, 'title' | 'occupation' | 'gender'> | undefined {
  const words = phrase.trim().split(/[ \t]+/).map((w) => w.toLowerCase());
  const head = words[words.length - 1];
  if (!head || !ROLE_SET.has(head)) return undefined;
  const kept = words.filter((w, i) => i === words.length - 1 || !DESCRIBING.has(w));
  const out: Pick<ProposalFields, 'title' | 'occupation' | 'gender'> = {};
  const isTitle = TITLE_SET.has(capitalise(head));
  const ranked = kept.length > 1 && kept.slice(0, -1).every((w) => RANKS.has(w));
  if (isTitle || ranked) out.title = kept.map(capitalise).join(' ');
  if (!isTitle) out.occupation = ranked ? head : kept.join(' ');
  if (FEMALE_ROLES.has(head)) out.gender = 'female';
  else if (MALE_ROLES.has(head)) out.gender = 'male';
  return out;
}

/** "Keller the Grand Magus" -> { name: "Keller", role: "Grand Magus" }; names like "Orsan the Grey" stay whole. */
function splitRole(raw: string): { raw: string; role?: string } {
  const m = /^(.+?)[ \t]+the[ \t]+(.+)$/u.exec(raw.trim());
  if (m && roleFields(m[2]!)) return { raw: m[1]!, role: m[2]! };
  return { raw };
}

const titleCase = (s: string) => s.split(/[ \t]+/).map((w, i) => (i > 0 && /^(?:of|the|and)$/.test(w) ? w : capitalise(w))).join(' ');

// ------------------------------------------------------------------------------------------ sentences

interface Sentence {
  text: string;
  start: number;
}

/** Split prose into sentences, keeping offsets. Dates like 12.03.1920 and "c. 1800" do not end a sentence. */
export function sentences(body: string): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  const push = (end: number) => {
    const raw = body.slice(from, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) out.push({ text, start: from + lead });
    from = end;
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '\n') {
      push(i);
      from = i + 1;
      continue;
    }
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    if (ch === '.' && /\d/.test(body[i + 1] ?? '')) continue;
    if (ch === '.' && /(?:^|[^\p{L}])(?:c|St|Mr|Mrs|Dr)$/u.test(body.slice(Math.max(0, i - 4), i))) continue;
    while (/[.!?"'”’)]/.test(body[i + 1] ?? '')) i++;
    push(i + 1);
  }
  push(body.length);
  return out;
}

// ------------------------------------------------------------------------------------------ extractor

function extractChapter(world: World, ch: StoryChapter, p: Patterns, ix: WorldIndex): Extraction {
  const cal = world.manifest.calendar;
  const proposals: RawProposal[] = [];
  const appearances: StoryAppearance[] = [];
  const P = p.person;
  const PLACE = `(${NAME})`;
  const D = p.date;
  const DP = `(?:(?:in|on|during|by)${S}(?:the${S}year${S})?)?${D}`;
  const LOC = `(?:${S}(?:in|at)${S}${PLACE})?`;
  const rx = (s: string) => new RegExp(s, 'gu');
  const notPlace = (n: string) => p.months.has(n) || p.eras.has(n) || TITLE_SET.has(n.split(' ')[0]!) || STOP.has(n) || /['’]s$/.test(n);

  /** The one person the previous sentences were about, for "he"/"she"; undefined when unclear. */
  let last: string | undefined;
  const lowerWords = new Set((ch.body.match(/(?<![\p{L}])\p{Ll}[\p{L}'’-]*/gu) ?? []));
  for (const s of sentences(ch.body)) {
    const named = new Set<string>();
    const span: SourceSpan = { chapter: ch.file, start: s.start, end: s.start + s.text.length, quote: s.text.length > 240 ? `${s.text.slice(0, 237)}...` : s.text };
    const dates = [...s.text.matchAll(p.datePhrase)].map((m) => toDate(m[1], cal)).filter((d): d is string => !!d);
    const sentenceDate = dates.length === 1 ? dates[0] : undefined;
    const sentencePlace = [...s.text.matchAll(rx(`${START}(?:in|at)${S}${PLACE}`))].map((m) => m[1]!).find((n) => !notPlace(n) && !STOP.has(n));
    const add = (r: Omit<RawProposal, 'sourceSpan'>) => proposals.push({ ...r, sourceSpan: span });
    const person = (rawIn: string, fields: ProposalFields, pattern: string, confidence = 0.9): string | undefined => {
      const split = ix.resolve(rawIn.trim()) ? { raw: rawIn } : splitRole(rawIn);
      const raw = split.raw;
      const n = cleanName(raw);
      if (!n) return undefined;
      const f: ProposalFields = { ...(split.role ? roleFields(split.role) : {}), ...fields };
      if (n.title) {
        f.title = n.title;
        f.aliases = [n.raw];
      }
      // A known full name ("Queen Ilsa") wins over the stripped one.
      const name = ix.resolve(raw.trim()) ? raw.trim().replace(/[ \t]+/g, ' ') : n.name;
      if (name !== n.name) {
        delete f.title;
        delete f.aliases;
      }
      add({ entryType: 'character', name, fields: f, confidence, pattern });
      named.add(name);
      return name;
    };
    const place = (raw: string | undefined, pattern: string, confidence = 0.6): string | undefined => {
      if (!raw) return undefined;
      const n = cleanName(raw);
      if (!n || n.title || notPlace(n.name)) return undefined;
      add({ entryType: 'place', name: n.name, fields: {}, confidence, pattern });
      return n.name;
    };

    // born: "King Camel was born in Qarim in 1998", "Camel, son of Leyla, was born in 1998"
    for (const m of s.text.matchAll(rx(`${P}(?:,[^,]{1,60},)?${S}(?:was${S})?born${LOC}(?:${S}${DP})?`))) {
      const born = toDate(m[3], cal) ?? sentenceDate;
      const where = place(m[2], 'born');
      if (!born && !where) continue;
      person(m[1]!, born ? { born } : {}, 'born');
    }
    // died: "Camel died in 2050", "Camel was slain at Qarim"
    for (const m of s.text.matchAll(rx(`${P}(?:,[^,]{1,60},)?${S}(?:died|perished|passed${S}away|was${S}(?:killed|slain|murdered|executed))(?!${S}by)${LOC}(?:${S}${DP})?`))) {
      const died = toDate(m[3], cal) ?? sentenceDate;
      place(m[2], 'died');
      person(m[1]!, died ? { died, status: 'dead' } : { status: 'dead' }, 'died');
    }
    // A killed B (and "B was killed by A")
    const killed = (actorRaw: string, verb: string, victimRaw: string, where?: string, dateRaw?: string) => {
      const date = toDate(dateRaw, cal) ?? sentenceDate;
      const placeName = place(where ?? sentencePlace, 'killed');
      const victim = person(victimRaw, date ? { died: date, status: 'dead' } : { status: 'dead' }, 'killed');
      const actor = person(actorRaw, {}, 'killed', 0.7);
      if (!victim || !actor) return;
      const fields: ProposalFields = { actions: [{ actor, verb, target: victim }] };
      if (date) fields.date = date;
      if (placeName) fields.place = placeName;
      add({ entryType: 'event', name: `The ${KILL_NOUN[verb] ?? 'Death'} of ${victim}`, fields, confidence: 0.8, pattern: 'killed' });
    };
    for (const m of s.text.matchAll(rx(`${P}${S}(${KILL_VERBS.join('|')})${S}${P}${LOC}(?:${S}${DP})?`))) killed(m[1]!, m[2]!, m[3]!, m[4], m[5]);
    for (const m of s.text.matchAll(rx(`${P}${S}was${S}(killed|slain|murdered|executed|assassinated)${S}by${S}${P}${LOC}(?:${S}${DP})?`))) {
      killed(m[3]!, m[2] === 'slain' ? 'slew' : m[2]!, m[1]!, m[4], m[5]);
    }
    // married: "Camel married Leyla in 1950"
    for (const m of s.text.matchAll(rx(`${P}${S}(?:married|wed)${S}${P}(?:${S}${DP})?`))) {
      const other = person(m[2]!, {}, 'married', 0.7);
      if (!other) continue;
      const rel: Relation = { type: 'spouse-of', target: other };
      const from = toDate(m[3], cal) ?? sentenceDate;
      if (from) rel.from = from;
      person(m[1]!, { relations: [rel] }, 'married');
    }
    // son/daughter/child of: "Camel, son of Leyla", "Camel was the daughter of Leyla"
    for (const m of s.text.matchAll(rx(`${P}(?:,|${S}(?:was|is))${S}(?:the${S})?(?:son|daughter|child|heir)${S}of${S}${P}`))) {
      const parent = person(m[2]!, {}, 'child-of', 0.7);
      if (parent) person(m[1]!, { relations: [{ type: 'child-of', target: parent }] }, 'child-of');
    }
    // the X of Place: "Ilsa, the Salt Queen of Saltmere", "the Sultan of Qarim", "the City of Brass"
    for (const m of s.text.matchAll(rx(`${P},${S}the${S}((?:${CAP}${S}){0,2}${CAP})${S}of${S}(?:the${S})?${PLACE}`))) {
      const where = place(m[3], 'title-of', 0.7);
      person(m[1]!, { title: where ? `${m[2]} of ${where}` : m[2]! }, 'title-of', 0.8);
    }
    for (const m of s.text.matchAll(rx(`${START}(?:${TITLE}|${PLACE_WORDS.join('|')})${S}of${S}(?:the${S})?${PLACE}`))) place(m[1], 'title-of', 0.7);
    // battle/war/siege of X: an event, "in DATE" next to it or anywhere in the sentence
    for (const m of s.text.matchAll(rx(`${START}(?:[Tt]he${S})?(${either(EVENT_WORDS)})${S}(?:of|on|at)${S}(?:the${S})?(${NAME})(?:${S}${DP})?`))) {
      if (!/^[Tt]he[ \t]/.test(m[0]) && /^\p{Ll}/u.test(m[1]!)) continue; // "a raid on Qarim" is too unsure; "the raid on Qarim" is fine
      const word = capitalise(m[1]!);
      const target = cleanName(m[2]!)?.name;
      if (!target) continue;
      const fields: ProposalFields = {};
      const date = toDate(m[3], cal) ?? sentenceDate;
      if (date) fields.date = date;
      if (EVENT_AT_PLACE.has(word)) {
        const where = place(target, 'event');
        if (where) fields.place = where;
      }
      const who = ix.mentions.find(s.text).flatMap((x) => x.ids).filter((id) => ['character', 'faction'].includes(ix.resolve(id)!.type));
      if (who.length) fields.participants = [...new Set(who)];
      const prep = / on /.test(m[0]) && !/ of /.test(m[0]) ? 'on' : / at /.test(m[0]) && !/ of /.test(m[0]) ? 'at' : 'of';
      const after = m[0].slice(m[0].indexOf(` ${prep} `) + prep.length + 2);
      // A capitalised "Battle of" is a name; a lowercase "battle of" is surer with a date or a known place.
      const isName = /^\p{Lu}/u.test(m[1]!);
      const confidence = isName ? 0.8 : date || findExisting(ix, target)?.type === 'place' ? 0.65 : 0.5;
      add({ entryType: 'event', name: `The ${word} ${prep} ${/^the\s/i.test(after) ? 'the ' : ''}${target}`, fields, confidence, pattern: 'event' });
    }
    // a deed at a place: "Hadi fought at Saltmere in 1920" -> The Battle of Saltmere, with its place, date and people
    for (const m of s.text.matchAll(rx(`${P}(?:,[^,]{1,60},)?${S}(${Object.keys(PLACE_DEEDS).join('|')})(?:${S}(at|in|on|near|outside|before))?${S}(?:the${S}(?:${PLACE_NOUNS.join('|')})${S}of${S})?${PLACE}(?:${S}${DP})?`))) {
      const deed = PLACE_DEEDS[m[2]!]!;
      const target = cleanName(m[4]!);
      if (!target || target.title || notPlace(target.name) || !!deed.at !== !!m[3]) continue;
      const existing = findExisting(ix, target.name);
      if (existing && existing.type !== 'place') continue; // "attacked Tarik", "fought at Leyla's side"
      // The verb alone is a weak sign; a known place, a date or a place word make it surer.
      const placeWord = target.name.split(' ').some((w) => PLACE_WORDS.includes(w));
      if (!existing && !deed.sure && !deed.at && !placeWord) continue;
      const date = toDate(m[5], cal) ?? sentenceDate;
      if (!existing && !date && !placeWord && !deed.sure) continue; // "they fought at Hollow" with nothing else: too unsure
      const sure = Math.round(((existing ? 0.2 : 0) + (date ? 0.1 : 0) + (placeWord ? 0.1 : 0)) * 100) / 100;
      const where = place(target.name, 'deed-at', 0.45 + sure);
      if (!where) continue;
      const actor = person(m[1]!, {}, 'deed-at', 0.6);
      const fields: ProposalFields = { place: where };
      if (date) fields.date = date;
      const who = ix.mentions.find(s.text).flatMap((x) => x.ids).filter((id) => ['character', 'faction'].includes(ix.resolve(id)!.type));
      const actorRef = actor ? findExisting(ix, actor, 'character')?.id ?? actor : undefined;
      const parts = [...new Set([...(actorRef ? [actorRef] : []), ...who])];
      if (parts.length) fields.participants = parts;
      add({ entryType: 'event', name: `The ${deed.noun} ${deed.of} ${where}`, fields, confidence: 0.4 + sure, pattern: 'deed-at' });
    }
    // places from motion and description: "rode to Qarim", "Qarim, a port on the salt sea", "the gates of Qarim"
    for (const m of s.text.matchAll(rx(`${START}(?:${MOTION})(?:${S}(?:back|home|north|south|east|west|on))?${S}(?:to|into|toward|towards|for|from|at|in)${S}(?:the${S}(?:${PLACE_NOUNS.join('|')})${S}of${S})?${PLACE}`))) {
      const n = cleanName(m[1]!);
      if (!n || findExisting(ix, n.name, 'character')) continue;
      place(m[1], 'motion', 0.5);
    }
    for (const m of s.text.matchAll(rx(`${START}${PLACE},${S}(?:a|an|the)${S}(?:${WORD}${S}){0,2}?(?:${PLACE_NOUNS.join('|')})${END}`))) {
      if (!/^[\s"'“‘(]*$/.test(s.text.slice(0, m.index!)) && !/[,;:][ \t]*$/.test(s.text.slice(0, m.index!))) continue;
      place(m[1], 'place-is', 0.8);
    }
    for (const m of s.text.matchAll(rx(`${START}the${S}(?:gates|walls|streets|ruins|markets|harbour|harbor|towers|halls|road|roads|way|throne|people|sands|dunes)${S}(?:of|to)${S}${PLACE}`))) place(m[1], 'place-of', 0.55);
    // named things: "a sword called Dawnbreaker", "her blade, Nightfall,"
    for (const m of s.text.matchAll(rx(`${START}(?:a|an|the|his|her|their|its|my)${S}(?:${WORD}${S}){0,2}?(${ITEM_NOUNS.join('|')})(?:${S}(?:called|named|known${S}as)${S}|,${S})(?:the${S})?(${NAME})(?=[ \t]*(?:[,.;:!?]|$|${S}(?:and|which|that)${END}))`))) {
      const n = cleanName(m[2]!);
      if (!n || n.title || findExisting(ix, n.name, 'character')?.type === 'character') continue;
      const comma = !/called|named|known/.test(m[0]);
      if (comma && !findExisting(ix, n.name)) continue; // "his sword, Leyla," is too unsure unless the item exists
      add({ entryType: 'item', name: n.name, fields: {}, confidence: comma ? 0.6 : 0.8, pattern: 'item-named' });
    }
    // factions: "the Order of the Silver Flame", "the Thieves' Guild", "House Varr"; "Hadi joined the Order of ..."
    const FACTION = `((?:[Tt]he${S})?(?:(?:${FACTION_PREFIX.join('|')})${S}(?!of\b)${CAP}(?!${S}of${S})|(?:${CAP}${S}){0,3}(?:${FACTION_WORDS.join('|')})(?:${S}of${S}(?:the${S})?${NAME})?))${END}`;
    const factionName = (raw: string): string | undefined => {
      const t = raw.replace(/[ \t]+/g, ' ').replace(/^the /i, '');
      const words = t.split(' ');
      if (words.length < 2 || STOP.has(words[0]!) || TITLE_SET.has(words[0]!)) return undefined;
      const existing = findExisting(ix, t);
      if (existing) return existing.type === 'faction' ? existing.name : undefined;
      return FACTION_PREFIX.includes(words[0]!) && !/ of /.test(t) ? t : `The ${t}`;
    };
    const factions = new Set<string>();
    for (const m of s.text.matchAll(rx(`${START}${FACTION}`))) {
      if (!/^the /i.test(m[1]!) && !FACTION_PREFIX.includes(m[1]!.split(/[ \t]/)[0]!)) continue;
      const name = factionName(m[1]!);
      if (!name || factions.has(name)) continue;
      factions.add(name);
      add({ entryType: 'faction', name, fields: {}, confidence: / of /.test(name) ? 0.7 : 0.6, pattern: 'faction' });
    }
    for (const m of s.text.matchAll(rx(`${P}(?:,[^,]{1,60},)?${S}(${Object.keys(FACTION_VERBS).join('|')})${S}(?:with${S}|against${S}|for${S})?${FACTION}`))) {
      const name = factionName(m[3]!);
      if (name) person(m[1]!, { relations: [{ type: FACTION_VERBS[m[2]!]!, target: name }] }, 'faction-deed', 0.75);
    }
    for (const m of s.text.matchAll(rx(`${P},${S}(?:a|an|the)${S}(member|knight|servant|soldier|brother|sister|leader|head|founder|master)${S}of${S}${FACTION}`))) {
      const name = factionName(m[3]!);
      const type = /^(?:leader|head|master)$/.test(m[2]!) ? 'leader-of' : m[2] === 'founder' ? 'founded' : 'member-of';
      if (name) person(m[1]!, { relations: [{ type, target: name }] }, 'faction-of', 0.8);
    }
    // items: "the Glass Compass", "the Crown of Thorns"
    for (const m of s.text.matchAll(rx(`${START}[Tt]he${S}((?:${CAP}${S}){0,3}(?:${ITEM_WORDS.join('|')})(?:${S}of${S}(?:the${S})?${NAME})?)${END}`))) {
      if (!/[ \t]/.test(m[1]!)) continue; // "the Crown" alone is too vague
      add({ entryType: 'item', name: `The ${m[1]!.replace(/[ \t]+/g, ' ')}`, fields: {}, confidence: 0.6, pattern: 'item' });
    }
    // in/at Place
    for (const m of s.text.matchAll(rx(`${START}(?:in|at|near|into)${S}(?:the${S}(?:${PLACE_WORDS.map((w) => w.toLowerCase()).join('|')})${S}of${S})?${PLACE}`))) place(m[1], 'in-place', 0.5);
    // appositives: "Keller the grand magus", "Leyla, the healer," (a capitalised "the Grand Magus" is split in person())
    const ROLE_PHRASE = `((?:${WORD}${S}){0,3}?(?:${either(ROLES)}))${END}`;
    for (const m of s.text.matchAll(rx(`${P}${S}the${S}${ROLE_PHRASE}(?!${S}of${END})`))) {
      // Only as the subject ("Keller the magus created"), not "told Leyla the king had died".
      if (!/(?:^[\s"'“‘(]*|[,;:][ \t]*|(?:^|[^\p{L}])and[ \t]+)$/u.test(s.text.slice(0, m.index!))) continue;
      const role = roleFields(m[2]!);
      if (role) person(m[1]!, role, 'role', 0.8);
    }
    for (const m of s.text.matchAll(rx(`${P},${S}(?:the|a|an)${S}${ROLE_PHRASE}(?=[ \t]*(?:[,.;:!?]|$))`))) {
      const role = roleFields(m[2]!);
      if (role) person(m[1]!, role, 'role', 0.8);
    }
    // deeds with things: "Keller created the scepter", "Leyla found the Glass Compass"
    for (const m of s.text.matchAll(rx(`${P}(?:${S}the${S}(?:${WORD}${S}){0,3}?(?:${either(ROLES)}))?(?:,[^,]{1,60},)?${S}(${Object.keys(ITEM_VERBS).join('|')})${S}the${S}((?:${WORD}${S}){0,2}?(?:${either(ITEM_WORDS)})(?:${S}of${S}(?:the${S})?${NAME})?)${END}`))) {
      const item = `The ${titleCase(m[3]!.replace(/[ \t]+/g, ' '))}`;
      const existing = findExisting(ix, item);
      if (existing && existing.type !== 'item') continue;
      add({ entryType: 'item', name: existing?.name ?? item, fields: {}, confidence: 0.7, pattern: 'item-deed' });
      person(m[1]!, { relations: [{ type: ITEM_VERBS[m[2]!]!, target: existing?.name ?? item }] }, 'item-deed', 0.8);
    }
    // any other capitalised name: a "new entry?" proposal, typed from its words and what stands before it
    for (const m of s.text.matchAll(rx(`${START}${NAME}`))) {
      const at = m.index!;
      const before = s.text.slice(0, at);
      const initial = /^[\s"'“‘(]*$/.test(before);
      const possessive = /['’]s$/.test(m[0]);
      const split = splitRole(m[0].replace(/['’]s$/, ''));
      const n = cleanName(split.raw);
      if (!n) continue;
      const words = n.name.split(' ');
      const one = words.length === 1 ? n.name : undefined;
      if (one && (TITLE_SET.has(one) || ITEM_WORDS.includes(one) || PLACE_WORDS.includes(one) || EVENT_WORDS.includes(one))) continue;
      if (p.months.has(n.name) || p.eras.has(n.name) || words.some((w) => STOP.has(w)) || /^\p{Lu}{1,4}$/u.test(n.name)) continue;
      if (/(?:^|[^\p{L}])of[ \t]+(?:the[ \t]+)?$/u.test(before)) continue; // "son of X", "Battle of X": other patterns
      if (initial && !n.title && !split.role && words.length === 1) {
        // A sentence-initial word is a name only when it is not a common word and goes on into the sentence.
        const after = s.text.slice(at + m[0].length);
        if (/ly$/.test(n.name) || lowerWords.has(n.name.toLowerCase()) || !/^[ \t]+\p{Ll}/u.test(after)) continue;
      }
      const afterThe = /(?:^|[^\p{L}])the[ \t]+$/iu.test(before) || /^the$/i.test(m[0].split(/[ \t]+/)[0]!);
      const hasWord = (list: readonly string[]) => words.some((w) => list.includes(w));
      if (hasWord(EVENT_WORDS)) {
        // "the Great Fire", "the Long Plague": a named event (the "Battle of X" pattern covers "of" names).
        if (afterThe && words.length > 1 && !new RegExp(`^${S}(?:of|on|at)${S}`, 'u').test(s.text.slice(at + m[0].length))) add({ entryType: 'event', name: `The ${n.name}`, fields: {}, confidence: 0.45, pattern: 'name' });
        continue;
      }
      if (hasWord(FACTION_WORDS) || FACTION_PREFIX.includes(words[0]!)) continue; // the faction patterns above
      if (hasWord(ITEM_WORDS)) {
        if (new RegExp(`^${S}of${S}`, 'u').test(s.text.slice(at + m[0].length))) continue; // "the Crown of Thorns": the item pattern
        if (findExisting(ix, `The ${n.name}`)?.type === 'item' || words.length > 1) add({ entryType: 'item', name: `The ${n.name}`, fields: {}, confidence: 0.4, pattern: 'name' });
        continue;
      }
      if (hasWord(PLACE_WORDS) || (!possessive && !n.title && !split.role && PLACE_BEFORE.test(before))) {
        if (!notPlace(n.name)) add({ entryType: 'place', name: n.name, fields: {}, confidence: 0.4, pattern: 'name' });
        continue;
      }
      if (afterThe || words.length > 3) continue; // "the Shifting Dunes": too unclear to guess
      person(m[0].replace(/['’]s$/, ''), {}, 'name', 0.4);
    }
    // he/she: "he was a very good wizard" adds to the one person just named
    const pron = /^(?:[^,]{0,40},[ \t]+)?(he|she)(?![\p{L}])(?:[ \t]+(?:was|is|became)[ \t]+(?:a|an|the)[ \t]+((?:[\p{L}'’-]+[ \t]+){0,3}?[\p{L}'’-]+)(?=[ \t]*(?:[,.;:!?]|$|[ \t]+(?:of|in|at|from|who|and|with)(?![\p{L}]))))?/iu.exec(s.text);
    if (pron && last && !named.size) {
      const gender = pron[1]!.toLowerCase() === 'he' ? 'male' : 'female';
      const role = pron[2] ? roleFields(pron[2]) : undefined;
      const existing = findExisting(ix, last, 'character');
      // A bare pronoun only sets the gender of someone new; an existing entry needs "he was a ...".
      if (role || !existing) {
        const f: ProposalFields = { ...(role ?? {}), gender };
        add({ entryType: 'character', name: last, fields: f, confidence: 0.5, pattern: 'pronoun' });
      }
    }
    const isPerson = (n: string) => { const any = findExisting(ix, n); return !any || any.type === 'character'; };
    const people = new Set([...named].filter(isPerson).map((n) => findExisting(ix, n, 'character')?.id ?? n));
    for (const x of ix.mentions.find(s.text)) for (const id of x.ids) if (ix.resolve(id)?.type === 'character' && ![...named].some((n) => findExisting(ix, n, 'character')?.id === id)) people.add(id);
    if (people.size === 1) {
      const only = [...people][0]!;
      last = ix.byIdOf(only)?.name ?? only;
    } else if (people.size > 1) last = undefined;

    // generic dated deed: "Camel fought at Qarim in 1920." Feeds warnings only.
    if (sentenceDate) {
      const m = rx(`^(?:[^,]{0,40},${S})?${P}${S}(\\p{Ll}+)(?:${S}${P})?`).exec(s.text);
      const verb = m?.[2];
      if (m && verb && !SPECIFIC_VERBS.has(verb) && (/ed$/.test(verb) || /^(?:fought|met|led|rode|went|came|fled|saw|took|made|won|lost|wrote|built|became|ruled|stole|forged|wielded|left|crossed|sailed|reached|found|held|gave|sent|spoke|began|ran|struck|swore|broke|drove|fell|rose|stood|sat|slept|returned|visited)$/.test(verb))) {
        const actor = cleanName(m[1]!);
        if (actor) {
          const a: StoryAppearance = { actor: ix.resolve(m[1]!.trim()) ? m[1]!.trim() : actor.name, verb, date: sentenceDate, sourceSpan: span };
          const t = m[3] && cleanName(m[3]);
          if (t && ix.resolve(m[3]!.trim())) a.target = m[3]!.trim();
          else if (t && ix.resolve(t.name)) a.target = t.name;
          if (sentencePlace) a.place = sentencePlace;
          appearances.push(a);
        }
      }
    }
  }
  return { proposals, appearances };
}

/** The built-in extractor: sentence patterns, see the list in docs/INTEGRATION.md. */
export interface SyncExtractor extends Extractor {
  extract(input: ExtractInput): Extraction;
}

export const ruleExtractor: SyncExtractor = {
  id: 'rules',
  extract({ world, chapters }) {
    const p = patterns(world);
    const ix = new WorldIndex(world);
    const out: Extraction = { proposals: [], appearances: [] };
    for (const ch of chapters) {
      const r = extractChapter(world, ch, p, ix);
      out.proposals.push(...r.proposals);
      out.appearances.push(...r.appearances);
    }
    return out;
  },
};

// ------------------------------------------------------------------------------------- a picked name

/** What a name someone picked in the story most likely is. */
export interface Guess {
  /** Set when the name already belongs to an entry. */
  existing?: Entry;
  type: EntryType;
  /** The name as it would be added ("the Glass Compass" -> "The Glass Compass"). */
  name: string;
  confidence: number;
}

/**
 * Guess the entry type of a selected bit of story text, using the sentence around it: an existing entry
 * first, then what the extractor finds for that name in the sentence, then the words in the name
 * ("Order", "Battle", "City", "Sword"), then a capitalised name is a character and anything else a note.
 */
export function guessEntry(world: World, text: string, sentence = text): Guess | undefined {
  const raw = text.replace(/\s+/g, ' ').trim().replace(/^["'“‘(]+|["'”’),.;:!?]+$/g, '');
  if (!raw || raw.length > 80) return undefined;
  const ix = new WorldIndex(world);
  const existing = findExisting(ix, raw, 'character') ?? findExisting(ix, raw);
  if (existing) return { existing, type: existing.type, name: existing.name, confidence: 1 };
  const chapter: StoryChapter = { file: 'story/selection.md', title: '', order: 0, body: sentence };
  const found = ruleExtractor.extract({ world, chapters: [chapter] }).proposals
    .filter((p) => key(p.name) === key(raw))
    .sort((a, b) => b.confidence - a.confidence)[0];
  const name = /^the\s/i.test(raw) ? `The ${raw.slice(4)}` : raw;
  if (found) return { type: found.entryType, name: found.name, confidence: found.confidence };
  const words = raw.split(' ');
  const has = (list: readonly string[]) => words.some((w) => list.includes(capitalise(w)));
  if (has(FACTION_WORDS) && words.length > 1) return { type: 'faction', name, confidence: 0.5 };
  if (has(EVENT_WORDS)) return { type: 'event', name, confidence: 0.5 };
  if (has(PLACE_WORDS)) return { type: 'place', name, confidence: 0.5 };
  if (has(ITEM_WORDS)) return { type: 'item', name, confidence: 0.5 };
  if (/^\p{Lu}/u.test(raw) && words.length <= 4) return { type: 'character', name, confidence: 0.3 };
  return { type: 'note', name: raw.charAt(0).toUpperCase() + raw.slice(1), confidence: 0.2 };
}

// ------------------------------------------------------------------------------------------ reconcile

/**
 * Find an existing entry by name, alias or id; "The X" and "X" count as the same name. For characters a
 * bare name also finds the one character whose name starts with it once titles are dropped
 * ("Kadir" -> "Kadir Humpback", "Ilsa" -> "Queen Ilsa"), so the story does not make look-alike duplicates.
 */
export function findExisting(ix: WorldIndex, name: string, type?: EntryType): Entry | undefined {
  const n = name.trim();
  const exact = ix.resolve(n) ?? (/^the\s/i.test(n) ? ix.resolve(n.replace(/^the\s+/i, '')) : ix.resolve(`The ${n}`));
  if (exact || type !== 'character') return exact;
  const want = normalizeName(n);
  const hits = ix.entries.filter((e) => e.type === 'character' && [e.name, ...(e.aliases ?? [])].some((full) => {
    const words = normalizeName(full).split(' ');
    while (words.length > 1 && TITLE_SET.has(capitalise(words[0]!))) words.shift();
    const rest = words.join(' ');
    return rest === want || rest.startsWith(`${want} `);
  }));
  return hits.length === 1 ? hits[0] : undefined;
}

const key = (s: string) => normalizeName(s).replace(/^the /, '');

function sameDate(a: DateText | undefined, b: DateText | undefined, cal: Calendar): boolean {
  if (a === undefined || b === undefined) return a === b;
  const x = parseDate(a, cal);
  const y = parseDate(b, cal);
  if (x.kind === 'date' && y.kind === 'date') return x.date.lo === y.date.lo && x.date.hi === y.date.hi && x.date.approx === y.date.approx;
  return a.trim() === b.trim();
}

function refId(ix: WorldIndex, ref: string): string {
  return findExisting(ix, ref)?.id ?? ref;
}

/** Union lists, merge scalars (first wins). */
function mergeFields(into: ProposalFields, from: ProposalFields): void {
  for (const [k, v] of Object.entries(from) as [keyof ProposalFields, unknown][]) {
    if (v === undefined) continue;
    const cur = into[k] as unknown;
    if (Array.isArray(v)) {
      const list = [...((cur as unknown[]) ?? [])];
      for (const x of v) if (!list.some((y) => JSON.stringify(y) === JSON.stringify(x))) list.push(x);
      (into as Record<string, unknown>)[k] = list;
    } else if (cur === undefined) (into as Record<string, unknown>)[k] = v;
  }
}

/** Fields of `f` that the entry does not have yet (adds) or has with another value (changes). */
function diff(ix: WorldIndex, e: Entry, f: ProposalFields): { fields: ProposalFields; previous: ProposalFields } {
  const cal = ix.calendar;
  const fields: ProposalFields = {};
  const previous: ProposalFields = {};
  const rec = e as unknown as Record<string, unknown>;
  const scalar = (k: 'born' | 'died' | 'date', applies: boolean) => {
    const v = f[k];
    if (v === undefined || !applies) return;
    const cur = rec[k] as string | undefined;
    if (cur !== undefined && sameDate(cur, v, cal)) return;
    if (cur !== undefined && cur.trim() !== '' && cur !== 'unknown') previous[k] = cur;
    fields[k] = v;
  };
  scalar('born', e.type === 'character');
  scalar('died', e.type === 'character');
  scalar('date', e.type === 'event' || e.type === 'note');
  if (f.status !== undefined && e.type === 'character') {
    const cur = statusOf(e);
    if (cur !== f.status) {
      if (cur && cur !== 'unknown') previous.status = cur;
      fields.status = f.status;
    }
  }
  if (f.title !== undefined) {
    const cur = e.details?.['title'] ?? e.extra?.['title'];
    if (typeof cur !== 'string' || normalizeName(cur) !== normalizeName(f.title)) {
      if (typeof cur === 'string' && cur.trim()) previous.title = cur;
      if (!normalizeName(e.name).startsWith(normalizeName(f.title) + ' ')) fields.title = f.title;
    }
  }
  // Occupation and gender only fill a gap: the story never overrides what the entry says.
  if (e.type === 'character') {
    for (const k of ['occupation', 'gender'] as const) {
      const cur = e.details?.[k];
      if (f[k] !== undefined && (typeof cur !== 'string' || !cur.trim())) fields[k] = f[k];
    }
  }
  if (f.place !== undefined && e.type === 'event') {
    const cur = e.place;
    if (!cur || refId(ix, cur) !== refId(ix, f.place)) {
      if (cur) previous.place = cur;
      fields.place = f.place;
    }
  }
  const names = new Set([e.name, ...(e.aliases ?? [])].map(normalizeName));
  const aliases = (f.aliases ?? []).filter((a) => !names.has(normalizeName(a)));
  if (aliases.length) fields.aliases = aliases;
  const rels = (f.relations ?? []).filter((r) => {
    const target = refId(ix, r.target);
    if (target === e.id) return false;
    const has = (e.relations ?? []).some((x) => x.type === r.type && refId(ix, x.target) === target);
    const t = ix.resolve(target);
    const inverse = r.type === 'spouse-of' && t?.relations?.some((x) => x.type === 'spouse-of' && refId(ix, x.target) === e.id);
    const parent = r.type === 'child-of' && t?.relations?.some((x) => x.type === 'parent-of' && refId(ix, x.target) === e.id);
    return !has && !inverse && !parent;
  });
  if (rels.length) fields.relations = rels;
  if (e.type === 'event') {
    const parts = (f.participants ?? []).filter((p) => !(e.participants ?? []).some((x) => refId(ix, x.id) === refId(ix, p)));
    if (parts.length) fields.participants = parts;
    const acts = (f.actions ?? []).filter((a) => !(e.actions ?? []).some((x) => x.verb === a.verb && refId(ix, x.actor) === refId(ix, a.actor) && (x.target ? refId(ix, x.target) : '') === (a.target ? refId(ix, a.target) : '')));
    if (acts.length) fields.actions = acts;
  }
  return { fields, previous };
}

const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);

export interface Reconciled {
  /** Open proposals, in the order they appear in the story. */
  proposals: Proposal[];
  /** Proposals the author ignored (still matched, so warnings can skip them). */
  ignored: Proposal[];
  /** Raw proposals that matched an entry and add nothing: plain links. */
  links: { entryId: string; sourceSpan: SourceSpan }[];
}

/**
 * Match raw proposals against the world. Same name + same type merges into one proposal; a name that
 * exists as another type is a link, not a duplicate.
 */
export function reconcile(world: World, raw: readonly RawProposal[]): Reconciled {
  const ix = new WorldIndex(world);
  const byKey = new Map<string, Proposal>();
  const links: Reconciled['links'] = [];
  // Merge all mentions of the same thing first, so fields from different sentences add up.
  const groups = new Map<string, RawProposal & { alsoAt: SourceSpan[]; existing?: Entry }>();
  for (const r of raw) {
    const existing = findExisting(ix, r.name, r.entryType);
    if (existing && existing.type !== r.entryType) {
      links.push({ entryId: existing.id, sourceSpan: r.sourceSpan });
      continue;
    }
    const g = existing ? `id:${existing.id}` : `new:${r.entryType}:${key(r.name)}`;
    const cur = groups.get(g);
    if (!cur) {
      groups.set(g, { ...r, fields: structuredClone(r.fields), alsoAt: [], ...(existing ? { existing } : {}) });
      continue;
    }
    const hadNoFields = !Object.keys(cur.fields).length && Object.keys(r.fields).length > 0;
    mergeFields(cur.fields, r.fields);
    cur.confidence = Math.max(cur.confidence, r.confidence);
    if (cur.sourceSpan.start !== r.sourceSpan.start || cur.sourceSpan.chapter !== r.sourceSpan.chapter) {
      const spans = [cur.sourceSpan, ...cur.alsoAt];
      if (!spans.some((s) => s.start === r.sourceSpan.start && s.chapter === r.sourceSpan.chapter)) {
        // Quote the sentence that says something about it, not a bare mention.
        if (hadNoFields) {
          cur.alsoAt.push(cur.sourceSpan);
          cur.sourceSpan = r.sourceSpan;
          cur.pattern = r.pattern;
        } else cur.alsoAt.push(r.sourceSpan);
      }
    }
  }
  // A name proposed as two types (Qarim as place and as person) keeps the surer one.
  const best = new Map<string, string>();
  for (const [g, r] of groups) {
    if (r.existing) continue;
    const k = key(r.name);
    const other = best.get(k);
    if (!other || groups.get(other)!.confidence < r.confidence) best.set(k, g);
  }
  for (const [g, r] of groups) {
    const { alsoAt, existing, ...rest } = r;
    const extra = alsoAt.length ? { alsoAt } : {};
    if (!existing) {
      if (best.get(key(r.name)) !== g) continue;
      const k = `create:${r.entryType}:${key(r.name)}`;
      byKey.set(k, { ...rest, ...extra, key: k, kind: 'create' });
      continue;
    }
    const d = diff(ix, existing, r.fields);
    if (!Object.keys(d.fields).length) {
      links.push({ entryId: existing.id, sourceSpan: r.sourceSpan });
      continue;
    }
    const k = `update:${existing.id}:${stable(d.fields)}`;
    const p: Proposal = { ...rest, ...extra, key: k, kind: 'update', name: existing.name, fields: d.fields, matchedExistingId: existing.id };
    if (Object.keys(d.previous).length) p.previous = d.previous;
    byKey.set(k, p);
  }
  const ignoredKeys = new Set((world.storyIgnored ?? []).map((i) => i.key));
  const all = [...byKey.values()].sort((a, b) => chapterIndex(world, a) - chapterIndex(world, b) || a.sourceSpan.start - b.sourceSpan.start || a.name.localeCompare(b.name));
  return { proposals: all.filter((p) => !ignoredKeys.has(p.key)), ignored: all.filter((p) => ignoredKeys.has(p.key)), links };
}

function chapterIndex(world: World, p: Proposal): number {
  return (world.story ?? []).findIndex((c) => c.file === p.sourceSpan.chapter);
}
