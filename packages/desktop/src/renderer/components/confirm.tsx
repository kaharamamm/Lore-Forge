import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { IconName } from '@lore-forge/core';
import { t } from '../i18n.tsx';
import { Icon } from './icon.tsx';

const FOCUSABLE = 'button:not([disabled]), a[href], area[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus stays inside `box` while it is open: Tab from the last control goes to the first and Shift+Tab
 * from the first to the last. Returns the handler for the dialog's keydown.
 */
export function trapTab(box: HTMLElement | null, e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !box) return;
  const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0]!, last = items[items.length - 1]!;
  const at = document.activeElement;
  if (e.shiftKey && (at === first || !box.contains(at))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (at === last || !box.contains(at))) { e.preventDefault(); first.focus(); }
}

interface Props {
  title: string;
  /** What is about to go: a cover, a portrait, a chapter line. */
  subject?: preact.ComponentChildren;
  /** What happens, in one or two plain sentences. */
  children: preact.ComponentChildren;
  confirmLabel: string;
  confirmIcon?: IconName;
  cancelLabel?: string;
  /** Resolves when done; a rejection shows its message in the dialog and keeps it open. */
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

/**
 * The themed confirmation for anything destructive (a world, an entry, a chapter): a danger mark, what is about
 * to go, plain words on what happens, a danger button and Cancel. Cancel has the focus; Tab stays inside;
 * Escape and a click on the backdrop cancel. It rises in (reduced motion: fades in).
 */
export function ConfirmDialog({ title, subject, children, confirmLabel, confirmIcon = 'trash-can', cancelLabel = t('Cancel'), onConfirm, onClose }: Props) {
  const box = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    // Escape also works when focus has wandered out (a click on the page behind).
    const onWin = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onWin);
    return () => { window.removeEventListener('keydown', onWin); if (back?.isConnected) back.focus({ preventScroll: true }); };
  }, []);
  const go = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch (e) {
      setProblem((e as Error).message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''));
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); }
    trapTab(box.current, e);
  };
  // On the page itself, so it dims the whole window wherever it is asked from (an editor panel too).
  return createPortal(
    <div class="modal-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text" onKeyDown={onKey}>
        <div class="confirm-mark" aria-hidden="true"><Icon name="hazard-sign" /></div>
        {/* The mark stands half above the dialog's top edge, so the dialog does not clip; this body scrolls instead. */}
        <div class="confirm-scroll">
          <h2 id="confirm-title">{title}</h2>
          {subject && <div class="confirm-subject">{subject}</div>}
          <div id="confirm-text" class="confirm-text">{children}</div>
          {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
          <div class="dialog-actions">
            <button ref={cancel} type="button" class="ghost confirm-cancel" onClick={onClose}>{cancelLabel}</button>
            <button type="button" class="danger-solid confirm-go" disabled={busy} onClick={() => void go()}><Icon name={confirmIcon} /> {confirmLabel}</button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
