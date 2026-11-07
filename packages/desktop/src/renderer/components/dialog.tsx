import { useEffect, useRef } from 'preact/hooks';
import { trapTab } from './confirm.tsx';

/** Modal shell shared by the library dialogs: Escape and a click outside close it; Tab stays inside. */
export function Dialog({ title, onClose, children, footer, class: extra }: { title: string; onClose: () => void; children: preact.ComponentChildren; footer?: preact.ComponentChildren; class?: string }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} class={`about library-dialog${extra ? ` ${extra}` : ''}`} role="dialog" aria-modal="true" aria-labelledby="library-dialog-title" onKeyDown={(e) => trapTab(box.current, e)}>
        <header class="dialog-head"><h2 id="library-dialog-title">{title}</h2></header>
        <div class="dialog-body">{children}</div>
        {/* A footer stays below the body, which scrolls on its own. */}
        {footer && <div class="dialog-actions">{footer}</div>}
      </section>
    </div>
  );
}
