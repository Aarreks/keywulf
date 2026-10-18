import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommunityResult } from './CommunityResult';
import { CommunityError, communityRequest, getBoard, getRankedRun, getVerification } from '../lib/communityClient';
import type { RankedRun } from '../lib/leaderboard';
import type { VerificationStatus } from '../lib/verification';
import { normalizeVerificationText, verificationTextHash, verificationTimeLimitMs } from '../lib/verification';

vi.mock('../lib/communityClient', async original => ({
  ...await original<typeof import('../lib/communityClient')>(),
  communityRequest: vi.fn(), getBoard: vi.fn(), getRankedRun: vi.fn(), getVerification: vi.fn(),
}));
vi.mock('../lib/verification', async original => ({
  ...await original<typeof import('../lib/verification')>(), verificationTextHash: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
const run: RankedRun = { id: 'run', name: 'Typist TEST', date: '2026-10-06', corpusHash: 'hash',
  status: 'running', startedAt: 0, wpm: null, accuracy: null, verified: false };
const empty: VerificationStatus = { attempt: null, receipt: null, serverNow: 1000, retryAt: null };
const running: VerificationStatus = { ...empty, attempt: { id: 'check', date: run.date, corpusHash: 'hash', claimedWpm: 150,
  requiredWpm: 113, characterCount: 10, textHash: 'check:some words', imageHeight: 240, status: 'running', startedAt: 1000, expiresAt: 1000 + verificationTimeLimitMs(10, 113), result: null } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(communityRequest).mockReset();
  vi.mocked(getBoard).mockResolvedValue({ date: run.date, entries: [] });
  vi.mocked(verificationTextHash).mockReset().mockImplementation(async (id, text) => `${id}:${normalizeVerificationText(text)}`);
  vi.mocked(getRankedRun).mockResolvedValue({ run }); vi.mocked(getVerification).mockResolvedValue(empty);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = (onLeaderboard = () => {}) => act(async () => root.render(<CommunityResult date={run.date} replay="abc" elapsedMs={120_000} start={Promise.resolve(run)} onLeaderboard={onLeaderboard} />));
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === text);
  expect(button).toBeDefined(); await act(async () => button!.click());
}

it('lets a pending fast score request verification without changing local game storage', async () => {
  localStorage.setItem('keywulf', 'unchanged');
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(communityRequest).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'ready' } });
  await render(); await click('Verify score');
  expect(container.textContent).toContain('113 WPM');
  expect(container.querySelector('img')).not.toBeNull();
  expect(container.textContent).toContain('Timing starts on your first character');
  expect(container.textContent).toContain('1.1s to type');
  expect(localStorage.getItem('keywulf')).toBe('unchanged');
});

async function enterAnswer(text: string) {
  await act(async () => {
    const input = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function enterNickname(text: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('#leaderboard-nickname')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('shows the top five immediately and never asks for a nickname before verification', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 80 } });
  vi.mocked(getBoard).mockResolvedValue({ date: run.date, entries: Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: `Fox ${i + 1}`, wpm: 100 - i, accuracy: 1, verified: true })) });
  await render();
  expect(container.querySelectorAll('[role="row"]')).toHaveLength(6);
  expect(container.textContent).toContain('Fox 5');
  expect(container.textContent).not.toContain('Fox 6');
  expect(document.querySelector('#leaderboard-nickname')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('reads the current published score when returning with an old finish promise, without reopening nickname selection', async () => {
  const pending = { ...run, status: 'pending' as const, wpm: 80 };
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...pending, status: 'published', name: 'Posted Fox', verified: true } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'passed' } });
  await act(async () => root.render(<CommunityResult date={run.date} elapsedMs={120_000} finish={Promise.resolve(pending)} onLeaderboard={() => {}} />));
  expect(container.textContent).toContain('Posted as Posted Fox');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('offers a saved verification pass without automatically reopening its nickname popup', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 80 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'passed' } });
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Post score');
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Verification passed');
});

it('opens the nickname popup after one pass, rejects invalid names locally and navigates only after a confirmed post', async () => {
  const pending = { ...run, status: 'pending' as const, wpm: 80 };
  const onBoard = vi.fn();
  vi.mocked(getRankedRun).mockResolvedValue({ run: pending });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockResolvedValueOnce({ ...running, attempt: { ...running.attempt!, status: 'passed' } })
    .mockResolvedValueOnce({ run: { ...pending, status: 'published', name: 'Valid Fox', verified: true } });
  await render(onBoard);
  expect(document.querySelector('#leaderboard-nickname')).toBeNull();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some words');
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Verification passed');
  expect(document.querySelector('#leaderboard-nickname')).toHaveFocus();
  expect(onBoard).not.toHaveBeenCalled();
  await enterNickname('bad@name'); await click('Post score');
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent('Use 2–24');
  expect(communityRequest).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain('Posted as');
  await enterNickname('Valid Fox'); await click('Post score');
  expect(vi.mocked(communityRequest).mock.calls.map(call => call[0])).toEqual(['verification/finish', 'runs/publish']);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain('Posted as Valid Fox');
  expect(onBoard).toHaveBeenCalledTimes(1);
});

it('keeps a verified score private when posting is rejected and reuses the same pass on retry', async () => {
  const pending = { ...run, status: 'pending' as const, wpm: 80 };
  const onBoard = vi.fn();
  vi.mocked(getRankedRun).mockResolvedValue({ run: pending });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'passed' } });
  vi.mocked(communityRequest).mockRejectedValueOnce(new CommunityError('That nickname is invalid', 400))
    .mockResolvedValueOnce({ run: pending })
    .mockResolvedValueOnce({ run: { ...pending, status: 'published', verified: true } });
  await render(onBoard);
  await click('Post score');
  await enterNickname('Valid Fox'); await click('Post score');
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent('That nickname is invalid');
  expect(onBoard).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('Posted as');
  await click('Post score');
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent('Posting was not confirmed');
  expect(onBoard).not.toHaveBeenCalled();
  await click('Post score');
  expect(onBoard).toHaveBeenCalledTimes(1);
  expect(vi.mocked(communityRequest).mock.calls.every(call => call[0] === 'runs/publish')).toBe(true);
});

it('lets the nickname popup close and reopen without requesting another verification passage', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 80 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'passed' } });
  await render();
  await click('Post score');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close nickname"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Post score');
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Verification passed');
  expect(communityRequest).not.toHaveBeenCalled();
});

it('counts down the time to start separately and switches to typing time on the first character', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'ready', startedAt: null, expiresAt: 11_000 } });
  vi.mocked(communityRequest).mockResolvedValue({ ...running, serverNow: 2000, attempt: { ...running.attempt!, startedAt: 2000, expiresAt: 2000 + verificationTimeLimitMs(10, 113) } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  expect(container.querySelector('[role="timer"]')).toHaveTextContent('Start within 10.0s · 1.1s to type');
  expect(container.querySelector('[role="timer"]')).toHaveAttribute('aria-label', 'Time to start');
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector('[role="timer"]')).toHaveTextContent('Start within 9.0s · 1.1s to type');
  expect(communityRequest).not.toHaveBeenCalled();
  await enterAnswer('s');
  expect(container.querySelector('[role="timer"]')).toHaveTextContent('1.1s remaining · No pause');
  expect(container.querySelector('[role="timer"]')).toHaveAttribute('aria-label', 'Time remaining');
  expect(container.textContent).not.toContain('Start within');
});

it('shows the remaining server-provided start window rather than resetting ten seconds on load', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'ready', startedAt: null, expiresAt: 8000 } });
  await render();
  expect(container.querySelector('[role="timer"]')).toHaveTextContent('Start within 7.0s');
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector('[role="timer"]')).toHaveTextContent('Start within 6.0s');
  expect(communityRequest).not.toHaveBeenCalled();
});

it('focuses before typing, starts on the first character and keeps typing enabled during the start request', async () => {
  const ready = { ...running, attempt: { ...running.attempt!, status: 'ready' as const, startedAt: null, expiresAt: 11_000 } };
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(ready);
  let acknowledge!: (value: VerificationStatus) => void;
  vi.mocked(communityRequest).mockReturnValueOnce(new Promise(resolve => { acknowledge = resolve; }))
    .mockResolvedValueOnce({ ...running, attempt: { ...running.attempt!, status: 'passed' } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  const input = container.querySelector('textarea')!;
  expect(input).toHaveFocus();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(communityRequest).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Timing starts on your first character');
  expect(container.textContent).not.toContain('Check speed');
  await enterAnswer('s');
  expect(vi.mocked(communityRequest).mock.calls.map(call => call[0])).toEqual(['verification/start']);
  expect(input.disabled).toBe(false); expect(input).toHaveFocus();
  await enterAnswer('some words');
  expect(communityRequest).toHaveBeenCalledTimes(1);
  await act(async () => acknowledge({ ...running, serverNow: 3000, attempt: { ...running.attempt!, startedAt: 3000, expiresAt: 3000 + verificationTimeLimitMs(10, 113) } }));
  expect(vi.mocked(communityRequest).mock.calls.map(call => call[0])).toEqual(['verification/start', 'verification/finish']);
});

it('automatically submits a full exact match once, but not a same-length typo', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'passed' } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some wurds');
  expect(communityRequest).not.toHaveBeenCalled();
  await enterAnswer('SOME   words ');
  expect(communityRequest).toHaveBeenCalledTimes(1);
  expect(vi.mocked(communityRequest).mock.calls[0][0]).toBe('verification/finish');
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Verification passed');
});

it('retires an idle passage when its ten-second readiness window expires', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'ready', startedAt: null, expiresAt: 11_000 } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.querySelector('[role="timer"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Speed check failed');
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('10 seconds');
  expect(container.textContent).toContain('Verify score');
  expect(communityRequest).not.toHaveBeenCalled();
});

it.each([404, 410])('retires a stale passage when the first keystroke is rejected with HTTP %s', async code => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'ready', startedAt: null, expiresAt: 11_000 } });
  vi.mocked(communityRequest).mockRejectedValue(new CommunityError('Challenge expired. Request a new passage.', code));
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('x');
  expect(container.querySelector('[role="timer"]')).toBeNull();
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.textContent).toContain('Verify score');
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
});

it('recovers from a rejected start with a fresh passage without reloading the page', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'ready', startedAt: null, expiresAt: 11_000 } });
  vi.mocked(communityRequest).mockRejectedValueOnce(new CommunityError('Challenge expired. Request a new passage.', 410))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce({ ...running, attempt: { ...running.attempt!, id: 'replacement', status: 'ready', startedAt: null, expiresAt: 11_000 } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('x');
  await click('Retry');
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('textarea')).toHaveValue('');
  expect(container.querySelector('textarea')).toHaveFocus();
  expect(container.querySelector('textarea')!.disabled).toBe(false);
  expect(container.textContent).toContain('Timing starts on your first character');
});

it('does not extend the ready passage lifetime when a transient start failure stops the optimistic timer', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'ready', startedAt: null, expiresAt: 11_000 } });
  vi.mocked(communityRequest).mockRejectedValue(new Error('Offline'));
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  await enterAnswer('x');
  expect(container.textContent).toContain('Timing starts on your first character');
  await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.querySelector('[role="timer"]')).toBeNull();
});

it.each(['feedback', 'submission'])('retires an attempt rejected as expired during %s', async operation => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockRejectedValue(new CommunityError('Challenge expired. Request a new passage.', 410));
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer(operation === 'feedback' ? 'x' : 'some words');
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.querySelector('[role="timer"]')).toBeNull();
  expect(container.textContent).not.toContain('Retry submission');
  expect(container.textContent).toContain('Verify score');
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
});

it('ignores a matching hash that finishes after the player changes the text', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  let finishHash!: (hash: string) => void;
  vi.mocked(verificationTextHash).mockReturnValueOnce(new Promise(resolve => { finishHash = resolve; }));
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some words');
  await enterAnswer('some wordsx');
  await act(async () => finishHash('check:some words'));
  expect(communityRequest).not.toHaveBeenCalled();
});

it('highlights the entire incorrect suffix and input, and clears them on correction', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockResolvedValue({ id: 'check', mismatchIndex: 6 });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some wurd');
  await act(async () => { await vi.advanceTimersByTimeAsync(39); });
  expect(communityRequest).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(container.querySelector('.verification-mirror .incorrect')?.textContent).toBe('urd');
  expect(container.querySelector('textarea')).toHaveAttribute('aria-invalid', 'true');
  expect(container.querySelector('.verification-editor')).toHaveClass('verification-editor--incorrect');
  expect(vi.mocked(communityRequest).mock.calls[0][0]).toBe('verification/check');
  await enterAnswer('some wurds');
  expect(container.querySelector('.verification-mirror .incorrect')?.textContent).toBe('urds');
  await enterAnswer('some wurx');
  expect(container.querySelector('.verification-mirror .incorrect')?.textContent).toBe('urx');
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
  await enterAnswer('some word');
  expect(container.querySelector('.verification-mirror .incorrect')).toBeNull();
  expect(container.querySelector('textarea')).toHaveAttribute('aria-invalid', 'false');
  expect(container.querySelector('.verification-editor')).not.toHaveClass('verification-editor--incorrect');
});

it('coalesces fast typing, checks the latest text and reuses confirmed prefixes without polling', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockResolvedValue({ id: 'check', mismatchIndex: null });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('s');
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  await enterAnswer('so');
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
  expect(vi.mocked(communityRequest).mock.calls[0][1]).toEqual({ id: 'check', text: 'so' });
  await enterAnswer('som');
  await act(async () => { await vi.advanceTimersByTimeAsync(70); });
  await enterAnswer('some');
  await act(async () => { await vi.advanceTimersByTimeAsync(79); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(communityRequest).toHaveBeenCalledTimes(2);
  expect(vi.mocked(communityRequest).mock.calls[1][1]).toEqual({ id: 'check', text: 'some' });
  await enterAnswer('so');
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(communityRequest).toHaveBeenCalledTimes(2);
});

it('keeps one feedback request in flight and follows it with the latest edit', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  let reply!: (value: { id: string; mismatchIndex: number | null }) => void;
  vi.mocked(communityRequest).mockReturnValueOnce(new Promise(resolve => { reply = resolve; }))
    .mockResolvedValue({ id: 'check', mismatchIndex: null });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some wurd');
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  await enterAnswer('some word');
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
  await act(async () => reply({ id: 'check', mismatchIndex: 6 }));
  expect(container.querySelector('.verification-mirror .incorrect')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(99); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(communityRequest).toHaveBeenCalledTimes(2);
  expect(vi.mocked(communityRequest).mock.calls[1][1]).toEqual({ id: 'check', text: 'some word' });
});

it('backs off failed feedback requests without continually polling unchanged successful text', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, characterCount: 200, expiresAt: 30_000 } });
  vi.mocked(communityRequest).mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue({ id: 'check', mismatchIndex: null });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some');
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  await enterAnswer('some word');
  await act(async () => { await vi.advanceTimersByTimeAsync(799); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(communityRequest).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(communityRequest).toHaveBeenCalledTimes(2);
});

it('ignores delayed feedback for edited text and highlights invalid characters without a server query', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...running, attempt: { ...running.attempt!, characterCount: 200, expiresAt: 30_000 } });
  let reply!: (value: { id: string; mismatchIndex: number }) => void;
  vi.mocked(communityRequest).mockReturnValue(new Promise(resolve => { reply = resolve; }));
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some wurd');
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  await enterAnswer('some word');
  await act(async () => reply({ id: 'check', mismatchIndex: 6 }));
  expect(container.querySelector('.verification-mirror .incorrect')).toBeNull();
  await enterAnswer('some word!');
  expect(container.querySelector('.verification-mirror .incorrect')?.textContent).toBe('!');
  expect(communityRequest).toHaveBeenCalledTimes(1);
});

it('keeps typing and exact-match submission working if optional feedback is unavailable', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockRejectedValueOnce(new Error('Feedback unavailable'))
    .mockResolvedValueOnce({ ...running, attempt: { ...running.attempt!, status: 'passed' } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some word');
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('textarea')!.disabled).toBe(false);
  await enterAnswer('some words');
  expect(vi.mocked(communityRequest).mock.calls.map(call => call[0])).toEqual(['verification/check', 'verification/finish']);
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Verification passed');
});

it('ignores a stale initial read arriving after a successful score submission', async () => {
  let finishRead!: (value: { run: RankedRun }) => void;
  vi.mocked(getRankedRun).mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
  vi.mocked(communityRequest).mockResolvedValue({ run: { ...run, status: 'published', wpm: 70 } });
  await render(); await click('Join leaderboard');
  expect(container.textContent).toContain('Posted as');
  await act(async () => finishRead({ run }));
  expect(container.textContent).toContain('Posted as');
});

it('lets the owner update a published nickname without submitting the replay again', async () => {
  const saved = { ...run, status: 'published' as const, wpm: 70, verified: true };
  vi.mocked(getRankedRun).mockResolvedValue({ run: saved });
  vi.mocked(communityRequest).mockResolvedValue({ run: { ...saved, name: 'Fox 2' } });
  await render();
  await click('Edit nickname');
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('#leaderboard-nickname')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Fox 2');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Save nickname');
  expect(vi.mocked(communityRequest).mock.calls.map(call => call[0])).toEqual(['runs/publish']);
  expect(vi.mocked(communityRequest).mock.calls[0][1]).toEqual({ date: run.date, id: run.id, nickname: 'Fox 2' });
  expect(container.textContent).toContain('Fox 2');
});

it('recovers a passed receipt after the short-lived challenge record expires', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue({ ...empty, receipt: { id: 'old-check', date: run.date, corpusHash: run.corpusHash,
    claimedWpm: 150, requiredWpm: 113, measuredWpm: 120, accuracy: 1, verifiedAt: 0, validUntil: 10_000 } });
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Post score');
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Verification passed');
});

it('uses the running server deadline, blocks paste and permits a new passage after expiry', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  await render();
  const image = container.querySelector('img')!;
  await act(async () => image.dispatchEvent(new Event('load')));
  const input = container.querySelector('textarea')!;
  expect(document.activeElement).toBe(input);
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  await act(async () => { input.dispatchEvent(paste); });
  expect(paste.defaultPrevented).toBe(true);
  expect(container.textContent).toContain('1.1s remaining');
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(container.textContent).toContain('1.0s remaining');
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector('textarea')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Time ran out.');
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Retry');
  await click('Give up');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain('Verify score');
});

it.each(['speed', 'mismatch'] as const)('shows a confirmed %s failure with retry and give-up actions', async reason => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockResolvedValueOnce({ ...running, attempt: { ...running.attempt!, status: 'failed',
    result: { passed: false, measuredWpm: 110, accuracy: Number(reason !== 'mismatch'), elapsedMs: 1100, reason } } })
    .mockResolvedValueOnce({ ...running, attempt: { ...running.attempt!, id: 'retry', status: 'ready', startedAt: null, expiresAt: 11_000 } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some words');
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).toHaveTextContent('Speed check failed');
  expect(dialog).toHaveTextContent(reason === 'speed' ? 'You needed 113 WPM.' : 'The passage didn’t match.');
  expect(dialog.querySelector('button')).toHaveFocus();
  await click('Retry');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('textarea')).toHaveValue('');
  expect(vi.mocked(communityRequest).mock.calls.map(call => call[0])).toEqual(['verification/finish', 'verification/issue']);
});

it('keeps a failed retry in the failure popup, traps focus, and gives up without changing the daily result', async () => {
  localStorage.setItem('keywulf', 'daily result');
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockRejectedValueOnce(new CommunityError('Challenge expired', 410))
    .mockRejectedValueOnce(new CommunityError('Try again later.', 429));
  await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  const retry = document.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
  expect(retry).toHaveFocus();
  await act(async () => retry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toHaveTextContent('Give up');
  await click('Retry');
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent('Try again later.');
  await click('Give up');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(localStorage.getItem('keywulf')).toBe('daily result');
});

it('keeps the same answer for retry after an unknown network outcome', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ ...running,
    attempt: { ...running.attempt!, status: 'passed', result: { passed: true, measuredWpm: 120, accuracy: 1, elapsedMs: 20_000, reason: 'passed' } } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some words');
  expect(container.textContent).toContain('Connection lost');
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Retry submission');
  expect(vi.mocked(communityRequest).mock.calls[0][1]).toEqual(vi.mocked(communityRequest).mock.calls[1][1]);
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Verification passed');
});
