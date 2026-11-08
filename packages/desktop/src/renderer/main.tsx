import { render } from 'preact';
import type { TrimSize } from '@lore-forge/core';
import { App } from './app.tsx';
import { pauseWhenHidden } from './components/aura.tsx';
import { CoverCapture } from './components/cover-capture.tsx';
import { recordMessages } from '@lore-forge/core';
import { isLang } from '../shared/i18n.ts';
import { switchLanguage } from './i18n.tsx';

const query = new URLSearchParams(location.search);
const coverDir = query.get('cover');
// The language comes with the page's address (main.ts): the first frame is already in it.
const lang = query.get('lang');
switchLanguage(isLang(lang) ? lang : 'en');
// Core remembers how it made each warning and label, so they can be shown in another language (tm in i18n.tsx).
recordMessages(true);

if (coverDir) {
  // Hidden window for the Word export: only the book cover, captured by the main process.
  document.documentElement.classList.add('is-cover-capture');
  render(<CoverCapture dir={coverDir} trim={(query.get('trim') as TrimSize | null) ?? undefined} />, document.getElementById('root')!);
} else {
  pauseWhenHidden();
  render(<App />, document.getElementById('root')!);
}
