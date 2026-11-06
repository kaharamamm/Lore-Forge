import { useEffect, useState } from 'preact/hooks';
import { bookLook, parseWorld, storyBook, type Doc, type TrimSize } from '@lore-forge/core';
import { CoverSheet, lookVars } from './preview.tsx';

declare global {
  interface Window { __coverReady?: string }
}

const frames = () => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));

/**
 * The Story Book cover alone, filling the window, for the Word export: the main process loads this in a hidden
 * window and captures it, so Word gets the same cover as the preview and the PDF. `window.__coverReady` is "ok" once
 * the picture and fonts are drawn, "none" when the world has no cover art, or an error message.
 */
export function CoverCapture({ dir, trim }: { dir: string; trim?: TrimSize }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => {
    void (async () => {
      const d = storyBook(parseWorld(await window.lore.readWorld(dir)), trim ? { trim } : {});
      if (!d.cover.art) { window.__coverReady = 'none'; return; }
      setDoc(d);
    })().catch((e: Error) => { window.__coverReady = `error: ${e.message}`; });
  }, []);
  useEffect(() => {
    if (!doc) return;
    void (async () => {
      // The picture comes through useImage; wait for it in the page, then decode it, then the fonts.
      const want = !!doc.cover.art?.image;
      for (let i = 0; want && i < 200 && !document.querySelector('.cover-capture image'); i++) await new Promise((ok) => setTimeout(ok, 25));
      const href = document.querySelector('.cover-capture image')?.getAttribute('href');
      if (href) { const img = new Image(); img.src = href; await img.decode().catch(() => {}); }
      await document.fonts.ready;
      await frames();
      await new Promise((ok) => setTimeout(ok, 150));
      window.__coverReady = 'ok';
    })();
  }, [doc]);
  if (!doc) return null;
  return (
    <div class="cover-capture preview-pages is-book" style={lookVars(doc.print?.look ?? bookLook(), 1)}>
      <CoverSheet doc={doc} dir={dir} />
    </div>
  );
}
