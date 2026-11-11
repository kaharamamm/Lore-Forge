/**
 * Read aloud: a chapter read sentence by sentence, by the voices Lore-Forge brings (English voices that run on this
 * computer, offline: main/voice.ts) or by the computer's own voices. The sentence being read is marked in the text and
 * kept in view; Pause, Stop, the voice and the speed sit in a bar under the text. A built-in voice makes the next
 * sentence while one is read, and pauses mid-sentence. The voice is remembered for each language, the speed for all.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { World } from '@lore-forge/core';
import { confidentLanguage, pickVoice, textLanguage, type ReadPart } from '../reading.ts';
import type { BuiltInVoice, SpokenName } from '../../shared/voices.ts';
import { t } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { Select, type SelectOption } from './select.tsx';

const RATES = [0.75, 1, 1.25, 1.5];
const RATE_KEY = 'lore:read-rate';
const voiceKey = (lang: string) => `lore:read-voice:${lang}`;
const stored = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* reading still works */ } };
/** A voice in the list: "lore:<id>" for a built-in voice, "system:<name>" for one of the computer's. */
const BUILT_IN = 'lore:';
const SYSTEM = 'system:';

/** Where this system adds voices, for a computer with none, or none for the text's language. */
export function addVoicesHint(): string {
  const p = navigator.platform.toLowerCase();
  if (p.includes('win')) return t('Windows adds voices under Settings → Time & language → Speech.');
  if (p.includes('mac')) return t('macOS adds voices under System Settings → Accessibility → Spoken Content.');
  return t('On Linux, install speech-dispatcher and a voice such as espeak-ng, then start Lore-Forge again.');
}

export const LANGUAGE_NAMES = (): Record<'tr' | 'en', string> => ({ en: t('English'), tr: t('Turkish') });
const speaks = (v: SpeechSynthesisVoice, lang: string): boolean => v.lang.toLowerCase().replace('_', '-').startsWith(lang);

/** The voices this computer has; the list can arrive a moment after the window opens. */
function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices()));
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const update = () => setVoices(speechSynthesis.getVoices());
    update();
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

/** The voices Lore-Forge brings that this computer can run (none on an Intel Mac, or a build without them). */
export function useBuiltInVoices(): BuiltInVoice[] {
  const [voices, setVoices] = useState<BuiltInVoice[]>([]);
  useEffect(() => {
    let live = true;
    window.lore.builtInVoices().then((v) => { if (live) setVoices(v); }, () => {});
    return () => { live = false; };
  }, []);
  return voices;
}

/** Up to 20,000 characters of a book's own text: its story, or its entries' text while it has no story. */
function bookText(world: World): string {
  const take = (parts: Iterable<string>): string => {
    let text = '';
    for (const p of parts) {
      text += `${p}\n`;
      if (text.length >= 20000) break;
    }
    return text.slice(0, 20000);
  };
  const story = take((world.story ?? []).map((c) => c.body));
  return story.trim() ? story : take(world.entries.map((e) => `${e.summary ?? ''}\n${e.body}`));
}

/** The language a book is written in, English when its text does not say. */
export function bookLanguage(world: World): 'tr' | 'en' {
  return textLanguage(bookText(world));
}

/** The language a book is written in, only when its text says so (book titles and names are marked with it). */
export function bookTextLanguage(world: World): 'tr' | 'en' | undefined {
  return confidentLanguage(bookText(world));
}

/** The built-in voice for a language that Read aloud uses: the one chosen there last, else the first. */
export function preferredBuiltIn(voices: readonly BuiltInVoice[], language: 'tr' | 'en'): BuiltInVoice | undefined {
  const before = stored(voiceKey(language));
  return voices.find((b) => b.language === language && `${BUILT_IN}${b.id}` === before) ?? voices.find((b) => b.language === language);
}

/** How a built-in voice is named in a list: "Heart (American)", or a Piper voice's own name. */
export function builtInLabel(b: BuiltInVoice): string {
  return b.engine === 'piper' ? b.name : b.accent === 'gb' ? t('{name} (British)', { name: b.name }) : t('{name} (American)', { name: b.name });
}

/** The book's names that have a pronunciation, said the way their authors wrote them. */
export function spokenNamesOf(world: World): SpokenName[] {
  return world.entries.filter((e) => e.pronunciation?.trim() && e.name.trim()).map((e) => ({ name: e.name, say: e.pronunciation! }));
}

/**
 * Says a name as its pronunciation reads, in the built-in voice chosen for a language (or the first one for it): the
 * Hear button next to an entry's pronunciation. Null when no built-in voice speaks that language.
 */
export function useHearName(language: 'tr' | 'en'): ((name: string, say: string) => Promise<void>) | null {
  const builtIn = useBuiltInVoices();
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => () => { void ctx.current?.close(); }, []);
  const voice = preferredBuiltIn(builtIn, language);
  if (!voice) return null;
  return async (name, say) => {
    const speech = await window.lore.speakBuiltIn(name, voice.id, 1, say.trim() ? [{ name, say }] : []);
    if (!speech.audio.length) return;
    ctx.current ??= new AudioContext();
    const c = ctx.current;
    if (c.state === 'suspended') await c.resume();
    const buffer = c.createBuffer(1, speech.audio.length, speech.sampleRate);
    buffer.getChannelData(0).set(speech.audio);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.start();
  };
}

export interface ReadAloud {
  /** Some voice can read: a built-in one or one of the computer's. */
  available: boolean;
  /** The sentence being read (also while paused), to mark in the text; null when not reading. */
  part: ReadPart | null;
  start: (parts: ReadPart[], text: string) => void;
  stop: () => void;
  bar: preact.ComponentChildren;
}

type Speech = { audio: Float32Array; sampleRate: number };
interface Sound { ctx: AudioContext; source: AudioBufferSourceNode | null; made: Map<number, Promise<Speech>> }

/**
 * Reading aloud for one text; it stops when `text` changes (another chapter, or an edit) and when the view goes. The
 * built-in voices say `names` (the book's names with a pronunciation) the way their authors wrote them.
 */
export function useReadAloud(text: string, names: readonly SpokenName[] = []): ReadAloud {
  const systemVoices = useSystemVoices();
  const builtIn = useBuiltInVoices();
  const said = useRef(names);
  said.current = names;
  const [parts, setParts] = useState<ReadPart[] | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A built-in voice is still making the sentence that should be playing (the voice just changed, or reading starts).
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState<'tr' | 'en'>('en');
  const [voice, setVoice] = useState<string | null>(null);
  const [rate, setRate] = useState(() => { const r = Number(stored(RATE_KEY)); return RATES.includes(r) ? r : 1; });
  // Each sentence belongs to a run; one from an earlier run (stopped, or a new voice or speed) is ignored.
  const run = useRef(0);
  // The sentences asked of the voice process go in a batch, which a new voice or speed drops while they still wait.
  const batch = useRef({ name: `read-${Math.random().toString(36).slice(2)}`, n: 0 });
  const batchName = (): string => `${batch.current.name}:${batch.current.n}`;
  const sound = useRef<Sound | null>(null);
  const live = useRef({ parts, voice, rate, index });
  live.current = { parts, voice, rate, index };

  /** Whatever is playing goes quiet. */
  const quiet = (): void => {
    run.current++;
    setLoading(false);
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    const s = sound.current;
    if (s?.source) { s.source.onended = null; s.source.stop(); s.source = null; }
  };
  /** Quiet, and the sentences made for the old voice or speed are dropped, the waiting ones before they are made. */
  const hush = (): void => {
    quiet();
    if (sound.current?.made.size) {
      window.lore.dropSpeech(batchName());
      batch.current.n++;
    }
    sound.current?.made.clear();
  };
  const stop = (): void => {
    hush();
    // The sound card is let go until the next reading.
    if (sound.current?.ctx.state === 'running') void sound.current.ctx.suspend();
    setParts(null);
    setPaused(false);
    setProblem(null);
  };

  /** A sentence in a built-in voice, made once and kept until the voice or speed changes. */
  const made = (i: number, list: ReadPart[]): Promise<Speech> | undefined => {
    const s = sound.current;
    const v = live.current.voice;
    if (!s || !v?.startsWith(BUILT_IN) || i >= list.length) return undefined;
    let p = s.made.get(i);
    if (!p) {
      p = window.lore.speakBuiltIn(list[i]!.say, v.slice(BUILT_IN.length), live.current.rate, [...said.current], batchName());
      p.catch(() => {});
      s.made.set(i, p);
    }
    return p;
  };

  const say = (i: number, list = live.current.parts): void => {
    quiet();
    const mine = run.current;
    if (!list || i >= list.length) return stop();
    setIndex(i);
    setPaused(false);
    setProblem(null);
    const v = live.current.voice ?? '';
    if (v.startsWith(BUILT_IN)) {
      sound.current ??= { ctx: new AudioContext(), source: null, made: new Map() };
      const s = sound.current;
      // Sentences already read are let go, so a long chapter does not pile up in memory.
      for (const k of s.made.keys()) if (k < i) s.made.delete(k);
      void (async () => {
        // A sentence that takes a moment (a new voice, the first one) shows that the voice is loading.
        const slow = setTimeout(() => { if (run.current === mine) setLoading(true); }, 250);
        let speech: Speech;
        try {
          speech = await made(i, list)!;
        } catch (err) {
          clearTimeout(slow);
          if (run.current !== mine) return;
          setLoading(false);
          setPaused(true);
          setProblem(t('The voice could not read this: {error}', { error: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
          return;
        }
        clearTimeout(slow);
        if (run.current !== mine) return;
        setLoading(false);
        // Nothing to say (a line of dashes, say): on to the next sentence.
        if (!speech.audio.length) return say(i + 1, list);
        // The next sentence is made while this one is read.
        void made(i + 1, list);
        if (s.ctx.state === 'suspended') await s.ctx.resume();
        const buffer = s.ctx.createBuffer(1, speech.audio.length, speech.sampleRate);
        buffer.getChannelData(0).set(speech.audio);
        const source = s.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(s.ctx.destination);
        source.onended = () => { if (run.current === mine) say(i + 1, list); };
        s.source = source;
        source.start();
      })();
      return;
    }
    const u = new SpeechSynthesisUtterance(list[i]!.say);
    const sys = speechSynthesis.getVoices().find((x) => `${SYSTEM}${x.name}` === v);
    if (sys) {
      u.voice = sys;
      u.lang = sys.lang;
    }
    u.rate = live.current.rate;
    u.onend = () => { if (run.current === mine) say(i + 1, list); };
    u.onerror = (e) => { if (run.current === mine && e.error !== 'interrupted' && e.error !== 'canceled') stop(); };
    speechSynthesis.speak(u);
  };

  /** The voice to read a language with: the one chosen before, else a built-in voice for it, else the computer's. */
  const voiceFor = (language: 'tr' | 'en'): string | null => {
    const before = stored(voiceKey(language));
    if (before?.startsWith(BUILT_IN) && builtIn.some((b) => `${BUILT_IN}${b.id}` === before)) return before;
    if (before?.startsWith(SYSTEM) && systemVoices.some((x) => `${SYSTEM}${x.name}` === before)) return before;
    const own = builtIn.find((b) => b.language === language);
    if (own) return `${BUILT_IN}${own.id}`;
    const sys = pickVoice(systemVoices, language, before?.startsWith(SYSTEM) ? before.slice(SYSTEM.length) : null);
    return sys ? `${SYSTEM}${sys.name}` : builtIn.length ? `${BUILT_IN}${builtIn[0]!.id}` : null;
  };

  const start = (list: ReadPart[], whole: string): void => {
    if (!list.length) return;
    const language = textLanguage(whole);
    const v = voiceFor(language);
    setLang(language);
    setVoice(v);
    live.current = { ...live.current, parts: list, voice: v };
    setParts(list);
    say(0, list);
  };
  const pause = (): void => {
    const s = sound.current;
    if (live.current.voice?.startsWith(BUILT_IN) && s?.source) void s.ctx.suspend();
    else hush();
    setPaused(true);
  };
  const resume = (): void => {
    const s = sound.current;
    // A built-in voice goes on mid-sentence; the computer's voices start the sentence again.
    if (live.current.voice?.startsWith(BUILT_IN) && s?.source && !problem) {
      void s.ctx.resume();
      setPaused(false);
    } else say(index);
  };

  // Another chapter, or the text changed under the reading: stop. Leaving the Story stops it too.
  useEffect(() => { if (live.current.parts) stop(); }, [text]);
  useEffect(() => () => {
    hush();
    void sound.current?.ctx.close();
  }, []);

  const change = (): void => {
    hush();
    const s = sound.current;
    if (s?.ctx.state === 'suspended') void s.ctx.resume();
    if (parts) say(live.current.index);
  };
  const changeVoice = (v: string): void => {
    setVoice(v);
    store(voiceKey(lang), v);
    live.current = { ...live.current, voice: v };
    change();
  };
  const changeRate = (value: string): void => {
    const r = Number(value);
    setRate(r);
    store(RATE_KEY, String(r));
    live.current = { ...live.current, rate: r };
    change();
  };

  // Lore-Forge's voices first, those for the text's language before the others; then the computer's, the same way
  // (macOS has dozens).
  const mine = systemVoices.filter((v) => speaks(v, lang));
  const others = systemVoices.filter((v) => !speaks(v, lang));
  const ownFirst = [...builtIn].sort((a, b) => Number(b.language === lang) - Number(a.language === lang));
  const builtInLanguages = new Set(builtIn.map((b) => b.language));
  const groups = builtInLanguages.size + Number(mine.length > 0) + Number(others.length > 0) > 1;
  const voiceOptions: SelectOption[] = [
    ...ownFirst.map((b) => ({ value: `${BUILT_IN}${b.id}`, label: builtInLabel(b), ...(groups ? { group: t('Lore-Forge voices, {language}', { language: LANGUAGE_NAMES()[b.language] }) } : {}) })),
    ...mine.map((v) => ({ value: `${SYSTEM}${v.name}`, label: v.name, ...(groups ? { group: t('{language} voices on this computer', { language: LANGUAGE_NAMES()[lang] }) } : {}) })),
    ...others.map((v) => ({ value: `${SYSTEM}${v.name}`, label: v.name, ...(groups ? { group: t('Other voices on this computer') } : {}) })),
  ];
  const missing = mine.length === 0 && !builtInLanguages.has(lang);
  const bar = parts && (
    <div class="read-bar" role="group" aria-label={t('Reading aloud')} aria-busy={loading || undefined}>
      <button type="button" class="small read-pause" onClick={() => (paused ? resume() : pause())}>
        <Icon name={paused ? 'play-button' : 'pause-button'} /> {paused ? t('Resume') : t('Pause')}
      </button>
      <button type="button" class="ghost small read-stop" onClick={stop}><Icon name="stop-button" /> {t('Stop')}</button>
      {loading
        ? <span class="small read-loading" role="status"><span class="read-spinner" aria-hidden="true" /> {t('Loading the voice…')}</span>
        : <span class="muted small read-progress" aria-live="off">{t('Sentence {n} of {total}', { n: index + 1, total: parts.length })}</span>}
      <span class="read-choices">
        <Select class="read-voice" value={voice ?? ''} aria-label={t('Voice')} placeholder={t('Voice')} options={voiceOptions} onChange={changeVoice} />
        <Select class="read-rate" value={String(rate)} aria-label={t('Speed')} options={RATES.map((r) => ({ value: String(r), label: `${r}×` }))} onChange={changeRate} />
      </span>
      {problem && <p class="small read-problem" role="alert"><Icon name="hazard-sign" /> {problem}</p>}
      {missing && <p class="muted small read-missing">{t('No {language} voice on this computer, so another voice reads it.', { language: LANGUAGE_NAMES()[lang] })} {addVoicesHint()}</p>}
    </div>
  );
  return { available: builtIn.length > 0 || systemVoices.length > 0, part: parts ? parts[index] ?? null : null, start, stop, bar };
}
