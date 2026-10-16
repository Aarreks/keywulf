import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommunityResult } from './CommunityResult';
import { communityRequest, getRankedRun, getVerification } from '../lib/communityClient';
import type { RankedRun } from '../lib/leaderboard';
import type { VerificationStatus } from '../lib/verification';
import { normalizeVerificationText, verificationTextHash, verificationTimeLimitMs } from '../lib/verification';

vi.mock('../lib/communityClient', async original => ({
  ...await original<typeof import('../lib/communityClient')>(),
  communityRequest: vi.fn(), getRankedRun: vi.fn(), getVerification: vi.fn(),
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
  vi.mocked(verificationTextHash).mockReset().mockImplementation(async (id, text) => `${id}:${normalizeVerificationText(text)}`);
  vi.mocked(getRankedRun).mockResolvedValue({ run }); vi.mocked(getVerification).mockResolvedValue(empty);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<CommunityResult date={run.date} replay="abc" elapsedMs={120_000} start={Promise.resolve(run)} onLeaderboard={() => {}} />));
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === text);
  expect(button).toBeDefined(); await act(async () => button!.click());
}

it('lets a pending fast score request verification without changing local game storage', async () => {
  localStorage.setItem('keywulf', 'unchanged');
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(communityRequest).mockResolvedValue({ ...running, attempt: { ...running.attempt!, status: 'ready' } });
  await render(); await click('Get verification passage');
  expect(container.textContent).toContain('113 WPM');
  expect(container.querySelector('img')).not.toBeNull();
  expect(container.textContent).toContain('Starts on your first character');
  expect(container.textContent).toContain('1.1 seconds');
  expect(localStorage.getItem('keywulf')).toBe('unchanged');
});

async function enterAnswer(text: string) {
  await act(async () => {
    const input = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('focuses before typing, starts on the first character and keeps typing enabled during the start request', async () => {
  const ready = { ...running, attempt: { ...running.attempt!, status: 'ready' as const, startedAt: null, expiresAt: 300_000 } };
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(ready);
  let acknowledge!: (value: VerificationStatus) => void;
  vi.mocked(communityRequest).mockReturnValueOnce(new Promise(resolve => { acknowledge = resolve; }))
    .mockResolvedValueOnce({ ...running, attempt: { ...running.attempt!, status: 'passed' } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  const input = container.querySelector('textarea')!;
  expect(input).toHaveFocus();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(communityRequest).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Starts on your first character');
  expect(container.textContent).not.toContain('Check speed');
  await enterAnswer('s');
  expect(vi.mocked(communityRequest).mock.calls.map(call => call[0])).toEqual(['verification/start']);
  expect(input.disabled).toBe(false); expect(input).toHaveFocus();
  await enterAnswer('some words');
  expect(communityRequest).toHaveBeenCalledTimes(1);
  await act(async () => acknowledge({ ...running, serverNow: 11_000, attempt: { ...running.attempt!, startedAt: 11_000, expiresAt: 11_000 + verificationTimeLimitMs(10, 113) } }));
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
  expect(container.textContent).toContain('Publish checked score');
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

it('highlights the first wrong character, keeps appended feedback useful and clears it immediately on correction', async () => {
  vi.mocked(getRankedRun).mockResolvedValue({ run: { ...run, status: 'pending', wpm: 150 } });
  vi.mocked(getVerification).mockResolvedValue(running);
  vi.mocked(communityRequest).mockResolvedValue({ id: 'check', mismatchIndex: 6 });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  await enterAnswer('some wurd');
  await act(async () => { await vi.advanceTimersByTimeAsync(39); });
  expect(communityRequest).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(container.querySelector('.verification-mirror .incorrect')?.textContent).toBe('u');
  expect(container.querySelector('textarea')).toHaveAttribute('aria-invalid', 'true');
  expect(vi.mocked(communityRequest).mock.calls[0][0]).toBe('verification/check');
  await enterAnswer('some wurds');
  expect(container.querySelector('.verification-mirror .incorrect')?.textContent).toBe('u');
  await enterAnswer('some wurx');
  expect(container.querySelector('.verification-mirror .incorrect')?.textContent).toBe('u');
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(communityRequest).toHaveBeenCalledTimes(1);
  await enterAnswer('some word');
  expect(container.querySelector('.verification-mirror .incorrect')).toBeNull();
  expect(container.querySelector('textarea')).toHaveAttribute('aria-invalid', 'false');
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
  expect(container.textContent).toContain('Publish checked score');
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
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#leaderboard-nickname')!;
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
  expect(container.textContent).toContain('Publish checked score');
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
  expect(container.textContent).toContain('0.0s remaining');
  expect(input.disabled).toBe(true);
  expect(container.textContent).toContain('Request a new passage');
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
  await click('Retry submission');
  expect(vi.mocked(communityRequest).mock.calls[0][1]).toEqual(vi.mocked(communityRequest).mock.calls[1][1]);
  expect(container.textContent).toContain('Publish checked score');
});
