import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ClipboardEvent, CSSProperties } from 'react';
import type { Challenge } from '../types';
import { buildCorpus, buildStorySpans } from '../lib/challengeClient';
import { computeScore, TIME_LIMIT_MS, type Score } from '../lib/scoring';
import { RollingTracker } from '../lib/rolling';
import type { InProgress, Settings } from '../lib/storage';

export interface RunResult extends Score {
  correctChars: number;
  totalChars: number;
  storyCount: number;
  /** Number of stories fully typed before the run ended. */
  storiesCleared: number;
  /** True when the 2-minute clock ended the run before the text was finished. */
  timedOut: boolean;
  /** WPM samples over the run for the result graph: [progress0..1, wpm]. */
  samples: Array<{ p: number; wpm: number }>;
}

interface PlayProps {
  challenge: Challenge;
  settings: Settings;
  resume: InProgress | null;
  /** Fired once, on the first real keystroke. */
  onStart: () => void;
  /** Periodic + on-hide snapshot for safe resume (official runs). */
  onSnapshot: (snap: Omit<InProgress, 'date' | 'gameNumber' | 'updatedAt'>) => void;
  onComplete: (result: RunResult) => void;
}

// How often to push the HUD state to React, and telemetry samples.
const HUD_INTERVAL = 90;
const TELEMETRY_INTERVAL = 180;
const SNAPSHOT_INTERVAL = 3000;
const TELEMETRY_WINDOW = 130; // samples kept for the live scroller

export function Play({ challenge, settings, resume, onStart, onSnapshot, onComplete }: PlayProps) {
  const corpus = useMemo(() => buildCorpus(challenge), [challenge]);
  const storySpans = useMemo(() => buildStorySpans(challenge), [challenge]);
  const chars = useMemo(() => Array.from(corpus), [corpus]);
  // Which corpus offsets belong to a headline (rendered bold: Courier Prime is
  // monospace, so bold has identical advance width and causes zero reflow).
  const isHeadline = useMemo(() => {
    const flags = new Array<boolean>(corpus.length).fill(false);
    challenge.stories.forEach((s, i) => {
      const span = storySpans[i];
      if (!span) return;
      const hlLen = s.headline.trim().replace(/\s+/g, ' ').length;
      for (let k = span.start; k < Math.min(span.start + hlLen, corpus.length); k++) flags[k] = true;
    });
    return flags;
  }, [challenge, storySpans, corpus.length]);

  // DOM refs.
  const stageRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const spanRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const teleLineRef = useRef<SVGPolylineElement>(null);
  const teleAreaRef = useRef<SVGPolygonElement>(null);

  // Engine state (mutable, outside React render for per-keystroke speed).
  const idxRef = useRef(0);
  const statusRef = useRef<Int8Array>(new Int8Array(chars.length));
  const correctPosRef = useRef(0);
  const correctKsRef = useRef(0);
  const incorrectKsRef = useRef(0);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const startTimeRef = useRef(0);
  const elapsedBaseRef = useRef(0);
  const lastLenRef = useRef(0);
  const tracker = useRef(new RollingTracker());
  const teleRef = useRef<Array<{ tMs: number; wpm: number }>>([]);
  const allSamplesRef = useRef<Array<{ p: number; wpm: number }>>([]);
  const lastHudRef = useRef(0);
  const lastTeleRef = useRef(0);
  const lastSnapRef = useRef(0);
  const lastKeyAtRef = useRef(0);
  const rafRef = useRef(0);

  const [hud, setHud] = useState({ wpm: 0, acc: 100, progress: 0, timeLeft: TIME_LIMIT_MS / 1000 });
  const [storyIdx, setStoryIdx] = useState(0);
  const [turnKey, setTurnKey] = useState(0);
  const [calm, setCalm] = useState(false);

  const nowMs = () => performance.now();
  const elapsedMs = useCallback((now: number) => {
    if (!startedRef.current) return elapsedBaseRef.current;
    const end = completedRef.current ? startTimeRef.current + (lastKeyAtRef.current - startTimeRef.current) : now;
    return elapsedBaseRef.current + (end - startTimeRef.current);
  }, []);

  const positionCaret = useCallback(() => {
    const flow = flowRef.current;
    const caret = caretRef.current;
    if (!flow || !caret) return;
    const i = idxRef.current;
    let left: number;
    let top: number;
    let height: number;
    if (i < chars.length && spanRefs.current[i]) {
      const s = spanRefs.current[i]!;
      left = s.offsetLeft;
      top = s.offsetTop;
      height = s.offsetHeight;
    } else if (chars.length > 0 && spanRefs.current[chars.length - 1]) {
      const s = spanRefs.current[chars.length - 1]!;
      left = s.offsetLeft + s.offsetWidth;
      top = s.offsetTop;
      height = s.offsetHeight;
    } else {
      left = 0;
      top = 0;
      height = 24;
    }
    caret.style.setProperty('--cx', `${left}px`);
    caret.style.setProperty('--cy', `${top}px`);
    caret.style.transform = `translate(${left}px, ${top}px)`;
    caret.style.height = `${height * 0.82}px`;
    // Scroll the flow so the active line keeps one line of context above it.
    const lineH = height;
    const targetOffset = Math.max(0, top - lineH);
    flow.style.transform = `translateY(${-targetOffset}px)`;
  }, [chars.length]);

  const finish = useCallback(
    (timedOut: boolean) => {
      if (completedRef.current) return;
      completedRef.current = true;
      const now = nowMs();
      const total = chars.length;
      lastKeyAtRef.current = timedOut ? now : lastKeyAtRef.current || now;
      const elapsed = timedOut ? TIME_LIMIT_MS : elapsedMs(now);
      const score = computeScore({
        correctChars: correctPosRef.current,
        correctKeystrokes: correctKsRef.current,
        incorrectKeystrokes: incorrectKsRef.current,
        totalChars: total,
        elapsedMs: elapsed,
      });
      // Final sample at the point the run ended.
      const endP = total > 0 ? idxRef.current / total : 1;
      allSamplesRef.current.push({ p: timedOut ? endP : 1, wpm: score.wpm });
      // Stories fully cleared by the end of the run.
      const cleared = storySpans.filter((sp) => idxRef.current >= sp.end).length;
      if (settings.haptics && typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate([18, 40, 26]);
        } catch {
          /* ignore */
        }
      }
      if (inputRef.current) inputRef.current.blur();
      onComplete({
        ...score,
        correctChars: correctPosRef.current,
        totalChars: total,
        storyCount: challenge.stories.length,
        storiesCleared: cleared,
        timedOut,
        samples: allSamplesRef.current.slice(),
      });
    },
    [chars.length, challenge.stories.length, elapsedMs, onComplete, settings.haptics, storySpans],
  );

  const processChar = useCallback(
    (ch: string) => {
      if (completedRef.current) return;
      if (ch === '\n' || ch === '\r') return;
      const i = idxRef.current;
      if (i >= chars.length) return;
      const now = nowMs();
      if (!startedRef.current) {
        startedRef.current = true;
        startTimeRef.current = now;
        onStart();
      } else if (elapsedMs(now) >= TIME_LIMIT_MS) {
        // Belt and suspenders: the rAF loop normally ends the run at 2:00, but
        // rAF can be throttled/paused (hidden tab); never let a late keystroke
        // extend a run past the limit.
        finish(true);
        return;
      }
      lastKeyAtRef.current = now;
      const expected = chars[i];
      const correct = ch === expected;
      statusRef.current[i] = correct ? 1 : 2;
      if (correct) {
        correctPosRef.current += 1;
        correctKsRef.current += 1;
      } else {
        incorrectKsRef.current += 1;
      }
      tracker.current.push({ t: now, correct });

      const span = spanRefs.current[i];
      if (span) {
        span.classList.remove('correct', 'incorrect', 'sp');
        span.classList.add(correct ? 'correct' : 'incorrect');
        if (!correct && expected === ' ') span.classList.add('sp');
      }
      idxRef.current = i + 1;
      // Caret bump micro-interaction.
      const caret = caretRef.current;
      if (caret) {
        caret.classList.remove('blink');
        caret.classList.remove('bump');
        // force reflow to restart animation
        void caret.offsetWidth;
        caret.classList.add('bump');
      }
      positionCaret();
      if (idxRef.current >= chars.length) finish(false);
    },
    [chars, elapsedMs, finish, onStart, positionCaret],
  );

  const processBack = useCallback(() => {
    if (completedRef.current) return;
    const i = idxRef.current;
    if (i <= 0) return;
    const j = i - 1;
    if (statusRef.current[j] === 1) correctPosRef.current -= 1;
    statusRef.current[j] = 0;
    idxRef.current = j;
    const span = spanRefs.current[j];
    if (span) span.classList.remove('correct', 'incorrect', 'sp');
    positionCaret();
  }, [positionCaret]);

  // Unified input handling (works for physical + soft keyboards). We let the
  // textarea accumulate raw typed characters and diff by length, so backspace
  // and typing are handled uniformly across platforms.
  const onInput = useCallback(
    (e: FormEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const ie = e.nativeEvent as InputEvent;
      if (ie.inputType === 'insertFromPaste' || ie.inputType === 'insertFromDrop') {
        // Pasted/dropped text never counts. Discard it.
        el.value = el.value.slice(0, lastLenRef.current);
        return;
      }
      const val = el.value;
      if (val.length > lastLenRef.current) {
        const added = val.slice(lastLenRef.current);
        for (const ch of added) processChar(ch);
      } else if (val.length < lastLenRef.current) {
        let n = lastLenRef.current - val.length;
        while (n-- > 0) processBack();
      }
      lastLenRef.current = el.value.length;
    },
    [processChar, processBack],
  );

  // Guard against paste via keyboard shortcut and stray control keys.
  const onPaste = useCallback((e: ClipboardEvent) => {
    e.preventDefault();
  }, []);

  const focusInput = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Build the telemetry point string from the rolling window. Coordinates are
  // computed in PIXEL space with the viewBox matched to the element's real
  // size, so strokes stay uniform and round on every screen (a stretched unit
  // viewBox turned the trace into a chisel-tip line).
  const renderTelemetry = useCallback(() => {
    const samples = teleRef.current;
    const line = teleLineRef.current;
    const area = teleAreaRef.current;
    if (!line || !area) return;
    const svg = line.ownerSVGElement;
    if (!svg) return;
    const w = svg.clientWidth || 600;
    const h = svg.clientHeight || 66;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    if (samples.length < 2) {
      line.setAttribute('points', '');
      area.setAttribute('points', '');
      return;
    }
    const view = samples.slice(-TELEMETRY_WINDOW);
    let peak = 60;
    for (const s of view) peak = Math.max(peak, s.wpm);
    const maxWpm = peak * 1.15;
    const n = view.length;
    const pts: string[] = [];
    for (let k = 0; k < n; k++) {
      const x = (k / (n - 1)) * w;
      const y = h - Math.max(0, Math.min(1, view[k].wpm / maxWpm)) * (h - 4) - 2;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    line.setAttribute('points', pts.join(' '));
    area.setAttribute('points', `0,${h} ${pts.join(' ')} ${w},${h}`);
  }, []);

  // Main animation loop: energy/caret glow, HUD, telemetry, snapshots.
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      const now = nowMs();
      const stage = stageRef.current;
      const read = tracker.current.read(now);
      if (stage) stage.style.setProperty('--energy', read.energy.toFixed(3));

      if (startedRef.current && !completedRef.current) {
        const el = elapsedMs(now);
        // Hard 2-minute clock: end the run when time is up.
        if (el >= TIME_LIMIT_MS) {
          finish(true);
          return;
        }
        const minutes = el / 60000;
        const wpm = minutes > 0 ? correctPosRef.current / 5 / minutes : 0;
        const totalKs = correctKsRef.current + incorrectKsRef.current;
        const acc = totalKs > 0 ? (correctKsRef.current / totalKs) * 100 : 100;
        const progress = idxRef.current / Math.max(1, chars.length);
        const timeLeft = Math.max(0, Math.ceil((TIME_LIMIT_MS - el) / 1000));

        if (now - lastHudRef.current >= HUD_INTERVAL) {
          lastHudRef.current = now;
          setHud({ wpm: Math.max(0, Math.round(wpm)), acc: Math.round(acc * 10) / 10, progress, timeLeft });
          setCalm(read.energy > 0.55 && progress > 0.06);
          const flow = flowRef.current;
          const stageEl = stageRef.current;
          if (stageEl) stageEl.style.setProperty('--progress', progress.toFixed(4));
          if (flow) flow.style.setProperty('--progress', progress.toFixed(4));
          // Current story index for the story tag.
          const ci = storySpans.findIndex((sp) => idxRef.current < sp.end);
          const si = ci === -1 ? storySpans.length - 1 : ci;
          setStoryIdx((prev) => {
            if (prev !== si) setTurnKey((k) => k + 1);
            return si;
          });
        }
        if (now - lastTeleRef.current >= TELEMETRY_INTERVAL) {
          lastTeleRef.current = now;
          teleRef.current.push({ tMs: el, wpm: read.rollingWpm });
          if (teleRef.current.length > 400) teleRef.current = teleRef.current.slice(-TELEMETRY_WINDOW);
          allSamplesRef.current.push({ p: progress, wpm: read.rollingWpm });
          if (allSamplesRef.current.length > 400) {
            allSamplesRef.current = allSamplesRef.current.filter((_, k) => k % 2 === 0);
          }
          renderTelemetry();
        }
        if (now - lastSnapRef.current >= SNAPSHOT_INTERVAL) {
          lastSnapRef.current = now;
          onSnapshot({
            typedCount: idxRef.current,
            correctKeystrokes: correctKsRef.current,
            incorrectKeystrokes: incorrectKsRef.current,
            elapsedMs: el,
          });
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [chars.length, elapsedMs, finish, onSnapshot, renderTelemetry, storySpans]);

  // Seed from a resume snapshot, then set up caret + focus.
  useEffect(() => {
    if (resume && resume.typedCount > 0 && resume.typedCount <= chars.length) {
      idxRef.current = resume.typedCount;
      for (let k = 0; k < resume.typedCount; k++) statusRef.current[k] = 1;
      correctPosRef.current = resume.typedCount;
      correctKsRef.current = resume.correctKeystrokes;
      incorrectKsRef.current = resume.incorrectKeystrokes;
      elapsedBaseRef.current = resume.elapsedMs;
      // Reflect resumed characters visually + keep the input diff consistent.
      for (let k = 0; k < resume.typedCount; k++) {
        spanRefs.current[k]?.classList.add('correct');
      }
      if (inputRef.current) {
        inputRef.current.value = corpus.slice(0, resume.typedCount);
        lastLenRef.current = resume.typedCount;
      }
    }
    positionCaret();
    focusInput();
    caretRef.current?.classList.add('blink');
    // Recompute caret on resize.
    const onResize = () => positionCaret();
    window.addEventListener('resize', onResize);
    const onVis = () => {
      if (document.visibilityState === 'hidden' && startedRef.current && !completedRef.current) {
        onSnapshot({
          typedCount: idxRef.current,
          correctKeystrokes: correctKsRef.current,
          incorrectKeystrokes: incorrectKsRef.current,
          elapsedMs: elapsedMs(nowMs()),
        });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentStory = challenge.stories[storyIdx];

  return (
    <div className="stage enter" ref={stageRef}>
      <div className={`hud tnum ${calm ? 'hud--calm' : ''}`} aria-live="off">
        <div className="stat">
          <div className="stat__val stat__val--accent">{hud.wpm}</div>
          <div className="stat__label">WPM</div>
        </div>
        <div className="stat">
          <div className="stat__val">{hud.acc.toFixed(1)}%</div>
          <div className="stat__label">Accuracy</div>
        </div>
        <div className="stat">
          <div className={`stat__val ${hud.timeLeft <= 15 ? 'stat__val--urgent' : ''}`}>
            {Math.floor(hud.timeLeft / 60)}:{(hud.timeLeft % 60).toString().padStart(2, '0')}
          </div>
          <div className="stat__label">Left</div>
        </div>
        <div className="hud__spacer" />
        <div className="stat hud__story">
          <div className="stat__val">
            {storyIdx + 1}
            <span style={{ color: 'var(--muted)', fontWeight: 700 }}>/{challenge.stories.length}</span>
          </div>
          <div className="stat__label">Story</div>
        </div>
      </div>

      <div
        className="passage"
        onPointerDown={(e) => {
          e.preventDefault();
          focusInput();
        }}
      >
        <div className="passage__viewport">
          <div className="passage__flow" ref={flowRef}>
            {chars.map((ch, i) => (
              <span
                key={i}
                className={isHeadline[i] ? 'ch ch--hl' : 'ch'}
                ref={(el) => {
                  spanRefs.current[i] = el;
                }}
              >
                {ch}
              </span>
            ))}
            <span className="caret blink" ref={caretRef} aria-hidden="true" />
          </div>
        </div>
        <textarea
          ref={inputRef}
          className="capture"
          onInput={onInput}
          onPaste={onPaste}
          onBlur={() => {
            // Keep the keyboard/engine attached unless we're done.
            if (!completedRef.current) setTimeout(focusInput, 0);
          }}
          aria-label="Typing input. Type the briefing shown above."
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="done"
        />
      </div>

      <div className="progress" aria-hidden="true">
        <div className="progress__fill" style={{ '--progress': hud.progress } as CSSProperties} />
      </div>

      <div className={`storytag ${turnKey ? 'turn' : ''}`} key={turnKey}>
        <span className="storytag__cat">{currentStory?.category ?? ''}</span>
        <span className="storytag__rule" />
        <span>{currentStory?.regions?.join(' / ')}</span>
      </div>

      {settings.showGraph && (
        <div className="telemetry" aria-hidden="true">
          <svg preserveAspectRatio="none">
            <polygon ref={teleAreaRef} className="telemetry__area" points="" />
            <polyline ref={teleLineRef} className="telemetry__line" points="" />
          </svg>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {hud.wpm} words per minute, {hud.acc.toFixed(0)} percent accuracy, {Math.round(hud.progress * 100)} percent
        complete.
      </p>
    </div>
  );
}
