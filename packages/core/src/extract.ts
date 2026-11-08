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
/**
 * Words that start sentences, mostly in dialogue, without being names there: questions ("Are you sure?"), commands
 * ("Remember the smell."), numbers and amounts. Only a sentence's first word is checked, so "said Will" can still be a name.
 */
const COMMON_START = new Set([
  'Am', 'Are', 'Is', 'Was', 'Were', 'Be', 'Been', 'Do', 'Does', 'Did', 'Can', 'Could', 'Will', 'Would', 'Shall', 'Should', 'Might', 'Must',
  'Have', 'Has', 'Had', 'Let', 'Come', 'Go', 'Look', 'Listen', 'Hear', 'Wait', 'Stop', 'Remember', 'Forget', 'Make', 'Take', 'Sit', 'Stand',
  'Follow', 'Keep', 'Stay', 'Run', 'Get', 'Give', 'Tell', 'See', 'Watch', 'Hold', 'Help', 'Try', 'Find', 'Bring', 'Leave', 'Put', 'Turn',
  'Move', 'Walk', 'Hurry', 'Hush', 'Climb', 'Drink', 'Eat', 'Sleep', 'Rest', 'Open', 'Close', 'Mind', 'Show', 'Ask', 'Say', 'Sing',
  'Breathe', 'Trust', 'Believe', 'Think', 'Imagine', 'Promise', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Hundred', 'Hundreds', 'Thousand', 'Thousands', 'Half', 'Dozens', 'Much', 'More',
  'Less', 'Enough', 'Good', 'Bad', 'Low', 'High', 'Very', 'Too', 'Just', 'Almost', 'Better', 'Best', 'Little', 'Same', 'Sure', 'Right',
  'Back', 'Up', 'Down', 'Off', 'Out', 'Away', 'Together', 'Ready', 'Fine', 'Okay', 'Quiet', 'Quick', 'Careful', 'Easy', 'Steady',
  'Whatever', 'Whoever', 'Somehow', 'Anyway', 'Besides', 'Otherwise', 'Already', 'Rather', 'Quite', 'Sorry', 'Near', 'Far', 'Past',
  'Beside', 'Between', 'Beneath', 'Underneath', 'Despite', 'Except', 'Like', 'Unlike', 'Onto', 'Halfway', 'Ahead', 'Afterwards',
  'Afterward', 'Overhead', 'Downstairs', 'Upstairs', 'Nearby', 'Elsewhere', 'Abroad', 'Alone', 'Twice', 'People', 'Men', 'Women',
]);
/** "I'm", "We'll", "Don't": contractions, never names. */
const CONTRACTION = /^(?:I|You|We|They|He|She|It|That|There|Here|Who|What|Where|How|Let)['’](?:m|ll|ve|re|d|s)$|n['’]t$/u;
/**
 * The plain forms a capitalised word may come from: "Bells" from bell, "Foxes" from fox, "Stories" from story,
 * "Flying" from fly, "Running" from run, "Making" from make. A sentence-initial word whose plain form the chapter
 * uses in lowercase is that common word, not a name.
 */
function plainForms(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  if (w.length > 4 && /[^s]s$/.test(w)) out.push(w.slice(0, -1));
  if (/(?:s|x|z|ch|sh)es$/.test(w)) out.push(w.slice(0, -2));
  if (w.length > 4 && w.endsWith('ies')) out.push(`${w.slice(0, -3)}y`);
  if (w.length > 5 && w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    out.push(stem, `${stem}e`);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) out.push(stem.slice(0, -1));
  }
  return out;
}
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
/**
 * More thing words, only for capitalised names ("the Copper Paddle", "the Red Kite"): as plain words they are
 * too everyday ("took the rope") to make an item of.
 */
const ITEM_HEADS = [
  'Paddle', 'Oar', 'Rope', 'Kite', 'Wings', 'Bowl', 'Basket', 'Satchel', 'Saddle', 'Bridle', 'Blanket', 'Tapestry', 'Statue', 'Figurine',
  'Doll', 'Clock', 'Spyglass', 'Telescope', 'Lens', 'Quill', 'Letter', 'Journal', 'Diary', 'Ledger', 'Chart', 'Atlas', 'Shell', 'Skull',
  'Egg', 'Cane', 'Pipe', 'Wagon', 'Cart', 'Chariot', 'Ship', 'Boat', 'Raft', 'Barge', 'Galley', 'Token', 'Badge', 'Sigil', 'Rune',
  'Runestone', 'Totem', 'Charm', 'Box', 'Coffer', 'Vial', 'Flask', 'Bottle', 'Jar', 'Needle', 'Loom', 'Spindle', 'Anvil', 'Chain', 'Chains',
  'Collar', 'Hat', 'Scarf', 'Coat', 'Gown', 'Wheel', 'Engine', 'Machine', 'Automaton',
];
/** Weapon and thing nouns for "a sword called Dawnbreaker", "a ship named the Grumbling Gull". */
const ITEM_NOUNS = [...new Set([...ITEM_WORDS, ...ITEM_HEADS].map((w) => w.toLowerCase()))];
/** Group words: "the Order of the Silver Flame", "the Thieves' Guild", "House Varr". */
const FACTION_WORDS = [
  'Order', 'Guild', 'Brotherhood', 'Sisterhood', 'Clan', 'Clans', 'Tribe', 'Tribes', 'House', 'Legion', 'Company', 'Circle', 'Council',
  'Cult', 'Church', 'League', 'Alliance', 'Covenant', 'Watch', 'Guard', 'Army', 'Fleet', 'Society', 'Syndicate', 'Brethren', 'Horde',
  'Knights', 'Riders', 'Fellowship', 'Coven', 'Conclave', 'Senate', 'Dynasty', 'Faction', 'Confederacy', 'Federation', 'Union', 'Band',
  // groups named after what their members do: "the Well Wardens", "the Seven Founders", "the Saffron Caravan"
  'Caravan', 'Crew', 'Wardens', 'Founders', 'Heralds', 'Keepers', 'Watchers', 'Rangers', 'Hunters', 'Seekers', 'Sentinels', 'Defenders',
  'Guardians', 'Champions', 'Elders', 'Sisters', 'Brothers', 'Children', 'Sons', 'Daughters', 'Priesthood', 'Clergy', 'Navy', 'Militia',
  'Regiment', 'Battalion', 'Squad', 'Assembly', 'Cabal', 'Gang', 'Family', 'Court', 'Host', 'Pack', 'Folk', 'Raiders', 'Bandits', 'Pirates',
  'Rebels', 'Nomads', 'Wanderers', 'Pilgrims', 'Monks', 'Priests', 'Mages', 'Wizards', 'Witches', 'Druids', 'Guards', 'Soldiers', 'Warriors',
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
const PLACE_BEFORE = /(?:^|[^\p{L}])(?:in|at|near|into|across|through|beyond|toward|towards|reached|entered|visited|left|out[ \t]+of)[ \t]+$/u;
const PLACE_WORDS = [
  'City', 'Town', 'Village', 'Kingdom', 'Realm', 'Land', 'Lands', 'Isle', 'Island', 'Isles', 'Islands', 'Fortress', 'Castle', 'Oasis', 'Port', 'Valley',
  'Desert', 'Mountain', 'Mountains', 'Peak', 'Forest', 'Woods', 'River', 'Lake', 'Sea', 'Bay', 'Coast', 'Harbour', 'Harbor', 'Citadel', 'Keep',
  'Temple', 'Shrine', 'Abbey', 'Monastery', 'Pass', 'Plains', 'Dunes', 'Marsh', 'Marshes', 'Swamp', 'Hills', 'Caves', 'Mines', 'Springs',
  'Palace', 'Ruins', 'Bazaar', 'Wastes', 'Steppe', 'Gulf', 'Strait', 'Canyon', 'Gorge', 'Cliffs', 'Reach', 'Highlands', 'Lowlands',
];
/**
 * More place words, only as the last word of a capitalised name ("Hollin Wood", "the Copper Market", "the Hall of
 * Heroes"). Unlike the words above, "the Hall of Heroes" names the hall, not a place called Heroes.
 */
const PLACE_HEADS = [
  'Wood', 'Grove', 'Glade', 'Edge', 'Farm', 'Farmstead', 'Mill', 'Pond', 'Tarn', 'Pool', 'Well', 'Wells', 'Spring', 'Fountain', 'Ridge', 'Hill',
  'Mount', 'Crag', 'Cliff', 'Bluff', 'Summit', 'Vale', 'Dale', 'Glen', 'Hollow', 'Heath', 'Moor', 'Moors', 'Fen', 'Fens', 'Field', 'Fields',
  'Meadow', 'Meadows', 'Orchard', 'Garden', 'Gardens', 'Market', 'Square', 'Plaza', 'Hall', 'Tower', 'Towers', 'Gate', 'Gates', 'Bridge',
  'Road', 'Street', 'Lane', 'Quarter', 'District', 'Docks', 'Wharf', 'Pier', 'Inn', 'Tavern', 'Erg', 'Sands', 'Shore', 'Shores', 'Beach',
  'Cove', 'Lagoon', 'Reef', 'Delta', 'Falls', 'Ford', 'Cave', 'Cavern', 'Caverns', 'Grotto', 'Chasm', 'Rift', 'Crater', 'Volcano', 'Glacier',
  'Jungle', 'Badlands', 'Barrens', 'Basin', 'Plateau', 'Cape', 'Spire', 'Sanctum', 'Sanctuary', 'Chapel', 'Cathedral', 'Library', 'Academy',
  'Barracks', 'Prison', 'Dungeon', 'Crypt', 'Tomb', 'Catacombs', 'Manor', 'Estate', 'Lodge', 'Cottage', 'Hold', 'Stronghold', 'Bastion',
  'Outpost', 'Camp', 'Colony', 'Hamlet', 'Shire', 'County', 'Province', 'Empire', 'Ocean', 'Tundra', 'Wilds', 'Wilderness', 'Waste',
  'Reaches', 'Heights', 'Downs', 'Fjord', 'Loch', 'Stream', 'Brook', 'Creek', 'Rapids', 'Ravine', 'Gap', 'Mesa', 'Point',
];
/** First words that make the rest a place: "Mount Zeh", "Lake Ardent", "Fort Wren". */
const PLACE_PREFIX = new Set(['Mount', 'Mt', 'Lake', 'Loch', 'Fort', 'Port', 'Cape', 'Isle', 'Castle', 'River']);
/** One-word names after "the" that end like a place or a group: "the Millpond", "the Tarnwater", "the Bellguard". */
const PLACE_SUFFIX = /(?:wood|woods|water|waters|sea|pond|mere|ford|port|haven|hold|keep|gate|bridge|mouth|dale|vale|moor|marsh|fen|field|fields|hollow|crest|peak|spire|cliff|cliffs|falls|well|wells|spring|springs|burg|borough|stead|holm|shire|reach|tarn|lake|crag|fell|ridge|hill|hills|cairn|crown|top|deep|deeps)$/;
const FACTION_SUFFIX = /(?:guard|watch|hood)$/;
/** Words before a name with "the" that make it a place: "in the Red Erg", "behind The Snowcrown", "reached the Moon Well". */
const SPATIAL_THE = /(?:^|[^\p{L}])(?:in|at|into|inside|near|across|through|beyond|toward|towards|onto|past|around|beneath|below|above|along|within|outside|over|under|behind|beside|throughout|upon|reached|reaching|entered|entering|visited|crossed|crossing|climbed|climbing|left|leaving)[ \t]+(?:the[ \t]+)?$/iu;
/** "from" and "to" also go before people ("a gift to the Heron"), so they only count for longer or place-like names. */
const FROM_TO_THE = /(?:^|[^\p{L}])(?:from|to)[ \t]+(?:the[ \t]+)?$/iu;
/** "looked back at Yusuf", "smiled at Leyla": at a person, not a place. */
const LOOK_AT = /(?:look|stare|glance|gaze|peer|smile|grin|laugh|frown|wave|nod|point|shout|yell|bark|snap|growl|hiss|sneer|wink|scowl|blink|squint|swear|curse|call|scream|howl|spit|aim|throw|tug|pull|wag|glare|sniff|lick|snarl|whistle|sigh|beam|rage)[a-z]*(?:[ \t]+(?:back|up|down|over|across|around|round|hard|again|only|just|straight|right|directly|sharply|coldly|sadly|kindly|still|now))?[ \t]+at[ \t]+$/i;
/** Speech next to a name makes it a person: "said Brook", "Glen asked". */
const SPEECH_BEFORE = /(?:^|[^\p{L}])(?:said|asked|whispered|shouted|cried|replied|answered|called|muttered|murmured|laughed|sighed|added|snapped|growled|told)[ \t]+$/u;
const SPEECH_AFTER = /^[ \t]+(?:said|asks|asked|says|whispered|shouted|cried|replied|answered|called|muttered|murmured|laughed|sighed|added|snapped|growled|nodded|smiled|frowned|told)(?![\p{L}])/u;
/** "-ing" words that are not happenings: "the Morning of the Feast" is a time, not an event. */
const NOT_EVENT_ING = new Set(['Morning', 'Evening', 'King', 'Ring', 'Thing', 'Wing', 'String', 'Sling', 'Spring', 'Darling', 'Sibling', 'Ceiling', 'Offspring', 'Viking', 'Clothing', 'Something', 'Nothing', 'Everything', 'Anything', 'Lightning', 'Building', 'Painting', 'Writing', 'Ending', 'Beginning', 'Being']);
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
/** More happenings, only when capitalised ("the Great Rockfall", "the Feast of Bells"): "the storm at dawn" is weather. */
const EVENT_HEADS = [
  'Rockfall', 'Avalanche', 'Landslide', 'Storm', 'Tempest', 'Earthquake', 'Quake', 'Eruption', 'Drought', 'Blight', 'Pestilence', 'Feast',
  'Festival', 'Wedding', 'Funeral', 'Trial', 'Trials', 'Tournament', 'Games', 'Contest', 'Hunt', 'Harvest', 'Migration', 'Voyage', 'Expedition',
  'Exile', 'Schism', 'Sundering', 'Cataclysm', 'Catastrophe', 'Collapse', 'Purge', 'Reckoning', 'Awakening', 'Ascension', 'Accord', 'Pact',
  'Ceremony', 'Rite', 'Ritual', 'Celebration', 'Murder', 'Assassination', 'Execution', 'Betrayal', 'Rescue',
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

// Pattern pieces built once. The sentence loop runs for every sentence of every chapter, and building these
// word lists there again was a third of the time a story check took.
const ROLES_ALT = either(ROLES);
const ITEM_WORDS_EITHER = either(ITEM_WORDS);
const EVENT_EITHER = either(EVENT_WORDS);
const KILL_ALT = KILL_VERBS.join('|');
const DEEDS_ALT = Object.keys(PLACE_DEEDS).join('|');
const FACTION_VERBS_ALT = Object.keys(FACTION_VERBS).join('|');
const ITEM_VERBS_ALT = Object.keys(ITEM_VERBS).join('|');
const ITEM_NOUNS_ALT = ITEM_NOUNS.join('|');
const ITEM_WORDS_ALT = ITEM_WORDS.join('|');
const PLACE_NOUNS_ALT = PLACE_NOUNS.join('|');
const PLACE_WORDS_ALT = PLACE_WORDS.join('|');
const PLACE_WORDS_LOWER_ALT = PLACE_WORDS.map((w) => w.toLowerCase()).join('|');
// The group word is the name's last capitalised word: "the Order Hall" is a hall, not "the Order".
const FACTION = `((?:[Tt]he${S})?(?:(?:${FACTION_PREFIX.join('|')})${S}(?!of\b)${CAP}(?!${S}of${S})|(?:${CAP}${S}){0,3}(?:${FACTION_WORDS.join('|')})(?!${S}\\p{Lu})(?:${S}of${S}(?:the${S})?${NAME})?))${END}`;
const PLACE_HEADS_ALT = PLACE_HEADS.join('|');
const ROLE_PHRASE = `((?:${WORD}${S}){0,3}?(?:${ROLES_ALT}))${END}`;
/** "... of Qarim", "... at the Ford": an event pattern names it; "the Hero Trials of 527" stays a name of its own. */
const AFTER_OF_ON_AT_NAME = new RegExp(`^${S}(?:of|on|at)${S}(?:the${S})?\\p{Lu}`, 'u');
const AFTER_OF = new RegExp(`^${S}of${S}`, 'u');
const ITEM_HEADS_ALT = ITEM_HEADS.join('|');
const EVENT_HEADS_ALT = EVENT_HEADS.join('|');
const ITEM_SET = new Set([...ITEM_WORDS, ...ITEM_HEADS]);
const PLACE_SET = new Set([...PLACE_WORDS, ...PLACE_HEADS]);
const EVENT_SET = new Set([...EVENT_WORDS, ...EVENT_HEADS]);
const FACTION_SET = new Set(FACTION_WORDS);
/** Words on those lists that are also first names or surnames, so alone they can still be a person ("Glen asked"). */
const NAME_LIKE = new Set(['Glen', 'Heath', 'Cliff', 'Brook', 'Dale', 'Lane', 'Wells', 'Ford', 'Gates', 'Hall', 'Wood', 'Hill', 'Field', 'Fields', 'Rune', 'Charm', 'Hunt', 'Storm', 'Pierce', 'Rose', 'Stone', 'Bell', 'Marsh', 'Moor', 'Shore']);
/** Words before a name that make "X Hall" or "X Wood" a place rather than a person called Hall or Wood: "over Hollin Wood". */
const PLACE_NEAR = /(?:^|[^\p{L}])(?:in|at|near|into|onto|across|through|throughout|beyond|toward|towards|over|under|past|around|beside|behind|beneath|below|above|along|within|outside|reached|entered|visited|left|out[ \t]+of)[ \t]+$/iu;
/** Words a lone capitalised word is too vague to be named by: "the Desert", "the Crown", "the Siege", "Children". */
const VAGUE = new Set([...TITLE_SET, ...ITEM_SET, ...PLACE_SET, ...EVENT_SET, ...FACTION_SET].filter((w) => !NAME_LIKE.has(w)));
/** Thing and event words whose plural opens a sentence as a plain noun ("Engines are ready"); place plurals are surnames too ("Rivers"). */
const THING_PLURALS = new Set([...ITEM_SET, ...EVENT_SET].filter((w) => !NAME_LIKE.has(w)));
/** After a sentence-initial word, an object means it was a command: "Hang it on the bell", "Give me the key". */
const OBJECT_AFTER = /^[ \t]+(?:it|them|him|her|me|us|this|that|these|those|your|my|our|his|their|everyone|everything)(?![\p{L}])/u;
/** Writing in capitals is a sign or a shout ("WHO RINGS ME"), not a name. */
const ALL_CAPS = /^(?:\p{Lu}+[ \t]+)*\p{Lu}{2,}(?:[ \t]+\p{Lu}+)*$/u;

/**
 * A name that cannot be a person: "House Tarn", "the Seven Founders", "the Great Rockfall". A last word that is
 * also a surname ("Edmund Hall", "Elena Wood") does not count.
 */
function notAPerson(name: string): boolean {
  const words = name.split(' ');
  if (!kindByWords(words)) return false;
  if (FACTION_PREFIX.includes(words[0]!) || PLACE_PREFIX.has(words[0]!)) return true;
  return !NAME_LIKE.has(words[words.length - 1]!);
}

/** A name whose words say it is a group, a thing or an event: "at the Copper Paddle", "the Captain of The Bellguard". */
function otherThanPlace(name: string): boolean {
  const words = name.split(' ');
  const kind = kindByWords(words);
  return (kind !== undefined && kind !== 'place') || (words.length === 1 && name.length > 7 && FACTION_SUFFIX.test(name.toLowerCase()));
}

/** What a name is by its last word ("Hollin Wood", "the Seven Founders", "the Copper Paddle", "the Great Storm"), or a first word like "Mount". */
function kindByWords(words: readonly string[]): 'event' | 'faction' | 'item' | 'place' | undefined {
  if (words.length < 2) return undefined;
  const head = words[words.length - 1]!;
  if (EVENT_SET.has(head)) return 'event';
  if (FACTION_SET.has(head) || FACTION_PREFIX.includes(words[0]!)) return 'faction';
  if (ITEM_SET.has(head)) return 'item';
  if (PLACE_SET.has(head) || PLACE_PREFIX.has(words[0]!)) return 'place';
  return undefined;
}

// Quick checks for the words a pattern cannot match without: a sentence that lacks them skips the pattern.
// Each one only has to be true whenever its pattern can match, so skipping never changes a result.
const HAS = {
  born: /born/,
  death: /died|perished|passed|killed|slew|slain|murdered|executed|assassinated/,
  married: /married|wed/,
  childOf: /(?:son|daughter|child|heir)[ \t]+of/,
  of: /[ \t]of[ \t]/,
  event: new RegExp(`(?:${EVENT_EITHER}|${EVENT_HEADS_ALT})[ \\t]+(?:of|on|at)[ \\t]`, 'u'),
  gerundOf: /\p{Lu}\p{Ll}{2,}ing[ \t]+of[ \t]/u,
  deed: new RegExp(DEEDS_ALT),
  motion: new RegExp(MOTION),
  placeNoun: new RegExp(PLACE_NOUNS_ALT),
  placeOf: /the[ \t]+(?:gates|walls|streets|ruins|markets|harbour|harbor|towers|halls|road|roads|way|throne|people|sands|dunes)[ \t]+(?:of|to)[ \t]/,
  itemNoun: new RegExp(ITEM_NOUNS_ALT),
  faction: new RegExp(`${FACTION_PREFIX.join('|')}|${FACTION_WORDS.join('|')}`),
  factionVerb: new RegExp(FACTION_VERBS_ALT),
  memberOf: /(?:member|knight|servant|soldier|brother|sister|leader|head|founder|master)[ \t]+of/,
  itemWord: new RegExp(`${ITEM_WORDS_ALT}|${ITEM_HEADS_ALT}`),
  role: new RegExp(ROLES_ALT, 'u'),
  itemVerb: new RegExp(ITEM_VERBS_ALT),
};

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

/** Stop words that also start names when a place or group word follows: "the Night Market", "the Well Wardens", "the Long Paddle". */
const STOP_IN_NAMES = new Set(['Well', 'Long', 'First', 'Last', 'Night', 'Dawn', 'Dusk', 'Morning', 'Evening', 'Midnight', 'Noon']);
const keepsStop = (words: readonly string[]) => STOP_IN_NAMES.has(words[0]!) && words.length > 1 && kindByWords(words) !== undefined;

/** "King camel" -> { name: "Camel", title: "King", raw: "King camel" }; leading stop words go. */
function cleanName(raw: string): { name: string; title?: string; raw: string } | undefined {
  const words = raw.trim().split(/[ \t]+/);
  while (words.length && STOP.has(words[0]!) && !keepsStop(words)) words.shift();
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
  // The sentence patterns, as tagged templates: each is compiled once per chapter (its parts are the chapter's
  // constants) instead of once per sentence, which was most of the time a story check took. A shared regex starts
  // each use at index 0, as a fresh one did (matchAll works on its own copy; exec reads lastIndex).
  const sites = new Map<TemplateStringsArray, { values: unknown[]; re: RegExp }>();
  const rx = (strings: TemplateStringsArray, ...values: unknown[]): RegExp => {
    const hit = sites.get(strings);
    if (hit && hit.values.every((v, i) => v === values[i])) {
      hit.re.lastIndex = 0;
      return hit.re;
    }
    const re = new RegExp(strings.reduce((src, part, i) => src + String(values[i - 1]) + part), 'gu');
    sites.set(strings, { values, re });
    return re;
  };
  const notPlace = (n: string) => p.months.has(n) || p.eras.has(n) || TITLE_SET.has(n.split(' ')[0]!) || STOP.has(n) || /['’]s$/.test(n);

  /** The one person the previous sentences were about, for "he"/"she"; undefined when unclear. */
  let last: string | undefined;
  const lowerWords = new Set((ch.body.match(/(?<![\p{L}])\p{Ll}[\p{L}'’-]*/gu) ?? []));
  for (const s of sentences(ch.body)) {
    const named = new Set<string>();
    const span: SourceSpan = { chapter: ch.file, start: s.start, end: s.start + s.text.length, quote: s.text.length > 240 ? `${s.text.slice(0, 237)}...` : s.text };
    const dates = [...s.text.matchAll(p.datePhrase)].map((m) => toDate(m[1], cal)).filter((d): d is string => !!d);
    const sentenceDate = dates.length === 1 ? dates[0] : undefined;
    const sentencePlace = [...s.text.matchAll(rx`${START}(?:in|at)${S}${PLACE}`)].map((m) => m[1]!).find((n) => !notPlace(n) && !STOP.has(n));
    const add = (r: Omit<RawProposal, 'sourceSpan'>) => proposals.push({ ...r, sourceSpan: span });
    const person = (rawIn: string, fields: ProposalFields, pattern: string, confidence = 0.9): string | undefined => {
      const split = ix.resolve(rawIn.trim()) ? { raw: rawIn } : splitRole(rawIn);
      const raw = split.raw;
      const n = cleanName(raw);
      if (!n) return undefined;
      // "Lady Mira of House Tarn was born": House Tarn is not the one born.
      if (!ix.resolve(raw.trim()) && notAPerson(n.name)) return undefined;
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
      if (!n || n.title || notPlace(n.name) || otherThanPlace(n.name)) return undefined;
      add({ entryType: 'place', name: n.name, fields: {}, confidence, pattern });
      return n.name;
    };

    const text = s.text;
    const hasDeath = HAS.death.test(text);
    const hasOf = HAS.of.test(text);
    const hasFaction = HAS.faction.test(text);
    // born: "King Camel was born in Qarim in 1998", "Camel, son of Leyla, was born in 1998"
    if (HAS.born.test(text)) for (const m of text.matchAll(rx`${P}(?:${S}of${S}(?:the${S})?${NAME})?(?:,[^,]{1,60},)?${S}(?:was${S})?born${LOC}(?:${S}${DP})?`)) {
      const born = toDate(m[3], cal) ?? sentenceDate;
      const where = place(m[2], 'born');
      if (!born && !where) continue;
      person(m[1]!, born ? { born } : {}, 'born');
    }
    // died: "Camel died in 2050", "Camel was slain at Qarim"
    if (hasDeath) for (const m of text.matchAll(rx`${P}(?:${S}of${S}(?:the${S})?${NAME})?(?:,[^,]{1,60},)?${S}(?:died|perished|passed${S}away|was${S}(?:killed|slain|murdered|executed))(?!${S}by)${LOC}(?:${S}${DP})?`)) {
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
    if (hasDeath) {
      for (const m of text.matchAll(rx`${P}${S}(${KILL_ALT})${S}${P}${LOC}(?:${S}${DP})?`)) killed(m[1]!, m[2]!, m[3]!, m[4], m[5]);
      for (const m of text.matchAll(rx`${P}${S}was${S}(killed|slain|murdered|executed|assassinated)${S}by${S}${P}${LOC}(?:${S}${DP})?`)) {
        killed(m[3]!, m[2] === 'slain' ? 'slew' : m[2]!, m[1]!, m[4], m[5]);
      }
    }
    // married: "Camel married Leyla in 1950"
    if (HAS.married.test(text)) for (const m of text.matchAll(rx`${P}${S}(?:married|wed)${S}${P}(?:${S}${DP})?`)) {
      const other = person(m[2]!, {}, 'married', 0.7);
      if (!other) continue;
      const rel: Relation = { type: 'spouse-of', target: other };
      const from = toDate(m[3], cal) ?? sentenceDate;
      if (from) rel.from = from;
      person(m[1]!, { relations: [rel] }, 'married');
    }
    // son/daughter/child of: "Camel, son of Leyla", "Camel was the daughter of Leyla"
    if (HAS.childOf.test(text)) for (const m of text.matchAll(rx`${P}(?:,|${S}(?:was|is))${S}(?:the${S})?(?:son|daughter|child|heir)${S}of${S}${P}`)) {
      const parent = person(m[2]!, {}, 'child-of', 0.7);
      if (parent) person(m[1]!, { relations: [{ type: 'child-of', target: parent }] }, 'child-of');
    }
    // the X of Place: "Ilsa, the Salt Queen of Saltmere", "the Sultan of Qarim", "the City of Brass"
    if (hasOf) {
      for (const m of text.matchAll(rx`${P},${S}the${S}((?:${CAP}${S}){0,2}${CAP})${S}of${S}(?:the${S})?${PLACE}`)) {
        const where = place(m[3], 'title-of', 0.7);
        person(m[1]!, { title: where ? `${m[2]} of ${where}` : m[2]! }, 'title-of', 0.8);
      }
      for (const m of text.matchAll(rx`${START}(?:${TITLE}|${PLACE_WORDS_ALT})${S}of${S}(?:the${S})?${PLACE}`)) place(m[1], 'title-of', 0.7);
      // "the Hall of Heroes", "The Square of Bells", "the Ridge of the Seven": the whole name is the place
      for (const m of text.matchAll(rx`${START}[Tt]he${S}((?:${CAP}${S}){0,2}(?:${PLACE_HEADS_ALT})${S}of${S}(?:the${S})?${NAME})${END}`)) {
        add({ entryType: 'place', name: `The ${m[1]!.replace(/[ \t]+/g, ' ')}`, fields: {}, confidence: 0.6, pattern: 'place-name' });
      }
    }
    // battle/war/siege of X: an event, "in DATE" next to it or anywhere in the sentence
    if (HAS.event.test(text)) for (const m of text.matchAll(rx`${START}(?:[Tt]he${S})?(${EVENT_EITHER}|${EVENT_HEADS_ALT})${S}(?:of|on|at)${S}(?:the${S})?(${NAME})(?:${S}${DP})?`)) {
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
    // "the Ringing of the Bell", "The Passing of the Bell": a capitalised "-ing of" names a happening
    if (hasOf && HAS.gerundOf.test(text)) for (const m of text.matchAll(rx`${START}[Tt]he${S}(\\p{Lu}\\p{Ll}{2,}ing)${S}of${S}(the${S})?(${NAME})`)) {
      if (NOT_EVENT_ING.has(m[1]!)) continue;
      const target = cleanName(m[3]!)?.name;
      if (!target) continue;
      const the = m[2] || /^the[ \t]/i.test(m[3]!) ? 'the ' : '';
      add({ entryType: 'event', name: `The ${m[1]} of ${the}${target}`, fields: sentenceDate ? { date: sentenceDate } : {}, confidence: 0.6, pattern: 'event-ing' });
    }
    // a deed at a place: "Hadi fought at Saltmere in 1920" -> The Battle of Saltmere, with its place, date and people
    if (HAS.deed.test(text)) for (const m of text.matchAll(rx`${P}(?:,[^,]{1,60},)?${S}(${DEEDS_ALT})(?:${S}(at|in|on|near|outside|before))?${S}(?:the${S}(?:${PLACE_NOUNS_ALT})${S}of${S})?${PLACE}(?:${S}${DP})?`)) {
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
    if (HAS.motion.test(text)) for (const m of text.matchAll(rx`${START}(?:${MOTION})(?:${S}(?:back|home|north|south|east|west|on))?${S}(?:to|into|toward|towards|for|from|at|in|out${S}of)${S}(?:the${S}(?:${PLACE_NOUNS_ALT})${S}of${S})?${PLACE}`)) {
      const n = cleanName(m[1]!);
      if (!n || findExisting(ix, n.name, 'character')) continue;
      place(m[1], 'motion', 0.5);
    }
    if (HAS.placeNoun.test(text) && text.includes(',')) for (const m of text.matchAll(rx`${START}${PLACE},${S}(?:a|an|the)${S}(?:${WORD}${S}){0,2}?(?:${PLACE_NOUNS_ALT})${END}`)) {
      if (!/^[\s"'“‘(]*$/.test(text.slice(0, m.index!)) && !/[,;:][ \t]*$/.test(text.slice(0, m.index!))) continue;
      place(m[1], 'place-is', 0.8);
    }
    if (HAS.placeOf.test(text)) for (const m of text.matchAll(rx`${START}the${S}(?:gates|walls|streets|ruins|markets|harbour|harbor|towers|halls|road|roads|way|throne|people|sands|dunes)${S}(?:of|to)${S}${PLACE}`)) place(m[1], 'place-of', 0.55);
    // named things: "a sword called Dawnbreaker", "her blade, Nightfall,"
    if (HAS.itemNoun.test(text)) for (const m of text.matchAll(rx`${START}(?:a|an|the|his|her|their|its|my)${S}(?:${WORD}${S}){0,2}?(${ITEM_NOUNS_ALT})(?:${S}(?:called|named|known${S}as)${S}|,${S})(?:the${S})?(${NAME})(?=[ \t]*(?:[,.;:!?]|$|${S}(?:and|which|that)${END}))`)) {
      const n = cleanName(m[2]!);
      if (!n || n.title || findExisting(ix, n.name, 'character')?.type === 'character') continue;
      const comma = !/called|named|known/.test(m[0]);
      if (comma && !findExisting(ix, n.name)) continue; // "his sword, Leyla," is too unsure unless the item exists
      add({ entryType: 'item', name: n.name, fields: {}, confidence: comma ? 0.6 : 0.8, pattern: 'item-named' });
    }
    // "the Sunblade, a sword forged by the smiths": a named thing, and what kind of thing it is
    if (HAS.itemNoun.test(text) && text.includes(',')) for (const m of text.matchAll(rx`${START}[Tt]he${S}(${NAME}),${S}(?:a|an|the)${S}(?:${WORD}${S}){0,2}?(?:${ITEM_NOUNS_ALT})${END}`)) {
      const n = cleanName(m[1]!);
      if (!n || n.title || findExisting(ix, n.name, 'character')?.type === 'character') continue;
      add({ entryType: 'item', name: `The ${n.name}`, fields: {}, confidence: 0.75, pattern: 'item-is' });
    }
    // factions: "the Order of the Silver Flame", "the Thieves' Guild", "House Varr"; "Hadi joined the Order of ..."
    const factionName = (raw: string): string | undefined => {
      const t = raw.replace(/[ \t]+/g, ' ').replace(/^the /i, '');
      const words = t.split(' ');
      if (words.length < 2 || (STOP.has(words[0]!) && !STOP_IN_NAMES.has(words[0]!)) || TITLE_SET.has(words[0]!)) return undefined;
      const existing = findExisting(ix, t);
      if (existing) return existing.type === 'faction' ? existing.name : undefined;
      return FACTION_PREFIX.includes(words[0]!) && !/ of /.test(t) ? t : `The ${t}`;
    };
    const factions = new Set<string>();
    if (hasFaction) for (const m of text.matchAll(rx`${START}${FACTION}`)) {
      if (!/^the /i.test(m[1]!) && !FACTION_PREFIX.includes(m[1]!.split(/[ \t]/)[0]!)) continue;
      const name = factionName(m[1]!);
      if (!name || factions.has(name)) continue;
      factions.add(name);
      add({ entryType: 'faction', name, fields: {}, confidence: / of /.test(name) ? 0.7 : 0.6, pattern: 'faction' });
    }
    if (hasFaction && HAS.factionVerb.test(text)) for (const m of text.matchAll(rx`${P}(?:,[^,]{1,60},)?${S}(${FACTION_VERBS_ALT})${S}(?:with${S}|against${S}|for${S})?${FACTION}`)) {
      const name = factionName(m[3]!);
      if (name) person(m[1]!, { relations: [{ type: FACTION_VERBS[m[2]!]!, target: name }] }, 'faction-deed', 0.75);
    }
    if (hasFaction && HAS.memberOf.test(text)) for (const m of text.matchAll(rx`${P},${S}(?:a|an|the)${S}(member|knight|servant|soldier|brother|sister|leader|head|founder|master)${S}of${S}${FACTION}`)) {
      const name = factionName(m[3]!);
      const type = /^(?:leader|head|master)$/.test(m[2]!) ? 'leader-of' : m[2] === 'founder' ? 'founded' : 'member-of';
      if (name) person(m[1]!, { relations: [{ type, target: name }] }, 'faction-of', 0.8);
    }
    // items: "the Glass Compass", "the Crown of Thorns"
    // The thing word is the last capitalised word: "the Mirror Tarn" is a tarn, not a mirror.
    if (HAS.itemWord.test(text)) for (const m of text.matchAll(rx`${START}[Tt]he${S}((?:${CAP}${S}){0,3}(?:${ITEM_WORDS_ALT}|${ITEM_HEADS_ALT})(?!${S}\\p{Lu})(?:${S}of${S}(?:the${S})?${NAME})?)${END}`)) {
      if (!/[ \t]/.test(m[1]!)) continue; // "the Crown" alone is too vague
      add({ entryType: 'item', name: `The ${m[1]!.replace(/[ \t]+/g, ' ')}`, fields: {}, confidence: 0.6, pattern: 'item' });
    }
    // in/at Place, but not "looked back at Yusuf"
    for (const m of text.matchAll(rx`${START}(?:in|at|near|into)${S}(?:the${S}(?:${PLACE_WORDS_LOWER_ALT})${S}of${S})?${PLACE}`)) {
      if (/^at[ \t]/.test(m[0]) && LOOK_AT.test(`${text.slice(0, m.index!)}at `)) continue;
      // "in The Square of Bells": the name goes on past "of" (the whole-name pattern has it), so not "Square".
      if (AFTER_OF.test(text.slice(m.index! + m[0].length)) && VAGUE.has(cleanName(m[1]!)?.name ?? '')) continue;
      place(m[1], 'in-place', 0.5);
    }
    // appositives: "Keller the grand magus", "Leyla, the healer," (a capitalised "the Grand Magus" is split in person())
    const hasRole = HAS.role.test(text);
    if (hasRole) for (const m of text.matchAll(rx`${P}${S}the${S}${ROLE_PHRASE}(?!${S}of${END})`)) {
      // Only as the subject ("Keller the magus created"), not "told Leyla the king had died".
      if (!/(?:^[\s"'“‘(]*|[,;:][ \t]*|(?:^|[^\p{L}])and[ \t]+)$/u.test(text.slice(0, m.index!))) continue;
      const role = roleFields(m[2]!);
      if (role) person(m[1]!, role, 'role', 0.8);
    }
    if (hasRole && text.includes(',')) for (const m of text.matchAll(rx`${P},${S}(?:the|a|an)${S}${ROLE_PHRASE}(?=[ \t]*(?:[,.;:!?]|$))`)) {
      const role = roleFields(m[2]!);
      if (role) person(m[1]!, role, 'role', 0.8);
    }
    // deeds with things: "Keller created the scepter", "Leyla found the Glass Compass"
    if (HAS.itemVerb.test(text)) for (const m of text.matchAll(rx`${P}(?:${S}the${S}(?:${WORD}${S}){0,3}?(?:${ROLES_ALT}))?(?:,[^,]{1,60},)?${S}(${ITEM_VERBS_ALT})${S}the${S}((?:${WORD}${S}){0,2}?(?:${ITEM_WORDS_EITHER})(?!${S}\\p{Lu})(?:${S}of${S}(?:the${S})?${NAME})?)${END}`)) {
      const item = `The ${titleCase(m[3]!.replace(/[ \t]+/g, ' '))}`;
      const existing = findExisting(ix, item);
      if (existing && existing.type !== 'item') continue;
      add({ entryType: 'item', name: existing?.name ?? item, fields: {}, confidence: 0.7, pattern: 'item-deed' });
      person(m[1]!, { relations: [{ type: ITEM_VERBS[m[2]!]!, target: existing?.name ?? item }] }, 'item-deed', 0.8);
    }
    // any other capitalised name: a "new entry?" proposal, typed by its last word, then by what stands before it
    for (const m of text.matchAll(rx`${START}${NAME}`)) {
      let before = text.slice(0, m.index!);
      let found = m[0];
      const after = text.slice(m.index! + m[0].length);
      // The first word of a sentence, of a quote inside one (said, "Are we there?") or of *emphasis*.
      const initial = /^[\s"'“‘(*_]*$/.test(before) || /(?:^|[\s,:;(—–-])["'“‘*_]+$/u.test(before);
      // "From the Broken Tooth", "In the Red Erg", "Ring the Hero's Bell" run together into one capitalised run:
      // the name starts after "the". ("Orsan the Grey" stays whole.)
      const glued = /^(\p{Lu}\p{Ll}*)([ \t]+the[ \t]+)(?=\p{Lu})/u.exec(found);
      if (glued && (STOP.has(glued[1]!) || COMMON_START.has(glued[1]!) || kindByWords(found.slice(glued[0].length).split(/[ \t]+/)) !== undefined)) {
        before += glued[0];
        found = found.slice(glued[0].length);
      }
      if (ALL_CAPS.test(found)) continue;
      // "the Heralds' vault": a plural owner, like "Yusuf's"
      const possessive = /['’]s?$/.test(found);
      const split = splitRole(found.replace(/['’]s?$/, ''));
      const n = cleanName(split.raw);
      if (!n) continue;
      if (ALL_CAPS.test(n.name)) continue;
      const words = n.name.split(' ');
      const one = words.length === 1 ? n.name : undefined;
      if (one && VAGUE.has(one)) continue;
      const afterThe = /(?:^|[^\p{L}])the[ \t]+$/iu.test(before) || /^the$/i.test(found.split(/[ \t]+/)[0]!);
      if (one && afterThe && NAME_LIKE.has(one)) continue; // "the Hall" alone, though "Hall said" is a person
      // Speech next to it makes it a person ("said Brook"); otherwise the last word can tell ("Hollin Wood").
      const speech = SPEECH_BEFORE.test(before) || SPEECH_AFTER.test(after);
      let kind = n.title || split.role || speech ? undefined : kindByWords(words);
      // "Edmund Hall", "Ayla Stone" are people unless "the" or a place word says otherwise ("the Great Hall", "over Hollin Wood")
      // ("Hadiya's Bell" names its owner, so it is a thing either way.)
      if (kind && NAME_LIKE.has(words[words.length - 1]!) && !afterThe && !PLACE_PREFIX.has(words[0]!) && !PLACE_NEAR.test(before) && !/['’]s$/.test(words[0]!)) kind = undefined;
      // A stop word inside a person's name means two phrases ran together; a place or group may have one ("Moon Well").
      if (p.months.has(n.name) || p.eras.has(n.name) || words.some((w) => (!kind && STOP.has(w)) || CONTRACTION.test(w)) || /^\p{Lu}{1,4}$/u.test(n.name)) continue;
      // "son of X", "Battle of X": other patterns, unless the name says what it is ("the shaft of the Moon Well")
      const suffixed = afterThe && !!one && one.length > 5 && PLACE_SUFFIX.test(one.toLowerCase());
      if (/(?:^|[^\p{L}])of[ \t]+(?:the[ \t]+)?$/u.test(before) && !kind && !suffixed) continue;
      if (initial && !n.title && !split.role && words.length === 1) {
        // A sentence-initial word is a name only when it is not a common word and goes on into the sentence.
        // "Carpenters were building": the plural of a trade is not a name either
        const common = lowerWords.has(n.name.toLowerCase()) || COMMON_START.has(n.name) || plainForms(n.name).some((w) => lowerWords.has(w) || ROLE_SET.has(w) || THING_PLURALS.has(capitalise(w)));
        // "Flower of the market!", "Hang it on the bell": a noun with "of", or a command with its object
        if (/ly$/.test(n.name) || common || !/^[ \t]+\p{Ll}/u.test(after) || /^[ \t]+of[ \t]/.test(after) || OBJECT_AFTER.test(after)) continue;
      }
      if (kind === 'event') {
        // "the Great Rockfall", "the Long Plague": a named event ("the Battle of Qarim" is the event pattern's).
        if (afterThe && !AFTER_OF_ON_AT_NAME.test(after)) add({ entryType: 'event', name: `The ${n.name}`, fields: {}, confidence: 0.45, pattern: 'name' });
        continue;
      }
      if (kind === 'faction') continue; // the faction patterns above
      if (kind === 'item') {
        if (AFTER_OF.test(after)) continue; // "the Crown of Thorns": the item pattern
        // "Yusuf's Compass" is named by its owner; "the Glass Compass" takes its "the".
        add({ entryType: 'item', name: /['’]s$/.test(words[0]!) ? n.name : `The ${n.name}`, fields: {}, confidence: 0.4, pattern: 'name' });
        continue;
      }
      if (kind === 'place') {
        if (!notPlace(n.name)) add({ entryType: 'place', name: n.name, fields: {}, confidence: 0.5, pattern: 'name' });
        continue;
      }
      if (afterThe && one && FACTION_SUFFIX.test(one.toLowerCase()) && one.length > 7 && !speech) {
        add({ entryType: 'faction', name: `The ${one}`, fields: {}, confidence: 0.5, pattern: 'name' }); // "the Bellguard"
        continue;
      }
      // What stands before it: "in Qarim", "across the Red Erg", "behind The Snowcrown", "to the Moon Well".
      // Not "looked back at Yusuf", which is at a person.
      // "toward the Steward" is toward a person: a lone trade or title word is someone's title, never a place.
      const role = !!one && ROLE_SET.has(one.toLowerCase());
      if (!possessive && !n.title && !split.role && !speech && !role && !notPlace(n.name) && !LOOK_AT.test(before)) {
        const placeLike = words.length > 1 || (!!one && PLACE_SUFFIX.test(one.toLowerCase()));
        const where = afterThe ? SPATIAL_THE.test(before) || (placeLike && FROM_TO_THE.test(before)) : PLACE_BEFORE.test(before);
        if (where || (afterThe && placeLike && words.length === 1)) {
          // A one-word "the Millpond", "the Tarnwater" counts on its ending alone.
          add({ entryType: 'place', name: n.name, fields: {}, confidence: 0.4, pattern: 'name' });
          continue;
        }
      }
      if (afterThe || words.length > 3) continue; // "the Shifting Pride": too unclear to guess
      person(found.replace(/['’]s$/, ''), {}, 'name', 0.4);
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
      const m = rx`^(?:[^,]{0,40},${S})?${P}${S}(\\p{Ll}+)(?:${S}${P})?`.exec(s.text);
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

/**
 * What a chapter's extraction reads from the world besides the chapter itself: the calendar, and each entry's
 * id, type, name and aliases (to match names, resolve mentions and build the name patterns). Kept per entries
 * array, so a story edit, which leaves the entries as they are, does not build it again.
 */
const namesOf = new WeakMap<readonly Entry[], string>();
function worldSignature(world: World): string {
  let names = namesOf.get(world.entries);
  if (names === undefined) {
    names = world.entries.map((e) => `${e.id}\u0001${e.type}\u0001${e.name}\u0001${(e.aliases ?? []).join('\u0002')}`).join('\u0000');
    namesOf.set(world.entries, names);
  }
  return `${JSON.stringify(world.manifest.calendar)}\u0003${names}`;
}

/**
 * The last extraction of every chapter, reused while the chapter's text and the world's names stay the same.
 * Typing in one chapter then reads only that chapter again, and editing an entry's other fields reads none.
 * The results are only ever read, never changed, so sharing them is safe.
 */
const chapterCache = new Map<string, { signature: string; body: string; result: Extraction }>();
const CHAPTER_CACHE_LIMIT = 500;

export const ruleExtractor: SyncExtractor = {
  id: 'rules',
  extract({ world, chapters }) {
    const signature = worldSignature(world);
    let p: Patterns | undefined;
    let ix: WorldIndex | undefined;
    const out: Extraction = { proposals: [], appearances: [] };
    for (const ch of chapters) {
      const key = `${world.manifest.id}\u0000${ch.file}`;
      const hit = chapterCache.get(key);
      let r: Extraction;
      if (hit && hit.signature === signature && hit.body === ch.body) r = hit.result;
      else {
        r = extractChapter(world, ch, (p ??= patterns(world)), (ix ??= new WorldIndex(world)));
        if (chapterCache.size >= CHAPTER_CACHE_LIMIT) chapterCache.clear();
        chapterCache.set(key, { signature, body: ch.body, result: r });
      }
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
  // "Rhys" after "Rhys Varn": a first name alone is the one new person whose full name starts with it.
  const newPeople = [...groups].filter(([, r]) => !r.existing && r.entryType === 'character');
  for (const [g, r] of newPeople) {
    const first = key(r.name);
    if (first.includes(' ')) continue;
    const fuller = newPeople.filter(([g2, r2]) => g2 !== g && groups.has(g2) && key(r2.name).startsWith(`${first} `));
    if (fuller.length !== 1) continue;
    const whole = fuller[0]![1];
    mergeFields(whole.fields, r.fields);
    whole.confidence = Math.max(whole.confidence, r.confidence);
    whole.alsoAt.push(r.sourceSpan, ...r.alsoAt);
    groups.delete(g);
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
