import type { IconName } from '@lore-forge/core';
import { t } from '../i18n.tsx';
import { Dialog } from './dialog.tsx';
import { Icon } from './icon.tsx';

export type ShareKind = 'file' | 'site' | 'data';

/** Share… on World Home: the book as one file, as a website, or as game data. Each choice then asks where to save. */
export function ShareDialog({ onChoose, onClose }: { onChoose: (kind: ShareKind) => void; onClose: () => void }) {
  const choices: [ShareKind, IconName, string, string][] = [
    ['file', 'envelope', t('Book file'), t('The whole book in one .loreforge file, to send to someone with Lore-Forge or to keep as a backup.')],
    ['site', 'world', t('Website'), t('Pages anyone can open in a browser, even offline: every entry, the maps, the timeline and the story, with the pictures.')],
    ['data', 'perspective-dice-six-faces-random', t('Game data'), t('One JSON file with every entry, date, link and pin, with the pictures and 3D models next to it, for a game engine or your own tools.')],
  ];
  return (
    <Dialog title={t('Share this book')} onClose={onClose} class="share-dialog"
      footer={<button type="button" class="ghost" onClick={onClose}>{t('Cancel')}</button>}>
      <div class="share-choices">
        {choices.map(([kind, icon, title, text]) => (
          <button key={kind} type="button" class={`share-choice share-${kind}`} onClick={() => onChoose(kind)}>
            <span class="share-choice-icon" aria-hidden="true"><Icon name={icon} /></span>
            <span class="share-choice-text"><strong>{title}</strong><span class="muted">{text}</span></span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
