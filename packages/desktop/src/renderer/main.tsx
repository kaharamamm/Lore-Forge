import { render } from 'preact';
import type { TrimSize } from '@lore-forge/core';
import { App } from './app.tsx';
import { pauseWhenHidden } from './components/aura.tsx';
import { CoverCapture } from './components/cover-capture.tsx';

const query = new URLSearchParams(location.search);
const coverDir = query.get('cover');

if (coverDir) {
  // Hidden window for the Word export: only the book cover, captured by the main process.
  document.documentElement.classList.add('is-cover-capture');
  render(<CoverCapture dir={coverDir} trim={(query.get('trim') as TrimSize | null) ?? undefined} />, document.getElementById('root')!);
} else {
  pauseWhenHidden();
  render(<App />, document.getElementById('root')!);
}
