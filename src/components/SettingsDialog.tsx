import { useEffect, useRef } from 'react';
import type { Settings, ThemePref, FontSize } from '../lib/storage';
import { CloseIcon } from './icons';

interface Props {
  settings: Settings;
  onChange: (partial: Partial<Settings>) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const haptorsSupported =
    typeof navigator !== 'undefined' && 'vibrate' in navigator;

  return (
    <div className="overlay" onPointerDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        ref={ref}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 style={{ fontSize: 18 }}>Settings</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>

        <div className="field">
          <div>
            <div className="field__label">Theme</div>
            <div className="field__desc">System, light, or dark.</div>
          </div>
          <div className="seg" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
              <button
                key={t}
                aria-pressed={settings.theme === t}
                onClick={() => onChange({ theme: t })}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div>
            <div className="field__label">Passage size</div>
            <div className="field__desc">Comfort of the text you type.</div>
          </div>
          <div className="seg" role="group" aria-label="Passage size">
            {(['small', 'medium', 'large'] as FontSize[]).map((t) => (
              <button
                key={t}
                aria-pressed={settings.fontSize === t}
                onClick={() => onChange({ fontSize: t })}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div>
            <div className="field__label">Reduced visual intensity</div>
            <div className="field__desc">Calmer colors and ambient motion.</div>
          </div>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.reducedIntensity}
            aria-pressed={settings.reducedIntensity}
            aria-label="Reduced visual intensity"
            onClick={() => onChange({ reducedIntensity: !settings.reducedIntensity })}
          />
        </div>

        <div className="field">
          <div>
            <div className="field__label">Live graph</div>
            <div className="field__desc">Show the performance trace while playing.</div>
          </div>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.showGraph}
            aria-pressed={settings.showGraph}
            aria-label="Live graph"
            onClick={() => onChange({ showGraph: !settings.showGraph })}
          />
        </div>

        <div className="field">
          <div>
            <div className="field__label">Haptics{!haptorsSupported ? ' (unsupported)' : ''}</div>
            <div className="field__desc">A short vibration on completion (supported phones).</div>
          </div>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.haptics}
            aria-pressed={settings.haptics}
            aria-label="Haptics"
            disabled={!haptorsSupported}
            onClick={() => onChange({ haptics: !settings.haptics })}
          />
        </div>

        <p className="field__desc">
          Progress is stored in this browser only. No account, no tracking.
        </p>
      </div>
    </div>
  );
}
