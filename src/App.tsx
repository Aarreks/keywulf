import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Challenge } from './types';
import { fetchTodayChallenge, parseChallenge } from './lib/challengeClient';
import { todayUtc } from './lib/gameNumber';
import {
  loadState,
  saveState,
  hasCompleted,
  getResult,
  getResumable,
  recordOfficialResult,
  markOfficialStarted,
  saveInProgress,
  clearInProgress,
  updateSettings,
  aggregateStats,
  type KeywulfState,
  type Settings,
  type OfficialResult,
  type InProgress,
} from './lib/storage';
import { formatWpm } from './lib/scoring';
import sampleChallenge from './data/sampleChallenge.json';

import { TopBar } from './components/TopBar';
import { StartScreen } from './components/StartScreen';
import { Play, type RunResult } from './components/Play';
import { Result } from './components/Result';
import { CompletedCard } from './components/CompletedCard';
import { StatsView } from './components/StatsView';
import { AboutView } from './components/AboutView';
import { SettingsDialog } from './components/SettingsDialog';
import { ErrorScreen, LoadingScreen } from './components/ErrorScreen';

type Phase = 'loading' | 'error' | 'home' | 'playing' | 'result' | 'stats' | 'about';

function applyTheme(settings: Settings) {
  const root = document.documentElement;
  const dark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-fontsize', settings.fontSize);
  root.classList.toggle('reduced-intensity', settings.reducedIntensity);
}

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loadError, setLoadError] = useState('');
  const [state, setState] = useState<KeywulfState>(() => loadState());
  const [practice, setPractice] = useState(false);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [resumeSnap, setResumeSnap] = useState<InProgress | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runNonce, setRunNonce] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist helper that keeps our ref in sync.
  const persist = useCallback((next: KeywulfState) => {
    stateRef.current = next;
    setState(next);
    saveState(next);
  }, []);

  // --- Theme ---
  useEffect(() => {
    applyTheme(state.settings);
  }, [state.settings]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (stateRef.current.settings.theme === 'system') applyTheme(stateRef.current.settings);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // --- Load today's challenge ---
  const load = useCallback(async () => {
    setPhase('loading');
    setLoadError('');
    try {
      const c = await fetchTodayChallenge();
      setChallenge(c);
      setPhase('home');
    } catch (err) {
      // Fall back to the bundled sample so the app is never a blank page.
      try {
        const c = parseChallenge(sampleChallenge as unknown);
        setChallenge(c);
        setPhase('home');
        setLoadError(''); // sample loaded fine
      } catch {
        setLoadError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isToday = useMemo(() => (challenge ? challenge.date === todayUtc() : false), [challenge]);
  const completedResult: OfficialResult | undefined = challenge
    ? getResult(state, challenge.date)
    : undefined;
  const resumable = challenge ? getResumable(state, challenge.date) : null;

  const todayNumber = challenge?.gameNumber ?? 0;
  const stats = useMemo(() => aggregateStats(state, todayNumber), [state, todayNumber]);

  // --- Actions ---
  const startOfficial = useCallback(() => {
    if (!challenge) return;
    persist(markOfficialStarted(stateRef.current, challenge.date));
    setResumeSnap(null);
    setPractice(false);
    setRunNonce((n) => n + 1);
    setPhase('playing');
  }, [challenge, persist]);

  const restartOfficial = useCallback(() => {
    if (!challenge) return;
    persist(clearInProgress(stateRef.current));
    setResumeSnap(null);
    setPractice(false);
    setRunNonce((n) => n + 1);
    setPhase('playing');
  }, [challenge, persist]);

  const resumeOfficial = useCallback(() => {
    if (!challenge) return;
    setResumeSnap(resumable);
    setPractice(false);
    setRunNonce((n) => n + 1);
    setPhase('playing');
  }, [challenge, resumable]);

  const startPractice = useCallback(() => {
    setResumeSnap(null);
    setPractice(true);
    setRunNonce((n) => n + 1);
    setPhase('playing');
  }, []);

  const onSnapshot = useCallback(
    (snap: Omit<InProgress, 'date' | 'gameNumber' | 'updatedAt'>) => {
      // Only official runs persist an in-progress snapshot for safe resume.
      if (practice || !challenge) return;
      const full: InProgress = {
        ...snap,
        date: challenge.date,
        gameNumber: challenge.gameNumber,
        updatedAt: new Date().toISOString(),
      };
      persist(saveInProgress(stateRef.current, full));
    },
    [practice, challenge, persist],
  );

  const onComplete = useCallback(
    (result: RunResult) => {
      setLastResult(result);
      if (!practice && challenge && !hasCompleted(stateRef.current, challenge.date)) {
        const official: OfficialResult = {
          date: challenge.date,
          gameNumber: challenge.gameNumber,
          wpm: formatWpm(result.wpm),
          accuracy: result.accuracy,
          elapsedMs: result.elapsedMs,
          errors: result.errors,
          storiesCleared: result.storiesCleared,
          storyCount: result.storyCount,
          storyFraction: result.currentStoryFraction,
          completedAt: new Date().toISOString(),
        };
        persist(recordOfficialResult(stateRef.current, official));
      }
      setPhase('result');
    },
    [practice, challenge, persist],
  );

  const onSettingsChange = useCallback(
    (partial: Partial<Settings>) => {
      persist(updateSettings(stateRef.current, partial));
    },
    [persist],
  );

  const goHome = useCallback(() => setPhase('home'), []);

  // --- Render ---
  const currentStreak = stats.current;

  let body: ReactNode = null;
  if (phase === 'loading') body = <LoadingScreen />;
  else if (phase === 'error') body = <ErrorScreen message={loadError} onRetry={() => void load()} />;
  else if (!challenge) body = <LoadingScreen />;
  else if (phase === 'stats') body = <StatsView stats={stats} />;
  else if (phase === 'about') body = <AboutView />;
  else if (phase === 'playing')
    body = (
      <Play
        key={runNonce}
        challenge={challenge}
        settings={state.settings}
        resume={resumeSnap}
        onStart={() => {
          /* first keystroke; snapshotting handles persistence */
        }}
        onSnapshot={onSnapshot}
        onComplete={onComplete}
      />
    );
  else if (phase === 'result' && lastResult)
    body = (
      <Result
        challenge={challenge}
        result={lastResult}
        practice={practice}
        streak={currentStreak}
        longest={stats.longest}
        bestWpm={stats.bestWpm}
        gamesCompleted={stats.gamesCompleted}
        onPracticeAgain={startPractice}
        onViewStats={() => setPhase('stats')}
      />
    );
  // home
  else if (completedResult)
    body = (
      <CompletedCard
        challenge={challenge}
        result={completedResult}
        streak={currentStreak}
        onViewResult={() => {
          // Rebuild a minimal result view from the stored official result.
          setLastResult({
            wpm: completedResult.wpm,
            rawWpm: completedResult.wpm,
            accuracy: completedResult.accuracy,
            errors: completedResult.errors,
            completion: 1,
            elapsedMs: completedResult.elapsedMs,
            correctChars: 0,
            totalChars: 0,
            storyCount: completedResult.storyCount || challenge.stories.length,
            storiesCleared: completedResult.storiesCleared,
            timedOut: (completedResult.storiesCleared || 0) < (completedResult.storyCount || 0),
            currentStoryFraction: completedResult.storyFraction ?? 0,
            samples: [],
          });
          setPractice(false);
          setPhase('result');
        }}
        onPractice={startPractice}
        onViewStats={() => setPhase('stats')}
      />
    );
  else
    body = (
      <StartScreen
        challenge={challenge}
        isToday={isToday}
        resumable={Boolean(resumable)}
        onStart={resumable ? restartOfficial : startOfficial}
        onResume={resumeOfficial}
      />
    );

  return (
    <div className="app">
      <div className="container">
        <TopBar
          onHome={goHome}
          onStats={() => setPhase('stats')}
          onAbout={() => setPhase('about')}
          onSettings={() => setSettingsOpen(true)}
        />
      </div>
      <main className="main">
        <div className="container" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {body}
        </div>
      </main>
      <div className="container">
        <footer className="footer">
          <span>
            Keywulf &middot; <a onClick={goHome} style={{ cursor: 'pointer' }}>Daily news typeracing</a>
          </span>
          <span style={{ display: 'inline-flex', gap: 18 }}>
            <a onClick={() => setPhase('about')} style={{ cursor: 'pointer' }}>
              About
            </a>
            <a onClick={() => setPhase('stats')} style={{ cursor: 'pointer' }}>
              Stats
            </a>
            <a
              className="footer__credit"
              href="https://phosfox.us"
              target="_blank"
              rel="noopener noreferrer"
            >
              Made by Phosfox
            </a>
          </span>
        </footer>
      </div>

      {settingsOpen && (
        <SettingsDialog
          settings={state.settings}
          onChange={onSettingsChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
