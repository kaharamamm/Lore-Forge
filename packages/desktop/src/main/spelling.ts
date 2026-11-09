/**
 * Spell checking: the languages to check (Settings), a right-click menu in text fields with spelling suggestions, Add
 * to the dictionary, Cut, Copy and Paste, the suggestions for the Story's own menu, and the open book's names, which
 * count as spelled right while it is open. Chromium checks the spelling: on Windows with the system's own checker
 * where it has the language, else with a Hunspell dictionary it downloads once; on macOS with the system's checker,
 * which picks the language itself.
 */
import { ipcMain, Menu, session, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../shared/i18n.ts';

/** At most this many of a book's words count as spelled right. */
const MAX_BOOK_WORDS = 4000;
/** How long after the Story marks its own menu a right-click counts as one for it. */
const OWN_MENU_MS = 2000;

/** Turns spell checking on in these languages, or off when there are none. */
export function applySpelling(languages: readonly string[]): void {
  const s = session.defaultSession;
  s.setSpellCheckerEnabled(languages.length > 0);
  if (process.platform === 'darwin' || !languages.length) return;
  const ok = languages.filter((l) => s.availableSpellCheckerLanguages.includes(l));
  if (ok.length) s.setSpellCheckerLanguages(ok);
}

// ------------------------------------------------------------------------------------------- the book's words

let wordsFile = '';
/** Words added to the spell checker for the open book (never the user's own), to take out again when it closes. */
const added = new Set<string>();
/**
 * Every word Lore-Forge may have put in the spell checker, in this run or an earlier one, kept in a file: the spell
 * checker stores its list a moment after a change, so a run that ends at once can leave words there. The next start
 * takes out the ones it finds. A word the user adds leaves this list.
 */
const ours = new Set<string>();
/** At most this many words are remembered (the newest). */
const MAX_OURS = 20_000;
let saving: Promise<void> = Promise.resolve();
const saveOurs = (): Promise<void> => (saving = saving.then(() => writeFile(wordsFile, JSON.stringify([...ours].slice(-MAX_OURS)), 'utf8')).catch(() => {}));

/**
 * The spell checker's own word list, once it is loaded from disk (a change made before that is lost). Not waited for
 * long: with spell checking off it may never load.
 */
const wordList = (): Promise<string[]> => Promise.race([
  session.defaultSession.listWordsInSpellCheckerDictionary(),
  new Promise<string[]>((ok) => setTimeout(() => ok([]), 5000)),
]);

/** Words an earlier run left in the spell checker go first; book words wait for that. */
let cleaned: Promise<void> = Promise.resolve();
async function cleanLeftovers(): Promise<void> {
  try {
    const known = JSON.parse(await readFile(wordsFile, 'utf8')) as unknown;
    if (Array.isArray(known)) for (const w of known) if (typeof w === 'string') ours.add(w);
  } catch {
    return;
  }
  if (!ours.size) return;
  const present = new Set(await wordList());
  for (const w of ours) if (present.has(w)) session.defaultSession.removeWordFromSpellCheckerDictionary(w);
}

/** The open book's words become spelled right, and the last book's that are not in it any more go. */
async function bookWords(words: readonly string[]): Promise<void> {
  await cleaned;
  const s = session.defaultSession;
  const want = new Set(words.slice(0, MAX_BOOK_WORDS));
  for (const w of [...added]) {
    if (want.has(w)) continue;
    s.removeWordFromSpellCheckerDictionary(w);
    added.delete(w);
  }
  const have = new Set(await wordList());
  let more = false;
  for (const w of want) {
    if (have.has(w) || added.has(w) || !s.addWordToSpellCheckerDictionary(w)) continue;
    added.add(w);
    ours.delete(w);
    ours.add(w);
    more = true;
  }
  if (more) await saveOurs();
}

/** A word the user adds stays theirs, also when the open book has it. */
function addWord(word: string): void {
  session.defaultSession.addWordToSpellCheckerDictionary(word);
  added.delete(word);
  if (ours.delete(word)) void saveOurs();
}

// ------------------------------------------------------------------------------------------ the right-click menu

async function contextMenu(win: BrowserWindow, p: ContextMenuParams): Promise<void> {
  const wc = win.webContents;
  // The Story's text has its own menu (it marks the right-click just before): the suggestions go there.
  const own = await wc.executeJavaScript(`typeof window.loreOwnMenu === 'number' && performance.now() - window.loreOwnMenu < ${OWN_MENU_MS}`, true).catch(() => false);
  if (own) {
    wc.send('spelling', p.misspelledWord ? { word: p.misspelledWord, suggestions: p.dictionarySuggestions.slice(0, 5) } : null);
    return;
  }
  const items: MenuItemConstructorOptions[] = [];
  if (p.misspelledWord) {
    const suggestions = p.dictionarySuggestions.slice(0, 5);
    for (const s of suggestions) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (!suggestions.length) items.push({ label: t('No suggestions'), enabled: false });
    items.push({ label: t('Add “{word}” to the dictionary', { word: p.misspelledWord }), click: () => addWord(p.misspelledWord) }, { type: 'separator' });
  }
  if (p.isEditable) {
    items.push(
      { label: t('Cut'), role: 'cut', enabled: p.editFlags.canCut },
      { label: t('Copy'), role: 'copy', enabled: p.editFlags.canCopy },
      { label: t('Paste'), role: 'paste', enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { label: t('Select all'), role: 'selectAll', enabled: p.editFlags.canSelectAll },
    );
  } else if (p.selectionText.trim()) {
    items.push({ label: t('Copy'), role: 'copy' });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

/**
 * Spelling for the app window. `dataDir` holds the list of book words the spell checker has from Lore-Forge: words left
 * there by a run that ended without closing its book go first.
 */
export async function registerSpelling(dataDir: string, languages: () => Promise<string[]>): Promise<void> {
  wordsFile = join(dataDir, 'spelling-book-words.json');
  applySpelling(await languages());
  cleaned = cleanLeftovers().catch(() => {});
  ipcMain.handle('spellingWords', (_e, words: unknown) => bookWords(Array.isArray(words) ? words.filter((w): w is string => typeof w === 'string') : []));
  ipcMain.handle('addToDictionary', (_e, word: unknown) => { if (typeof word === 'string' && word.trim()) addWord(word.trim()); });
}

/** The right-click menu of a window. */
export function attachSpelling(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_e, p) => void contextMenu(win, p));
}

/**
 * Quitting: the book's words leave the spell checker. The list stays in its file, so the next start takes them out
 * again in case the spell checker had not stored the change yet.
 */
export function forgetBookWords(): void {
  for (const w of added) session.defaultSession.removeWordFromSpellCheckerDictionary(w);
}
