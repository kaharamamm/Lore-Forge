/**
 * Replace in the story (Ctrl+Shift+H): a word or phrase found in every chapter's title and text, listed by chapter in
 * its sentence, then replaced one at a time or all at once.
 */
import { useMemo, useState } from 'preact/hooks';
import { findAll, replaceFound, textAround, type Found, type StoryChapter } from '@lore-forge/core';
import { num, t } from '../i18n.tsx';
import { Dialog } from './dialog.tsx';
import { Icon } from './icon.tsx';

interface Hits {
  chapter: StoryChapter;
  title: Found[];
  body: Found[];
}

/** The text chosen in the open chapter, when it is a short phrase: what to find, to start with. */
function chosenPhrase(): string {
  const el = document.getElementById('story-text') as HTMLTextAreaElement | null;
  const s = el && el.selectionEnd > el.selectionStart ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
  return s.length <= 80 && !s.includes('\n') ? s : '';
}

export function ReplaceDialog({ chapters, onGo, onReplace, onClose }: {
  /** The story, in reading order. */
  chapters: readonly StoryChapter[];
  /** Opens a chapter with the found text chosen. */
  onGo: (file: string, start: number, end: number) => void;
  /** Writes the changed chapters; `all` is a Replace all (the book is kept first, and Undo is offered). */
  onReplace: (changed: StoryChapter[], count: number, all: boolean, find: string, by: string) => Promise<void>;
  onClose: () => void;
}) {
  const [find, setFind] = useState(chosenPhrase);
  const [by, setBy] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [busy, setBusy] = useState(false);
  const hits = useMemo((): Hits[] => {
    if (!find) return [];
    const opts = { matchCase, wholeWords };
    return chapters.map((chapter) => ({ chapter, title: findAll(chapter.title, find, opts), body: findAll(chapter.body, find, opts) })).filter((h) => h.title.length || h.body.length);
  }, [chapters, find, matchCase, wholeWords]);
  const total = hits.reduce((n, h) => n + h.title.length + h.body.length, 0);
  const run = async (changed: StoryChapter[], count: number, all: boolean): Promise<void> => {
    setBusy(true);
    try {
      await onReplace(changed, count, all, find, by);
    } finally {
      setBusy(false);
    }
  };
  const one = (h: Hits, field: 'title' | 'body', f: Found) => run([{ ...h.chapter, [field]: replaceFound(h.chapter[field], [f], by) }], 1, false);
  const every = () => run(hits.map((h) => ({ ...h.chapter, title: replaceFound(h.chapter.title, h.title, by), body: replaceFound(h.chapter.body, h.body, by) })), total, true);
  return (
    <Dialog class="replace-dialog" title={t('Replace in the story')} onClose={onClose}
      footer={(
        <>
          <button type="button" class="ghost" onClick={onClose}>{t('Close')}</button>
          <button type="button" class="primary replace-all" disabled={!total || busy} onClick={() => void every()}>{t('Replace all')}</button>
        </>
      )}>
      <div class="replace-form">
        <label class="field">
          <span>{t('Find')}</span>
          <input type="text" class="replace-find" value={find} autoFocus onInput={(e) => setFind(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>{t('Replace with')}</span>
          <input type="text" class="replace-by" value={by} onInput={(e) => setBy(e.currentTarget.value)} />
        </label>
        <div class="replace-options">
          <label><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.currentTarget.checked)} /> {t('Match case')}</label>
          <label><input type="checkbox" checked={wholeWords} onChange={(e) => setWholeWords(e.currentTarget.checked)} /> {t('Whole words')}</label>
        </div>
      </div>
      <p class="muted small replace-count" role="status">
        {!find ? t('Type what to find.') : !total ? t('Not found in the story.') : total === 1 ? t('Found once.') : t('Found {n} times, in {chapters}.', { n: num(total), chapters: hits.length === 1 ? t('one chapter') : t('{n} chapters', { n: hits.length }) })}
      </p>
      <div class="replace-results">
        {hits.map((h) => (
          <section key={h.chapter.file} class="replace-group">
            <h3><Icon name="scroll-quill" /> {h.chapter.title || t('Untitled')} <span class="muted small">{h.title.length + h.body.length}</span></h3>
            <ul>
              {(['title', 'body'] as const).flatMap((field) => h[field].map((f) => {
                const text = h.chapter[field];
                const around = textAround(text, f.start, f.end);
                return (
                  <li key={`${field}:${f.start}`} class="replace-hit">
                    {field === 'title' && <span class="rename-field">{t('Chapter title')}</span>}
                    <span class="rename-line">{around.before}<del>{text.slice(f.start, f.end)}</del>{by && <ins>{by}</ins>}{around.after}</span>
                    <span class="replace-hit-actions">
                      {field === 'body' && <button type="button" class="ghost small" onClick={() => onGo(h.chapter.file, f.start, f.end)}>{t('Show')}</button>}
                      <button type="button" class="ghost small" disabled={busy} onClick={() => void one(h, field, f)}>{t('Replace')}</button>
                    </span>
                  </li>
                );
              }))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
