import { useEffect, useRef } from 'preact/hooks';
import { GENERATOR, ICON_CREDITS } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { UpdatesSection } from './updates.tsx';

const CREDITS: [string, string, string, string][] = [
  ['Icons', `${ICON_CREDITS.name}, by ${ICON_CREDITS.authors}`, ICON_CREDITS.license, ICON_CREDITS.url],
  ['Title font', 'Cinzel, by Natanael Gama and the Cinzel Project Authors', 'SIL Open Font License 1.1', 'https://github.com/NDISCOVER/Cinzel'],
  ['PDF fonts', 'DejaVu Sans, Serif and Mono', 'Bitstream Vera / DejaVu licence (free)', 'https://dejavu-fonts.github.io'],
  ['Relationship web', 'React Flow (@xyflow/react), run through preact/compat', 'MIT', 'https://reactflow.dev'],
  ['Pan and zoom (family tree, timeline)', 'd3-zoom and d3-selection', 'ISC', 'https://d3js.org'],
  ['Motion', '@formkit/auto-animate and CSS View Transitions', 'MIT', 'https://auto-animate.formkit.com'],
  ['UI', 'Preact', 'MIT', 'https://preactjs.com'],
  ['PDF', 'PDFKit', 'MIT', 'https://pdfkit.org'],
  ['3D model viewer', 'three.js (GLTF, OBJ and FBX loaders, OrbitControls), loaded only when a model is shown', 'MIT', 'https://threejs.org'],
  ['Self-update', 'electron-updater (electron-builder)', 'MIT', 'https://www.electron.build/auto-update'],
];

/** About and credits: who made the icons and fonts, and their licences (CC BY needs the attribution). */
export function AboutDialog({ onClose, onTour }: { onClose: () => void; onTour?: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="modal-backdrop about-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* Centred in the window; the head stays put and only the body scrolls. */}
      <section class="about about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header class="about-head dialog-head">
          <Icon name="laurels" class="about-mark" />
          <div>
            <h2 id="about-title">Lore-Forge</h2>
            <p class="muted">{GENERATOR}, open source under the MIT licence. Your worlds stay plain Markdown files on your disk.</p>
          </div>
          <button ref={close} type="button" class="ghost small" onClick={onClose}>Close</button>
        </header>
        <div class="dialog-body">
          <UpdatesSection />
          {onTour && <p class="about-tour-line"><button type="button" class="ghost small about-tour" onClick={onTour}><Icon name="direction-signs" /> Take the tour</button> <span class="muted">A short walk through Lore-Forge with the sample world.</span></p>}
          {/* The licences ask for the credits (CC BY 3.0 for the icons, the OFL for the fonts), so they stay, folded. */}
          <details class="credits-box">
            <summary><Icon name="laurels" class="credits-mark" /> <span class="credits-title">Credits and licences</span> <span class="muted credits-count">{CREDITS.length} open-source parts</span></summary>
            <dl class="credits">
              {CREDITS.map(([what, who, license, url]) => (
                <div key={what} class="credit">
                  <dt>{what}</dt>
                  <dd>{who}. <span class="muted">{license}.</span> <a href={url} target="_blank" rel="noreferrer">{url.replace(/^https:\/\//, '')}</a></dd>
                </div>
              ))}
            </dl>
            <p class="muted small-print">Game icons are used unchanged except for colour and size, under {ICON_CREDITS.license} ({ICON_CREDITS.licenseUrl}).</p>
          </details>
        </div>
      </section>
    </div>
  );
}
