import { useCallback, useRef, useState } from 'preact/hooks';

export interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  text: string;
  action?: { label: string; run: () => void };
}

const ICON: Record<Toast['tone'], string> = { ok: '✓', error: '✖', info: 'ℹ' };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = next.current++;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.tone === 'error' ? 9000 : 5000);
  }, [dismiss]);
  return { toasts, push, dismiss };
}

/** Bottom-right stack; announced politely to screen readers. */
export function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast toast-${t.tone}`}>
          <span aria-hidden="true" class="toast-icon">{ICON[t.tone]}</span>
          <span class="toast-text">{t.text}</span>
          {t.action && <button type="button" class="ghost small" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button type="button" class="ghost small icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
