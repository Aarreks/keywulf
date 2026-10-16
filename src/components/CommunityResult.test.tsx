import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommunityResult } from './CommunityResult';
import { communityRequest, getRankedRun, getVerification } from '../lib/communityClient';
import type { RankedRun } from '../lib/leaderboard';
import type { VerificationStatus } from '../lib/verification';

vi.mock('../lib/communityClient', async original => ({
  ...await original<typeof import('../lib/communityClient')>(),
  communityRequest: vi.fn(), getRankedRun: vi.fn(), getVerification: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
const run: RankedRun = { id: 'run', name: 'Typist TEST', date: '2026-10-06', corpusHash: 'hash',
  status: 'running', startedAt: 0, wpm: null, accuracy: null, verified: false };
const empty: VerificationStatus = { attempt: null, receipt: null, serverNow: 1000, retryAt: null };
const running: VerificationStatus = { ...empty, attempt: { id: 'check', date: run.date, corpusHash: 'hash', claimedWpm: 150,
  requiredWpm: 113, characterCount: 200, imageHeight: 240, status: 'running', startedAt: 1000, expiresAt: 61_000, result: null } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(communityRequest).mockReset();
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
  expect(container.querySelector('img')).toBeNull();
  expect(localStorage.getItem('keywulf')).toBe('unchanged');
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
  await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
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
  await act(async () => {
    const input = container.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(input, 'some words'); input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => container.querySelector('textarea')!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(container.textContent).toContain('Connection lost');
  await act(async () => container.querySelector('textarea')!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(vi.mocked(communityRequest).mock.calls[0][1]).toEqual(vi.mocked(communityRequest).mock.calls[1][1]);
  expect(container.textContent).toContain('Publish checked score');
});
