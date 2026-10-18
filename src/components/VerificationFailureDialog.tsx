import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  message: string;
  error: string;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
}

export function VerificationFailureDialog({ message, error, busy, onRetry, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const saving = useRef(busy);
  saving.current = busy;
  useEffect(() => {
    // The finish request may still be unwinding when the outcome first renders.
    // Focus Retry once it is enabled, including after a failed retry request.
    if (!busy && !dialog.current?.contains(document.activeElement)) dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [busy]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving.current) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [onClose]);

  return createPortal(<div className="overlay" onPointerDown={() => { if (!busy) onClose(); }}>
    <div ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby="verification-failure-title"
      aria-describedby="verification-failure-message" onPointerDown={event => event.stopPropagation()}>
      <div className="dialog__head"><h2 id="verification-failure-title" style={{ fontSize: 18 }}>Speed check failed</h2></div>
      <p id="verification-failure-message">{message} Your daily result is saved.</p>
      {error && <p role="alert">{error}</p>}
      <div className="result__actions">
        <button className="btn btn--primary" disabled={busy} onClick={onRetry}>{busy ? 'Preparing…' : 'Retry'}</button>
        <button className="btn btn--ghost" disabled={busy} onClick={onClose}>Give up</button>
      </div>
    </div>
  </div>, document.body);
}
