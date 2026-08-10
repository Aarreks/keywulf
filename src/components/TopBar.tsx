import { Mark, ChartIcon, InfoIcon, GearIcon } from './icons';

interface Props {
  onHome: () => void;
  onStats: () => void;
  onAbout: () => void;
  onSettings: () => void;
}

export function TopBar({ onHome, onStats, onAbout, onSettings }: Props) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="Keywulf home">
        <Mark />
        <span className="brand__word">
          Key<b>wulf</b>
        </span>
      </button>
      <nav className="navbtns" aria-label="Primary">
        <button className="iconbtn" onClick={onStats} aria-label="Stats" title="Stats">
          <ChartIcon />
        </button>
        <button className="iconbtn" onClick={onAbout} aria-label="About" title="About">
          <InfoIcon />
        </button>
        <button className="iconbtn" onClick={onSettings} aria-label="Settings" title="Settings">
          <GearIcon />
        </button>
      </nav>
    </header>
  );
}
