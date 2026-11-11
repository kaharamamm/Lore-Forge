/**
 * Ready starts for a new book (New book, Start from): a calendar, the writing and picture style, a cover colour and
 * emblem, and for a game world fields of its own. Era and month names and writing styles are in the app's language,
 * like the rest of what the user writes; an era's code is made from its name. All of it can be changed later in World
 * settings.
 */
import { fieldKey, type Calendar, type CustomField, type CustomFieldKind, type EntryType, type IconName, type Month } from '@lore-forge/core';
import { t } from '../shared/i18n.ts';
import { picturePresets, writingPresets } from './presets.ts';

export interface BookTemplate {
  id: string;
  name: string;
  /** What it brings, in one line. */
  about: string;
  /** None: plain years, as a blank book has. */
  calendar?: Calendar;
  writingStyle?: string;
  artStyle?: string;
  fields?: Partial<Record<EntryType, CustomField[]>>;
  cover?: { color: string; icon: IconName };
}

/** An era's code from its name: the first letters of its capitalised words, without accents ("Second Age" -> "SA", "İkinci Çağ" -> "IC"). */
export function eraCode(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const big = words.filter((w) => /^\p{Lu}/u.test(w));
  const code = (big.length ? big : words).map((w) => w[0]!).join('').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  return /^[A-Z]/.test(code) ? code : `E${code}`;
}

/** Eras one after the other, each ending the year before the next starts; the last one is the default. */
function eras(...list: [name: string, start: number, color: string][]): Calendar {
  const out = list.map(([name, start, color], i) => ({ id: eraCode(name), name, start, ...(list[i + 1] ? { end: list[i + 1]![1] - 1 } : {}), color }));
  return { eras: out, defaultEra: out[out.length - 1]!.id };
}

/** The everyday calendar: years from year 1, and its twelve months (without leap days). */
function everyday(): Calendar {
  const names = [t('January'), t('February'), t('March'), t('April'), t('May'), t('June'), t('July'), t('August'), t('September'), t('October'), t('November'), t('December')];
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return { ...eras([t('Anno Domini'), 1, '#6f8fc9']), months: names.map((name, i): Month => ({ name, days: days[i]! })) };
}

/** Fields with keys made from their names, as World settings makes them. */
function fieldList(...list: [name: string, kind: CustomFieldKind, choices?: string[]][]): CustomField[] {
  const taken: string[] = [];
  return list.map(([name, kind, choices]) => {
    const key = fieldKey(name, taken);
    taken.push(key);
    return { key, name, kind, ...(choices ? { choices } : {}) };
  });
}

const writing = (id: string) => writingPresets().find((p) => p.id === id)?.text;
const picture = (id: string) => picturePresets().find((p) => p.id === id)?.text;

/** The templates, Blank first. */
export const bookTemplates = (): BookTemplate[] => [
  { id: 'blank', name: t('Blank'), about: t('Plain years and nothing else set: everything is yours to choose.') },
  {
    id: 'fantasy', name: t('Epic fantasy'), about: t('A First and a Second Age, the Epic writing style and painterly pictures.'),
    calendar: eras([t('First Age'), 1, '#8a6a3d'], [t('Second Age'), 1001, '#c9822f']),
    writingStyle: writing('epic'), artStyle: picture('painterly'), cover: { color: '#7a2e2e', icon: 'dragon-head' },
  },
  {
    id: 'fairy-tale', name: t('Fairy tale'), about: t('Plain years, the Fairy tale writing style and storybook pictures.'),
    writingStyle: writing('fairy-tale'), artStyle: picture('storybook'), cover: { color: '#3b3478', icon: 'fairy' },
  },
  {
    id: 'mystery', name: t('Mystery'), about: t('The everyday calendar with its twelve months, the Mystery writing style and dark ink pictures.'),
    calendar: everyday(), writingStyle: writing('mystery'), artStyle: picture('dark-ink'), cover: { color: '#1f4f6b', icon: 'magnifying-glass' },
  },
  {
    id: 'horror', name: t('Horror'), about: t('The everyday calendar with its twelve months, the Horror writing style and gothic pictures.'),
    calendar: everyday(), writingStyle: writing('horror'), artStyle: picture('gothic'), cover: { color: '#14161b', icon: 'death-skull' },
  },
  {
    id: 'sci-fi', name: t('Science fiction'), about: t('Old Earth years, then Galactic Standard ones; the Science fiction writing style and cinematic pictures.'),
    calendar: eras([t('Old Earth'), 1, '#6f8fc9'], [t('Galactic Standard'), 2301, '#a68fc9']),
    writingStyle: writing('sci-fi'), artStyle: picture('cinematic'), cover: { color: '#2b2f3a', icon: 'world' },
  },
  {
    id: 'game', name: t('Game world'), about: t('Two ages, custom fields for game data (level, class and hit points; damage, rarity, weight and price; danger), the Adventure writing style and painterly pictures.'),
    calendar: eras([t('Age of Legends'), 1, '#a68fc9'], [t('Age of Heroes'), 1001, '#c9822f']),
    writingStyle: writing('adventure'), artStyle: picture('painterly'), cover: { color: '#2f5d3a', icon: 'crossed-swords' },
    fields: {
      character: fieldList([t('Level'), 'number'], [t('Class'), 'choice', [t('Warrior'), t('Mage'), t('Rogue'), t('Cleric'), t('Ranger')]], [t('Hit points'), 'number']),
      item: fieldList([t('Damage'), 'number'], [t('Rarity'), 'choice', [t('Common'), t('Uncommon'), t('Rare'), t('Epic'), t('Legendary')]], [t('Weight'), 'number'], [t('Price'), 'number']),
      place: fieldList([t('Danger level'), 'number']),
    },
  },
];
