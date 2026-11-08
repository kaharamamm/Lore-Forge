import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BUNDLED_FONTS, bundledFont, type CoverArt, type WorldCoverSettings } from '@lore-forge/core';
import type { CoverImage } from '../../shared/api.ts';
import { t } from '../i18n.tsx';
import { Popover } from './popover.tsx';

/** "Show title on cover" and "Show emblem on cover": both on unless world.json says false. The spine keeps both. */
export function CoverSwitches({ art, set }: { art: CoverArt; set: (patch: Partial<WorldCoverSettings>) => void }) {
  return (
    <fieldset class="field cover-switches">
      <legend class="field-label">{t('On the cover')}</legend>
      <label class="check"><input type="checkbox" class="show-title" checked={art.showTitle} onChange={(e) => set({ showTitle: e.currentTarget.checked ? undefined : false })} /> {t('Show title on cover')}</label>
      <label class="check"><input type="checkbox" class="show-emblem" checked={art.showEmblem} onChange={(e) => set({ showEmblem: e.currentTarget.checked ? undefined : false })} /> {t('Show emblem on cover')}</label>
      <p class="muted font-note">{t('Works with or without a picture. The title always stays on the spine.')}</p>
    </fieldset>
  );
}

/**
 * Pictures used before: the world's own images and recent uploads, as small thumbnails under the upload button.
 * Choosing one never copies or deletes anything until the cover is saved; uploads stay where they are.
 */
export function RecentPictures({ dir, current, refresh, onPick }: { dir: string | null; current: string | undefined; refresh?: unknown; onPick: (picture: CoverImage) => void }) {
  const [list, setList] = useState<CoverImage[] | null>(null);
  useEffect(() => {
    let live = true;
    void window.lore.coverImages(dir).then((l) => live && setList(l)).catch(() => live && setList([]));
    return () => void (live = false);
  }, [dir, refresh]);
  if (!list?.length) return null;
  return (
    <div class="recent-pictures" role="group" aria-label={t('Recent pictures')}>
      {list.slice(0, 14).map((p) => (
        <button key={`${p.kind}:${p.path}`} type="button" class={`recent-picture is-${p.kind}`} aria-pressed={current === p.path} title={p.kind === 'world' ? t('{path} (in this world)', { path: p.path }) : t('{path} (uploaded before)', { path: p.path })} aria-label={t('Use {name}', { name: p.name })} onClick={() => onPick(p)}>
          <img src={p.thumb ?? ''} alt="" />
        </button>
      ))}
    </div>
  );
}

let systemList: Promise<string[]> | undefined;
/**
 * Fonts installed on this computer: Chromium's Local Font Access (queryLocalFonts) when it answers, plus the main
 * process's list (fontconfig, the Windows registry or system_profiler). Read once per session.
 */
export function systemFonts(): Promise<string[]> {
  systemList ??= (async () => {
    const names = new Set<string>();
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (query) {
      const local = await Promise.race([query().catch(() => []), new Promise<{ family: string }[]>((ok) => setTimeout(() => ok([]), 2500))]);
      for (const f of local) names.add(f.family);
    }
    for (const f of await window.lore.systemFonts().catch(() => [])) names.add(f);
    return [...names].filter((n) => n && !bundledFont(n)).sort((a, b) => a.localeCompare(b));
  })();
  return systemList;
}

/** True when the font is bundled or installed; undefined while the system list is still loading. */
export function useFontAvailable(family: string | undefined): boolean | undefined {
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    if (family && !bundledFont(family)) void systemFonts().then(setList);
  }, [family]);
  if (!family || bundledFont(family)) return true;
  if (!list) return undefined;
  const f = family.toLowerCase();
  return list.some((n) => n.toLowerCase() === f);
}

type Option = { family: string | undefined; group: 'default' | 'bundled' | 'system'; hint?: string };
const SHOW_MAX = 150;

/**
 * Cover title font: a button showing the current font in itself, opening a searchable list grouped Bundled and
 * System, each name drawn in its own font. Arrow keys, Home/End and Enter work from the search box.
 */
export function FontPicker({ value, styleLabel, onChange }: { value: string | undefined; styleLabel: string; onChange: (family: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [system, setSystem] = useState<string[] | null>(null);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) void systemFonts().then(setSystem);
  }, [open]);
  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (n: string) => !q || n.toLowerCase().includes(q);
    const out: Option[] = [];
    if (!q) out.push({ family: undefined, group: 'default', hint: styleLabel });
    for (const f of BUNDLED_FONTS) if (match(f.family)) out.push({ family: f.family, group: 'bundled', hint: t(f.kind) });
    for (const n of (system ?? []).filter(match).slice(0, SHOW_MAX)) out.push({ family: n, group: 'system' });
    return out;
  }, [query, system, styleLabel]);
  const more = (system ?? []).filter((n) => n.toLowerCase().includes(query.trim().toLowerCase())).length - SHOW_MAX;
  useEffect(() => setActive(Math.max(0, options.findIndex((o) => o.family === value))), [open]);
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, options.length - 1))), [options.length]);
  useLayoutEffect(() => list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }), [active, open]);
  const close = (focus: boolean) => {
    setOpen(false);
    setQuery('');
    if (focus) button.current?.focus();
  };
  const pick = (o: Option | undefined) => {
    if (!o) return;
    onChange(o.family);
    close(true);
  };
  const onKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const step: Record<string, (a: number) => number> = {
      ArrowDown: (a) => Math.min(last, a + 1), ArrowUp: (a) => Math.max(0, a - 1),
      PageDown: (a) => Math.min(last, a + 8), PageUp: (a) => Math.max(0, a - 8),
      ...(e.ctrlKey ? { Home: () => 0, End: () => last } : {}),
    };
    const move = step[e.key];
    if (move) {
      e.preventDefault();
      setActive(move);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(options[active]);
    }
  };
  const id = (i: number) => `font-opt-${i}`;
  const face = (f: string | undefined) => (f ? { fontFamily: `"${f.replace(/["\\]/g, '')}", var(--display)` } : undefined);
  return (
    <div class="font-field">
      <span class="field-label" id="font-field-label">{t('Title font')}</span>
      <button ref={button} type="button" class={`select font-button${open ? ' is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-labelledby="font-field-label font-field-value" onClick={() => (open ? close(true) : setOpen(true))}>
        <span id="font-field-value" class="select-value font-name" style={face(value)}>{value ?? t('Title style ({style})', { style: styleLabel })}</span>
        <span class="select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <Popover anchor={button} class="select-popover font-popover" role="dialog" aria-label={t('Title font')} matchWidth onClose={(why) => close(why === 'escape')}>
          <input ref={search} type="search" class="font-search" placeholder={t('Search fonts')} value={query} role="combobox" aria-expanded="true" aria-controls="font-options" aria-activedescendant={options[active] ? id(active) : undefined} aria-label={t('Search fonts')}
            onInput={(e) => { setQuery(e.currentTarget.value); setActive(0); }} onKeyDown={onKey} />
          <ul ref={list} id="font-options" class="font-options" role="listbox" aria-label={t('Fonts')}>
            {options.map((o, i) => (
              <>
                {(i === 0 || options[i - 1]!.group !== o.group) && o.group !== 'default' && <li key={`g-${o.group}`} role="presentation" class="font-group">{o.group === 'bundled' ? t('Bundled') : t('System')}</li>}
                <li key={`${o.group}:${o.family ?? ''}`} id={id(i)} role="option" class={`font-option is-${o.group}`} data-family={o.family ?? ''} aria-selected={i === active} aria-checked={o.family === value}
                  onMouseDown={(e) => e.preventDefault()} onMouseMove={() => i !== active && setActive(i)} onClick={() => pick(o)}>
                  <span class="font-name" style={face(o.family)}>{o.family ?? t('Title style lettering')}</span>
                  {o.hint && <span class="font-hint">{o.hint}</span>}
                </li>
              </>
            ))}
            {system === null && <li role="presentation" class="font-group muted">{t("Reading this computer's fonts…")}</li>}
            {system && !options.some((o) => o.group === 'system') && <li role="presentation" class="font-group muted">{query ? t('No system font matches') : t('No system fonts found')}</li>}
            {more > 0 && <li role="presentation" class="font-more muted">{t('{n} more system fonts; type to narrow the list', { n: more })}</li>}
          </ul>
        </Popover>
      )}
    </div>
  );
}
