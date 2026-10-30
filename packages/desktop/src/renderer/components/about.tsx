import { useEffect, useRef } from 'preact/hooks';
import { GENERATOR, ICON_CREDITS } from '@lore-forge/core';
import { Icon } from './icon.tsx';

const CREDITS: [string, string, string, string][] = [
  ['Icons', `${ICON_CREDITS.name}, by ${ICON_CREDITS.authors}`, ICON_CREDITS.license, ICON_CREDITS.url],
  ['Title font', 'Cinzel, by Natanael Gama and the Cinzel Project Authors', 'SIL Open Font License 1.1', 'https://github.com/NDISCOVER/Cinzel'],
  ['PDF fonts', 'DejaVu Sans, Serif and Mono', 'Bitstream Vera / DejaVu licence (free)', 'https://dejavu-fonts.github.io'],
  ['Relationship web', 'React Flow (@xyflow/react), run through preact/compat', 'MIT', 'https://reactflow.dev'],
  ['Pan and zoom (family tree, timeline)', 'd3-zoom and d3-selection', 'ISC', 'https://d3js.org'],
  ['Motion', '@formkit/auto-animate and CSS View Transitions', 'MIT', 'https://auto-animate.formkit.com'],
  ['UI', 'Preact', 'MIT', 'https://preactjs.com'],
  ['PDF', 'PDFKit', 'MIT', 'https://pdfkit.org'],
];

/** About and credits: who made the icons and fonts, and their licences (CC BY needs the attribution). */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section class="about" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header class="about-head">
          <Icon name="laurels" class="about-mark" />
          <div>
            <h2 id="about-title">Lore-Forge</h2>
            <p class="muted">{GENERATOR}. Your worlds stay plain Markdown files on your disk.</p>
          </div>
          <button ref={close} type="button" class="ghost small" onClick={onClose}>Close</button>
        </header>
        <h3>Credits and licences</h3>
        <dl class="credits">
          {CREDITS.map(([what, who, license, url]) => (
            <div key={what} class="credit">
              <dt>{what}</dt>
              <dd>{who}. <span class="muted">{license}.</span> <a href={url} target="_blank" rel="noreferrer">{url.replace(/^https:\/\//, '')}</a></dd>
            </div>
          ))}
        </dl>
        <p class="muted small-print">Game icons are used unchanged except for colour and size, under {ICON_CREDITS.license} ({ICON_CREDITS.licenseUrl}).</p>
      </section>
    </div>
  );
}
