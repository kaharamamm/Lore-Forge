import { useEffect, useState } from 'preact/hooks';
import { ENTRY_TYPES, parseWorld, TYPE_ICON, TYPE_LABELS, type World } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { useCoverImage, WorldCover } from './cover.tsx';
import { animated } from '../motion.ts';

/** A world as a book on the shelf: generated cover, its picture if it has one, name and what is inside. */
function WorldCard({ dir, label, onOpen }: { dir: string; label?: string; onOpen: (dir: string) => void }) {
  const [world, setWorld] = useState<World | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void window.lore.peekWorld(dir).then((files) => {
      if (!live) return;
      try { setWorld(files ? parseWorld(files) : null); } catch { setWorld(null); }
    });
    return () => void (live = false);
  }, [dir]);
  const cover = useCoverImage(dir, world?.entries);
  const name = world?.manifest.name ?? dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  const counts = world ? ENTRY_TYPES.map((t) => [t, world.entries.filter((e) => e.type === t).length] as const).filter(([, n]) => n) : [];
  return (
    <li class="world-card">
      <button type="button" class="world-book" onClick={() => onOpen(dir)} disabled={world === null} title={dir} aria-describedby={`wc-${encodeURIComponent(dir)}`}>
        <span class="world-cover">
          <WorldCover seed={world?.manifest.id ?? name} image={cover} />
          <span class="cover-title">{name}</span>
          {label && <span class="cover-ribbon">{label}</span>}
        </span>
      </button>
      <div class="world-meta" id={`wc-${encodeURIComponent(dir)}`}>
        {world === undefined && <span class="muted">Reading…</span>}
        {world === null && <span class="muted"><Icon name="hazard-sign" /> Folder missing or not a world</span>}
        {world && (
          <>
            <span class="world-count">{world.entries.length} {world.entries.length === 1 ? 'entry' : 'entries'}</span>
            <span class="world-types">{counts.map(([t, n]) => <span key={t} class={`t-${t}`} title={TYPE_LABELS[t]}><Icon name={TYPE_ICON[t]} label={TYPE_LABELS[t]} /> {n}</span>)}</span>
          </>
        )}
        <span class="muted world-path">{dir}</span>
      </div>
    </li>
  );
}

export function StartScreen({ onOpen, error }: { onOpen: (dir: string) => void; error: string | null }) {
  const [recent, setRecent] = useState<string[]>([]);
  const [example, setExample] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void window.lore.recentWorlds().then(setRecent);
    void window.lore.exampleWorld().then(setExample);
  }, []);
  const run = async (f: () => Promise<string | null>) => {
    try {
      setProblem(null);
      const dir = await f();
      if (dir) onOpen(dir);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const shelf = [...recent, ...(example && !recent.includes(example) ? [example] : [])];
  return (
    <main class="start">
      <header class="start-hero">
        <Icon name="quill-ink" class="start-mark" />
        <div>
          <h1>Lore-Forge</h1>
          <p class="muted">Write the worlds, lore and characters of your games. Each world is a plain folder you can keep in git.</p>
        </div>
      </header>
      {(error || problem) && <p class="error-line" role="alert"><Icon name="cancel" /> {error ?? problem}</p>}
      <div class="start-actions">
        <button type="button" class="primary" onClick={() => void run(() => window.lore.pickWorld())}><Icon name="files" /> Open world folder…</button>
        <form class="create" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => window.lore.createWorld(name.trim())); }}>
          <label for="world-name" class="sr-only">New world name</label>
          <input id="world-name" type="text" placeholder="New world name, e.g. The Shifting Sands" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          <button type="submit" class="ghost" disabled={!name.trim()}><Icon name="sprout" /> Create world…</button>
        </form>
      </div>
      {shelf.length > 0 && (
        <section aria-labelledby="shelf-title">
          <h2 id="shelf-title">{recent.length ? 'Your worlds' : 'Start with the example'}</h2>
          <ul class="shelf" ref={animated}>
            {shelf.map((d) => <WorldCard key={d} dir={d} label={d === example ? 'Example' : undefined} onOpen={onOpen} />)}
          </ul>
        </section>
      )}
    </main>
  );
}
