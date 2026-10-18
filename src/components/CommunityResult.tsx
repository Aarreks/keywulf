import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CommunityError, communityRequest, getRankedRun, getVerification } from '../lib/communityClient';
import type { RankedRun } from '../lib/leaderboard';
import { normalizeVerificationText, requiredVerificationWpm, verificationCharacterOffset, verificationTextHash, verificationTimeLimitMs, VERIFICATION_FEEDBACK_INTERVAL_MS, VERIFICATION_FEEDBACK_COOLDOWN_MS, type VerificationFeedback, type VerificationStatus } from '../lib/verification';
import { formatWpm } from '../lib/scoring';
import { LeaderboardView } from './LeaderboardView';
import { NicknameDialog } from './NicknameDialog';
import { VerificationFailureDialog } from './VerificationFailureDialog';

interface Props {
  date: string;
  replay?: string;
  elapsedMs: number;
  start?: Promise<RankedRun>;
  finish?: Promise<RankedRun>;
  onLeaderboard: () => void;
}

export function CommunityResult({ date, replay, elapsedMs, start, finish, onLeaderboard }: Props) {
  const [run, setRun] = useState<RankedRun | null>(null);
  const [verification, setVerification] = useState<VerificationStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [nickname, setNickname] = useState(() => {
    try { return localStorage.getItem('keywulf.nickname') || ''; } catch { return ''; }
  });
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const closeNickname = useCallback(() => setNicknameOpen(false), []);
  const [failure, setFailure] = useState('');
  const closeFailure = useCallback(() => setFailure(''), []);
  const [imageReady, setImageReady] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [readyRemaining, setReadyRemaining] = useState<{ id: string; ms: number }>();
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState<(VerificationFeedback & { text: string }) | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const latestAnswer = useRef(answer);
  latestAnswer.current = answer;
  const scheduleFeedback = useRef<() => void>();
  const controller = useRef<AbortController>();
  const inFlight = useRef(false);
  const revision = useRef(0);
  const deadline = useRef(0);
  const submission = useRef<string | null>(null);
  const submittedElapsed = useRef<number>();
  const blockedText = useRef<string | null>(null);
  const typingClock = useRef<{ id: string; at: number }>();
  const readyDeadline = useRef<{ id: string; at: number }>();
  const attempt = verification?.attempt;
  const latestAttempt = useRef(attempt);
  latestAttempt.current = attempt;

  const expireAttempt = useCallback((id: string) => {
    const current = latestAttempt.current;
    // A late rejection for an old passage must not retire its replacement or
    // overwrite a successful completion of the same passage.
    if (current?.id !== id || !['ready', 'running'].includes(current.status)) return;
    deadline.current = 0;
    submission.current = null;
    submittedElapsed.current = undefined;
    setStarting(false); setRemainingMs(0);
    setVerification(status => status?.attempt?.id === id ? { ...status, attempt: { ...status.attempt, status: 'expired' } } : status);
    setError('');
    setFailure(current.status === 'ready' ? 'You didn’t start within 10 seconds.' : 'Time ran out.');
  }, []);

  useEffect(() => {
    const active = new AbortController();
    const version = revision.current;
    controller.current = active;
    // Wait for the initial save, then read the mutable publication state. The
    // finish promise retains the pre-publication score even after it is posted.
    const currentRun = finish ? finish.then(() => getRankedRun(date, active.signal)) : getRankedRun(date, active.signal);
    void Promise.all([currentRun, getVerification(active.signal)]).then(([current, status]) => {
      if (!active.signal.aborted && version === revision.current) {
        setRun(current.run); setVerification(status);
        if (current.run?.status === 'published') setNickname(current.run.name);
      }
    }).catch(err => { if (!active.signal.aborted && version === revision.current) setError(err instanceof Error ? err.message : 'Leaderboard unavailable'); });
    return () => active.abort();
  }, [date, finish]);

  useEffect(() => { if (imageReady && ['ready', 'running'].includes(attempt?.status || '')) input.current?.focus(); }, [imageReady, attempt?.status]);

  useEffect(() => {
    if (!attempt || !verification || attempt.status !== 'ready' || starting) return;
    // The readiness TTL is separate from typing time. Retire an abandoned image
    // even if the player has not typed; the server still decides boundary races.
    if (readyDeadline.current?.id !== attempt.id) {
      readyDeadline.current = { id: attempt.id, at: performance.now() + Math.max(0, attempt.expiresAt - verification.serverNow) };
    }
    const readyAt = readyDeadline.current.at;
    const tick = () => setReadyRemaining({ id: attempt.id, ms: Math.max(0, readyAt - performance.now()) });
    tick();
    const countdown = setInterval(tick, 100);
    const timer = setTimeout(() => expireAttempt(attempt.id), Math.max(0, readyDeadline.current.at - performance.now()) + 1);
    return () => { clearTimeout(timer); clearInterval(countdown); };
  }, [attempt, verification, starting, expireAttempt]);

  const syncMirror = useCallback(() => {
    if (!input.current || !mirror.current) return;
    // A native textarea keeps selection, IME and mobile keyboard behavior. Its
    // mirror must share the content width (including scrollbar changes) and scroll.
    if (input.current.clientWidth) mirror.current.style.width = `${input.current.clientWidth + 2}px`;
    mirror.current.scrollTop = input.current.scrollTop;
    mirror.current.scrollLeft = input.current.scrollLeft;
  }, []);
  useLayoutEffect(syncMirror, [answer, feedback, syncMirror]);
  useEffect(() => {
    if (!input.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncMirror);
    observer.observe(input.current);
    return () => observer.disconnect();
  }, [attempt?.status, imageReady, syncMirror]);

  useEffect(() => {
    if (!attempt || !verification || (attempt.status !== 'running' && !starting)) return;
    if (typingClock.current?.id !== attempt.id && attempt.startedAt !== null) {
      typingClock.current = { id: attempt.id, at: performance.now() - (verification.serverNow - attempt.startedAt) };
    }
    const localDeadline = (typingClock.current?.at ?? performance.now()) + verificationTimeLimitMs(attempt.characterCount, attempt.requiredWpm);
    deadline.current = attempt.status === 'running'
      ? Math.min(localDeadline, performance.now() + Math.max(0, attempt.expiresAt - verification.serverNow)) : localDeadline;
    const tick = () => {
      const remaining = Math.max(0, deadline.current - performance.now());
      setRemainingMs(remaining);
      // An in-flight finish can already have passed on the server. Wait for its
      // acknowledgement rather than declaring that unknown outcome a failure.
      if (!remaining && !inFlight.current && submission.current === null) expireAttempt(attempt.id);
    };
    tick();
    const timer = setInterval(tick, 50);
    return () => clearInterval(timer);
  }, [attempt, verification, starting, expireAttempt]);

  const perform = useCallback(async (operation: (signal: AbortSignal) => Promise<void>, verificationId?: string) => {
    if (inFlight.current || !controller.current) return;
    const active = controller.current;
    revision.current++;
    inFlight.current = true; setBusy(true); setError('');
    try { await operation(active.signal); }
    catch (err) {
      if (!active.signal.aborted) {
        if (verificationId && err instanceof CommunityError && [404, 410].includes(err.status)) {
          expireAttempt(verificationId);
          return;
        }
        if (err instanceof CommunityError && err.status === 400 && submission.current !== null) {
          blockedText.current = submission.current;
          submission.current = null;
          submittedElapsed.current = undefined;
        }
        setError(err instanceof Error ? err.message : 'Request failed. Please retry.');
      }
    }
    finally { inFlight.current = false; if (!active.signal.aborted) setBusy(false); }
  }, [expireAttempt]);

  const submit = useCallback(async (id: string, text: string, signal: AbortSignal) => {
    submission.current ??= text;
    submittedElapsed.current ??= Math.max(1, performance.now() - typingClock.current!.at);
    const status = await communityRequest<VerificationStatus>('verification/finish', {
      id, text: submission.current, elapsedMs: submittedElapsed.current,
    }, signal);
    if (!signal.aborted) {
      setVerification(status);
      if (status.attempt?.status === 'passed') setNicknameOpen(true);
      else if (status.attempt && ['failed', 'expired'].includes(status.attempt.status)) {
        const reason = status.attempt.result?.reason;
        setFailure(reason === 'mismatch' || reason === 'accuracy' ? 'The passage didn’t match.'
          : reason === 'speed' ? `You needed ${status.attempt.requiredWpm} WPM.` : 'Time ran out.');
      }
    }
  }, []);

  useEffect(() => {
    if (!attempt || attempt.status !== 'running' || !attempt.textHash || !imageReady || busy ||
        submission.current !== null || answer === blockedText.current) return;
    const candidate = normalizeVerificationText(answer);
    if (candidate.length !== attempt.characterCount) return;
    let stale = false;
    // A salted whole-passage hash detects completion without sending the answer
    // to the browser or making a server request for every guessed character.
    void verificationTextHash(attempt.id, candidate).then(hash => {
      if (!stale && hash === attempt.textHash && performance.now() <= deadline.current) {
        void perform(signal => submit(attempt.id, answer, signal), attempt.id);
      }
    }).catch(() => { if (!stale) setError('Completion check unavailable. Please request a new passage.'); });
    return () => { stale = true; };
  }, [answer, attempt, imageReady, busy, perform, submit]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'running' || !imageReady) return;
    const id = attempt.id;
    let stopped = false;
    let checking = false;
    let lastChecked = '';
    let correctPrefix = '';
    let wrongPrefix: string | undefined;
    let nextCheckAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const needsCheck = () => {
      const text = latestAnswer.current;
      const normalized = normalizeVerificationText(text);
      return !stopped && submission.current === null && performance.now() <= deadline.current &&
        normalized && !/[^a-zA-Z\s]/.test(text) && normalized !== lastChecked &&
        !correctPrefix.startsWith(normalized) && !(wrongPrefix && normalized.startsWith(wrongPrefix));
    };
    const schedule = () => {
      if (checking || timer !== undefined || !needsCheck()) return;
      // A short leading window coalesces edits without postponing feedback
      // indefinitely during fast typing. Only one request can be in flight.
      timer = setTimeout(() => { timer = undefined; void check(); }, Math.max(40, nextCheckAt - performance.now()));
    };
    const check = async () => {
      if (!needsCheck()) return;
      const text = latestAnswer.current;
      checking = true;
      nextCheckAt = performance.now() + VERIFICATION_FEEDBACK_INTERVAL_MS;
      request = new AbortController();
      timeout = setTimeout(() => request?.abort(), 1500);
      try {
        const result = await communityRequest<VerificationFeedback>('verification/check', { id, text }, request.signal);
        // Anchor the cooldown after acknowledgement too: variable request latency
        // must not make a later check overtake the server's minimum interval.
        nextCheckAt = Math.max(nextCheckAt, performance.now() + VERIFICATION_FEEDBACK_COOLDOWN_MS);
        if (!stopped && result.id === id) {
          lastChecked = normalizeVerificationText(text);
          const prefix = lastChecked.slice(0, result.mismatchIndex ?? lastChecked.length);
          if (prefix.length > correctPrefix.length) correctPrefix = prefix;
          wrongPrefix = result.mismatchIndex === null ? undefined : lastChecked.slice(0, result.mismatchIndex + 1);
          setFeedback({ ...result, text });
        }
      } catch (err) {
        if (!stopped && err instanceof CommunityError && [404, 410].includes(err.status)) {
          expireAttempt(id);
          return;
        }
        // Feedback is optional. Back off instead of hammering a slow service or
        // consuming the submission budget while the player keeps typing.
        nextCheckAt = performance.now() + (err instanceof CommunityError && err.status === 429 ? 1000 : 800);
      }
      finally { clearTimeout(timeout); checking = false; schedule(); }
    };
    scheduleFeedback.current = schedule;
    schedule();
    return () => { stopped = true; scheduleFeedback.current = undefined; clearTimeout(timer); clearTimeout(timeout); request?.abort(); };
  }, [attempt, imageReady, expireAttempt]);
  useEffect(() => { scheduleFeedback.current?.(); }, [answer]);

  function changeAnswer(text: string) {
    if (submission.current !== null) return;
    blockedText.current = null;
    setAnswer(text);
    if (!attempt || attempt.status !== 'ready' || !text.length || inFlight.current) return;
    typingClock.current ??= { id: attempt.id, at: performance.now() };
    if (typingClock.current.id !== attempt.id) typingClock.current = { id: attempt.id, at: performance.now() };
    setRemainingMs(Math.max(0, typingClock.current.at + verificationTimeLimitMs(attempt.characterCount, attempt.requiredWpm) - performance.now()));
    setStarting(true);
    // Typing continues while start is in flight. The server makes retries keep
    // the original start time, and autosubmission waits for its acknowledgement.
    void perform(async signal => {
      try {
        let status: VerificationStatus;
        try { status = await communityRequest<VerificationStatus>('verification/start', { id: attempt.id }, signal); }
        catch (err) {
          if (err instanceof CommunityError && err.status < 500) throw err;
          status = await communityRequest<VerificationStatus>('verification/start', { id: attempt.id }, signal);
        }
        if (!signal.aborted && latestAttempt.current?.id === attempt.id && ['ready', 'running'].includes(latestAttempt.current.status)) setVerification(status);
      } finally {
        if (!signal.aborted) setStarting(false);
      }
    }, attempt.id);
  }
  const canCheck = run?.status === 'pending';
  const receipt = verification?.receipt;
  const hasReceipt = run && receipt && receipt.date === run.date && receipt.corpusHash === run.corpusHash &&
    receipt.validUntil > verification.serverNow && receipt.requiredWpm >= requiredVerificationWpm(run.wpm!);
  const activeAttempt = attempt && ['ready', 'running'].includes(attempt.status);
  const passedId = hasReceipt ? receipt!.id : attempt?.status === 'passed' && attempt.date === run?.date && attempt.corpusHash === run.corpusHash ? attempt.id : undefined;
  const readyMs = readyRemaining && readyRemaining.id === attempt?.id ? readyRemaining.ms : Math.max(0, (attempt?.expiresAt ?? 0) - (verification?.serverNow ?? 0));
  const timeToStart = (Math.ceil(readyMs / 100) / 10).toFixed(1);
  const checkedOffset = feedback?.id === attempt?.id && feedback?.mismatchIndex !== null && feedback &&
    normalizeVerificationText(answer).startsWith(normalizeVerificationText(feedback.text).slice(0, feedback.mismatchIndex + 1))
    ? verificationCharacterOffset(answer, feedback.mismatchIndex) : -1;
  const invalidOffset = answer.search(/[^a-zA-Z\s]/);
  const wrongOffset = checkedOffset < 0 ? invalidOffset : invalidOffset < 0 ? checkedOffset : Math.min(checkedOffset, invalidOffset);
  function requestPassage() {
    void perform(async signal => {
      // A local deadline can precede the server's by request latency. Retire
      // that passage before issuing, otherwise issue may return the same one.
      if (attempt?.status === 'expired') {
        try { await communityRequest('verification/cancel', { id: attempt.id }, signal); }
        catch (err) { if (!(err instanceof CommunityError) || ![404, 409, 410].includes(err.status)) throw err; }
      }
      const status = await communityRequest<VerificationStatus>('verification/issue', { date }, signal);
      if (!signal.aborted) {
        setVerification(status); setAnswer(''); submission.current = null; submittedElapsed.current = undefined;
        typingClock.current = undefined; setStarting(false); setImageReady(false); setFailure('');
      }
    });
  }
  async function publish(chosenName: string, signal: AbortSignal) {
    const result = await communityRequest<{ run: RankedRun }>('runs/publish', { date, id: run!.id, nickname: chosenName }, signal);
    if (!signal.aborted) {
      if (result.run?.id !== run!.id || result.run.status !== 'published' || !result.run.verified) throw new Error('Posting was not confirmed. Try again.');
      setRun(result.run); setNickname(result.run.name);
      try { localStorage.setItem('keywulf.nickname', result.run.name); } catch { /* Posting already succeeded. */ }
      setNicknameOpen(false);
      onLeaderboard();
    }
  }

  return <section className="panel result" aria-labelledby="community-result-title">
    <h2 className="result__label" id="community-result-title">Global leaderboard</h2>
    <LeaderboardView date={date} limit={5} onOpen={onLeaderboard} />
    {run?.status === 'published' ? <p role="status">Posted as <strong>{run.name}</strong> · {formatWpm(run.wpm!)} WPM{run.verified ? ' · Speed checked' : ''}.</p>
      : run?.status === 'pending' ? <p>{formatWpm(run.wpm!)} WPM · {passedId ? 'Verified' : 'Verify to post'}.</p>
        : <p>Join after your official run.</p>}
    {error && !failure && <p role="alert">{error}</p>}
    {failure && <VerificationFailureDialog message={failure} error={error} busy={busy} onRetry={requestPassage} onClose={closeFailure} />}
    {run?.status === 'published' && <button className="btn btn--ghost" onClick={() => setNicknameOpen(true)}>Edit nickname</button>}
    {nicknameOpen && run && <NicknameDialog initialValue={nickname || run.name} published={run.status === 'published'} onSubmit={publish} onClose={closeNickname} />}
    {!run || run.status === 'running' ? <button className="btn" disabled={busy || !replay || (!start && run?.status !== 'running')} onClick={() => void perform(async signal => {
      let ranked = finish ? await finish : run;
      if (!ranked || ranked.status === 'running') {
        const begun = start ? await start : ranked!;
        ranked = (await communityRequest<{ run: RankedRun }>('runs/finish', { date, id: begun.id, replay, elapsedMs }, signal)).run;
      }
      if (!signal.aborted) setRun(ranked);
    })}>{busy ? 'Saving…' : 'Join leaderboard'}</button> : null}
    {(!run || run.status === 'running') && (!replay || (!start && run?.status !== 'running')) && <p className="start__hint">Available on your next daily run.</p>}
    {canCheck && !activeAttempt && <>
      {attempt?.result && !passedId && <p role="status">{['accuracy', 'mismatch'].includes(attempt.result.reason) ? 'Text did not match.' : 'Below the required speed.'}</p>}
      <div className="result__actions">
        {passedId ? !nicknameOpen && <button className="btn btn--primary" onClick={() => setNicknameOpen(true)}>Post score</button>
          : <button className="btn" disabled={busy} onClick={requestPassage}>{busy ? 'Preparing…' : 'Verify score'}</button>}
      </div>
    </>}
    {activeAttempt && <div className="panel result">
      <h3>Speed check</h3>
      <p>Pass one passage at <strong>{attempt.requiredWpm} WPM</strong>. Timing starts on your first character; case doesn’t matter.</p>
      <>
        <p className="tnum" role="timer" aria-label={attempt.status === 'ready' && !starting ? 'Time to start' : 'Time remaining'}>{attempt.status === 'ready' && !starting
          ? `Start within ${timeToStart}s · ${(Math.ceil(verificationTimeLimitMs(attempt.characterCount, attempt.requiredWpm) / 100) / 10).toFixed(1)}s to type`
          : `${(Math.ceil(remainingMs / 100) / 10).toFixed(1)}s remaining · No pause`}</p>
        <img className="verification-image" src={`/api/verification/image?id=${attempt.id}&v=${imageRetry}`} alt="Verification passage to transcribe" width="720" height={attempt.imageHeight}
          onLoad={() => setImageReady(true)}
          onError={() => { setImageReady(false); setError('The passage image could not load. Please reload it.'); }} />
        {!imageReady && <button className="btn btn--ghost" onClick={() => setImageRetry(value => value + 1)}>Reload image</button>}
        <div>
          <label htmlFor="speed-answer">Type the passage</label>
          <div className={`verification-editor${wrongOffset >= 0 ? ' verification-editor--incorrect' : ''}`}>
            <div ref={mirror} className="verification-input verification-mirror" aria-hidden="true">
              {wrongOffset < 0 ? answer : <>{answer.slice(0, wrongOffset)}<span className="ch incorrect">{answer.slice(wrongOffset)}</span></>}{'\u200b'}
            </div>
            <textarea ref={input} className="verification-input" id="speed-answer" value={answer} disabled={(busy && submission.current !== null) || !imageReady || ((attempt.status === 'running' || starting) && remainingMs === 0)} maxLength={1000}
              autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} aria-invalid={wrongOffset >= 0}
              aria-describedby="verification-feedback" onScroll={syncMirror}
              onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()}
              onChange={event => changeAnswer(event.target.value)} />
          </div>
          <p className="sr-only" id="verification-feedback" role="status">{wrongOffset >= 0 ? `Check character ${wrongOffset + 1}.` : ''}</p>
          {busy && submission.current !== null && <p role="status">Checking speed…</p>}
          {!busy && submission.current !== null && error && <button className="btn" onClick={() => void perform(signal => submit(attempt.id, submission.current!, signal), attempt.id)}>Retry submission</button>}
        </div>
        {error && <button className="btn" disabled={busy} onClick={requestPassage}>New passage</button>}
      </>
      <button className="btn btn--ghost" disabled={busy} onClick={() => void perform(async signal => {
        const status = await communityRequest<VerificationStatus>('verification/cancel', { id: attempt.id }, signal);
        if (!signal.aborted) { setVerification(status); setAnswer(''); submission.current = null; submittedElapsed.current = undefined; typingClock.current = undefined; setStarting(false); }
      }, attempt.id)}>Cancel</button>
    </div>}
  </section>;
}
