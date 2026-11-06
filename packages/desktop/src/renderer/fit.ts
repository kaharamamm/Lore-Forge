/**
 * Titles that fit their box: the font shrinks in small steps until the text fits in `lines` lines (wrapped and
 * balanced by CSS) without any word sticking out. Only if it still does not fit at the smallest size does the box
 * get `is-clamped` (CSS then breaks long words and ends with an ellipsis). Works for vertical spines too.
 */
export interface FitOptions {
  /** Smallest size, as a share of the CSS size (0.6 = 60%). */
  min: number;
  /** Most lines (columns, on a vertical spine). */
  lines: number;
  vertical?: boolean;
}

export function fitText(el: HTMLElement, { min, lines, vertical = false }: FitOptions): boolean {
  el.classList.remove('is-clamped');
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize);
  if (!base || !el.textContent) return true;
  const fits = (): boolean => {
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    // Across the lines: the text's extent in the block direction; along them: no overflow at all.
    const across = vertical ? el.scrollWidth : el.scrollHeight;
    const along = vertical ? el.scrollHeight <= el.clientHeight : el.scrollWidth <= el.clientWidth;
    return along && across <= lines * line + 1;
  };
  for (let size = base; size >= base * min - 0.01; size *= 0.94) {
    el.style.fontSize = `${size.toFixed(2)}px`;
    if (fits()) return true;
  }
  el.classList.add('is-clamped');
  return false;
}
