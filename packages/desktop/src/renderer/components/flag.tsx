import type { Lang } from '../../shared/i18n.ts';

/** The Union Jack (2:1, cropped to the box at its sides). */
const UK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice"><clipPath id="a"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="b"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#a)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#b)" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g></svg>';
/** The Turkish flag in its legal proportions (3:2; crescent and star after the Turkish Flag Law). */
const TR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -30000 90000 60000"><path fill="#e30a17" d="M0-30000h90000v60000H0z"/><path fill="#fff" d="M41750 0l13568-4408-8386 11541V-7133l8386 11541zM42675 8021a15000 15000 0 1 1 0-16042 12000 12000 0 1 0 0 16042z"/></svg>';

const FLAGS: Record<Lang, string> = {
  en: `data:image/svg+xml;utf8,${encodeURIComponent(UK)}`,
  tr: `data:image/svg+xml;utf8,${encodeURIComponent(TR)}`,
};

/** A language's flag (Settings, Language), 3:2. Decorative: the language's name is always next to it. */
export function Flag({ lang }: { lang: Lang }) {
  return <img class="flag" src={FLAGS[lang]} alt="" width="21" height="14" draggable={false} />;
}
