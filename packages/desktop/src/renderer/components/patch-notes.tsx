import { useMemo } from 'preact/hooks';
import ENGLISH from '../../../../../CHANGELOG.md';
import TURKISH from '../../../../../CHANGELOG.tr.md';
import { inline, parseChangelog, withFallback, type Inline, type NoteItem, type Release } from '../../shared/changelog.ts';
import { localeOf } from '../../shared/i18n.ts';
import { releasePage } from '../../shared/update-state.ts';
import { t, useLanguage, type Lang } from '../i18n.tsx';
import { Dialog } from './dialog.tsx';
import { Icon } from './icon.tsx';
import { useUpdateState } from './updates.tsx';
import type { IconName } from '@lore-forge/core';

const REPO = 'https://github.com/kaharamamm/Lore-Forge/blob/main/';

/** The changelog as it shipped with this build (CHANGELOG.md, and CHANGELOG.tr.md in Turkish), read once per language. */
const parsed = new Map<Lang, Release[]>();
function releases(lang: Lang): Release[] {
  let r = parsed.get(lang);
  if (!r) {
    const english = parseChangelog(ENGLISH);
    r = lang === 'tr' ? withFallback(parseChangelog(TURKISH), english) : english;
    parsed.set(lang, r);
  }
  return r;
}

/** A section's icon by its title, in either language. */
const KIND_ICONS: [RegExp, IconName, string][] = [
  [/^(added|eklenen)/i, 'sprout', 'added'],
  [/^(changed|değişen)/i, 'cycle', 'changed'],
  [/^(fixed|düzeltilen)/i, 'check-mark', 'fixed'],
];
const kindOf = (title: string): [IconName, string] => {
  const k = KIND_ICONS.find(([re]) => re.test(title));
  return k ? [k[1], k[2]] : ['info', 'note'];
};

function Md({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? p
        : 'bold' in p ? <strong key={i}><Md parts={p.bold} /></strong>
        : 'code' in p ? <code key={i}>{p.code}</code>
        : <a key={i} href={/^https?:/.test(p.link) ? p.link : `${REPO}${p.link}`} target="_blank" rel="noreferrer"><Md parts={p.text} /></a>))}
    </>
  );
}

function Items({ items }: { items: NoteItem[] }) {
  return (
    <ul class="note-list">
      {items.map((it, i) => (
        <li key={i}>
          <Md parts={inline(it.text)} />
          {it.items.length > 0 && <Items items={it.items} />}
          {it.more.map((p, j) => <p key={j} class="note-more"><Md parts={inline(p)} /></p>)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The library's Patch notes: what changed in each version, newest first, from the changelog that shipped with this
 * build (so it works offline and matches the app). The newest release is open, older ones fold. A newer version
 * the updater found shows on top with its notes from GitHub.
 */
export function PatchNotes({ onClose }: { onClose: () => void }) {
  const lang = useLanguage();
  const state = useUpdateState();
  const list = useMemo(() => releases(lang), [lang]);
  const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'long', year: 'numeric' });
  const newer = state && (state.status === 'available' || state.status === 'downloading' || state.status === 'ready') && state.latest ? state : null;
  return (
    <Dialog title={t('Patch notes')} onClose={onClose} class="patch-notes"
      footer={<>
        <a class="button-link ghost small" href={releasePage()} target="_blank" rel="noreferrer"><Icon name="open-book" /> {t('All releases on GitHub')}</a>
        <button type="button" class="primary" onClick={onClose}>{t('Close')}</button>
      </>}>
      {newer && (
        <section class="release release-newer" aria-label={t('Lore-Forge {version} is available', { version: newer.latest })}>
          <h3 class="release-head"><Icon name="upgrade" /> {t('Lore-Forge {version} is available', { version: newer.latest })}</h3>
          {newer.notes ? <p class="note-more release-remote">{newer.notes}</p> : <p class="muted">{t('Its notes are on GitHub.')}</p>}
          <a class="button-link ghost small" href={releasePage(newer.latest)} target="_blank" rel="noreferrer">{t("What's new")}</a>
        </section>
      )}
      {list.map((r, i) => {
        const current = !!state && r.version === state.version;
        return (
          <details key={r.version} class={`release${current ? ' is-current' : ''}`} open={i === 0}>
            <summary class="release-head">
              <span class="release-version">{r.version === 'Unreleased' ? t('Not released yet') : `Lore-Forge ${r.version}`}</span>
              {r.date && <span class="muted release-date">{date(r.date)}</span>}
              {current && <span class="release-badge">{t('Your version')}</span>}
            </summary>
            <div class="release-body">
              {r.intro.map((p, j) => <p key={j}><Md parts={inline(p)} /></p>)}
              {r.items.length > 0 && <Items items={r.items} />}
              {r.sections.map((s) => {
                const [icon, kind] = kindOf(s.title);
                return (
                  <section key={s.title} class={`release-section kind-${kind}`}>
                    <h4><Icon name={icon} /> {s.title}</h4>
                    {s.intro.map((p, j) => <p key={j}><Md parts={inline(p)} /></p>)}
                    {s.items.length > 0 && <Items items={s.items} />}
                  </section>
                );
              })}
            </div>
          </details>
        );
      })}
    </Dialog>
  );
}
