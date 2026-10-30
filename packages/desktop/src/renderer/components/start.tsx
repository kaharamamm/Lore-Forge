import { useEffect, useState } from 'preact/hooks';

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
  return (
    <main class="start">
      <h1>Lore-Forge</h1>
      <p class="muted">Write the worlds, lore and characters of your games. Each world is a plain folder you can keep in git.</p>
      {(error || problem) && <p class="error-line" role="alert"><span aria-hidden="true">✖ </span>{error ?? problem}</p>}
      <div class="start-actions">
        <button type="button" class="primary" onClick={() => void run(() => window.lore.pickWorld())}>Open world folder…</button>
        {example && <button type="button" class="ghost" onClick={() => onOpen(example)}>Open example world</button>}
      </div>
      <form class="create" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => window.lore.createWorld(name.trim())); }}>
        <label for="world-name">New world name</label>
        <div class="row">
          <input id="world-name" type="text" placeholder="e.g. The Shifting Sands" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          <button type="submit" class="ghost" disabled={!name.trim()}>Create world…</button>
        </div>
      </form>
      {recent.length > 0 && (
        <section>
          <h2>Recent worlds</h2>
          <ul class="recent">
            {recent.map((d) => (
              <li key={d}><button type="button" class="link" onClick={() => onOpen(d)}>{d}</button></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
