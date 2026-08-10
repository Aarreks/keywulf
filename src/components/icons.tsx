// Small inline SVG icons + the Keywulf mark. No icon library; these are tiny
// and inherit currentColor.

// The Keywulf mark: two round typewriter keys, "K" and "W", set at slightly
// different heights like keys on a typebar basket.
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={(size * 60) / 40}
      height={size}
      viewBox="0 0 60 40"
      className="brand__mark"
      aria-hidden="true"
      focusable="false"
    >
      <g>
        {/* K key (slightly raised) */}
        <circle cx="16" cy="17" r="14" fill="var(--ink)" />
        <circle cx="16" cy="17" r="11.4" fill="none" stroke="var(--bg)" strokeWidth="1.4" />
        <text
          x="16"
          y="22"
          textAnchor="middle"
          fontFamily="'Courier Prime', 'Courier New', monospace"
          fontWeight="700"
          fontSize="13"
          fill="var(--bg)"
        >
          K
        </text>
        {/* W key (slightly lowered, overlapping like a struck pair) */}
        <circle cx="42" cy="23" r="14" fill="var(--ember)" />
        <circle cx="42" cy="23" r="11.4" fill="none" stroke="var(--bg)" strokeWidth="1.4" />
        <text
          x="42"
          y="28"
          textAnchor="middle"
          fontFamily="'Courier Prime', 'Courier New', monospace"
          fontWeight="700"
          fontSize="13"
          fill="#fbf8f0"
        >
          W
        </text>
      </g>
    </svg>
  );
}

type IconProps = { size?: number };

export function ChartIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function InfoIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function GearIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CloseIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ShareIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 3v13M12 3L8 7M12 3l4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5l5 5 11-12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
