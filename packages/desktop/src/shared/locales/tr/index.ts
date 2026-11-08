/**
 * Turkish: the desktop app's own texts plus core's (warnings, rule names, labels). Keys are the English texts the
 * code passes to t(), tx() ("context|text") and tj(), and the templates core's msg makes (see core/src/i18n.ts).
 */
import { CORE_TR } from '@lore-forge/core';
import { APP } from './app.ts';
import { EDITOR } from './editor.ts';
import { LIBRARY } from './library.ts';
import { MAIN } from './main.ts';
import { STORY } from './story.ts';
import { VIEWS } from './views.ts';

/** For the app's own texts (t, tx, tj): its words win where core uses the same English for something else ("Home" is the Home tab here). */
export const TR: Readonly<Record<string, string>> = { ...CORE_TR, ...MAIN, ...LIBRARY, ...EDITOR, ...VIEWS, ...STORY, ...APP };

/** For what core says (tm, localizeDoc): core's words win ("Home" is a character's home there, "Back" a picture's back view). */
export const TR_CORE: Readonly<Record<string, string>> = { ...TR, ...CORE_TR };
