import { useEffect, useRef } from 'preact/hooks';
import { GENERATOR, ICON_CREDITS } from '@lore-forge/core';
import { t } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { UpdatesSection } from './updates.tsx';

/** The credits, made when shown so they are in the app's language; proper names and licences stay as they are. */
const credits = (): [string, string, string, string][] => [
  [t('Icons'), t('{name}, by {authors}', { name: ICON_CREDITS.name, authors: t(ICON_CREDITS.authors) }), ICON_CREDITS.license, ICON_CREDITS.url],
  [t('Title font'), t('Cinzel, by Natanael Gama and the Cinzel Project Authors'), 'SIL Open Font License 1.1', 'https://github.com/NDISCOVER/Cinzel'],
  [t('PDF fonts'), t('DejaVu Sans, Serif and Mono'), t('Bitstream Vera / DejaVu licence (free)'), 'https://dejavu-fonts.github.io'],
  [t('Relationship web'), t('React Flow (@xyflow/react), run through preact/compat'), 'MIT', 'https://reactflow.dev'],
  [t('Pan and zoom (family tree, timeline)'), t('d3-zoom and d3-selection'), 'ISC', 'https://d3js.org'],
  [t('Motion'), t('@formkit/auto-animate and CSS View Transitions'), 'MIT', 'https://auto-animate.formkit.com'],
  [t('UI'), 'Preact', 'MIT', 'https://preactjs.com'],
  ['PDF', 'PDFKit', 'MIT', 'https://pdfkit.org'],
  [t('3D model viewer'), t('three.js (GLTF, OBJ and FBX loaders, OrbitControls), loaded only when a model is shown'), 'MIT', 'https://threejs.org'],
  [t('Self-update'), 'electron-updater (electron-builder)', 'MIT', 'https://www.electron.build/auto-update'],
  [t('AI apps (MCP server)'), t('MCP TypeScript SDK and zod'), 'MIT', 'https://modelcontextprotocol.io'],
  [t('Zip files (Word files, shared book files)'), 'fflate', 'MIT', 'https://github.com/101arrowz/fflate'],
];

/** About and credits: who made the icons and fonts, and their licences (CC BY needs the attribution). */
export function AboutDialog({ onClose, onTour }: { onClose: () => void; onTour?: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const rows = credits();
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
            <p class="muted">{t('{generator}, open source under the MIT licence. Your worlds stay plain Markdown files on your disk.', { generator: GENERATOR })}</p>
          </div>
          <button ref={close} type="button" class="ghost small" onClick={onClose}>{t('Close')}</button>
        </header>
        <div class="dialog-body">
          <UpdatesSection />
          {onTour && <p class="about-tour-line"><button type="button" class="ghost small about-tour" onClick={onTour}><Icon name="direction-signs" /> {t('Take the tour')}</button> <span class="muted">{t('A short walk through Lore-Forge with the sample world.')}</span></p>}
          {/* The licences ask for the credits (CC BY 3.0 for the icons, the OFL for the fonts), so they stay, folded. */}
          <details class="credits-box">
            <summary><Icon name="laurels" class="credits-mark" /> <span class="credits-title">{t('Credits and licences')}</span> <span class="muted credits-count">{t('{n} open-source parts', { n: rows.length })}</span></summary>
            <dl class="credits">
              {rows.map(([what, who, license, url]) => (
                <div key={what} class="credit">
                  <dt>{what}</dt>
                  <dd>{who}. <span class="muted">{license}.</span> <a href={url} target="_blank" rel="noreferrer">{url.replace(/^https:\/\//, '')}</a></dd>
                </div>
              ))}
            </dl>
            <p class="muted small-print">{t('Game icons are used unchanged except for colour and size, under {license} ({url}). The genderless sign is drawn for Lore-Forge.', { license: ICON_CREDITS.license, url: ICON_CREDITS.licenseUrl })}</p>
          </details>
        </div>
      </section>
    </div>
  );
}
