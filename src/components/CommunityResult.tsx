import { useEffect, useRef, useState } from 'react';
import { CommunityError, communityRequest, getRankedRun, getVerification } from '../lib/communityClient';
import type { RankedRun } from '../lib/leaderboard';
import { requiredVerificationWpm, type VerificationStatus } from '../lib/verification';
import { formatWpm } from '../lib/scoring';

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
  const [imageReady, setImageReady] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController>();
  const inFlight = useRef(false);
  const revision = useRef(0);
  const deadline = useRef(0);
  const submission = useRef<string | null>(null);
  const attempt = verification?.attempt;

  useEffect(() => {
    const active = new AbortController();
    const version = revision.current;
    controller.current = active;
    const currentRun = finish ? finish.then(run => ({ run })) : getRankedRun(date, active.signal);
    void Promise.all([currentRun, getVerification(active.signal)]).then(([current, status]) => {
      if (!active.signal.aborted && version === revision.current) { setRun(current.run); setVerification(status); }
    }).catch(err => { if (!active.signal.aborted && version === revision.current) setError(err instanceof Error ? err.message : 'Leaderboard unavailable'); });
    return () => active.abort();
  }, [date, finish]);

  useEffect(() => { if (imageReady && attempt?.status === 'running') input.current?.focus(); }, [imageReady, attempt?.status]);

  useEffect(() => {
    if (attempt?.status !== 'running' || !verification) return;
    deadline.current = performance.now() + Math.max(0, attempt.expiresAt - verification.serverNow);
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [attempt?.status, attempt?.expiresAt, verification]);

  async function perform(operation: (signal: AbortSignal) => Promise<void>) {
    if (inFlight.current || !controller.current) return;
    const active = controller.current;
    revision.current++;
    inFlight.current = true; setBusy(true); setError('');
    try { await operation(active.signal); }
    catch (err) {
      if (!active.signal.aborted) {
        if (err instanceof CommunityError && err.status === 400) submission.current = null;
        setError(err instanceof Error ? err.message : 'Request failed. Please retry.');
      }
    }
    finally { inFlight.current = false; if (!active.signal.aborted) setBusy(false); }
  }
  const canCheck = run?.status === 'pending';
  const receipt = verification?.receipt;
  const hasReceipt = run && receipt && receipt.date === run.date && receipt.corpusHash === run.corpusHash &&
    receipt.validUntil > verification.serverNow && receipt.requiredWpm >= requiredVerificationWpm(run.wpm!);
  const activeAttempt = attempt && ['ready', 'running'].includes(attempt.status);

  return <section className="panel result" aria-labelledby="community-result-title">
    <h2 className="result__label" id="community-result-title">Daily leaderboard</h2>
    {run?.status === 'published' ? <p role="status">Posted as <strong>{run.name}</strong> · {formatWpm(run.wpm!)} WPM{run.verified ? ' · Speed checked' : ''}.</p>
      : run?.status === 'pending' ? <p>Your {formatWpm(run.wpm!)} WPM score is saved privately. Pass the speed check to publish it.</p>
        : <p>Post your first official run under a generated alias. Ranking uses continuous server time; pauses can make a run ineligible.</p>}
    {error && <p role="alert">{error}</p>}
    {!run || run.status === 'running' || run.status === 'unpublished' ? <button className="btn" disabled={busy || ((!replay || (!start && run?.status !== 'running')) && run?.status !== 'unpublished')} onClick={() => void perform(async signal => {
      let ranked = finish ? await finish : run;
      if (!ranked || ranked.status === 'running') {
        const begun = start ? await start : ranked!;
        ranked = (await communityRequest<{ run: RankedRun }>('runs/finish', { date, id: begun.id, replay, elapsedMs }, signal)).run;
      }
      if (ranked.status === 'unpublished') ranked = (await communityRequest<{ run: RankedRun }>('runs/publish', { date, id: ranked.id }, signal)).run;
      if (!signal.aborted) setRun(ranked);
    })}>{busy ? 'Saving…' : 'Post official result'}</button> : null}
    {(!run || run.status === 'running') && (!replay || (!start && run?.status !== 'running')) && <p className="start__hint">This result has no complete timed replay. You can join with your next daily run.</p>}
    {canCheck && !activeAttempt && <>
      {attempt?.result && <p role="status">{attempt.result.passed ? `Speed check passed at ${formatWpm(attempt.result.measuredWpm)} WPM.`
        : attempt.result.reason === 'accuracy' ? 'The passage needs at least 95% matching text. Correct mistakes before submitting.' : 'The required speed was not reached. You can request another passage.'}</p>}
      <div className="result__actions">
        {(hasReceipt || attempt?.status === 'passed') && <button className="btn btn--primary" disabled={busy} onClick={() => void perform(async signal => {
          const result = await communityRequest<{ run: RankedRun }>('runs/publish', { date, id: run.id }, signal);
          if (!signal.aborted) setRun(result.run);
        })}>Publish checked score</button>}
        <button className="btn" disabled={busy} onClick={() => void perform(async signal => {
          const status = await communityRequest<VerificationStatus>('verification/issue', { date }, signal);
          if (!signal.aborted) { setVerification(status); setAnswer(''); submission.current = null; setImageReady(false); }
        })}>{busy ? 'Preparing…' : 'Get verification passage'}</button>
      </div>
    </>}
    {activeAttempt && <div className="panel result">
      <h3>Speed verification</h3>
      <p>Type the image’s words at <strong>{attempt.requiredWpm} WPM</strong> or faster, with 95% matching text. Letter case does not matter. Three passages per 15 minutes.</p>
      {attempt.status === 'ready' ? <button className="btn btn--primary" disabled={busy} onClick={() => void perform(async signal => {
        const status = await communityRequest<VerificationStatus>('verification/start', { id: attempt.id }, signal);
        if (!signal.aborted) { setVerification(status); setImageReady(false); }
      })}>Reveal passage and start 60-second timer</button> : <>
        <p className="tnum" role="timer" aria-label="Time remaining">{secondsLeft}s remaining · No pause</p>
        <img className="verification-image" src={`/api/verification/image?id=${attempt.id}&v=${imageRetry}`} alt="Verification passage to transcribe" width="720" height={attempt.imageHeight}
          onLoad={() => setImageReady(true)}
          onError={() => { setImageReady(false); setError('The passage image could not load. The timer continues.'); }} />
        {!imageReady && <button className="btn btn--ghost" onClick={() => setImageRetry(value => value + 1)}>Reload image</button>}
        <form onSubmit={event => { event.preventDefault(); void perform(async signal => {
          submission.current ??= answer;
          const status = await communityRequest<VerificationStatus>('verification/finish', { id: attempt.id, text: submission.current }, signal);
          if (!signal.aborted) setVerification(status);
        }); }}>
          <label htmlFor="speed-answer">Type the passage</label>
          <textarea ref={input} className="verification-input" id="speed-answer" value={answer} disabled={busy || !imageReady || secondsLeft === 0} maxLength={1000}
            autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
            onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()}
            onChange={event => { if (submission.current === null) setAnswer(event.target.value); }} />
          <button className="btn btn--primary" disabled={busy || !answer || !imageReady || (secondsLeft === 0 && submission.current === null)}>{busy ? 'Checking…' : submission.current !== null ? 'Retry submission' : 'Check speed'}</button>
        </form>
        {secondsLeft === 0 && <button className="btn" disabled={busy} onClick={() => void perform(async signal => {
          const status = await communityRequest<VerificationStatus>('verification/issue', { date }, signal);
          if (!signal.aborted) { setVerification(status); setAnswer(''); submission.current = null; setImageReady(false); }
        })}>Request a new passage</button>}
      </>}
      <button className="btn btn--ghost" disabled={busy} onClick={() => void perform(async signal => {
        const status = await communityRequest<VerificationStatus>('verification/cancel', { id: attempt.id }, signal);
        if (!signal.aborted) { setVerification(status); setAnswer(''); submission.current = null; }
      })}>Cancel speed check</button>
      <p className="start__hint">The image-based check is visual. It is optional; your daily result and streak remain saved.</p>
    </div>}
    <button className="btn btn--ghost" onClick={onLeaderboard}>View daily leaderboard</button>
  </section>;
}
