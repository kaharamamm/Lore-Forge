import type { SearchHit } from '@lore-forge/core';
import { tm } from '../i18n.tsx';

/** Where a search hit matched: the field, then the text around it with the match marked. */
export function Snippet({ hit }: { hit: SearchHit }) {
  const s = hit.snippet;
  return (
    <span class="search-snippet">
      <span class="search-field">{tm(hit.field)}</span> {s.slice(0, hit.start)}<mark class="search-hit">{s.slice(hit.start, hit.end)}</mark>{s.slice(hit.end)}
    </span>
  );
}
