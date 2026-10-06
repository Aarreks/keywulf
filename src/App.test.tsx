import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fetchTodayChallenge, parseChallenge } from './lib/challengeClient';
import { loadState } from './lib/storage';
import sample from './data/sampleChallenge.json';

vi.mock('./lib/challengeClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/challengeClient')>(),
  fetchTodayChallenge: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${sample.date}T12:00:00Z`));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  localStorage.clear();
  vi.mocked(fetchTodayChallenge).mockReset();
  vi.mocked(fetchTodayChallenge).mockResolvedValue(parseChallenge(sample));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderApp() {
  await act(async () => root.render(<App />));
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  );
  expect(button, `Button ${label}`).toBeDefined();
  await act(async () => button!.click());
}

describe('visitor flows', () => {
  it('refreshes an idle tab at 01:00 UTC without showing a sample on failure', async () => {
    vi.setSystemTime(new Date(`${sample.date}T00:59:59Z`));
    await renderApp();
    expect(fetchTodayChallenge).toHaveBeenCalledTimes(1);
    vi.mocked(fetchTodayChallenge).mockRejectedValue(new Error('Fresh news is still being prepared'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(fetchTodayChallenge).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Fresh news is still being prepared');
    expect(container.querySelector('.start__actions')).toBeNull();
    expect(localStorage.getItem('keywulf')).toBeNull();
  });

  it('keeps an active corpus at rollover and loads the new briefing on returning home', async () => {
    vi.setSystemTime(new Date(`${sample.date}T00:59:59Z`));
    const previous = parseChallenge(sample);
    // The old day's corpus is still correct before the 01:00 release.
    previous.date = new Date(Date.parse(`${sample.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    vi.mocked(fetchTodayChallenge).mockResolvedValueOnce(previous).mockResolvedValue(parseChallenge(sample));
    await renderApp();
    await clickButton('Start');
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(fetchTodayChallenge).toHaveBeenCalledTimes(1);
    expect(container.querySelector('textarea')).not.toBeNull();
    await clickButton('Keywulf home');
    expect(fetchTodayChallenge).toHaveBeenCalledTimes(2);
  });

  it('reveals only completed-story photos and hides failed images', async () => {
    const challenge = parseChallenge(sample);
    challenge.stories = challenge.stories.slice(0, 2).map((story, i) => ({
      ...story, headline: 'A.', body: 'B.', photo: {
        url: `https://images.example/${i}.jpg`, alt: `Photo ${i}`,
        sourceUrl: 'https://publisher.example/article', sourceTitle: 'Original article',
      },
    }));
    vi.mocked(fetchTodayChallenge).mockResolvedValue(challenge);
    await renderApp();
    await clickButton('Start');
    expect(container.querySelector('.story-photos img')).toBeNull();
    await act(async () => {
      const input = container.querySelector('textarea')!;
      input.value = 'A. B.';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await clickButton('Keywulf home');
    await clickButton("Resume today's run");
    const images = container.querySelectorAll('.story-photos img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute('src', 'https://images.example/0.jpg');
    await act(async () => images[0].dispatchEvent(new Event('error')));
    expect(container.querySelector('.story-photos')).toBeNull();
    expect(container.querySelector('textarea')).not.toBeNull();
  });
  it('saves navigation-away progress and preserves mistakes on resume and backspace', async () => {
    await renderApp();
    await clickButton('Start');
    const input = container.querySelector('textarea')!;
    await act(async () => {
      input.value = 'xx';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await act(async () => vi.advanceTimersByTime(10_000));
    await clickButton('Keywulf home');
    expect(loadState().inProgress?.characterStatuses).toEqual([2, 2]);
    await clickButton("Resume today's run");
    expect(container.querySelectorAll('.ch.incorrect')).toHaveLength(2);
    expect(container.querySelector('.stat__val')).toHaveTextContent('0');
    expect(container.querySelectorAll('.stat__val')[1]).toHaveTextContent('0.0%');
    await act(async () => {
      const resumed = container.querySelector('textarea')!;
      resumed.value = resumed.value.slice(0, -1);
      resumed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    });
    await clickButton('Keywulf home');
    expect(loadState().inProgress?.characterStatuses).toEqual([2]);
    expect(loadState().inProgress?.incorrectKeystrokes).toBe(2);
  });

  it('keeps Settings focus inside the dialog during play and returns it on close', async () => {
    await renderApp();
    await clickButton('Start');
    const settings = container.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!;
    settings.focus();
    await clickButton('Settings');
    await act(async () => vi.runOnlyPendingTimers());
    const close = container.querySelector('[aria-label="Close settings"]')!;
    expect(close).toHaveFocus();
    await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
    })));
    const dialog = container.querySelector('[role="dialog"]')!;
    const enabled = dialog.querySelectorAll('button:not(:disabled)');
    expect(enabled[enabled.length - 1]).toHaveFocus();
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, cancelable: true,
    })));
    expect(close).toHaveFocus();
    await clickButton('Close settings');
    expect(settings).toHaveFocus();
  });
});
