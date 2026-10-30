import { detailOf } from './details.ts';
import { foldSearch } from './search.ts';
import type { IconName } from './icons.ts';
import { TYPE_ICON, type Entry } from './types.ts';

/**
 * Default pictures for entries without an image, shared by the app and the PDF exports.
 * Each table is checked in order; the first keyword found in the entry's kind, name or summary wins.
 */
type Table = readonly (readonly [RegExp, IconName])[];
/** Whole-word match that also works for Turkish letters (ç, ş, ı, ...), which \b does not see as letters. */
const w = (words: string) => new RegExp(`(?<!\\p{L})(?:${words})(?!\\p{L})`, 'u');

const PLACE: Table = [
  [w('ruins?|ruined'), 'ancient-ruins'],
  [w('palace|palaces|sarayı?'), 'indian-palace'],
  [w('castle|fortress|citadel|keep|kale(si)?'), 'castle'],
  [w('tower|towers|watchtower|spire|kule(si)?'), 'stone-tower'],
  [w('temple|shrine|sanctuary|tapınak'), 'greek-temple'],
  [w('church|cathedral|chapel|abbey|monastery|mosque|cami'), 'church'],
  [w('gate|gates|kapı(sı)?'), 'portculis'],
  [w('hut|huts|shack|hovel|kulübe'), 'hut'],
  [w('house|home|manor|hall|ev(i)?'), 'house'],
  [w('inn|tavern|alehouse|han(ı)?'), 'beer-stein'],
  [w('port|harbou?r|harbor|docks?|liman(ı)?'), 'anchor'],
  [w('lighthouse'), 'lighthouse'],
  [w('cave|caves|cavern|grotto|mine|mağara'), 'cave-entrance'],
  [w('forest|wood|woods|grove|jungle|orman'), 'forest'],
  [w('mountains?|peak|peaks|cliffs?|dağ(ı)?'), 'mountains'],
  [w('oasis|vaha'), 'oasis'],
  [w('desert|dunes?|sands|çöl'), 'desert'],
  [w('wells?|spring|kuyu'), 'well'],
  [w('market|bazaar|souk|çarşı|pazar'), 'shop'],
  [w('graveyard|cemetery|tomb|crypt|necropolis'), 'graveyard'],
  [w('pyramids?'), 'great-pyramid'],
  [w('bridge|köprü'), 'stone-bridge'],
  [w('library|archive'), 'bookshelf'],
  [w('village|hamlet|köy(ü)?'), 'village'],
  [w('city|town|capital|metropolis|şehir|kent'), 'huts-village'],
];
const ITEM: Table = [
  [w('crowns?|diadem|tiara|taç'), 'crown'],
  [w('rings?|yüzük'), 'diamond-ring'],
  [w('compass|pusula'), 'compass'],
  [w('maps?|chart|harita'), 'treasure-map'],
  [w('books?|tome|codex|grimoire|kitap'), 'book-cover'],
  [w('scrolls?|letter|parchment'), 'scroll-unfurled'],
  [w('potions?|elixir|tonic|iksir'), 'round-potion'],
  [w('shields?|kalkan'), 'checked-shield'],
  [w('bow|longbow|crossbow|yay'), 'bow-arrow'],
  [w('staff|stave|rod|asa'), 'wizard-staff'],
  [w('wand'), 'crystal-wand'],
  [w('axe|hatchet|balta'), 'battle-axe'],
  [w('dagger|knife|hançer|bıçak'), 'bowie-knife'],
  [w('spear|lance|pike|mızrak'), 'spears'],
  [w('hammer|maul|mace'), 'claw-hammer'],
  [w('sword|blade|sabre|saber|scimitar|kılıç'), 'broadsword'],
  [w('amulet|necklace|pendant|talisman|kolye'), 'gem-pendant'],
  [w('keys?|anahtar'), 'key'],
  [w('lamp|lantern|lamba'), 'magic-lamp'],
  [w('helm|helmet|miğfer'), 'visored-helm'],
  [w('armou?r|breastplate|mail|zırh'), 'breastplate'],
  [w('coins?|gold|treasure|altın'), 'crown-coin'],
  [w('orb|crystal|gem|jewel|stone'), 'crystal-ball'],
  [w('harp|lyre|lute|flute|drum'), 'harp'],
  [w('ship|boat|gemi'), 'cargo-ship'],
  [w('hourglass|sandglass'), 'sands-of-time'],
];
const FACTION: Table = [
  [w('pirates?|corsairs?|korsan'), 'pirate-flag'],
  [w('thieves|bandits?|raiders?|brigands?|eşkıya'), 'hood'],
  [w('assassins?'), 'hooded-assassin'],
  [w('court|crown|kingdom|empire|dynasty|throne|royal|sultanate|saray'), 'crown'],
  [w('guard|guards|army|legion|watch|soldiers|knights|order'), 'crossed-swords'],
  [w('cult|church|faith|priests?|temple'), 'church'],
  [w('guild|merchants?|traders?|company|caravans?'), 'two-coins'],
  [w('tribe|clan|nomads?|aşiret|kabile'), 'huts-village'],
  [w('council|senate|assembly|meclis'), 'meeple-group'],
  [w('scholars?|mages?|wizards?|academy|circle'), 'wizard-staff'],
  [w('winds?|storm'), 'tornado'],
];
const EVENT: Table = [
  [w('sieges?|besieged|kuşatma'), 'siege-tower'],
  [w('battle|war|skirmish|ambush|raid|fight|clash|savaş'), 'crossed-swords'],
  [w('wedding|marriage|married|betrothal|düğün'), 'linked-rings'],
  [w('coronation|crowned|crowning|enthronement|taç giyme'), 'coronation'],
  [w('plague|pestilence|sickness|epidemic|veba|salgın'), 'plague-doctor-profile'],
  [w('festival|feast|celebration|carnival|bayram|şenlik'), 'party-flags'],
  [w('fall|sack|ruin|destruction|burning|collapse'), 'tower-fall'],
  [w('death|murder|assassination|funeral|execution'), 'tombstone'],
  [w('storm|sandstorm|flood|earthquake|fırtına'), 'lightning-storm'],
  [w('treaty|pact|alliance|truce|peace|dispute|council|antlaşma'), 'shaking-hands'],
  [w('founding|founded|foundation|kuruluş'), 'flying-flag'],
  [w('birth|born'), 'sprout'],
  [w('journey|voyage|expedition|return|exodus|pilgrimage'), 'treasure-map'],
];
const NOTE: Table = [
  [w('songs?|ballad|poem|lament|hymn|şarkı|ağıt'), 'harp'],
  [w('maps?'), 'treasure-map'],
  [w('legend|myth|tale|story|chronicle'), 'open-book'],
];

const FEMALE_WORDS = w('queen|lady|princess|empress|duchess|countess|baroness|sultana|sultan hanım|hatun|hanım|mother|sister|daughter|wife|widow|priestess|witch|matriarch|mistress|dame|madam');
const MALE_WORDS = w('king|lord|prince|emperor|duke|count|baron|sultan|bey|pasha|paşa|ağa|father|brother|son|husband|priest|patriarch|sir|master');

/** First names, lower case, without accents removed: Turkish and English. Used only to pick a default picture. */
const FEMALE_NAMES = new Set(('ayşe fatma emine hatice zeynep elif meryem merve büşra esra leyla leila zehra mira nur nurcan ilsa sefa selin defne ece aslı aylin ayla deniz gül gülşen hande irem melek nazlı özge pınar sena sibel songül şule tuba yasemin yıldız derya dilara ebru eda feride gamze hülya aysel sevgi şirin lale reyhan ' +
  'mary anna emma olivia sophia isabella mia charlotte amelia emily elizabeth sarah grace alice ella lily rose jane margaret helen catherine eleanor victoria lucy clara hannah eva ivy freya ada iris luna maya nora ruby')
  .split(/\s+/).filter(Boolean));
const MALE_NAMES = new Set(('mehmet mustafa ahmet ali hüseyin hasan ibrahim ismail osman yusuf murat ömer ramazan halil süleyman abdullah mahmut recep kadir tarık tarik orsan hadi emre burak can cem eren kaan kerem mert onur serkan tolga volkan yasin selim kemal cemal fatih furkan oğuz batu arda alp kaya timur ' +
  'john james william henry george thomas edward charles robert richard michael david peter paul arthur jack harry oliver noah liam lucas ethan samuel daniel joseph benjamin alexander leo hugo oscar adam simon')
  .split(/\s+/).filter(Boolean));

const lower = (s: string | undefined) => (s ?? '').toLocaleLowerCase('tr').replace(/İ/g, 'i');

/** Gender read from the `gender` field, the title, or a known first name; undefined when unknown. */
export function guessGender(e: Entry): 'female' | 'male' | undefined {
  if (e.type !== 'character') return undefined;
  const g = lower(detailOf(e, 'gender') as string | undefined).trim();
  if (/^(f|female|woman|girl|kadın|kadin|kız|feminine)$/.test(g)) return 'female';
  if (/^(m|male|man|boy|erkek|masculine)$/.test(g)) return 'male';
  if (g) return undefined;
  const title = lower(detailOf(e, 'title') as string | undefined);
  const name = lower(e.name);
  for (const s of [title, name]) {
    if (FEMALE_WORDS.test(s)) return 'female';
    if (MALE_WORDS.test(s)) return 'male';
  }
  for (const word of name.split(/[\s,.'-]+/)) {
    if (FEMALE_NAMES.has(word)) return 'female';
    if (MALE_NAMES.has(word)) return 'male';
  }
  return undefined;
}

/** Races to suggest: the ones already used in the world first, then common defaults. */
export const DEFAULT_RACES = ['human', 'elf', 'dwarf', 'orc', 'camel-folk', 'ghoul', 'zombie', 'vampire', 'undead', 'spirit', 'djinn', 'giant', 'dragon'];

const RACE_ICONS: Record<string, IconName> = {
  human: 'person', man: 'person', elf: 'woman-elf-face', elves: 'woman-elf-face', 'half-elf': 'elf-ear', dwarf: 'dwarf-face', dwarves: 'dwarf-face',
  orc: 'orc-head', goblin: 'goblin-head', troll: 'troll', ogre: 'ogre', giant: 'giant', 'camel-folk': 'camel-head', camel: 'camel-head',
  ghoul: 'daemon-skull', zombie: 'shambling-zombie', vampire: 'vampire-dracula', undead: 'death-skull', skeleton: 'skeleton', lich: 'death-skull',
  spirit: 'spectre', ghost: 'spectre', djinn: 'djinn', jinn: 'djinn', cin: 'djinn', demon: 'imp-laugh', fairy: 'fairy', fae: 'fairy', angel: 'angel-wings',
  dragon: 'dragon-head', werewolf: 'wolf-howl', 'wolf-folk': 'wolf-head', mermaid: 'mermaid', merfolk: 'mermaid', centaur: 'centaur', minotaur: 'minotaur', cyclops: 'cyclops',
};

/** Icon for a race or kind: a known one by its word (singular, lower-case), "...-folk" as beast-folk, otherwise a hooded figure. */
export function raceIcon(race: string): IconName {
  const key = lower(race).trim().replace(/\s+/g, '-');
  const known = RACE_ICONS[key] ?? RACE_ICONS[key.replace(/s$/, '')];
  if (known) return known;
  if (/-?(folk|kin|people)$/.test(key)) return RACE_ICONS[key.replace(/-?(folk|kin|people)$/, '')] ?? 'wolf-head';
  return 'hood';
}

/** A character's races, split on commas: "elf, human" -> ["elf", "human"]. */
export function racesOf(e: Entry): string[] {
  return e.type === 'character' && e.race ? e.race.split(',').map((r) => r.trim()).filter(Boolean) : [];
}

export function raceSuggestions(entries: readonly Entry[]): string[] {
  const used = entries.flatMap(racesOf);
  return [...new Set([...used.sort((a, b) => a.localeCompare(b)), ...DEFAULT_RACES])];
}

const TABLES: Partial<Record<Entry['type'], Table>> = { place: PLACE, item: ITEM, faction: FACTION, event: EVENT, note: NOTE };

/**
 * The default picture for an entry with no image: for characters a female or male figure when the
 * gender field, title or first name tells, else their race, else a neutral figure; for other types the
 * first keyword match in kind, then name, then summary, else the type icon.
 */
export function entryIcon(e: Entry, raceName?: string): IconName {
  if (e.type === 'character') {
    const g = guessGender(e);
    if (g) return g;
    const race = raceName ?? racesOf(e)[0];
    return race ? raceIcon(race) : TYPE_ICON.character;
  }
  const table = TABLES[e.type] ?? [];
  for (const text of [detailOf(e, 'kind') as string | undefined, e.name, e.summary]) {
    const s = lower(text);
    if (!s) continue;
    for (const [re, icon] of table) if (re.test(s)) return icon;
  }
  return TYPE_ICON[e.type];
}

/** Every icon the tables can return, so the icon set can be checked. */
export const ENTRY_ICON_NAMES: readonly IconName[] = [
  ...new Set<IconName>([
    'female', 'male', TYPE_ICON.character, 'hood', 'wolf-head',
    ...Object.values(RACE_ICONS),
    ...Object.values(TABLES).flatMap((t) => t!.map(([, i]) => i)),
  ]),
];

const fold = (s: string) => foldSearch(s).normalize('NFD').replace(/\p{M}/gu, '');
/** The words inside a `w(...)` pattern: "kale(si)?|castles?" -> ["kale", "castles"]. */
const wordsOf = (re: RegExp) => (/\(\?:(.*)\)\(\?!/.exec(re.source)?.[1] ?? '').split('|').map((x) => x.replace(/\([^)]*\)\??/g, '').replace(/\?/g, '')).filter(Boolean);
let keywords: Map<IconName, string[]> | undefined;

/** Words that find an icon in the icon picker: the keyword tables above (English and Turkish), race names and type names. */
export function iconKeywords(): Map<IconName, string[]> {
  if (keywords) return keywords;
  const map = new Map<IconName, Set<string>>();
  const add = (icon: IconName, word: string) => { if (!map.has(icon)) map.set(icon, new Set()); map.get(icon)!.add(fold(word)); };
  for (const table of Object.values(TABLES)) for (const [re, icon] of table!) for (const word of wordsOf(re)) add(icon, word);
  for (const [race, icon] of Object.entries(RACE_ICONS)) add(icon, race);
  for (const [type, icon] of Object.entries(TYPE_ICON)) add(icon, type);
  for (const word of wordsOf(FEMALE_WORDS)) add('female', word);
  for (const word of wordsOf(MALE_WORDS)) add('male', word);
  keywords = new Map([...map].map(([k, v]) => [k, [...v]]));
  return keywords;
}

/**
 * Icons matching a query, best first: the name starts with it, a word of the name starts with it, a keyword starts
 * with it, then the name or a keyword contains it. Every word of the query has to match. Case, Turkish dotted and
 * dotless i and accents are ignored. An empty query returns `names` as they are.
 */
export function searchIcons(names: readonly IconName[], query: string): IconName[] {
  const words = fold(query).split(/[\s-]+/).filter(Boolean);
  if (!words.length) return [...names];
  const kw = iconKeywords();
  const tierOf = (name: IconName, q: string): number => {
    const label = fold(name.replace(/-/g, ' '));
    const keys = kw.get(name) ?? [];
    if (label.startsWith(q)) return 0;
    if (label.split(' ').some((p) => p.startsWith(q))) return 1;
    if (keys.some((k) => k.startsWith(q) || k.split(/[\s-]/).some((p) => p.startsWith(q)))) return 2;
    if (label.includes(q) || keys.some((k) => k.includes(q))) return 3;
    return -1;
  };
  return names
    .map((name, i) => ({ name, i, tiers: words.map((q) => tierOf(name, q)) }))
    .filter((r) => r.tiers.every((t) => t >= 0))
    .map((r) => ({ ...r, score: r.tiers.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((r) => r.name);
}
