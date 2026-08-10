interface Props {
  message: string;
  onRetry: () => void;
}

export function ErrorScreen({ message, onRetry }: Props) {
  return (
    <div className="errbox enter">
      <span className="pill">
        <span className="pill__dot" style={{ background: 'var(--bad)' }} />
        Could not load today's Keywulf
      </span>
      <h1 className="start__title" style={{ fontSize: 'clamp(28px, 5vw, 48px)' }}>
        Something went wrong.
      </h1>
      <p className="start__hint" style={{ maxWidth: '48ch' }}>
        {message}
      </p>
      <button className="btn btn--primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="errbox">
      <span className="pill">
        <span className="pill__dot" />
        Loading today's briefing
      </span>
    </div>
  );
}
