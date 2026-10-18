import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { normalizeNickname } from '../lib/leaderboard';
import { CloseIcon } from './icons';

interface Props {
  initialValue: string;
  published: boolean;
  onSubmit: (nickname: string, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}

export function NicknameDialog({ initialValue, published, onSubmit, onClose }: Props) {
  const [nickname, setNickname] = useState(initialValue);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController>();
  const inFlight = useRef(false);

  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus(); input.current?.select();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      if (!controls?.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      active.abort(); document.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !controller.current) return;
    let normalized: string;
    try { normalized = normalizeNickname(nickname); }
    catch (err) { setError((err as Error).message); input.current?.focus(); return; }
    const active = controller.current;
    inFlight.current = true; setSaving(true); setError('');
    try { await onSubmit(normalized, active.signal); }
    catch (err) { if (!active.signal.aborted) setError(err instanceof Error ? err.message : 'Could not post. Try again.'); }
    finally { inFlight.current = false; if (!active.signal.aborted) setSaving(false); }
  }

  return createPortal(<div className="overlay" onPointerDown={() => { if (!inFlight.current) onClose(); }}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="nickname-title" ref={dialog} onPointerDown={event => event.stopPropagation()}>
      <div className="dialog__head">
        <h2 id="nickname-title" style={{ fontSize: 18 }}>{published ? 'Edit nickname' : 'Post your score'}</h2>
        <button className="iconbtn" disabled={saving} onClick={onClose} aria-label="Close nickname"><CloseIcon /></button>
      </div>
      <form onSubmit={event => void submit(event)}>
        <label className="field__label" htmlFor="leaderboard-nickname">Nickname</label>
        <input ref={input} className="verification-input" style={{ minHeight: 0 }} id="leaderboard-nickname" value={nickname}
          maxLength={48} autoComplete="off" spellCheck={false} disabled={saving} aria-invalid={Boolean(error)}
          aria-describedby={error ? 'nickname-error' : 'nickname-hint'} onChange={event => { setNickname(event.target.value); setError(''); }} />
        <p className="field__desc" id="nickname-hint">2–24 letters or numbers; spaces, . _ - allowed.</p>
        {error && <p role="alert" id="nickname-error">{error}</p>}
        <button className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : published ? 'Save nickname' : 'Post score'}</button>
      </form>
    </div>
  </div>, document.body);
}
