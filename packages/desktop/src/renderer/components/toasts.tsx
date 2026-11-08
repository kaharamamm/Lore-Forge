import type { IconName } from '@lore-forge/core';
import { t } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { useCallback, useRef, useState } from 'preact/hooks';

export interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  text: string;
  action?: { label: string; run: () => void };
}

const ICON: Record<Toast['tone'], IconName> = { ok: 'check-mark', error: 'cancel', info: 'info' };

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
      {toasts.map((toast) => (
        <div key={toast.id} class={`toast toast-${toast.tone}`}>
          <Icon class="toast-icon" name={ICON[toast.tone]} />
          <span class="toast-text">{toast.text}</span>
          {toast.action && <button type="button" class="ghost small" onClick={() => { toast.action!.run(); dismiss(toast.id); }}>{toast.action.label}</button>}
          <button type="button" class="ghost small icon-btn" aria-label={t('Dismiss')} onClick={() => dismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
