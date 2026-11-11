/**
 * The audiobook dialog (Story Book → Save audiobook…): which voice reads, how long it plays, then how far it is while
 * Lore-Forge reads, and how it ended. The top bar shows a running audiobook when the dialog is closed.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { wordCount, writtenChapters, type World } from '@lore-forge/core';
import { audiobookBusy, clearAudiobook, listeningMinutes, stopAudiobook, useAudiobook, type AudiobookJob } from '../audiobook.ts';
import type { BuiltInVoice } from '../../shared/voices.ts';
import { num, t } from '../i18n.tsx';
import { Dialog } from './dialog.tsx';
import { Icon } from './icon.tsx';
import { Select } from './select.tsx';
import { bookLanguage, builtInLabel, LANGUAGE_NAMES, preferredBuiltIn, useBuiltInVoices } from './read-aloud.tsx';

/** A length of time as people say it: "40 seconds", "12 minutes", "2 hours 5 minutes". */
export function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t('{n} s', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('{n} min', { n: m });
  return m % 60 ? t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) : t('{h} h', { h: m / 60 });
}

/** Seconds left, once enough is done to tell. */
function timeLeft(job: AudiobookJob, now: number): number | null {
  const part = job.words ? job.done / job.words : 0;
  if (part < 0.02) return null;
  const spent = (now - job.started) / 1000;
  return (spent * (1 - part)) / part;
}

export function AudiobookDialog({ world, onStart, onClose }: { world: World; onStart: (voice: BuiltInVoice) => void; onClose: () => void }) {
  const job = useAudiobook();
  const busy = audiobookBusy(job);
  const voices = useBuiltInVoices();
  const language = useMemo(() => bookLanguage(world), [world]);
  const mine = voices.filter((v) => v.language === language);
  const [chosen, setChosen] = useState<string | null>(null);
  const voice = mine.find((v) => v.id === chosen) ?? preferredBuiltIn(mine, language);
  const chapters = writtenChapters(world);
  const words = chapters.reduce((n, c) => n + wordCount(c.body), 0);
  // The time shown while it reads moves on by itself.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const close = (): void => {
    if (!busy) clearAudiobook();
    onClose();
  };

  if (job && busy) {
    const part = job.words ? job.done / job.words : 0;
    const left = timeLeft(job, now);
    return (
      <Dialog class="audiobook-dialog" title={t('Audiobook: {title}', { title: job.title })} onClose={close}
        footer={<>
          <button type="button" class="ghost danger audiobook-stop" disabled={job.state === 'saving'} onClick={stopAudiobook}><Icon name="stop-button" /> {t('Stop')}</button>
          <button type="button" class="primary" onClick={close}>{t('Keep working')}</button>
        </>}>
        <p class="audiobook-now" role="status">
          {job.state === 'saving' ? t('Writing the file…') : job.chapter ? t('Reading chapter {n} of {total}: {title}', { n: job.chapter, total: job.chapters, title: job.chapterTitle }) : t('Reading the title…')}
        </p>
        <div class="audiobook-bar" role="progressbar" aria-label={t('How far the audiobook is')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(part * 100)}>
          <div style={{ width: `${Math.min(100, part * 100)}%` }} />
        </div>
        <p class="muted small">
          {t('{percent}% · {sound} of sound so far · {spent} spent', { percent: Math.floor(part * 100), sound: spokenTime(job.seconds), spent: spokenTime((now - job.started) / 1000) })}
          {left !== null && ` · ${t('about {time} left', { time: spokenTime(left) })}`}
        </p>
        <p class="muted small">{t('Read by {voice}. You can close this and keep working; the top bar shows how far it is.', { voice: job.reader })}</p>
      </Dialog>
    );
  }

  if (job) {
    return (
      <Dialog class="audiobook-dialog" title={t('Audiobook: {title}', { title: job.title })} onClose={close}
        footer={<>
          {job.state === 'done' && <button type="button" class="ghost" onClick={() => void window.lore.showInFolder(job.file)}><Icon name="open-folder" /> {t('Show in folder')}</button>}
          <button type="button" class="primary" onClick={close}>{t('Close')}</button>
        </>}>
        {job.state === 'done' && (
          <p role="status"><Icon name="check-mark" class="ok-mark" /> {t('Saved: {sound} of sound, {size} MB, with a mark at each chapter.', { sound: spokenTime(job.seconds), size: num(Math.round(((job.bytes ?? 0) / 1048576) * 10) / 10) })}</p>
        )}
        {job.state === 'done' && <p class="muted small audiobook-file">{job.file}</p>}
        {job.state === 'stopped' && <p role="status">{t('Stopped. Nothing was saved.')}</p>}
        {job.state === 'failed' && <p class="error-line" role="alert"><Icon name="hazard-sign" /> {t('The audiobook could not be made: {error}', { error: job.error ?? '' })}</p>}
      </Dialog>
    );
  }

  const ready = chapters.length > 0 && !!voice;
  return (
    <Dialog class="audiobook-dialog" title={t('Save as an audiobook')} onClose={close}
      footer={<>
        <button type="button" class="ghost" onClick={close}>{t('Cancel')}</button>
        <button type="button" class="primary audiobook-start" disabled={!ready} onClick={() => voice && onStart(voice)}><Icon name="speaker" /> {t('Save audiobook…')}</button>
      </>}>
      <p>{t('A Lore-Forge voice reads the story into one sound file, with a mark at each chapter. It is made on this computer, without the internet, and you can keep working while it reads.')}</p>
      {!chapters.length ? (
        <p class="hint">{t('The story has no chapters with text yet.')}</p>
      ) : !mine.length ? (
        <p class="hint">{voices.length ? t('Lore-Forge has no {language} voice yet, so it cannot read this book.', { language: LANGUAGE_NAMES()[language] }) : t('Lore-Forge’s voices do not run on this computer.')}</p>
      ) : (
        <>
          <label class="field audiobook-voice">
            <span>{t('Voice')}</span>
            <Select value={voice?.id ?? ''} options={mine.map((v) => ({ value: v.id, label: builtInLabel(v) }))} onChange={setChosen} aria-label={t('Voice')} />
          </label>
          <p class="muted">
            {chapters.length === 1
              ? t('One chapter, {words} words: about {time} of listening.', { words: num(words), time: spokenTime(listeningMinutes(words) * 60) })
              : t('{n} chapters, {words} words: about {time} of listening.', { n: chapters.length, words: num(words), time: spokenTime(listeningMinutes(words) * 60) })}
          </p>
          <p class="muted small">{t('It is saved as an Opus file (.opus). It plays in VLC, on Windows and Android, and in web browsers; Apple Books does not open it. Names with a Pronunciation are said the way it is written.')}</p>
        </>
      )}
    </Dialog>
  );
}

/** In the top bar while an audiobook is being made: how far it is; it opens the dialog. */
export function AudiobookChip({ onOpen }: { onOpen: () => void }) {
  const job = useAudiobook();
  if (!job || !audiobookBusy(job)) return null;
  const percent = job.words ? Math.floor((job.done / job.words) * 100) : 0;
  return (
    <button type="button" class="ghost small audiobook-chip" onClick={onOpen} title={t('The audiobook being made: how far it is, or stop it')}>
      <Icon name="speaker" /> {job.state === 'saving' ? t('Audiobook: saving') : t('Audiobook {n}%', { n: percent })}
    </button>
  );
}
